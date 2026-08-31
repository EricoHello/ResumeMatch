// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

const clientMocks = vi.hoisted(() => ({
  auth: { name: "test-auth" },
  googleProvider: { name: "test-google-provider" },
}));

const savedResumeMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

const analysisMocks = vi.hoisted(() => ({
  analyze: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  browserLocalPersistence: { name: "browser-local" },
  onAuthStateChanged: authMocks.onAuthStateChanged,
  setPersistence: authMocks.setPersistence,
  signInWithPopup: authMocks.signInWithPopup,
  signOut: authMocks.signOut,
}));

vi.mock("@/lib/firebase/client", () => ({
  getFirebaseClient: () => clientMocks,
  isFirebaseClientConfigured: () => true,
}));

vi.mock("@/lib/session/guest-session", () => ({
  beginGuestSession: vi.fn(),
  clearGuestSession: vi.fn(),
  readGuestSession: vi.fn(() => null),
}));

vi.mock("@/lib/resume/saved-client", () => ({
  loadSavedResume: savedResumeMocks.load,
  saveSavedResume: savedResumeMocks.save,
}));

vi.mock("@/lib/analysis/client", () => ({
  analyzeResume: analysisMocks.analyze,
  ResumeAnalysisClientError: class TestResumeAnalysisClientError extends Error {
    status = 500;
  },
}));

vi.mock("@/components/resume-uploader", () => ({
  ResumeUploader: ({
    initialResult,
    onResultChange,
    useReplaceLabel,
  }: {
    initialResult?: { text: string } | null;
    onResultChange?: (result: {
      fileName: string;
      fileType: "pdf";
      text: string;
      characterCount: number;
    }) => void;
    useReplaceLabel?: boolean;
  }) => (
    <div>
      <input data-testid="resume-uploader" aria-label="Resume session state" />
      {initialResult && <p>Loaded saved text: {initialResult.text}</p>}
      {initialResult && useReplaceLabel && <button>Replace resume</button>}
      <button
        type="button"
        onClick={() =>
          onResultChange?.({
            fileName: "replacement.pdf",
            fileType: "pdf",
            text: "Replacement resume text for a senior TypeScript engineer.",
            characterCount: 58,
          })
        }
      >
        Simulate parsed resume
      </button>
    </div>
  ),
}));

vi.mock("@/components/job-preferences", () => ({
  JobPreferences: ({
    onReadyChange,
  }: {
    onReadyChange: (preferences: {
      targetLocation: string;
      additionalLocations: string[];
      radiusMiles: number;
      workArrangement: "any";
      minimumSalary: number;
    }) => void;
  }) => (
    <button
      data-testid="job-preferences"
      type="button"
      onClick={() =>
        onReadyChange({
          targetLocation: "Seattle, WA",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "any",
          minimumSalary: 140_000,
        })
      }
    >
      Continue test preferences
    </button>
  ),
}));

import { ResumeMatchApp } from "@/components/resume-match-app";

const SIGNED_IN_USER = {
  uid: "firebase-user",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  getIdToken: vi.fn().mockResolvedValue("firebase-token"),
} as unknown as User;

const PROFILE = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior" as const,
  skills: ["TypeScript"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangement: "any" as const,
    minimumSalary: 140_000,
  },
};

describe("ResumeMatchApp authentication recovery", () => {
  beforeEach(() => {
    authMocks.onAuthStateChanged.mockReset();
    authMocks.setPersistence.mockReset();
    authMocks.signInWithPopup.mockReset();
    authMocks.signOut.mockReset();
    savedResumeMocks.load.mockReset();
    savedResumeMocks.save.mockReset();
    analysisMocks.analyze.mockReset();
    savedResumeMocks.load.mockResolvedValue(null);
    savedResumeMocks.save.mockImplementation(async (_user, savedResume) => savedResume);
    analysisMocks.analyze.mockResolvedValue(PROFILE);

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

  it("continues observing Google Sign-In when local persistence is unavailable", async () => {
    let notifyAuthState: ((user: User | null) => void) | undefined;
    authMocks.setPersistence.mockRejectedValue(
      new Error("Browser storage is unavailable"),
    );
    authMocks.onAuthStateChanged.mockImplementation(
      (
        _auth: unknown,
        next: (user: User | null) => void,
      ) => {
        notifyAuthState = next;
        queueMicrotask(() => next(null));
        return vi.fn();
      },
    );
    authMocks.signInWithPopup.mockImplementation(async () => {
      notifyAuthState?.(SIGNED_IN_USER);
      return { user: SIGNED_IN_USER };
    });

    render(<ResumeMatchApp />);

    const signIn = await screen.findByRole("button", {
      name: "Sign in with Google",
    });
    expect(authMocks.onAuthStateChanged).toHaveBeenCalledOnce();

    fireEvent.click(signIn);

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByTestId("resume-uploader")).toBeTruthy();
    expect(
      screen.getByText(/this browser may not remember it/i),
    ).toBeTruthy();
    expect(authMocks.signInWithPopup).toHaveBeenCalledWith(
      clientMocks.auth,
      clientMocks.googleProvider,
    );
  });

  it("opens Account from navigation and returns without remounting the matching flow", async () => {
    authMocks.setPersistence.mockResolvedValue(undefined);
    authMocks.onAuthStateChanged.mockImplementation(
      (_auth: unknown, next: (user: User | null) => void) => {
        queueMicrotask(() => next(SIGNED_IN_USER));
        return vi.fn();
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              preferences: {
                targetLocation: "Seattle, WA",
                minimumSalary: 120_000,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(<ResumeMatchApp />);

    const sessionInput = await screen.findByLabelText("Resume session state");
    fireEvent.change(sessionInput, { target: { value: "keep this session" } });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    expect(await screen.findByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.getByLabelText("Resume session state")).toHaveProperty(
      "value",
      "keep this session",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Back to resume matching" }),
    );
    expect(screen.getByLabelText("Resume session state")).toHaveProperty(
      "value",
      "keep this session",
    );
  });

  it("restores a signed-in user's saved resume and latest profile", async () => {
    authMocks.setPersistence.mockResolvedValue(undefined);
    authMocks.onAuthStateChanged.mockImplementation(
      (_auth: unknown, next: (user: User | null) => void) => {
        queueMicrotask(() => next(SIGNED_IN_USER));
        return vi.fn();
      },
    );
    savedResumeMocks.load.mockResolvedValue({
      resumeText: "Saved resume text for a senior TypeScript platform engineer.",
      profile: PROFILE,
    });

    render(<ResumeMatchApp />);

    expect(
      await screen.findByText(/Loaded saved text: Saved resume text/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace resume" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Your resume is ready for the next step" }),
    ).toBeTruthy();
    expect(savedResumeMocks.load).toHaveBeenCalledWith(
      SIGNED_IN_USER,
      expect.any(AbortSignal),
    );
  });

  it("saves replacement text and the successful AI profile for signed-in users", async () => {
    authMocks.setPersistence.mockResolvedValue(undefined);
    authMocks.onAuthStateChanged.mockImplementation(
      (_auth: unknown, next: (user: User | null) => void) => {
        queueMicrotask(() => next(SIGNED_IN_USER));
        return vi.fn();
      },
    );

    render(<ResumeMatchApp />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Simulate parsed resume" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue test preferences" }),
    );

    await waitFor(() =>
      expect(savedResumeMocks.save).toHaveBeenLastCalledWith(
        SIGNED_IN_USER,
        {
          resumeText:
            "Replacement resume text for a senior TypeScript engineer.",
          profile: PROFILE,
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it("never loads or saves persistent resume data for guests", async () => {
    authMocks.setPersistence.mockResolvedValue(undefined);
    authMocks.onAuthStateChanged.mockImplementation(
      (_auth: unknown, next: (user: User | null) => void) => {
        queueMicrotask(() => next(null));
        return vi.fn();
      },
    );

    render(<ResumeMatchApp />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue as Guest" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Simulate parsed resume" }),
    );

    expect(savedResumeMocks.load).not.toHaveBeenCalled();
    expect(savedResumeMocks.save).not.toHaveBeenCalled();
  });
});
