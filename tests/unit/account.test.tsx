// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Account } from "@/components/account";
import type { ResumeProfile } from "@/lib/analysis/types";
import {
  beginGuestSession,
  clearGuestSession,
  saveGuestPreferences,
} from "@/lib/session/guest-session";

const SAVED_PREFERENCES = {
  targetLocation: "Seattle, WA",
  additionalLocations: [],
  radiusMiles: 25,
  workArrangements: ["remote", "hybrid", "in_person"] as const,
  employmentTypes: ["contract", "full_time", "part_time", "seasonal"] as const,
  minimumSalary: 120_000,
};

const SESSION_PROFILE: ResumeProfile = {
  summary: "Frontend engineer with experience building accessible web products.",
  experienceLevel: "mid",
  skills: ["TypeScript", "React"],
  recentJobTitles: ["Frontend Engineer"],
  targetRoles: ["Senior Frontend Engineer", "Full Stack Engineer"],
  searchKeywords: ["React", "TypeScript"],
  preferences: SAVED_PREFERENCES,
};

function signedInUser() {
  return {
    uid: "verified-user",
    displayName: "Ada Lovelace",
    email: "ada@example.test",
    photoURL: "https://example.test/ada.jpg",
    getIdToken: vi.fn().mockResolvedValue("fresh-firebase-token"),
  } as unknown as User;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Account", () => {
  beforeEach(() => {
    clearGuestSession();
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Unexpected network request"))),
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows Firebase identity, saved preferences, the session profile, and sign out", async () => {
    const user = signedInUser();
    const onSignOut = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
    );

    render(
      <Account
        identity={{ kind: "user", user }}
        profile={SESSION_PROFILE}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
        onSignOut={onSignOut}
        onLeaveGuestMode={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Ada Lovelace profile" })).toBeTruthy();
    expect(await screen.findByText("Seattle, WA")).toBeTruthy();
    expect(screen.getByText("$120,000 / year")).toBeTruthy();
    expect(screen.getByText("Senior Frontend Engineer")).toBeTruthy();
    expect(screen.getByText("Mid")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer fresh-firebase-token" },
        cache: "no-store",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("shows guest status, session preferences, and Google Sign-In without Firestore access", async () => {
    beginGuestSession();
    saveGuestPreferences({
      targetLocation: "Remote",
      additionalLocations: [],
      radiusMiles: 25,
      workArrangements: ["remote"],
      employmentTypes: ["full_time"],
      minimumSalary: 95_000,
    });
    const onGoogleSignIn = vi.fn();

    render(
      <Account
        identity={{ kind: "guest" }}
        profile={null}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={onGoogleSignIn}
        onSignOut={vi.fn()}
        onLeaveGuestMode={vi.fn()}
      />,
    );

    expect(screen.getByText("Guest status")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Guest session" })).toBeTruthy();
    expect(screen.getByText(/stored only for this browser-tab session/i)).toBeTruthy();
    expect(screen.getAllByText("Remote")).toHaveLength(2);
    expect(screen.getByText("$95,000 / year")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(onGoogleSignIn).toHaveBeenCalledOnce());
  });
});
