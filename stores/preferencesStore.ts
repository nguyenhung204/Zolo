import { create } from "zustand";

export type Theme = "LIGHT" | "DARK" | "SYSTEM";
export type MessageDensity = "COMFORTABLE" | "COMPACT";

const STORAGE_THEME_KEY = "zolo-theme";
const STORAGE_DENSITY_KEY = "zolo-density";

function readStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return (localStorage.getItem(key) as T | null) ?? fallback;
}

interface PreferencesState {
  theme: Theme;
  messageDensity: MessageDensity;
  setTheme: (theme: Theme) => void;
  setMessageDensity: (density: MessageDensity) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  theme: readStorage<Theme>(STORAGE_THEME_KEY, "SYSTEM"),
  messageDensity: readStorage<MessageDensity>(STORAGE_DENSITY_KEY, "COMFORTABLE"),
  setTheme: (theme) => {
    set({ theme });
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_THEME_KEY, theme);
  },
  setMessageDensity: (messageDensity) => {
    set({ messageDensity });
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_DENSITY_KEY, messageDensity);
  },
}));
