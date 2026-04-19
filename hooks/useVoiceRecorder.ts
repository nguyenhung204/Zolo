"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceRecorderState = "idle" | "requesting" | "recording" | "recorded";

export interface VoiceRecorderResult {
  state: VoiceRecorderState;
  durationMs: number;
  /** Normalized 0–1 amplitude history for live waveform preview (last ≤40 samples) */
  volumeHistory: number[];
  audioBlob: Blob | null;
  mimeType: string;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
}

// ─── Preferred MIME type ──────────────────────────────────────────────────────

function getSupportedMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "audio/webm";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceRecorder(): VoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [volumeHistory, setVolumeHistory] = useState<number[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const volumeHistoryRef = useRef<number[]>([]);
  const mimeTypeRef = useRef<string>(getSupportedMime());

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (analyserRafRef.current) { cancelAnimationFrame(analyserRafRef.current); analyserRafRef.current = null; }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const start = useCallback(async () => {
    mimeTypeRef.current = getSupportedMime();
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up Web Audio analyser for live amplitude
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      volumeHistoryRef.current = [];

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
        const normalized = Math.min(1, avg / 80);
        const next = [...volumeHistoryRef.current.slice(-39), normalized];
        volumeHistoryRef.current = next;
        setVolumeHistory([...next]);
        analyserRafRef.current = requestAnimationFrame(tick);
      };
      analyserRafRef.current = requestAnimationFrame(tick);

      const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      startTimeRef.current = Date.now();
      setState("recording");

      timerRef.current = setInterval(() => {
        setDurationMs(Date.now() - startTimeRef.current);
      }, 100);
    } catch {
      stopStream();
      setState("idle");
    }
  }, [stopStream]);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      setAudioBlob(blob);
      setDurationMs(Date.now() - startTimeRef.current);
      setState("recorded");
    };
    recorder.stop();
    stopStream();
  }, [stopStream]);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null; // suppress the blob
      recorder.stop();
    }
    stopStream();
    chunksRef.current = [];
    volumeHistoryRef.current = [];
    setAudioBlob(null);
    setDurationMs(0);
    setVolumeHistory([]);
    setState("idle");
  }, [stopStream]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setDurationMs(0);
    setVolumeHistory([]);
    volumeHistoryRef.current = [];
    setState("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopStream(); };
  }, [stopStream]);

  return {
    state,
    durationMs,
    volumeHistory,
    audioBlob,
    mimeType: mimeTypeRef.current,
    start,
    stop,
    cancel,
    reset,
  };
}
