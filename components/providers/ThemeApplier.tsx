"use client";

import { useEffect } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useMyProfile } from "@/hooks/useUser";
import type { Theme, MessageDensity } from "@/stores/preferencesStore";

export function ThemeApplier() {
  const theme = usePreferencesStore((s) => s.theme);
  const messageDensity = usePreferencesStore((s) => s.messageDensity);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const setMessageDensity = usePreferencesStore((s) => s.setMessageDensity);
  const setEnterToSend = usePreferencesStore((s) => s.setEnterToSend);

  const { data: profile } = useMyProfile();

  // Sync server-side preferences into local store once profile loads
  useEffect(() => {
    const s = profile?.settings;
    if (!s) return;
    if (s.theme) setTheme(s.theme as Theme);
    if (s.messageDensity) setMessageDensity(s.messageDensity as MessageDensity);
    if (s.enterToSend !== undefined) setEnterToSend(s.enterToSend);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme.toLowerCase();
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = messageDensity.toLowerCase();
  }, [messageDensity]);

  return null;
}
