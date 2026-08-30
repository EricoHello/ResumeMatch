import type { JobPreferences } from "@/lib/preferences/types";

export type GuestPreferences = JobPreferences;

type GuestSession = {
  version: 1;
  mode: "guest";
  preferences?: GuestPreferences;
};

const SESSION_KEY = "resumematch:guest-session:v1";
let memorySession: GuestSession | null = null;

function isPreferences(value: unknown): value is GuestPreferences {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.targetLocation === "string" &&
    typeof candidate.minimumSalary === "number" &&
    Number.isInteger(candidate.minimumSalary) &&
    candidate.minimumSalary >= 0 &&
    candidate.minimumSalary <= 10_000_000
  );
}

export function readGuestSession(): GuestSession | null {
  if (typeof window === "undefined") return memorySession;

  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return memorySession;

    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;

    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || candidate.mode !== "guest") return null;
    if (candidate.preferences !== undefined && !isPreferences(candidate.preferences)) {
      return null;
    }

    memorySession = candidate as GuestSession;
    return memorySession;
  } catch {
    return memorySession;
  }
}

export function beginGuestSession() {
  if (typeof window === "undefined") return;

  const existing = readGuestSession();
  const session: GuestSession = {
    version: 1,
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
    version: 1,
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
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The in-memory copy has still been cleared.
  }
}
