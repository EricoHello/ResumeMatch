import type { JobPreferences } from "@/lib/preferences/types";
import { parseJobPreferences } from "@/lib/preferences/validation";
import { clearGuestPoints } from "@/lib/points/guest";

export type GuestPreferences = JobPreferences;

type GuestSession = {
  version: 2;
  mode: "guest";
  preferences?: GuestPreferences;
};

const SESSION_KEY = "resumematch:guest-session:v1";
let memorySession: GuestSession | null = null;

export function readGuestSession(): GuestSession | null {
  if (typeof window === "undefined") return memorySession;

  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return memorySession;

    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;

    const candidate = value as Record<string, unknown>;
    if ((candidate.version !== 1 && candidate.version !== 2) || candidate.mode !== "guest") return null;

    let preferences: JobPreferences | undefined;
    if (candidate.preferences !== undefined) {
      try {
        preferences = parseJobPreferences(candidate.preferences);
      } catch {
        return null;
      }
    }

    memorySession = {
      version: 2,
      mode: "guest",
      ...(preferences ? { preferences } : {}),
    };
    return memorySession;
  } catch {
    return memorySession;
  }
}

export function beginGuestSession() {
  if (typeof window === "undefined") return;

  const existing = readGuestSession();
  const session: GuestSession = {
    version: 2,
    mode: "guest",
    ...(existing?.preferences ? { preferences: existing.preferences } : {}),
  };

  memorySession = session;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // In-memory state keeps guest mode functional when storage is unavailable.
  }
}

export function saveGuestPreferences(preferences: GuestPreferences) {
  if (typeof window === "undefined") return;

  const session: GuestSession = {
    version: 2,
    mode: "guest",
    preferences,
  };

  memorySession = session;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // In-memory state keeps guest preferences available for the active tab.
  }
}

export function clearGuestSession() {
  memorySession = null;
  clearGuestPoints();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The in-memory copy has still been cleared.
  }
}
