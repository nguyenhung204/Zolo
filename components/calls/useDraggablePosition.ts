"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const MODAL_COMPACT = { w: 360, h: 520 };
export const MODAL_EXPANDED = { w: 680, h: 700 };

export function useDraggablePosition(modalW: number, modalH: number) {
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const posRef = useRef({ x: 20, y: 20 });
  const isDraggingRef = useRef(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      // First mount: place in the bottom-right corner.
      const init = {
        x: window.innerWidth - modalW - 20,
        y: window.innerHeight - modalH - 20,
      };
      setPos(init);
      posRef.current = init;
      initializedRef.current = true;
    } else {
      // Dimension change (expand/collapse): clamp existing position so the
      // modal stays on-screen, but do NOT reset it to the default corner.
      const clamped = {
        x: Math.min(posRef.current.x, window.innerWidth - modalW),
        y: Math.min(posRef.current.y, window.innerHeight - modalH - 4),
      };
      if (clamped.x !== posRef.current.x || clamped.y !== posRef.current.y) {
        setPos(clamped);
        posRef.current = clamped;
      }
    }
  }, [modalW, modalH]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: posRef.current.x,
      posY: posRef.current.y,
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      const x = Math.max(
        0,
        Math.min(
          startRef.current.posX + (e.clientX - startRef.current.mouseX),
          window.innerWidth - modalW
        )
      );
      const y = Math.max(
        0,
        Math.min(
          startRef.current.posY + (e.clientY - startRef.current.mouseY),
          window.innerHeight - 48
        )
      );
      const next = { x, y }; 
      setPos(next);
      posRef.current = next;
    },
    [modalW]
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return { pos, handlePointerDown, handlePointerMove, handlePointerUp };
}
