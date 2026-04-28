"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, Clock, CheckCircle2, XCircle } from "lucide-react";
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
            }, 1500);
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
                    ? "You are already a member or have a pending request."
                    : "Failed to join the group. Please try again.",
          );
          setState("error");
        },
      },
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-xl p-8 flex flex-col items-center gap-5 text-center">
        {state === "idle" ? null : state === "confirm" ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-cta/10 flex items-center justify-center">
              <Users className="w-7 h-7 text-cta" />
            </div>
            <div>
              <p className="text-base font-bold text-text">Join Group</p>
              <p className="text-sm text-muted mt-1">
                You&apos;ve been invited to join a group. Add an optional message to your request.
              </p>
            </div>
            <textarea
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Say something to the admins… (optional)"
              className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cta/40"
            />
            <button
              onClick={handleJoin}
              className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 transition cursor-pointer"
            >
              Join Group
            </button>
          </>
        ) : state === "joining" ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-cta/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-cta animate-spin" />
            </div>
            <div>
              <p className="text-base font-bold text-text">Joining group…</p>
              <p className="text-sm text-muted mt-1">Please wait while we process your invite.</p>
            </div>
          </>
        ) : state === "joined" ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-success" />
            </div>
            <div>
              <p className="text-base font-bold text-text">You&apos;re in!</p>
              <p className="text-sm text-muted mt-1">Redirecting to the group…</p>
            </div>
            {joinedConversationId && (
              <button
                onClick={() => router.push(`/conversations/${joinedConversationId}`)}
                className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 transition cursor-pointer"
              >
                Open Group
              </button>
            )}
          </>
        ) : state === "pending" ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-warning/10 flex items-center justify-center">
              <Clock className="w-7 h-7 text-warning" />
            </div>
            <div>
              <p className="text-base font-bold text-text">Request sent</p>
              <p className="text-sm text-muted mt-1">
                Your request to join the group is pending approval. You&apos;ll be notified once an
                admin reviews it.
              </p>
            </div>
            <button
              onClick={() => router.push("/conversations")}
              className="w-full py-2.5 text-sm font-semibold text-secondary border border-border rounded-xl hover:bg-border/40 transition cursor-pointer"
            >
              Back to Conversations
            </button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-error/10 flex items-center justify-center">
              <XCircle className="w-7 h-7 text-error" />
            </div>
            <div>
              <p className="text-base font-bold text-text">Could not join</p>
              <p className="text-sm text-muted mt-1">{errorMessage}</p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={() => router.push("/conversations")}
                className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 transition cursor-pointer"
              >
                Go to Conversations
              </button>
            </div>
          </>
        )}

        {/* Branding */}
        <div className="flex items-center gap-2 pt-2 border-t border-border w-full justify-center">
          <Users className="w-4 h-4 text-muted" />
          <span className="text-xs text-muted">Zolo Chat</span>
        </div>
      </div>
    </div>
  );
}
