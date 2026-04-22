"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Play, Pause, CloudUpload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api/messages";
import { fetchPlayableUrl, normalizeMediaTime, formatVoiceDuration } from "./shared";
import { UploadProgressBar } from "./UploadProgress";
import { toast } from "sonner";

interface Props {
  message: Message;
  isMine: boolean;
}

export function VoiceMessage({ message, isMine }: Props) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlayed, setIsPlayed] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(
    isMine ? (message._localPreviewUrl ?? null) : null
  );
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);

  const fallbackDuration = (message.metadata?.durationMs ?? 0) / 1000;
  const effectiveDuration = normalizeMediaTime(duration) || normalizeMediaTime(fallbackDuration);

  const waveformData = message.metadata?.waveform;
  const BAR_COUNT = 40;
  const bars = useMemo(() => {
    const raw = waveformData ?? [];
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      if (raw.length === 0) return 0.35;
      const idx = Math.floor((i / BAR_COUNT) * raw.length);
      const v = raw[idx] ?? 0;
      return Math.min(1, v > 1 ? v / 255 : v);
    });
  }, [waveformData]);

  const progressRatio = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!audioSrc && !isUploading && message.mediaId && !isLoadingUrl) {
      setIsLoadingUrl(true);
      const url = await fetchPlayableUrl(message.mediaId, message.conversationId);
      setIsLoadingUrl(false);
      if (url) { setAudioSrc(url); }
      else { toast.error("Could not load the audio."); }
      return;
    }
    if (!el || !audioSrc) return;
    if (playing) { el.pause(); }
    else { el.play().catch(() => {}); if (!isPlayed) setIsPlayed(true); }
  }, [playing, audioSrc, isPlayed, message.mediaId, message.conversationId, isUploading, isLoadingUrl]);

  const didAutoPlayRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (audioSrc && audioRef.current && !didAutoPlayRef.current) {
      didAutoPlayRef.current = true;
      audioRef.current.play().catch(() => {});
    }
  }, [audioSrc]);

  // Pause audio when scrolled out of viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const el = audioRef.current;
    if (!el || !effectiveDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * effectiveDuration;
  }, [effectiveDuration]);

  if (!audioSrc && isUploading) {
    return (
      <div className="flex items-center gap-2.5 min-w-[220px] max-w-[300px] px-1 py-0.5">
        <CloudUpload className="w-4 h-4 shrink-0 opacity-80" />
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-medium", isMine ? "text-white/80" : "text-text")}>Đang tải lên…</p>
          {typeof message._uploadProgress === "number" && (
            <p className={cn("text-[11px] mt-0.5", isMine ? "text-white/60" : "text-muted")}>{message._uploadProgress}%</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-2.5 min-w-[240px] max-w-[320px] px-1 py-0.5">
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onTimeUpdate={(e) => setCurrentTime(normalizeMediaTime(e.currentTarget.currentTime))}
          onLoadedMetadata={(e) => setDuration(normalizeMediaTime(e.currentTarget.duration))}
          onDurationChange={(e) => setDuration(normalizeMediaTime(e.currentTarget.duration))}
        />
      )}
      <button type="button" onClick={togglePlay} disabled={isLoadingUrl}
        className={cn("w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors cursor-pointer", "bg-border/60 hover:bg-border/80 text-text", isLoadingUrl && "opacity-50 cursor-wait")}>
        {isLoadingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <svg viewBox="0 0 100 24" className="w-full h-6 cursor-pointer overflow-visible" onClick={handleSeek}>
          {bars.map((amp, i) => {
            const barH = Math.max(2, amp * 20);
            const x = (i + 0.5) * (100 / BAR_COUNT);
            const filled = i < Math.round(progressRatio * BAR_COUNT);
            const fillColor = filled
              ? isMine ? "rgba(255,255,255,0.9)" : "var(--color-cta)"
              : isMine ? "rgba(255,255,255,0.3)" : "var(--color-border)";
            return <rect key={i} x={x - 0.9} y={12 - barH / 2} width={1.8} height={barH} rx={0.9} style={{ fill: fillColor }} />;
          })}
        </svg>
        <div className="flex items-center gap-1">
          <span className={cn("text-[10px] tabular-nums font-mono", isMine ? "text-white/60" : "text-muted")}>
            {formatVoiceDuration(playing || currentTime > 0 ? currentTime : effectiveDuration)}
          </span>
          {isUploading && typeof message._uploadProgress === "number" && (
            <span className={cn("text-[10px]", isMine ? "text-white/60" : "text-muted")}>{message._uploadProgress}%</span>
          )}
          {!isMine && !isPlayed && (
            <div className="w-1.5 h-1.5 rounded-full bg-cta shrink-0" title="Chưa nghe" />
          )}
        </div>
      </div>
      {isUploading && (
        <div className="absolute inset-x-3 bottom-1.5">
          <UploadProgressBar isMine={isMine} progress={message._uploadProgress} compact />
        </div>
      )}
    </div>
  );
}
