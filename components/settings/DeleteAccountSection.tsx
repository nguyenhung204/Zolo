"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeleteMyAccount } from "@/hooks/useUser";
import { getErrorMessage } from "@/lib/api/errors";

const DELETE_CONFIRMATION_TEXT = "DELETE";

const ACCOUNT_DELETION_POLICY = [
  "Deleting your account permanently removes your account data and cannot be undone.",
  "Friends and groups will no longer be able to send messages to you.",
  "Anyone who has already shared conversations with you can still view those shared messages.",
] as const;

export function DeleteAccountSection() {
  const router = useRouter();
  const deleteAccount = useDeleteMyAccount();

  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  const closeDialog = () => {
    if (deleteAccount.isPending) return;
    setIsOpen(false);
    setConfirmation("");
    setError("");
  };

  const openDialog = () => {
    setIsOpen(true);
    setConfirmation("");
    setError("");
  };

  const handleDelete = async () => {
    setError("");

    try {
      await deleteAccount.mutateAsync();
      router.replace("/login?accountDeleted=1");
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Could not delete your account right now."));
    }
  };

  const canConfirm = confirmation.trim().toUpperCase() === DELETE_CONFIRMATION_TEXT;

  return (
    <>
      <section className="bg-surface rounded-2xl border border-error/30 p-6 space-y-4">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-error uppercase tracking-wide">Delete account</h2>
          <p className="text-sm text-text">
            This action is irreversible. Before you continue, review the account deletion policy below.
          </p>
        </div>

        <div className="rounded-xl border border-error/20 bg-error/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-full bg-error/10 p-2 text-error">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-text">Account deletion policy</p>
              <ul className="space-y-1 text-sm text-secondary list-disc pl-5">
                {ACCOUNT_DELETION_POLICY.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={openDialog}
          className="px-5 py-2.5 rounded-lg bg-error text-white text-sm font-semibold hover:opacity-90 transition cursor-pointer"
        >
          Delete my account
        </button>
      </section>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close delete account dialog"
            onClick={closeDialog}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <div className="relative w-full max-w-lg rounded-2xl border border-error/30 bg-surface p-6 shadow-xl space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-error">Final confirmation</p>
              <h3 className="text-xl font-bold text-primary">Delete your account permanently?</h3>
              <p className="text-sm text-secondary">
                Type <span className="font-semibold text-text">{DELETE_CONFIRMATION_TEXT}</span> to confirm permanent account deletion.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-bg/70 p-4 space-y-2">
              <p className="text-sm font-medium text-text">This will immediately:</p>
              <ul className="space-y-1 text-sm text-secondary list-disc pl-5">
                {ACCOUNT_DELETION_POLICY.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <label htmlFor="delete-account-confirmation" className="text-xs font-medium uppercase tracking-wide text-secondary">
                Confirmation text
              </label>
              <input
                id="delete-account-confirmation"
                type="text"
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={DELETE_CONFIRMATION_TEXT}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition"
              />
              <p className="text-xs text-muted">
                This action cannot be reversed after the request is submitted.
              </p>
            </div>

            {error && (
              <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={deleteAccount.isPending}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-secondary hover:text-text hover:border-secondary transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canConfirm || deleteAccount.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-error text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
              >
                {deleteAccount.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {deleteAccount.isPending ? "Deleting account..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}