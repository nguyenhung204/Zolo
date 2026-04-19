import { apiClient } from "@/lib/api/client";

export type MediaType = "image" | "video" | "file" | "audio";
export type MediaTypeLarge = "IMAGE" | "VIDEO" | "FILE";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MediaInitResponse {
  mediaId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface MultipartInitResponse {
  mediaId: string;
  uploadId: string;
  objectKey: string;
}

export interface PartUrl {
  partNumber: number;
  url: string;
}

export interface PartRef {
  partNumber: number;
  eTag: string;
}

export interface MediaEntity {
  mediaId: string;
  url: string;
  thumbnailUrl?: string;
  expiresAt: string;
  status: "CREATED" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
}

// ─── Small file upload (< 10 MB) ─────────────────────────────────────────────

export async function initiateUpload(params: {
  type: MediaType;
  mimeType: string;
  size: number;
  filename: string;
}): Promise<MediaInitResponse> {
  const res = await apiClient.post("/media/upload", params);
  return res.data.data;
}

export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: File | Blob,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file instanceof File ? file.type : "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

export async function finalizeUpload(params: {
  mediaId: string;
  checksum?: string;
  checksumAlgorithm?: "sha256" | "md5";
}): Promise<MediaEntity> {
  const res = await apiClient.post("/media/upload/complete", params);
  return res.data.data;
}

// ─── Multipart upload (≥ 10 MB) ──────────────────────────────────────────────

export async function initiateMultipartUpload(params: {
  filename: string;
  mimeType: string;
  type: MediaTypeLarge;
  totalSize: number;
}): Promise<MultipartInitResponse> {
  const res = await apiClient.post("/media/multipart/init", params);
  return res.data.data;
}

export async function presignMultipartParts(params: {
  mediaId: string;
  partNumbers: number[];
  expiresIn?: number;
}): Promise<PartUrl[]> {
  const res = await apiClient.post("/media/multipart/presign-parts", params);
  return Array.isArray(res.data?.data) ? res.data.data : [];
}

export async function completeMultipartUpload(params: {
  mediaId: string;
  parts: PartRef[];
}): Promise<MediaEntity> {
  const res = await apiClient.post("/media/multipart/complete", params);
  return res.data.data;
}

export async function listMultipartParts(mediaId: string): Promise<PartRef[]> {
  const res = await apiClient.get(`/media/multipart/${mediaId}/parts`);
  const data = res.data?.data;
  return Array.isArray(data) ? data : [];
}

export async function abortMultipartUpload(mediaId: string): Promise<void> {
  await apiClient.delete(`/media/multipart/${mediaId}`);
}

// ─── Upload a single part and return its ETag ────────────────────────────────
//
// The presigned PUT URL must respond with an ETag header. This requires
// MinIO / S3 to include `ETag` in Access-Control-Expose-Headers (CORS).
// If the header is missing, the function rejects so the caller can abort
// the multipart session rather than submitting empty ETags to S3.

export async function uploadPart(
  uploadUrl: string,
  chunk: Blob,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 300) {
        reject(new Error(`Part upload failed: ${xhr.status}`));
        return;
      }
      // Read ETag from response header (requires ETag in CORS expose-headers).
      const raw = xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag") ?? "";
      const etag = raw.trim();
      if (!etag || etag === '""') {
        reject(new Error(
          "ETag missing from part upload response. " +
          "Ensure MinIO/S3 exposes the ETag header via Access-Control-Expose-Headers."
        ));
        return;
      }
      // Ensure the ETag is quoted as S3 requires.
      resolve(etag.startsWith('"') ? etag : `"${etag}"`);
    };
    xhr.onerror = () => reject(new Error("Part upload network error"));
    xhr.send(chunk);
  });
}

// ─── Media management ─────────────────────────────────────────────────────────

export async function preCheckMedia(params: {
  conversationId: string;
  mimeType: string;
  fileSize: number;
}): Promise<{ approved: boolean; reason?: string }> {
  const res = await apiClient.post("/chat/pre-check-media", params);
  return res.data.data;
}

/** GET /media/:mediaId/url — returns a pre-signed access URL */
export async function getMediaUrl(
  mediaId: string,
  prefer: "ORIGINAL" | "OPTIMIZED" = "ORIGINAL",
  conversationId?: string
): Promise<MediaEntity> {
  const params: Record<string, string> = { prefer };
  if (conversationId) params.conversationId = conversationId;
  const res = await apiClient.get(`/media/${mediaId}/url`, { params });
  const d = res.data?.data ?? res.data;
  return d as MediaEntity;
}

export interface PlayInfoResponse {
  url: string;
  quality?: string;
  expiresIn: number;
  thumbUrl?: string;
}

/** GET /media/:mediaId/play-info — smart endpoint for playback with optimal quality selection */
export async function getPlayInfo(
  mediaId: string,
  conversationId?: string
): Promise<PlayInfoResponse> {
  const params: Record<string, string> = {};
  if (conversationId) params.conversationId = conversationId;
  const res = await apiClient.get(`/media/${mediaId}/play-info`, { params });
  const d = res.data?.data ?? res.data;
  return d as PlayInfoResponse;
}

export async function deleteMedia(mediaId: string): Promise<void> {
  await apiClient.delete(`/media/${mediaId}`);
}

/** Convenience — returns just the URL string */
export async function getMediaSignedUrl(
  mediaId: string,
  prefer: "ORIGINAL" | "OPTIMIZED" = "ORIGINAL"
): Promise<string> {
  const entity = await getMediaUrl(mediaId, prefer);
  return entity.url;
}
