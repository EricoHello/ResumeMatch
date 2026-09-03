// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Account } from "@/components/account";
import type { ResumeProfile } from "@/lib/analysis/types";
import type { PointAccountViewState } from "@/lib/points/types";
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
  resumeImprovement:
    "The resume is coherent; quantify one accessibility outcome. Build an accessible React component audit tool to reinforce the target frontend roles.",
  experienceLevel: "mid",
  skills: ["TypeScript", "React"],
  recentJobTitles: ["Frontend Engineer"],
  targetRoles: ["Senior Frontend Engineer", "Full Stack Engineer"],
  searchKeywords: ["React", "TypeScript"],
  preferences: SAVED_PREFERENCES,
};

const RESUME_PRIVACY_ON = {
  status: "ready" as const,
  privacy: { saveResumeData: true, hasSavedResumeData: true },
};

const SIGNED_IN_POINTS: PointAccountViewState = {
  status: "ready",
  snapshot: {
    points: { balance: 25, totalEarned: 30, totalSpent: 5 },
    history: [
      {
        id: "earn-job-one",
        kind: "earn",
        action: "job_click",
        amount: 10,
        description: "Viewed a suggested job",
        timestamp: "2026-08-31T18:30:00.000Z",
      },
      {
        id: "spend-example",
        kind: "spend",
        action: "example_spend",
        amount: -5,
        description: "Used points on an example reward",
        timestamp: "2026-08-30T16:00:00.000Z",
      },
    ],
  },
};

const GUEST_POINTS: PointAccountViewState = {
  status: "ready",
  snapshot: {
    points: { balance: 10, totalEarned: 10, totalSpent: 0 },
    history: [],
  },
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
        pointsState={SIGNED_IN_POINTS}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
        onSignOut={onSignOut}
        onLeaveGuestMode={vi.fn()}
        onReloadPoints={vi.fn()}
        onDataDeleted={vi.fn()}
        resumePrivacyState={RESUME_PRIVACY_ON}
        onResumePrivacyChange={vi.fn()}
        onReloadResumePrivacy={vi.fn()}
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
    expect(screen.getByRole("heading", { name: "Points & rewards" })).toBeTruthy();
    expect(screen.getByLabelText("Current point balance").textContent).toBe(
      "25pts",
    );
    expect(screen.getByText("30 pts")).toBeTruthy();
    expect(screen.getByText("5 pts")).toBeTruthy();
    expect(screen.getByText("Persistent account history")).toBeTruthy();
    expect(screen.getByText("Viewed a suggested job")).toBeTruthy();
    expect(screen.getByText("+10 pts")).toBeTruthy();
    expect(screen.getByText("Used points on an example reward")).toBeTruthy();
    expect(screen.getByText("-5 pts")).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Save my resume for future sessions" })
        .getAttribute("aria-checked"),
    ).toBe("true");
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
        pointsState={GUEST_POINTS}
        onBack={vi.fn()}
        onGoogleSignIn={onGoogleSignIn}
        onSignOut={vi.fn()}
        onLeaveGuestMode={vi.fn()}
        onReloadPoints={vi.fn()}
        onDataDeleted={vi.fn()}
        resumePrivacyState={{ status: "loading" }}
        onResumePrivacyChange={vi.fn()}
        onReloadResumePrivacy={vi.fn()}
      />,
    );

    expect(screen.getByText("Guest status")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Guest session" })).toBeTruthy();
    expect(screen.getByText(/stored only for this browser-tab session/i)).toBeTruthy();
    expect(screen.getAllByText("Remote")).toHaveLength(2);
    expect(screen.getByText("$95,000 / year")).toBeTruthy();
    expect(screen.getByLabelText("Current point balance").textContent).toBe(
      "10pts",
    );
    expect(
      screen.getByText("Clears when this guest session ends"),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send My Data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete My Data" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(onGoogleSignIn).toHaveBeenCalledOnce());
  });

  it("emails account data using a fresh Firebase token", async () => {
    const user = signedInUser();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true } }));

    render(
      <Account
        identity={{ kind: "user", user }}
        profile={SESSION_PROFILE}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        pointsState={SIGNED_IN_POINTS}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onLeaveGuestMode={vi.fn()}
        onReloadPoints={vi.fn()}
        onDataDeleted={vi.fn()}
        resumePrivacyState={RESUME_PRIVACY_ON}
        onResumePrivacyChange={vi.fn()}
        onReloadResumePrivacy={vi.fn()}
      />,
    );

    await screen.findByText("Seattle, WA");
    fireEvent.click(screen.getByRole("button", { name: "Send My Data" }));

    expect(
      await screen.findByText(/sent to your authenticated account email/i),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/account/data",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer fresh-firebase-token" },
        cache: "no-store",
      }),
    );
  });

  it("requires an explicit irreversible warning before deleting account data", async () => {
    const user = signedInUser();
    const onDataDeleted = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));

    render(
      <Account
        identity={{ kind: "user", user }}
        profile={SESSION_PROFILE}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        pointsState={SIGNED_IN_POINTS}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onLeaveGuestMode={vi.fn()}
        onReloadPoints={vi.fn()}
        onDataDeleted={onDataDeleted}
        resumePrivacyState={RESUME_PRIVACY_ON}
        onResumePrivacyChange={vi.fn()}
        onReloadResumePrivacy={vi.fn()}
      />,
    );

    await screen.findByText("Seattle, WA");
    fireEvent.click(screen.getByRole("button", { name: "Delete My Data" }));

    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation.textContent).toContain("This cannot be undone.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Yes, permanently delete" }),
    );

    expect(
      await screen.findByText(/has been permanently deleted/i),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/account/data",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer fresh-firebase-token" },
        cache: "no-store",
      }),
    );
    expect(onDataDeleted).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByText(/No saved job preferences yet/i),
    ).toBeTruthy();
  });

  it("turns resume saving off and offers to delete only existing resume data", async () => {
    const user = signedInUser();
    const onResumePrivacyChange = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            privacy: {
              saveResumeData: false,
              hasSavedResumeData: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));

    render(
      <Account
        identity={{ kind: "user", user }}
        profile={SESSION_PROFILE}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        pointsState={SIGNED_IN_POINTS}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onLeaveGuestMode={vi.fn()}
        onReloadPoints={vi.fn()}
        onDataDeleted={vi.fn()}
        resumePrivacyState={RESUME_PRIVACY_ON}
        onResumePrivacyChange={onResumePrivacyChange}
        onReloadResumePrivacy={vi.fn()}
      />,
    );

    await screen.findByText("Seattle, WA");
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Save my resume for future sessions",
      }),
    );

    const confirmation = await screen.findByRole("alertdialog");
    expect(confirmation.textContent).toContain(
      "job preferences will not be deleted",
    );
    expect(onResumePrivacyChange).toHaveBeenCalledWith({
      saveResumeData: false,
      hasSavedResumeData: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/account/privacy",
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer fresh-firebase-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ saveResumeData: false }),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete saved resume data" }),
    );

    expect(
      await screen.findByText(/previously saved resume text.*permanently deleted/i),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/resumes/saved",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onResumePrivacyChange).toHaveBeenLastCalledWith({
      saveResumeData: false,
      hasSavedResumeData: false,
    });
  });
});
