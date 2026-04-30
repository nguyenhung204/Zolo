"use client";

import { useEffect } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmTone = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  /** Optional extra body rendered between description and footer (e.g. dropdown / textarea). */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disable the confirm button independently of `loading` (e.g. validation). */
  confirmDisabled?: boolean;
}

const TONE_BTN: Record<ConfirmTone, string> = {
  danger: "bg-error text-white hover:opacity-90",
  warning: "bg-warning text-white hover:opacity-90",
  info: "bg-cta text-white hover:bg-cta-hover",
};

const TONE_ICON: Record<ConfirmTone, string> = {
  danger: "bg-error/10 text-error",
  warning: "bg-warning/10 text-warning",
  info: "bg-cta/10 text-cta",
};

/**
 * Reusable confirmation dialog for destructive / important actions.
 * Replaces calls to `window.confirm` and `alert` so the surface stays inside
 * the app's design language, and supports an optional extra body slot.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  children,
  onConfirm,
  onCancel,
  confirmDisabled,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-8"
      onClick={() => !loading && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              TONE_ICON[tone],
            )}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold text-text"
            >
              {title}
            </h2>
            {description && (
              <p className="text-sm text-muted mt-1 leading-snug">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close"
            className="w-8 h-8 -mt-1 -mr-1 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-muted hover:text-text transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {children && <div className="px-5 pb-2 space-y-3">{children}</div>}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-secondary">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text hover:bg-border/40 transition cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition cursor-pointer disabled:opacity-60",
              TONE_BTN[tone],
            )}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
