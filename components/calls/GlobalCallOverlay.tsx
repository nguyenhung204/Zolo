"use client";

// The full screen overlay has been replaced by a draggable PiP modal.
// This re-export preserves the import in AppShell without requiring changes there.
export { DraggableCallModal as GlobalCallOverlay } from "./DraggableCallModal";
