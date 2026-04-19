"use client";

import { useState, useCallback } from "react";
import {
  initiateUpload,
  uploadToPresignedUrl,
  finalizeUpload,
  getMediaSignedUrl,
  preCheckMedia,
  initiateMultipartUpload,
  presignMultipartParts,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  type MediaType,
  type MediaTypeLarge,
} from "@/lib/api/media";

// ─── Constants ────────────────────────────────────────────────────────────────

const MULTIPART_THRESHOLD = 30 * 1024 * 1024; // 30 MB
const PART_SIZE = 10 * 1024 * 1024; // 10 MB per part
const MAX_PARALLEL_PARTS = 3;

type UploadStatus = "idle" | "checking" | "uploading" | "finalizing" | "processing" | "ready" | "error";

interface UploadState {
  status: UploadStatus;
  progress: number;
  mediaId: string | null;
  error: string | null;
}

// ─── MIME helpers ─────────────────────────────────────────────────────────────

const mimeToType = (mime: string): MediaType => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
};

const mimeToTypeLarge = (mime: string): MediaTypeLarge => {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  return "FILE";
};

// ─── Multipart upload helper ──────────────────────────────────────────────────

async function multipartUpload(
  file: File,
  onProgress: (pct: number) => void
): Promise<string> {
  const totalParts = Math.ceil(file.size / PART_SIZE);
  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

  // Step 1: Init
  const { mediaId } = await initiateMultipartUpload({
    filename: file.name,
    mimeType: file.type,
    type: mimeToTypeLarge(file.type),
    totalSize: file.size,
  });

  try {
    // Step 2: Get presigned URLs in batches
    const partUrls = await presignMultipartParts({ mediaId, partNumbers });
    const urlMap = new Map(partUrls.map((p) => [p.partNumber, p.url]));

    // Step 3: Upload parts with limited concurrency and collect ETags.
    // uploadPart reads the ETag from the PUT response header.
    // If ETag is missing (CORS not configured), it throws and the catch
    // block below aborts the multipart session immediately.
    const completedParts: { partNumber: number; eTag: string }[] = [];
    let uploaded = 0;

    for (let i = 0; i < totalParts; i += MAX_PARALLEL_PARTS) {
      const batch = partNumbers.slice(i, i + MAX_PARALLEL_PARTS);
      await Promise.all(
        batch.map(async (partNum) => {
          const start = (partNum - 1) * PART_SIZE;
          const chunk = file.slice(start, start + PART_SIZE);
          const url = urlMap.get(partNum)!;
          const eTag = await uploadPart(url, chunk, file.type);
          completedParts.push({ partNumber: partNum, eTag });
          uploaded += 1;
          onProgress(Math.round((uploaded / totalParts) * 95)); // reserve 5% for complete
        })
      );
    }

    // Step 4: Complete — sort ascending by partNumber as S3 requires.
    completedParts.sort((a, b) => a.partNumber - b.partNumber);
    await completeMultipartUpload({ mediaId, parts: completedParts });
    onProgress(100);
    return mediaId;
  } catch (err) {
    // Best-effort cleanup
    if (process.env.NODE_ENV === "development") {
      console.error('[multipartUpload] Upload failed:', { mediaId, error: err });
    }
    abortMultipartUpload(mediaId).catch(() => {});
    throw err;
  }
}

// ─── useMediaUpload ───────────────────────────────────────────────────────────

export function useMediaUpload(conversationId: string) {
  const [state, setState] = useState<UploadState>({
    status: "idle",
    progress: 0,
    mediaId: null,
    error: null,
  });

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      setState({ status: "checking", progress: 0, mediaId: null, error: null });

      try {
        const mediaId = await uploadFileDirect(file, conversationId, (progress) => {
          setState((s) => ({
            ...s,
            status: progress >= 100 ? "finalizing" : "uploading",
            progress,
          }));
        });

        if (!mediaId) {
          setState((s) => ({ ...s, status: "error", error: s.error ?? "Upload failed" }));
          return null;
        }

        setState({ status: "ready", progress: 100, mediaId, error: null });
        return mediaId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setState((s) => ({ ...s, status: "error", error: msg }));
        return null;
      }
    },
    [conversationId]
  );

  const reset = useCallback(() => {
    setState({ status: "idle", progress: 0, mediaId: null, error: null });
  }, []);

  return { ...state, upload, reset };
}

// ─── Stateless single-file upload (no shared state — safe for parallel calls) ─

export async function uploadFileDirect(
  file: File,
  conversationId: string,
  onProgress?: (progress: number) => void
): Promise<string | null> {
  try {
    const check = await preCheckMedia({
      conversationId,
      mimeType: file.type,
      fileSize: file.size,
    });
    if (!check.approved) return null;

    if (file.size >= MULTIPART_THRESHOLD) {
      return await multipartUpload(file, (progress) => {
        onProgress?.(progress);
      });
    }

    const { mediaId, uploadUrl } = await initiateUpload({
      type: mimeToType(file.type),
      mimeType: file.type,
      size: file.size,
      filename: file.name,
    });
    await uploadToPresignedUrl(uploadUrl, file, (progress) => {
      onProgress?.(Math.min(progress, 95));
    });
    onProgress?.(100);
    await finalizeUpload({ mediaId });
    return mediaId;
  } catch {
    return null;
  }
}

// ─── Poll /media/:mediaId/url until worker is done ───────────────────────────

export async function pollForSignedUrl(
  mediaId: string,
  maxAttempts = 15,
  intervalMs = 2_000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, intervalMs));
    try {
      return await getMediaSignedUrl(mediaId);
    } catch {
      // not ready yet — keep polling
    }
  }
  throw new Error("Timed out waiting for media processing");
}

// ─── Avatar upload (no preCheck) ─────────────────────────────────────────────

interface AvatarUploadState {
  status: UploadStatus;
  progress: number;
  mediaId: string | null;
  error: string | null;
}

export function useAvatarUpload() {
  const [state, setState] = useState<AvatarUploadState>({
    status: "idle",
    progress: 0,
    mediaId: null,
    error: null,
  });

  const upload = useCallback(async (file: File): Promise<string | null> => {
    setState({ status: "uploading", progress: 0, mediaId: null, error: null });
    try {
      const { mediaId, uploadUrl } = await initiateUpload({
        type: "image",
        mimeType: file.type,
        size: file.size,
        filename: file.name,
      });

      await uploadToPresignedUrl(uploadUrl, file, (progress) => {
        setState((s) => ({ ...s, progress }));
      });

      setState((s) => ({ ...s, status: "finalizing", progress: 100 }));
      await finalizeUpload({ mediaId });

      setState({ status: "ready", progress: 100, mediaId, error: null });
      return mediaId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setState((s) => ({ ...s, status: "error", error: msg }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", progress: 0, mediaId: null, error: null });
  }, []);

  return { ...state, upload, reset };
}
