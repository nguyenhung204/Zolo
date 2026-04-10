"use client";

import { useState } from "react";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { useMyProfile, useUpdateProfile } from "@/hooks/useUser";
import { getErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/stores/authStore";

export function ProfileSection() {
  const authUser = useAuthStore((s) => s.user);
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });

  function beginEditing() {
    setForm({
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      phone: profile?.phone ?? "",
    });
    setEditing(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSave() {
    await updateProfile.mutateAsync({
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      phone: form.phone || undefined,
    });
    setEditing(false);
  }

  function handleCancel() {
    if (profile) {
      setForm({
        firstName: profile.firstName ?? "",
        lastName: profile.lastName ?? "",
        phone: profile.phone ?? "",
      });
    }
    setEditing(false);
  }

  async function handleAvatarUploadComplete(mediaId: string) {
    await updateProfile.mutateAsync({ avatarMediaId: mediaId });
  }

  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    authUser?.name ||
    "—";

  const displayEmail = profile?.email ?? authUser?.email ?? "—";
  const displayUsername = profile?.username ?? authUser?.username;

  if (isLoading) {
    return (
      <section className="bg-surface rounded-2xl border border-border p-6 space-y-4 animate-pulse">
        <div className="h-4 w-24 bg-border rounded" />
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-border" />
          <div className="space-y-2">
            <div className="h-4 w-32 bg-border rounded" />
            <div className="h-3 w-44 bg-border rounded" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface rounded-2xl border border-border p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Profile</h2>
        {!editing && (
          <button
            onClick={beginEditing}
            className="text-xs font-medium text-cta hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {/* Avatar + Identity */}
      <div className="flex items-center gap-4">
        <AvatarUpload
          userId={profile?.id ?? authUser?.id ?? ""}
          name={displayName}
          currentAvatarUrl={profile?.avatarUrl ?? authUser?.avatarUrl}
          onUploadComplete={handleAvatarUploadComplete}
        />
        <div>
          <p className="text-base font-bold text-text">{displayName}</p>
          <p className="text-sm text-muted">{displayEmail}</p>
          {displayUsername && (
            <p className="text-xs text-muted">@{displayUsername}</p>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" name="firstName" value={form.firstName} onChange={handleChange} />
            <Field label="Last name" name="lastName" value={form.lastName} onChange={handleChange} />
          </div>
          <Field label="Phone" name="phone" value={form.phone} onChange={handleChange} type="tel" />

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="px-4 py-2 rounded-lg bg-cta text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition cursor-pointer"
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={updateProfile.isPending}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-secondary hover:bg-background transition cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {updateProfile.isError && (
            <p className="text-xs text-error">{getErrorMessage(updateProfile.error, "Failed to save profile.")}</p>
          )}
        </div>
      )}

      {/* Read-only info rows when not editing */}
      {!editing && (
        <div className="space-y-1 pt-1">
          {profile?.phone && <InfoRow label="Phone" value={profile.phone} />}
          {profile?.cccdNumber && <InfoRow label="CCCD" value={profile.cccdNumber} />}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs text-secondary font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cta/40 focus:border-cta transition"
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-xs font-medium text-text">{value}</span>
    </div>
  );
}
