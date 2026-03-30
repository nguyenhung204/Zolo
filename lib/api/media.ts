import { apiClient } from "@/lib/api/client";

export type MediaType = "image" | "video" | "file" | "audio";

export interface MediaInitResponse {
  mediaId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface MediaEntity {
  mediaId: string;
  url: string;
  thumbnailUrl?: string;
  expiresAt: string;
  status: "CREATED" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
}

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
  file: File,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

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
}): Promise<MediaEntity> {
  const res = await apiClient.post("/media/upload/complete", params);
  return res.data.data;
}

export async function preCheckMedia(params: {
  conversationId: string;
  mimeType: string;
  fileSize: number;
}): Promise<{ approved: boolean; reason?: string }> {
  const res = await apiClient.post("/chat/pre-check-media", params);
  return res.data.data;
}

export async function getMediaUrl(mediaId: string): Promise<MediaEntity> {
  const res = await apiClient.get(`/media/${mediaId}`);
  return res.data.data;
}

export async function deleteMedia(mediaId: string): Promise<void> {
  await apiClient.delete(`/media/${mediaId}`);
}

export async function getMediaSignedUrl(
  mediaId: string,
  prefer: "ORIGINAL" | "OPTIMIZED" = "ORIGINAL"
): Promise<string> {
  const res = await apiClient.get(`/media/${mediaId}/url?prefer=${prefer}`);
  // Gateway returns { url, expiresAt } or wraps in data envelope
  const d = res.data?.data ?? res.data;
  return d.url as string;
}
