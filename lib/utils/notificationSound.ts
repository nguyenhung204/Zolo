/**
 * Synthesises a soft two-tone notification chime via Web Audio API.
 * No audio file required — generates the sound programmatically.
 * Silently no-ops when the AudioContext is unavailable (SSR / blocked).
 */

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!_ctx || _ctx.state === "closed") {
      _ctx = new AudioContext();
    }
    return _ctx;
  } catch {
    return null;
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

export function playNotificationSound(volume = 0.07): void {
  const ctx = getCtx();
  if (!ctx) return;

  // Resume in case autoplay policy suspended the context
  const play = () => {
    const now = ctx.currentTime;
    tone(ctx, 880, now, 0.18, volume);        // A5
    tone(ctx, 1108, now + 0.12, 0.22, volume * 0.85); // C#6
  };

  if (ctx.state === "suspended") {
    ctx.resume().then(play).catch(() => null);
  } else {
    play();
  }
}
