"use client";

import { useState, useCallback } from "react";
import {
  initiateUpload,
  uploadToPresignedUrl,
  finalizeUpload,
  getMediaSignedUrl,
  preCheckMedia,
  type MediaType,
} from "@/lib/api/media";

type UploadStatus = "idle" | "checking" | "uploading" | "finalizing" | "processing" | "ready" | "error";

interface UploadState {
  status: UploadStatus;
  progress: number;
  mediaId: string | null;
  error: string | null;
}

const mimeToType = (mime: string): MediaType => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
};

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
        // Step 0: Pre-check permission
        const check = await preCheckMedia({
          conversationId,
          mimeType: file.type,
          fileSize: file.size,
        });
        if (!check.approved) {
          setState((s) => ({ ...s, status: "error", error: check.reason ?? "Not allowed" }));
          return null;
        }

        // Step 1: Initiate
        setState((s) => ({ ...s, status: "uploading" }));
        const { mediaId, uploadUrl } = await initiateUpload({
          type: mimeToType(file.type),
          mimeType: file.type,
          size: file.size,
          filename: file.name,
        });

        // Step 2: PUT to presigned URL
        await uploadToPresignedUrl(uploadUrl, file, (progress) => {
          setState((s) => ({ ...s, progress }));
        });

        // Step 3: Finalize
        setState((s) => ({ ...s, status: "finalizing", progress: 100 }));
        await finalizeUpload({ mediaId });

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

// ─── Poll /media/:mediaId/url until worker is done ───────────────────────────
// The /url endpoint returns an error until status = READY; retry until success.

async function pollForSignedUrl(
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
// Flow: Initiate → PUT MinIO → Finalize → poll READY → signed URL

interface AvatarUploadState {
  status: UploadStatus;
  progress: number;
  mediaId: string | null;
  url: string | null;
  error: string | null;
}

export function useAvatarUpload() {
  const [state, setState] = useState<AvatarUploadState>({
    status: "idle",
    progress: 0,
    mediaId: null,
    url: null,
    error: null,
  });

  const upload = useCallback(async (file: File): Promise<string | null> => {
    setState({ status: "uploading", progress: 0, mediaId: null, url: null, error: null });
    try {
      // Step 1: Initiate — get pre-signed PUT URL
      const { mediaId, uploadUrl } = await initiateUpload({
        type: "image",
        mimeType: file.type,
        size: file.size,
        filename: file.name,
      });

      // Step 2: Upload directly to MinIO
      await uploadToPresignedUrl(uploadUrl, file, (progress) => {
        setState((s) => ({ ...s, progress }));
      });

      // Step 3: Finalize — tells backend file is in MinIO, triggers worker
      setState((s) => ({ ...s, status: "finalizing", progress: 100 }));
      await finalizeUpload({ mediaId });

      // Step 4 + 5: Poll /media/:mediaId/url until worker finishes → signed URL
      setState((s) => ({ ...s, status: "processing" }));
      const signedUrl = await pollForSignedUrl(mediaId);
      setState({ status: "ready", progress: 100, mediaId, url: signedUrl, error: null });
      return signedUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setState((s) => ({ ...s, status: "error", error: msg }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", progress: 0, mediaId: null, url: null, error: null });
  }, []);

  return { ...state, upload, reset };
}
