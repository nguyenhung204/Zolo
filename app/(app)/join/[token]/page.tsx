"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  MessageSquarePlus,
} from "lucide-react";
import { useJoinByInvite } from "@/hooks/useGroup";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  params: Promise<{ token: string }>;
}

type JoinState = "idle" | "confirm" | "joining" | "joined" | "pending" | "error";

export default function JoinGroupPage({ params }: Props) {
  const { token } = use(params);
  const router = useRouter();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const joinMutation = useJoinByInvite();

  const [state, setState] = useState<JoinState>("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [showMessageField, setShowMessageField] = useState(false);
  const [joinedConversationId, setJoinedConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (!isInitialized) return;
    if (didInit.current) return;
    didInit.current = true;

    if (!isAuthenticated) {
      router.replace(`/login?from=/join/${token}`);
      return;
    }

    setState("confirm");
  }, [isAuthenticated, isInitialized, router, token]);

  function handleJoin() {
    setState("joining");
    joinMutation.mutate(
      { token, requestMessage: requestMessage.trim() || undefined },
      {
        onSuccess: (result) => {
          if (!result.requiresApproval) {
            setJoinedConversationId(result.conversationId);
            setState("joined");
            setTimeout(() => {
              router.push(`/conversations/${result.conversationId}`);
            }, 1200);
          } else {
            setState("pending");
          }
        },
        onError: (err) => {
          setErrorMessage(
            err.status === 401
              ? "This invite link has expired."
              : err.status === 403
                ? "This invite link has been revoked."
                : err.status === 404
                  ? "This group no longer exists."
                  : err.status === 400
                    ? "You're already a member or your request is pending."
                    : "Couldn't join the group. Please try again.",
          );
          setState("error");
        },
      },
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4 py-10">
      <div className="w-full max-w-sm bg-surface border border-border rounded-3xl shadow-xl overflow-hidden">
        {/* Hero */}
        <div className="bg-gradient-to-b from-cta/10 to-transparent px-6 pt-8 pb-6 flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-3xl bg-cta text-white flex items-center justify-center shadow-lg shadow-cta/30">
            <Users className="w-8 h-8" />
          </div>
          <div>
            <p className="text-lg font-bold text-text">You&apos;re invited!</p>
            <p className="text-sm text-muted mt-1 max-w-xs">
              Join this group on Zolo to start chatting with the team.
            </p>
          </div>
        </div>

        <div className="px-6 pb-6 pt-1 flex flex-col gap-3">
          {state === "confirm" && (
            <>
              {showMessageField ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                    <span>Message to admins (optional)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMessageField(false);
                        setRequestMessage("");
                      }}
                      className="text-xs text-muted hover:text-text cursor-pointer"
                    >
                      Skip
                    </button>
                  </label>
                  <textarea
                    autoFocus
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="Hi! I'd like to join because…"
                    className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cta/40"
                  />
                  <p className="text-[11px] text-muted text-right">
                    {requestMessage.length}/200
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMessageField(true)}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-border text-text hover:bg-surface-secondary transition cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <MessageSquarePlus className="w-3.5 h-3.5 text-muted" />
                    Add a message to admins
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted" />
                </button>
              )}

              <button
                onClick={handleJoin}
                className="w-full py-3 text-sm font-semibold text-white bg-cta rounded-xl hover:bg-cta-hover transition cursor-pointer"
              >
                Join group
              </button>
              <button
                onClick={() => router.push("/conversations")}
                className="w-full py-2 text-xs font-medium text-muted hover:text-text transition cursor-pointer"
              >
                Maybe later
              </button>
            </>
          )}

          {state === "joining" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 text-cta animate-spin" />
              <p className="text-sm text-muted">Joining the group…</p>
            </div>
          )}

          {state === "joined" && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-base font-bold text-text">You&apos;re in!</p>
                <p className="text-xs text-muted mt-0.5">Opening the group…</p>
              </div>
              {joinedConversationId && (
                <button
                  onClick={() => router.push(`/conversations/${joinedConversationId}`)}
                  className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:bg-cta-hover transition cursor-pointer"
                >
                  Open group
                </button>
              )}
            </div>
          )}

          {state === "pending" && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-warning" />
              </div>
              <div>
                <p className="text-base font-bold text-text">Request sent</p>
                <p className="text-xs text-muted mt-1 max-w-xs">
                  This group requires admin approval. You&apos;ll get a notification once
                  someone reviews your request.
                </p>
              </div>
              <button
                onClick={() => router.push("/conversations")}
                className="w-full py-2.5 text-sm font-semibold text-text border border-border rounded-xl hover:bg-surface-secondary transition cursor-pointer"
              >
                Back to chats
              </button>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-error/10 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-error" />
              </div>
              <div>
                <p className="text-base font-bold text-text">Couldn&apos;t join</p>
                <p className="text-xs text-muted mt-1 max-w-xs">{errorMessage}</p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  onClick={() => router.push("/conversations")}
                  className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:bg-cta-hover transition cursor-pointer"
                >
                  Go to chats
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border px-6 py-3 bg-surface-secondary flex items-center justify-center gap-1.5 text-[11px] text-muted">
          <Users className="w-3 h-3" />
          <span>Zolo Chat</span>
        </div>
      </div>
    </div>
  );
}
