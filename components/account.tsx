"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PreferenceIdentity } from "@/components/job-preferences";
import type { ResumeProfile } from "@/lib/analysis/types";
import type { JobPreferences } from "@/lib/preferences/types";
import { readGuestSession } from "@/lib/session/guest-session";

type AccountProps = {
  identity: PreferenceIdentity;
  profile: ResumeProfile | null;
  firebaseAvailable: boolean;
  authBusy: boolean;
  authMessage: string | null;
  onBack: () => void;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
  onLeaveGuestMode: () => void;
};

type PreferencesState =
  | { status: "loading" }
  | { status: "ready"; preferences: JobPreferences | null }
  | { status: "error"; message: string };

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.9A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z" />
      <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
    </svg>
  );
}

function parsePreferencesResponse(body: unknown): JobPreferences | null | undefined {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return undefined;
  }

  const data = body.data;
  if (typeof data !== "object" || data === null || !("preferences" in data)) {
    return undefined;
  }

  if (data.preferences === null) return null;
  if (typeof data.preferences !== "object") return undefined;

  const preferences = data.preferences as Record<string, unknown>;
  if (
    typeof preferences.targetLocation !== "string" ||
    typeof preferences.minimumSalary !== "number"
  ) {
    return undefined;
  }

  return {
    targetLocation: preferences.targetLocation,
    minimumSalary: preferences.minimumSalary,
  };
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return fallback;
    }

    const error = body.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  } catch {
    // Use the fallback for empty or non-JSON responses.
  }

  return fallback;
}

function initials(user: User) {
  const source = user.displayName || user.email || "Google account";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function displayExperienceLevel(level: ResumeProfile["experienceLevel"]) {
  if (level === "unknown") return "Not determined";
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function PreferencesSummary({
  preferences,
  emptyMessage,
}: {
  preferences: JobPreferences | null;
  emptyMessage: string;
}) {
  if (!preferences) {
    return <p className="account-empty">{emptyMessage}</p>;
  }

  return (
    <dl className="account-facts">
      <div>
        <dt>Preferred location</dt>
        <dd>{preferences.targetLocation}</dd>
      </div>
      <div>
        <dt>Minimum salary</dt>
        <dd>${preferences.minimumSalary.toLocaleString("en-US")} / year</dd>
      </div>
    </dl>
  );
}

export function Account({
  identity,
  profile,
  firebaseAvailable,
  authBusy,
  authMessage,
  onBack,
  onGoogleSignIn,
  onSignOut,
  onLeaveGuestMode,
}: AccountProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const signedInUser = identity.kind === "user" ? identity.user : null;
  const guestPreferences =
    identity.kind === "guest" ? readGuestSession()?.preferences ?? null : null;
  const [preferencesState, setPreferencesState] = useState<PreferencesState>(() =>
    signedInUser
      ? { status: "loading" }
      : { status: "ready", preferences: guestPreferences },
  );

  const loadPreferences = useCallback(async () => {
    if (!signedInUser) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPreferencesState({ status: "loading" });

    try {
      const token = await signedInUser.getIdToken(true);
      if (controller.signal.aborted) return;

      const response = await fetch("/api/preferences", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          await responseMessage(
            response,
            "We couldn’t load your saved preferences. Please try again.",
          ),
        );
      }

      const body: unknown = await response.json();
      const preferences = parsePreferencesResponse(body);
      if (preferences === undefined) {
        throw new Error("The server returned an unexpected preferences response.");
      }

      if (!controller.signal.aborted) {
        setPreferencesState({ status: "ready", preferences });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setPreferencesState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t load your saved preferences.",
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [signedInUser]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      if (signedInUser) void loadPreferences();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadPreferences, signedInUser]);

  return (
    <section className="account-page" aria-labelledby="account-heading">
      <button className="account-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        Back to resume matching
      </button>

      <div className="account-page-heading">
        <p className="eyebrow">Your ResumeMatch access</p>
        <h1 id="account-heading" ref={headingRef} tabIndex={-1}>Account</h1>
        <p>
          {identity.kind === "user"
            ? "Review the Google account and saved matching details ResumeMatch already uses."
            : "You’re using ResumeMatch privately without a persistent account."}
        </p>
      </div>

      {identity.kind === "user" ? (
        <section className="account-card account-identity-card" aria-labelledby="identity-heading">
          <div className="account-avatar" aria-hidden={!identity.user.photoURL}>
            {identity.user.photoURL ? (
              // Firebase Auth photo URLs can come from several Google-owned hosts.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={identity.user.photoURL}
                alt={`${identity.user.displayName || "Google account"} profile`}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span aria-hidden="true">{initials(identity.user)}</span>
            )}
          </div>
          <div className="account-identity-copy">
            <span className="account-status-badge">Signed in with Google</span>
            <h2 id="identity-heading">
              {identity.user.displayName || "Google account"}
            </h2>
            <p>{identity.user.email || "Email unavailable"}</p>
          </div>
        </section>
      ) : (
        <section className="account-card account-identity-card" aria-labelledby="identity-heading">
          <div className="account-avatar account-avatar--guest" aria-hidden="true">G</div>
          <div className="account-identity-copy">
            <span className="account-status-badge account-status-badge--guest">Guest status</span>
            <h2 id="identity-heading">Guest session</h2>
            <p>
              Preferences and resume analysis are stored only for this browser-tab
              session. They are not written to your ResumeMatch account or Firestore.
            </p>
          </div>
        </section>
      )}

      <div className="account-grid">
        <section className="account-card" aria-labelledby="account-preferences-heading">
          <div className="account-section-heading">
            <div>
              <p className="step-label">
                {identity.kind === "user" ? "Saved to your account" : "Current session"}
              </p>
              <h2 id="account-preferences-heading">Job preferences</h2>
            </div>
          </div>

          {preferencesState.status === "loading" && (
            <div className="inline-status" role="status">
              <span className="spinner spinner--small" aria-hidden="true" />
              Loading saved preferences…
            </div>
          )}
          {preferencesState.status === "error" && (
            <div className="notice notice--error" role="alert">
              <span className="notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>Couldn’t load saved preferences</strong>
                <p>{preferencesState.message}</p>
                <div className="notice-actions">
                  <button type="button" onClick={() => void loadPreferences()}>
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}
          {preferencesState.status === "ready" && (
            <PreferencesSummary
              preferences={preferencesState.preferences}
              emptyMessage={
                identity.kind === "user"
                  ? "No saved job preferences yet. Add them in the resume-matching flow."
                  : "No preferences have been added in this guest session yet."
              }
            />
          )}
        </section>

        <section className="account-card" aria-labelledby="account-profile-heading">
          <div className="account-section-heading">
            <div>
              <p className="step-label">Current session</p>
              <h2 id="account-profile-heading">AI candidate profile</h2>
            </div>
          </div>

          {profile ? (
            <>
              <dl className="account-facts">
                <div>
                  <dt>Target role</dt>
                  <dd>{profile.targetRoles[0] || "Not identified"}</dd>
                </div>
                <div>
                  <dt>Experience level</dt>
                  <dd>{displayExperienceLevel(profile.experienceLevel)}</dd>
                </div>
              </dl>
              <p className="account-profile-summary">{profile.summary}</p>
            </>
          ) : (
            <p className="account-empty">
              No AI candidate profile in this session yet. Complete resume analysis
              to see a summary here.
            </p>
          )}
          <p className="account-storage-note">
            AI candidate profiles remain in memory for the current page session and
            are not persisted to Firestore.
          </p>
        </section>
      </div>

      <section className="account-card account-access-card" aria-labelledby="account-access-heading">
        <div>
          <p className="step-label">
            {identity.kind === "user" ? "Account access" : "Keep your preferences"}
          </p>
          <h2 id="account-access-heading">
            {identity.kind === "user" ? "Signed in securely" : "Use a persistent account"}
          </h2>
          <p>
            {identity.kind === "user"
              ? "Signing out ends your authenticated ResumeMatch session. Your saved job preferences remain in your account."
              : "Sign in with Google to save job preferences across visits. Your current guest data stays session-only."}
          </p>
        </div>
        <div className="account-access-actions">
          {identity.kind === "user" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={authBusy}
              onClick={onSignOut}
            >
              {authBusy ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <>
              <button
                className="google-button"
                type="button"
                disabled={authBusy || !firebaseAvailable}
                onClick={onGoogleSignIn}
              >
                <GoogleIcon />
                {authBusy ? "Opening Google…" : "Sign in with Google"}
              </button>
              <button
                className="account-exit-button"
                type="button"
                disabled={authBusy}
                onClick={onLeaveGuestMode}
              >
                Exit guest mode
              </button>
            </>
          )}
        </div>
      </section>

      {!firebaseAvailable && identity.kind === "guest" && (
        <p className="configuration-note account-configuration-note">
          Google Sign-In isn’t available in this environment. Guest mode still works normally.
        </p>
      )}
      {authMessage && <p className="account-page-error" role="alert">{authMessage}</p>}
    </section>
  );
}
