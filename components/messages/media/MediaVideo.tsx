"use client";

import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api/messages";
import { getMediaUrl } from "@/lib/api/media";
import { fetchPlayableUrl, blobDownload, formatBytes, fmtTime } from "./shared";
import { UploadOverlay } from "./UploadProgress";
import { toast } from "sonner";

interface Props {
  message: Message;
  isMine: boolean;
}

export const MediaVideo = memo(function MediaVideo({ message, isMine }: Props) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;

  const [videoSrc, setVideoSrc] = useState<string | null>(
    isMine ? (message._localPreviewUrl ?? null) : null
  );
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);
  const [thumbPosterUrl, setThumbPosterUrl] = useState<string | undefined>(undefined);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const shouldAutoPlayRef = useRef(false);

  const thumbMediaId = message.metadata?.thumbMediaId;
  const fileName = message.metadata?.filename || "Video";
  const fileSize = message.metadata?.fileSize;

  useEffect(() => {
    if (!thumbMediaId) return;
    getMediaUrl(thumbMediaId, "ORIGINAL")
      .then((entity) => {
        const url = (entity as unknown as { url?: string }).url;
        if (url) setThumbPosterUrl(url);
      })
      .catch(() => {});
  }, [thumbMediaId]);

  useEffect(() => {
    if (message.mediaStatus?.toUpperCase() !== "READY") return;
    if (!videoSrc) return;
    if (isPlayingRef.current) { pendingRefreshRef.current = true; }
    else { setVideoSrc(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.mediaStatus]);

  useEffect(() => {
    if (!videoSrc || !shouldAutoPlayRef.current) return;
    shouldAutoPlayRef.current = false;
    videoRef.current?.play().catch(() => {});
  }, [videoSrc]);

  // ── Pause + free resources when video scrolls out of viewport ───────────
  useEffect(() => {
    if (!videoSrc) return; // only observe when src is loaded
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          const vid = videoRef.current;
          if (vid) {
            vid.pause();
            vid.removeAttribute("src");
            vid.load(); // forces browser to release buffered data
          }
          shouldAutoPlayRef.current = false;
          setVideoSrc(null);
          setPlaying(false);
          setCurrentTime(0);
          setDuration(0);
          setShowControls(true);
          isPlayingRef.current = false;
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  const loadAndPlay = useCallback(async () => {
    if (videoSrc || isLoadingUrl || !message.mediaId) return;
    setIsLoadingUrl(true);
    shouldAutoPlayRef.current = true;
    const url = await fetchPlayableUrl(message.mediaId, message.conversationId);
    setIsLoadingUrl(false);
    if (url) { setVideoSrc(url); }
    else { shouldAutoPlayRef.current = false; toast.error("Could not load the video."); }
  }, [videoSrc, isLoadingUrl, message.mediaId, message.conversationId]);

  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); } else { el.pause(); }
    showControlsBriefly();
  }, [showControlsBriefly]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(((e.clientX - rect.left) / rect.width) * duration, duration));
    showControlsBriefly();
  }, [duration, showControlsBriefly]);

  const handleVideoPlay = useCallback(() => {
    setPlaying(true); isPlayingRef.current = true; showControlsBriefly();
  }, [showControlsBriefly]);

  const handleVideoPauseOrEnd = useCallback((ended = false) => {
    setPlaying(false); isPlayingRef.current = false; setShowControls(true);
    if (ended) setCurrentTime(0);
    if (pendingRefreshRef.current) { pendingRefreshRef.current = false; setVideoSrc(null); }
  }, []);

  const handleVideoDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.mediaId || isDownloadingVideo) return;
    setIsDownloadingVideo(true);
    try {
      const entity = await getMediaUrl(message.mediaId, "ORIGINAL", message.conversationId);
      const url = (entity as unknown as { url?: string }).url;
      if (url) await blobDownload(url, fileName);
    } catch {
      toast.error("Could not download the video.");
    } finally {
      setIsDownloadingVideo(false);
    }
  }, [message.mediaId, message.conversationId, fileName, isDownloadingVideo]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isReady = !message.mediaId || (message.mediaStatus?.toUpperCase() === "READY" || message.mediaStatus == null);

  // ── Uploading state ──────────────────────────────────────────────────────
  if (isUploading) {
    return (
      <div className="relative w-[420px] max-w-full rounded-2xl overflow-hidden bg-black/60">
        <div className="aspect-video flex items-center justify-center">
          {videoSrc
            ? <video src={videoSrc} className="absolute inset-0 w-full h-full object-cover opacity-40" muted preload="metadata" />
            : <Loader2 className="w-8 h-8 text-white/60 animate-spin" />}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-black/70">
          <div className="flex-1 min-w-0">
            <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
            {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
          </div>
        </div>
        <UploadOverlay isMine={isMine} progress={message._uploadProgress} />
      </div>
    );
  }

  // ── Poster (not yet loaded) ──────────────────────────────────────────────
  if (!videoSrc) {
    return (
      <div className="relative w-[420px] max-w-full rounded-2xl overflow-hidden bg-black select-none">
        <button
          type="button"
          onClick={handleVideoDownload}
          disabled={isDownloadingVideo}
          className="absolute top-2 right-2 z-20 w-8 h-8 shrink-0 rounded-full bg-black/60 hover:bg-black/75 flex items-center justify-center text-white transition-colors cursor-pointer disabled:opacity-50"
          title="Tải xuống"
        >
          {isDownloadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        </button>
        <div className="aspect-video cursor-pointer relative" onClick={loadAndPlay} role="button" aria-label="Phát video">
          {thumbPosterUrl && (
            <img src={thumbPosterUrl} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          )}
          <div className={cn("absolute inset-0 flex items-center justify-center", thumbPosterUrl ? "bg-black/35" : "bg-black/80")}>
            {isLoadingUrl
              ? <Loader2 className="w-10 h-10 text-white animate-spin" />
              : (
                <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/20 hover:bg-black/75 transition-colors">
                  <Play className="w-6 h-6 text-white ml-0.5" />
                </div>
              )}
          </div>
          {!!message.metadata?.durationMs && !isLoadingUrl && (
            <span className="absolute top-2 right-2.5 text-[11px] font-mono text-white bg-black/60 rounded px-1.5 py-0.5 select-none">
              {fmtTime(message.metadata.durationMs / 1000)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-black/80">
          <div className="flex-1 min-w-0">
            <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
            {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Active player ────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative w-[420px] max-w-full rounded-2xl overflow-hidden bg-black select-none"
      onMouseMove={showControlsBriefly}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
    >
      <button
        type="button"
        onClick={handleVideoDownload}
        disabled={isDownloadingVideo}
        className="absolute top-2 right-2 z-20 w-8 h-8 shrink-0 rounded-full bg-black/60 hover:bg-black/75 flex items-center justify-center text-white transition-colors cursor-pointer disabled:opacity-50"
        title="Tải xuống"
      >
        {isDownloadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      </button>

      <video
        ref={videoRef}
        src={videoSrc ?? undefined}
        poster={thumbPosterUrl}
        className="w-full max-h-[340px] block cursor-pointer"
        preload="metadata"
        playsInline
        onPlay={handleVideoPlay}
        onPause={() => handleVideoPauseOrEnd(false)}
        onEnded={() => handleVideoPauseOrEnd(true)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onClick={togglePlay}
      />

      <div className={cn("absolute inset-0 flex flex-col justify-end pointer-events-none transition-opacity duration-200", showControls ? "opacity-100" : "opacity-0")}>
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-auto" onClick={togglePlay}>
            <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/20">
              <Play className="w-6 h-6 text-white ml-0.5" />
            </div>
          </div>
        )}
        <div className="pointer-events-auto bg-gradient-to-t from-black/80 via-black/20 to-transparent px-3 pt-6 pb-0">
          <div className="w-full h-1 rounded-full bg-white/30 mb-2 cursor-pointer relative group/seek" onClick={handleSeek}>
            <div className="h-full rounded-full bg-white transition-none" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover/seek:opacity-100 transition-opacity" style={{ left: `calc(${progressPct}% - 6px)` }} />
          </div>
          <div className="flex items-center gap-2 pb-0">
            <button type="button" onClick={togglePlay} className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <span className="text-white text-[11px] font-mono tabular-nums shrink-0">
              {fmtTime(currentTime)}<span className="opacity-50 mx-0.5">/</span>{fmtTime(duration)}
            </span>
            <div className="flex-1" />
            <button type="button"
              onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted((m) => !m); } }}
              className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button type="button" onClick={() => videoRef.current?.requestFullscreen?.()}
              className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/80">
        <div className="flex-1 min-w-0">
          <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
          {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
        </div>
      </div>
    </div>
  );
});
