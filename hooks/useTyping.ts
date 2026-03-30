"use client";

import { useCallback, useEffect, useRef } from "react";
import { getChatSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";

const TYPING_INTERVAL_MS = 3_000;
const TYPING_IDLE_MS = 3_000;

/**
 * Returns a `onKeystroke` callback to call on every textarea input event.
 * Handles:
 * - emit `typing:start` on first keystroke and repeat every 3 s while active
 * - emit `typing:stop` after 3 s of silence
 */
export function useTyping(conversationId: string) {
  const token = useAuthStore((s) => s.token);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const startTyping = useCallback(() => {
    if (!token || !conversationId) return;
    const socket = getChatSocket();

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit("typing:start", { conversationId });
      // Re-emit every 3 s to keep the indicator alive (server TTL = 5 s)
      intervalRef.current = setInterval(() => {
        socket.emit("typing:start", { conversationId });
      }, TYPING_INTERVAL_MS);
    }

    // Reset idle timer on every keystroke
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      stopTyping();
    }, TYPING_IDLE_MS);
  }, [conversationId, token]);

  const stopTyping = useCallback(() => {
    if (!isTypingRef.current) return;
    isTypingRef.current = false;
    const socket = getChatSocket();
    socket.emit("typing:stop", { conversationId });
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  }, [conversationId]);

  // Stop typing when conversation changes or component unmounts
  useEffect(() => {
    return () => stopTyping();
  }, [conversationId, stopTyping]);

  return { onKeystroke: startTyping, stopTyping };
}
