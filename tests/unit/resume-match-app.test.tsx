// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@/components/resume-uploader", () => ({
  ResumeUploader: () => <div data-testid="resume-uploader" />,
}));

vi.mock("@/components/job-preferences", () => ({
  JobPreferences: () => <div data-testid="job-preferences" />,
}));

import { ResumeMatchApp } from "@/components/resume-match-app";

const SIGNED_IN_USER = {
  uid: "firebase-user",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  getIdToken: vi.fn(),
} as unknown as User;

describe("ResumeMatchApp authentication recovery", () => {
  beforeEach(() => {
    authMocks.onAuthStateChanged.mockReset();
    authMocks.setPersistence.mockReset();
    authMocks.signInWithPopup.mockReset();
    authMocks.signOut.mockReset();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
});
