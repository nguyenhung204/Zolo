import { initiateUpload, uploadToPresignedUrl, finalizeUpload } from "@/lib/api/media";

/**
 * Captures a single frame from a video File at ~1 s and returns it as a JPEG Blob
 * (max 640 px on longest side, quality 0.7 ≈ 50 KB).
 *
 * Returns null on any error so callers can fall back gracefully.
 */
export function captureVideoFrame(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    };

    const draw = () => {
      try {
        const maxDim = 640;
        const ratio = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1);
        const w = Math.round(video.videoWidth * ratio);
        const h = Math.round(video.videoHeight * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob);
          },
          "image/jpeg",
          0.7
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onloadedmetadata = () => {
      // Seek to 1 s, or to the midpoint if the video is shorter.
      video.currentTime = Math.min(1, video.duration > 0 ? video.duration / 2 : 0);
    };

    video.onseeked = draw;

    // Some browsers fire onseeked immediately before metadata is ready;
    // fall back to onloadeddata for very short / unusual encodings.
    video.onloadeddata = () => {
      if (video.readyState >= 2 && video.currentTime === 0) {
        draw();
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = objectUrl;
  });
}

/**
 * Uploads a JPEG thumbnail Blob to MinIO via the regular image upload flow
 * (initiateUpload → PUT presigned URL → finalizeUpload).
 *
 * Returns the `mediaId` of the uploaded thumbnail, or null on failure.
 */
export async function uploadVideoThumbnail(blob: Blob): Promise<string | null> {
  try {
    const { mediaId, uploadUrl } = await initiateUpload({
      type: "image",
      mimeType: "image/jpeg",
      size: blob.size,
      filename: "video-thumb.jpg",
    });
    await uploadToPresignedUrl(uploadUrl, blob);
    await finalizeUpload({ mediaId });
    return mediaId;
  } catch {
    return null;
  }
}

/**
 * Convenience: captures a frame and immediately uploads it.
 * Returns the uploaded thumbnail `mediaId`, or null on any failure.
 */
export async function captureAndUploadThumbnail(file: File): Promise<string | null> {
  const blob = await captureVideoFrame(file);
  if (!blob) return null;
  return uploadVideoThumbnail(blob);
}
