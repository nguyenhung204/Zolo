"use client";

import { useRef, useState, useEffect } from "react";
import {
  initiateUpload,
  uploadToPresignedUrl,
  finalizeUpload,
} from "@/lib/api/media";
import { UserAvatar } from "@/components/presence/UserAvatar";

interface AvatarUploadProps {
  userId: string;
  name: string;
  currentAvatarUrl?: string;
  onUploadComplete: (mediaId: string, previewUrl: string) => void;
}

type UploadStatus = "idle" | "uploading" | "finalizing" | "error";

export function AvatarUpload({
  userId,
  name,
  currentAvatarUrl,
  onUploadComplete,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(currentAvatarUrl);

  // Sync when profile data arrives after initial render
  useEffect(() => {
    if (status === "idle" || status === "error") {
      setPreviewUrl(currentAvatarUrl);
    }
  }, [currentAvatarUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported");
      return;
    }

    setError(null);
    setStatus("uploading");
    setProgress(0);

    // Local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    try {
      const { mediaId, uploadUrl } = await initiateUpload({
        type: "image",
        mimeType: file.type,
        size: file.size,
        filename: file.name,
      });

      await uploadToPresignedUrl(uploadUrl, file, setProgress);

      setStatus("finalizing");
      const media = await finalizeUpload({ mediaId });

      onUploadComplete(mediaId, media.url ?? objectUrl);
      setStatus("idle");
    } catch {
      setError("Upload failed — please try again");
      setPreviewUrl(currentAvatarUrl);
      setStatus("error");
    } finally {
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const isLoading = status === "uploading" || status === "finalizing";

  return (
    // w-12 h-12 matches UserAvatar size="lg" exactly
    <div className="relative group w-12 h-12 shrink-0">
      <UserAvatar
        userId={userId}
        name={name}
        avatarUrl={previewUrl}
        size="lg"
        showPresence={false}
      />

      {/* Hover overlay — inset-0 now correctly covers only the avatar */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
        aria-label="Change avatar"
      >
        {isLoading ? (
          <span className="text-white text-[10px] font-medium">
            {status === "finalizing" ? "…" : `${progress}%`}
          </span>
        ) : (
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>

      {/* Progress ring — viewBox matches w-12 h-12 (48px) */}
      {status === "uploading" && (
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 48 48">
          <circle
            cx="24" cy="24" r="21"
            fill="none" stroke="#0369A1" strokeWidth="3"
            strokeDasharray={`${(progress / 100) * 132} 132`}
            strokeLinecap="round"
          />
        </svg>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
      />

      {error && (
        <p className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[10px] text-error whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  );
}
