"use client";

import { useState } from "react";
import { X, Plus, Trash2, Loader2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConversation, useMyConversationRole } from "@/hooks/useConversations";
import { useCreatePoll, usePolls } from "@/hooks/useGroup";
import { PollUI } from "./PollUI";

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
  const myRole = useMyConversationRole(conversationId);
  const allowMemberMessage = conversation?.allowMemberMessage ?? true;
  const supportsPolls = conversation?.kind === "group";
  const polls = usePolls(conversationId, open && supportsPolls);
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
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-[360px] max-w-[92vw] bg-surface flex flex-col shadow-2xl border-l border-border"
        style={{ animation: "slideInFromRight 0.25s ease-out" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-bold text-primary">Polls</h2>
            <p className="text-xs text-muted mt-0.5">Create and vote inside group conversations</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {supportsPolls ? (
          <div className="rounded-2xl border border-border bg-bg p-4 space-y-3">
            <p className="text-xs font-bold text-secondary uppercase tracking-wider">New Poll</p>
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

          {supportsPolls && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-secondary uppercase tracking-wider">Active Polls</p>
            {polls.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted" />
              </div>
            ) : polls.data?.length ? (
              polls.data.map((poll, index) =>
                poll.id ? (
                  <PollUI
                    key={`${poll.id}-${index}`}
                    pollId={poll.id}
                    myRole={myRole}
                    allowMemberMessage={allowMemberMessage}
                    initialData={poll}
                  />
                ) : (
                  <div key={`poll-missing-id-${index}`} className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                    Poll data is missing an id.
                  </div>
                ),
              )
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-muted">
                <BarChart3 className="w-9 h-9 opacity-40" />
                <p className="text-sm">No polls yet.</p>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </>
  );
}
