"use client";

import { useState } from "react";
import { X, Plus, Trash2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConversation } from "@/hooks/useConversations";
import { useCreatePoll } from "@/hooks/useGroup";

interface PollPanelProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

export function PollPanel({ conversationId, open, onClose }: PollPanelProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [deadline, setDeadline] = useState("");
  const { data: conversation } = useConversation(conversationId);
  const supportsPolls = conversation?.kind === "group";
  const createPoll = useCreatePoll(conversationId);

  if (!open) return null;

  const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
  const uniqueOptions = Array.from(new Set(cleanOptions));
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isDeadlineValid = !deadlineDate || (Number.isFinite(deadlineDate.getTime()) && deadlineDate.getTime() > Date.now());
  const canCreate = question.trim().length > 0 && uniqueOptions.length >= 2 && uniqueOptions.length <= 10 && isDeadlineValid;

  const resetForm = () => {
    setQuestion("");
    setOptions(["", ""]);
    setMultipleChoice(false);
    setDeadline("");
  };

  const handleCreate = () => {
    if (!supportsPolls) {
      toast.error("Polls are only available in groups.");
      return;
    }
    if (cleanOptions.length !== uniqueOptions.length) {
      toast.error("Poll options must be unique.");
      return;
    }
    if (!isDeadlineValid) {
      toast.error("Poll deadline must be in the future.");
      return;
    }
    if (!canCreate) {
      toast.error("Polls need a question and 2–10 options.");
      return;
    }
    createPoll.mutate(
      {
        question: question.trim(),
        options: uniqueOptions,
        multipleChoice,
        ...(deadlineDate ? { deadline: deadlineDate.toISOString() } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Poll created.");
          resetForm();
          onClose();
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-surface flex flex-col shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cta/10 text-cta flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary">Create Poll</h2>
              <p className="text-xs text-muted mt-0.5">Poll will appear in the conversation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5">
          {supportsPolls ? (
          <div className="space-y-3">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Question…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
            />
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={option}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                    }
                    placeholder={`Option ${index + 1}`}
                    className="flex-1 px-3 py-2 text-sm rounded-lg bg-surface border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                      className="w-9 rounded-lg text-muted hover:text-error hover:bg-error/10 transition cursor-pointer"
                      title="Remove option"
                    >
                      <Trash2 className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={options.length >= 10}
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="flex items-center gap-1.5 text-xs font-semibold text-cta hover:text-cta/80 disabled:text-muted disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add option
            </button>
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={multipleChoice}
                onChange={(e) => setMultipleChoice(e.target.checked)}
                className="accent-[var(--color-cta)]"
              />
              Allow multiple choices
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-secondary">Deadline (optional)</span>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
              />
            </label>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate || createPoll.isPending}
              className={cn(
                "w-full py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer",
                canCreate ? "bg-cta text-white hover:opacity-90" : "bg-border text-muted cursor-not-allowed",
              )}
            >
              {createPoll.isPending ? "Creating…" : "Create Poll"}
            </button>
          </div>
          ) : (
            <div className="rounded-2xl border border-border bg-bg p-4 text-sm text-muted">
              Polls are only available in group conversations.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
