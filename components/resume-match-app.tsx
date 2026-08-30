"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  JobPreferences,
  type PreferenceIdentity,
} from "@/components/job-preferences";
import { Account } from "@/components/account";
import { JobSearch } from "@/components/job-search";
import {
  ResumeAnalysis,
  type ResumeAnalysisState,
} from "@/components/resume-analysis";
import {
  ResumeUploader,
  type ResumeParseResult,
} from "@/components/resume-uploader";
import {
  analyzeResume,
  ResumeAnalysisClientError,
} from "@/lib/analysis/client";
import {
  getFirebaseClient,
  isFirebaseClientConfigured,
} from "@/lib/firebase/client";
import type { JobPreferences as JobPreferencesValue } from "@/lib/preferences/types";
import type { ResumeProfile } from "@/lib/analysis/types";
import {
  beginGuestSession,
  clearGuestSession,
  readGuestSession,
} from "@/lib/session/guest-session";

type AuthState =
  | { status: "loading" }
  | { status: "choice" }
  | { status: "guest" }
  | { status: "user"; user: User };

type AppView = "match" | "account";

function readableAuthError(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "auth/popup-closed-by-user") {
      return "Google Sign-In was closed before it finished.";
    }
    if (error.code === "auth/popup-blocked") {
      return "Your browser blocked the Google Sign-In window. Allow pop-ups and try again.";
    }
  }

  return "We couldn’t sign you in with Google. Please try again or continue as a guest.";
}

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

function ResumeJourney({
  identity,
  onProfileChange,
}: {
  identity: PreferenceIdentity;
  onProfileChange: (profile: ResumeProfile | null) => void;
}) {
  const [resume, setResume] = useState<ResumeParseResult | null>(null);
  const [readyPreferences, setReadyPreferences] =
    useState<JobPreferencesValue | null>(null);
  const [analysisState, setAnalysisState] =
    useState<ResumeAnalysisState | null>(null);
  const journeyRef = useRef<HTMLDivElement | null>(null);
  const analysisRequestRef = useRef<AbortController | null>(null);
  const lastAutomaticAttemptRef = useRef<{
    resume: ResumeParseResult;
    preferences: JobPreferencesValue;
  } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const heading = journeyRef.current?.querySelector<HTMLElement>("#uploader-heading");
      heading?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return () => {
      analysisRequestRef.current?.abort();
      analysisRequestRef.current = null;
    };
  }, []);

  const clearAnalysis = useCallback(() => {
    analysisRequestRef.current?.abort();
    analysisRequestRef.current = null;
    lastAutomaticAttemptRef.current = null;
    setAnalysisState(null);
    onProfileChange(null);
  }, [onProfileChange]);

  const handleResultChange = useCallback((nextResult: ResumeParseResult | null) => {
    analysisRequestRef.current?.abort();
    analysisRequestRef.current = null;
    lastAutomaticAttemptRef.current = null;
    setResume(nextResult);
    setReadyPreferences(null);
    setAnalysisState(null);
    onProfileChange(null);
  }, [onProfileChange]);

  const runAnalysis = useCallback(
    async (
      resumeToAnalyze: ResumeParseResult,
      preferences: JobPreferencesValue,
      retry = false,
    ) => {
      const previousAttempt = lastAutomaticAttemptRef.current;
      if (
        !retry &&
        previousAttempt?.resume === resumeToAnalyze &&
        previousAttempt.preferences.targetLocation === preferences.targetLocation &&
        previousAttempt.preferences.minimumSalary === preferences.minimumSalary
      ) {
        return;
      }

      analysisRequestRef.current?.abort();
      const controller = new AbortController();
      analysisRequestRef.current = controller;
      lastAutomaticAttemptRef.current = {
        resume: resumeToAnalyze,
        preferences,
      };
      setAnalysisState({ status: "loading" });

      try {
        const profile = await analyzeResume(
          {
            resumeText: resumeToAnalyze.text,
            preferences,
          },
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          analysisRequestRef.current !== controller
        ) {
          return;
        }
        setAnalysisState({ status: "success", profile });
        onProfileChange(profile);
      } catch (error) {
        if (
          controller.signal.aborted ||
          analysisRequestRef.current !== controller
        ) {
          return;
        }
        setAnalysisState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "We couldn’t analyze your resume. Please try again.",
          retryAfterSeconds:
            error instanceof ResumeAnalysisClientError && error.status === 429
              ? error.retryAfterSeconds
              : undefined,
        });
      } finally {
        if (analysisRequestRef.current === controller) {
          analysisRequestRef.current = null;
        }
      }
    },
    [onProfileChange],
  );

  const handleReadyChange = useCallback(
    (preferences: JobPreferencesValue | null) => {
      setReadyPreferences(preferences);

      if (!preferences || !resume) {
        clearAnalysis();
        return;
      }

      void runAnalysis(resume, preferences);
    },
    [clearAnalysis, resume, runAnalysis],
  );

  const retryAnalysis = useCallback(() => {
    if (!resume || !readyPreferences) return;
    void runAnalysis(resume, readyPreferences, true);
  }, [readyPreferences, resume, runAnalysis]);

  return (
    <div
      ref={journeyRef}
      className="resume-journey"
      data-flow-step={
        analysisState?.status === "success"
          ? "analysis-complete"
          : analysisState
            ? "analysis"
            : resume
              ? "preferences"
              : "upload"
      }
    >
      <ResumeUploader onResultChange={handleResultChange} />
      {resume && (
        <JobPreferences identity={identity} onReadyChange={handleReadyChange} />
      )}
      {analysisState && (
        <ResumeAnalysis state={analysisState} onRetry={retryAnalysis} />
      )}
      {analysisState?.status === "success" && (
        <JobSearch profile={analysisState.profile} />
      )}
    </div>
  );
}

export function ResumeMatchApp() {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [activeView, setActiveView] = useState<AppView>("match");
  const [sessionProfile, setSessionProfile] = useState<{
    identityKey: string;
    profile: ResumeProfile;
  } | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const choiceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const mainHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const firebaseAvailable = isFirebaseClientConfigured();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const firebase = getFirebaseClient();

    if (!firebase) {
      const frame = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setAuthState(
            readGuestSession() ? { status: "guest" } : { status: "choice" },
          );
        }
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }

    const restoreAuth = async () => {
      let persistenceUnavailable = false;

      try {
        await setPersistence(firebase.auth, browserLocalPersistence);
      } catch {
        persistenceUnavailable = true;
      }

      if (cancelled) return;

      try {
        unsubscribe = onAuthStateChanged(
          firebase.auth,
          (user) => {
            if (cancelled) return;
            setAuthBusy(false);
            setAuthMessage(
              persistenceUnavailable
                ? "Google Sign-In is available, but this browser may not remember it after you close the tab."
                : null,
            );

            if (user) {
              clearGuestSession();
              setSessionProfile(null);
              setAuthState({ status: "user", user });
              return;
            }

            setActiveView("match");
            setSessionProfile(null);
            setAuthState(
              readGuestSession() ? { status: "guest" } : { status: "choice" },
            );
          },
          () => {
            if (cancelled) return;
            setAuthBusy(false);
            setAuthMessage(
              "We couldn’t restore Google Sign-In. You can still continue as a guest.",
            );
            setAuthState(
              readGuestSession() ? { status: "guest" } : { status: "choice" },
            );
          },
        );
      } catch {
        if (cancelled) return;
        setAuthMessage(
          "We couldn’t restore Google Sign-In. You can still continue as a guest.",
        );
        setAuthState(
          readGuestSession() ? { status: "guest" } : { status: "choice" },
        );
      }
    };

    void restoreAuth();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (authState.status !== "choice") return;
    const frame = window.requestAnimationFrame(() => choiceHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [authState.status]);

  const googleSignIn = async () => {
    const firebase = getFirebaseClient();
    if (!firebase) {
      setAuthMessage(
        "Google Sign-In isn’t configured in this environment. Continue as a guest to use ResumeMatch.",
      );
      return;
    }

    setAuthBusy(true);
    setAuthMessage(null);
    try {
      await signInWithPopup(firebase.auth, firebase.googleProvider);
    } catch (error) {
      setAuthBusy(false);
      setAuthMessage(readableAuthError(error));
    }
  };

  const continueAsGuest = () => {
    beginGuestSession();
    setSessionProfile(null);
    setAuthMessage(null);
    setAuthState({ status: "guest" });
  };

  const leaveGuestMode = () => {
    clearGuestSession();
    setActiveView("match");
    setSessionProfile(null);
    setAuthMessage(null);
    setAuthState({ status: "choice" });
  };

  const googleSignOut = async () => {
    const firebase = getFirebaseClient();
    if (!firebase) return;

    setAuthBusy(true);
    setAuthMessage(null);
    try {
      await signOut(firebase.auth);
      setActiveView("match");
      setSessionProfile(null);
    } catch {
      setAuthBusy(false);
      setAuthMessage("We couldn’t sign you out. Please try again.");
    }
  };

  const identity =
    authState.status === "guest"
      ? ({ kind: "guest" } as const)
      : authState.status === "user"
        ? ({ kind: "user", user: authState.user } as const)
        : null;
  const identityKey = identity
    ? identity.kind === "user"
      ? `user:${identity.user.uid}`
      : "guest"
    : null;

  const currentProfile =
    identityKey && sessionProfile?.identityKey === identityKey
      ? sessionProfile.profile
      : null;

  const showMatchView = () => {
    setActiveView("match");
    window.requestAnimationFrame(() => mainHeadingRef.current?.focus());
  };

  const handleProfileChange = useCallback(
    (profile: ResumeProfile | null) => {
      if (!identityKey || !profile) {
        setSessionProfile(null);
        return;
      }

      setSessionProfile({ identityKey, profile });
    },
    [identityKey],
  );

  return (
    <main className="page-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a
          className="brand"
          href="#top"
          aria-label="ResumeMatch home"
          onClick={showMatchView}
        >
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>ResumeMatch</span>
        </a>
        <div className="nav-actions">
          <span className="version-pill">AI resume intake</span>
          {identity && (
            <button
              className="nav-account-button"
              type="button"
              aria-current={activeView === "account" ? "page" : undefined}
              onClick={() => setActiveView("account")}
            >
              Account
            </button>
          )}
        </div>
      </nav>

      <div className="page-content" id="top">
        <div hidden={activeView !== "match"}>
          <header className="hero">
            <p className="eyebrow">Resume ingestion, simplified</p>
            <h1 ref={mainHeadingRef} tabIndex={-1}>
              See what your resume says, in plain text.
            </h1>
            <p className="hero-copy">
              Upload a PDF or DOCX resume, add your job preferences, and turn it into
              a structured profile for more relevant opportunities.
            </p>
          </header>

          {authState.status === "loading" && (
            <section className="auth-card auth-card--loading" aria-label="Loading account">
              <span className="spinner" aria-hidden="true" />
              <p role="status">Restoring your session…</p>
            </section>
          )}

          {authState.status === "choice" && (
            <section className="auth-card" aria-labelledby="access-heading">
              <p className="step-label">Get started</p>
              <h2 id="access-heading" ref={choiceHeadingRef} tabIndex={-1}>
                Choose how to continue
              </h2>
              <p className="auth-copy">
                Sign in to save preferences across visits, or use a private guest
                session in this tab.
              </p>
              <div className="auth-actions">
                <button
                  className="google-button"
                  type="button"
                  disabled={authBusy || !firebaseAvailable}
                  onClick={() => void googleSignIn()}
                >
                  <GoogleIcon />
                  {authBusy ? "Opening Google…" : "Sign in with Google"}
                </button>
                <button
                  className="secondary-button auth-secondary-button"
                  type="button"
                  disabled={authBusy}
                  onClick={continueAsGuest}
                >
                  Continue as Guest
                </button>
              </div>
              {!firebaseAvailable && (
                <p className="configuration-note">
                  Google Sign-In isn’t available in this environment. Guest mode still
                  works normally.
                </p>
              )}
              {authMessage && <p className="form-error" role="alert">{authMessage}</p>}
            </section>
          )}

          {identity && (
            <>
              <aside className="account-strip" aria-label="Account status">
              <div className="account-copy">
                <span className="account-dot" aria-hidden="true" />
                <span>
                  {identity.kind === "user" ? (
                    <>
                      <strong>{identity.user.displayName || "Google account"}</strong>
                      <small>{identity.user.email || "Signed in"}</small>
                    </>
                  ) : (
                    <>
                      <strong>Guest session</strong>
                      <small>Preferences stay in this tab</small>
                    </>
                  )}
                </span>
              </div>
                <button
                  className="account-strip-link"
                  type="button"
                  onClick={() => setActiveView("account")}
                >
                  View account
                </button>
              </aside>

              {authMessage && <p className="account-error" role="alert">{authMessage}</p>}

              <ResumeJourney
                key={identityKey}
                identity={identity}
                onProfileChange={handleProfileChange}
              />

            <p className="privacy-note">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 1.75a4 4 0 0 0-4 4v2H5A1.75 1.75 0 0 0 3.25 9.5v6.75A1.75 1.75 0 0 0 5 18h10a1.75 1.75 0 0 0 1.75-1.75V9.5A1.75 1.75 0 0 0 15 7.75h-1v-2a4 4 0 0 0-4-4Zm2.5 6h-5v-2a2.5 2.5 0 0 1 5 0v2Z" />
              </svg>
              Resume files and AI profiles are not saved. {identity.kind === "user"
                ? "Your job preferences are saved to your account. "
                : "Guest preferences stay only in this browser tab. "}
              Extracted text is sent to Gemini only when you continue from job
              preferences.
            </p>
            </>
          )}
        </div>

        {identity && activeView === "account" && (
          <Account
            key={identityKey}
            identity={identity}
            profile={currentProfile}
            firebaseAvailable={firebaseAvailable}
            authBusy={authBusy}
            authMessage={authMessage}
            onBack={showMatchView}
            onGoogleSignIn={() => void googleSignIn()}
            onSignOut={() => void googleSignOut()}
            onLeaveGuestMode={leaveGuestMode}
          />
        )}
      </div>
    </main>
  );
}
