"use client";

import { useState } from "react";
import { X, Plus, Trash2, BarChart3, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConversation } from "@/hooks/useConversations";
import { useCreatePoll, usePolls } from "@/hooks/useGroup";
import { PollUI } from "./PollUI";
import { useAuthStore } from "@/stores/authStore";
import type { MemberRole } from "@/lib/api/conversations";

interface PollPanelProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

type PanelView = "list" | "create";

export function PollPanel({ conversationId, open, onClose }: PollPanelProps) {
  const [view, setView] = useState<PanelView>("list");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [deadline, setDeadline] = useState("");
  const { data: conversation } = useConversation(conversationId);
  const { data: polls = [] } = usePolls(conversationId, open);
  const myId = useAuthStore((s) => s.user?.id);
  const supportsPolls = conversation?.kind === "group";
  const createPoll = useCreatePoll(conversationId);

  const myRole = (conversation?.participants?.find((p) => p.userId === myId)?.role?.toLowerCase() ?? "member") as MemberRole;
  const allowMemberMessage = conversation?.allowMemberMessage !== false;

  if (!open) return null;

  const MAX_ACTIVE_POLLS = 3;
  const activePolls = polls.filter((p) => !p.isClosed && (!p.deadline || new Date(p.deadline).getTime() > Date.now()));
  const atPollLimit = activePolls.length >= MAX_ACTIVE_POLLS;

  const sortedPolls = [...polls].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
  const uniqueOptions = Array.from(new Set(cleanOptions));
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isDeadlineValid = !deadlineDate || Number.isFinite(deadlineDate.getTime());
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
    if (atPollLimit) {
      toast.error(`Tối đa ${MAX_ACTIVE_POLLS} poll đang hoạt động. Đóng bớt poll để tạo mới.`);
      return;
    }
    if (cleanOptions.length !== uniqueOptions.length) {
      toast.error("Poll options must be unique.");
      return;
    }
    if (deadlineDate && deadlineDate.getTime() <= Date.now()) {
      toast.error("Poll deadline must be in the future.");
      return;
    }
    if (!canCreate) {
      toast.error("Polls need a question and 2\u201310 options.");
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
          setView("list");
        },
      },
    );
  };

  const handleClose = () => {
    resetForm();
    setView("list");
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* Panel — centered modal on desktop, bottom sheet on mobile */}
      <div className={cn(
        "fixed z-50 bg-surface flex flex-col shadow-2xl border border-border overflow-hidden",
        // Mobile: bottom sheet
        "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]",
        // Desktop: centered modal
        "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
        "sm:rounded-2xl sm:w-[460px] sm:max-w-[92vw] sm:max-h-[80vh]",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cta/10 text-cta flex items-center justify-center">
              <BarChart3 className="w-[18px] h-[18px]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text">
                {view === "list" ? "Polls" : "New Poll"}
              </h2>
              <p className="text-[11px] text-muted mt-0.5">
                {view === "list"
                  ? `${polls.length} poll${polls.length !== 1 ? "s" : ""} · ${activePolls.length}/${MAX_ACTIVE_POLLS} active`
                  : "Create a poll for the group"
                }
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-border/50 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {view === "list" ? (
            <div className="p-4 sm:p-5 space-y-4">
              {/* Create button */}
              {supportsPolls && (
                atPollLimit ? (
                  <div className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl bg-border/30 border border-border text-muted text-sm">
                    <BarChart3 className="w-4 h-4 shrink-0" />
                    <span>Tối đa {MAX_ACTIVE_POLLS} poll đang hoạt động. Đóng bớt poll để tạo mới.</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setView("create")}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3 rounded-xl",
                      "bg-cta/5 border border-cta/20 hover:bg-cta/10 transition-colors cursor-pointer",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Plus className="w-4 h-4 text-cta" />
                      <span className="text-sm font-semibold text-cta">Create new poll</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-cta/60" />
                  </button>
                )
              )}

              {/* Poll list */}
              {polls.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-2xl bg-surface-secondary flex items-center justify-center mx-auto mb-3">
                    <BarChart3 className="w-6 h-6 text-muted" />
                  </div>
                  <p className="text-sm text-muted">No polls yet</p>
                  <p className="text-xs text-muted/70 mt-1">Create a poll to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedPolls.map((poll) => (
                    <PollUI
                      key={poll.id}
                      pollId={poll.id}
                      myRole={myRole}
                      allowMemberMessage={allowMemberMessage}
                      initialData={poll}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              {supportsPolls ? (
                <div className="space-y-3">
                  {/* Question */}
                  <div>
                    <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">
                      Question
                    </label>
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask something..."
                      className={cn(
                        "w-full px-3.5 py-2.5 text-sm rounded-xl bg-surface-secondary",
                        "border border-border focus:outline-none",
                        "placeholder:text-muted/60 text-text transition",
                      )}
                    />
                  </div>

                  {/* Options */}
                  <div>
                    <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">
                      Options
                    </label>
                    <div className="space-y-2">
                      {options.map((option, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            value={option}
                            onChange={(e) =>
                              setOptions((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                            }
                            placeholder={`Option ${index + 1}`}
                            className={cn(
                              "flex-1 px-3.5 py-2.5 text-sm rounded-xl bg-surface-secondary",
                              "border border-border focus:outline-none",
                              "placeholder:text-muted/60 text-text transition",
                            )}
                          />
                          {options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                              className="w-10 rounded-xl text-muted hover:text-error hover:bg-error/10 transition flex items-center justify-center cursor-pointer"
                              title="Remove option"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Add option */}
                    <button
                      type="button"
                      disabled={options.length >= 10}
                      onClick={() => setOptions((prev) => [...prev, ""])}
                      className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-cta hover:text-cta/80 disabled:text-muted disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add option ({options.length}/10)
                    </button>
                  </div>

                  {/* Settings row */}
                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={multipleChoice}
                        onChange={(e) => setMultipleChoice(e.target.checked)}
                        className="accent-[var(--color-cta)] w-3.5 h-3.5"
                      />
                      Multiple choices
                    </label>
                  </div>

                  {/* Deadline */}
                  <div>
                    <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">
                      Deadline (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className={cn(
                        "w-full px-3.5 py-2.5 text-sm rounded-xl bg-surface-secondary",
                        "border border-border focus:outline-none",
                        "text-text transition",
                      )}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setView("list");
                      }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text bg-surface-secondary hover:bg-border/50 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={!canCreate || createPoll.isPending}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer",
                        canCreate
                          ? "bg-cta text-white hover:opacity-90 active:scale-[0.98]"
                          : "bg-border text-muted cursor-not-allowed",
                      )}
                    >
                      {createPoll.isPending ? "Creating\u2026" : "Create Poll"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-surface-secondary p-4 text-sm text-muted text-center">
                  Polls are only available in group conversations.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
