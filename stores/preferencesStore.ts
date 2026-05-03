import { create } from "zustand";

export type Theme = "LIGHT" | "DARK" | "SYSTEM";
export type MessageDensity = "COMFORTABLE" | "COMPACT";

const STORAGE_THEME_KEY = "zolo-theme";
const STORAGE_DENSITY_KEY = "zolo-density";
const STORAGE_ENTER_TO_SEND_KEY = "zolo-enter-to-send";

function readStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return (localStorage.getItem(key) as T | null) ?? fallback;
}

function readBoolStorage(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "true";
}

interface PreferencesState {
  theme: Theme;
  messageDensity: MessageDensity;
  enterToSend: boolean;
  setTheme: (theme: Theme) => void;
  setMessageDensity: (density: MessageDensity) => void;
  setEnterToSend: (value: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  theme: readStorage<Theme>(STORAGE_THEME_KEY, "SYSTEM"),
  messageDensity: readStorage<MessageDensity>(STORAGE_DENSITY_KEY, "COMFORTABLE"),
  enterToSend: readBoolStorage(STORAGE_ENTER_TO_SEND_KEY, true),
  setTheme: (theme) => {
    set({ theme });
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_THEME_KEY, theme);
  },
  setMessageDensity: (messageDensity) => {
    set({ messageDensity });
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_DENSITY_KEY, messageDensity);
  },
  setEnterToSend: (enterToSend) => {
    set({ enterToSend });
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_ENTER_TO_SEND_KEY, String(enterToSend));
  },
}));
