"use client";

import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "resumematch:theme";

type Theme = "light" | "dark";

const THEME_CHANGE_EVENT = "resumematch:theme-change";

function themeFromDocument(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function savedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme, persist: boolean) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The page theme still works when browser storage is unavailable.
    }
  }

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeTheme(onStoreChange: () => void) {
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const handleSystemChange = (event: MediaQueryListEvent) => {
    if (savedTheme()) return;
    applyTheme(event.matches ? "dark" : "light", false);
  };

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  media?.addEventListener("change", handleSystemChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    media?.removeEventListener("change", handleSystemChange);
  };
}

function serverTheme(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    themeFromDocument,
    serverTheme,
  );
  const dark = theme === "dark";
  const nextTheme = dark ? "light" : "dark";

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={dark}
      title={`Switch to ${nextTheme} mode`}
      onClick={() => applyTheme(nextTheme, true)}
    >
      <svg className="theme-toggle-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
      </svg>
      <svg className="theme-toggle-sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
      </svg>
    </button>
  );
}
