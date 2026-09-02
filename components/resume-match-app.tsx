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
import {
  Account,
  type ResumePrivacyViewState,
} from "@/components/account";
import { JobSearch } from "@/components/job-search";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { loadResumePrivacySettings } from "@/lib/privacy/client";
import type { ResumePrivacyStatus } from "@/lib/privacy/types";
import {
  loadSavedResume,
  saveSavedResume,
} from "@/lib/resume/saved-client";
import type { SavedResume } from "@/lib/resume/saved-types";
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
type UserResumePrivacyState = {
  userId: string;
  view: ResumePrivacyViewState;
};
type SavedResumeLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };
type ResumePersistenceState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "session-only" }
  | { status: "error"; message: string };

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
  saveResumeData,
}: {
  identity: PreferenceIdentity;
  onProfileChange: (profile: ResumeProfile | null) => void;
  saveResumeData: boolean;
}) {
  const signedInUser = identity.kind === "user" ? identity.user : null;
  const [resume, setResume] = useState<ResumeParseResult | null>(null);
  const [resumeIsLoadedFromAccount, setResumeIsLoadedFromAccount] =
    useState(false);
  const [savedResumeLoadState, setSavedResumeLoadState] =
    useState<SavedResumeLoadState>(
      signedInUser ? { status: "loading" } : { status: "ready" },
    );
  const [persistenceState, setPersistenceState] =
    useState<ResumePersistenceState>({ status: "idle" });
  const [readyPreferences, setReadyPreferences] =
    useState<JobPreferencesValue | null>(null);
  const [analysisState, setAnalysisState] =
    useState<ResumeAnalysisState | null>(null);
  const journeyRef = useRef<HTMLDivElement | null>(null);
  const analysisRequestRef = useRef<AbortController | null>(null);
  const savedResumeLoadRequestRef = useRef<AbortController | null>(null);
  const persistenceAbortRef = useRef<AbortController | null>(null);
  const persistenceQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const latestPersistenceRequestRef = useRef(0);
  const pendingSavedResumeRef = useRef<SavedResume | null>(null);
  const previousSaveResumeDataRef = useRef(saveResumeData);
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
  }, [savedResumeLoadState.status]);

  useEffect(() => {
    return () => {
      analysisRequestRef.current?.abort();
      analysisRequestRef.current = null;
      savedResumeLoadRequestRef.current?.abort();
      savedResumeLoadRequestRef.current = null;
      persistenceAbortRef.current?.abort();
      persistenceAbortRef.current = null;
    };
  }, []);

  const persistResume = useCallback(
    (savedResume: SavedResume) => {
      pendingSavedResumeRef.current = savedResume;
      if (!signedInUser) return;

      if (!saveResumeData) {
        setPersistenceState({ status: "session-only" });
        return;
      }

      const requestNumber = latestPersistenceRequestRef.current + 1;
      latestPersistenceRequestRef.current = requestNumber;
      setPersistenceState({ status: "saving" });

      if (!persistenceAbortRef.current) {
        persistenceAbortRef.current = new AbortController();
      }
      const signal = persistenceAbortRef.current.signal;
      const operation = persistenceQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          return saveSavedResume(signedInUser, savedResume, signal);
        });
      persistenceQueueRef.current = operation;

      void operation.then(
        (result) => {
          if (
            !signal.aborted &&
            latestPersistenceRequestRef.current === requestNumber
          ) {
            setPersistenceState({
              status: result.persisted ? "saved" : "session-only",
            });
          }
        },
        (error: unknown) => {
          if (
            !signal.aborted &&
            latestPersistenceRequestRef.current === requestNumber
          ) {
            setPersistenceState({
              status: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "We couldn’t save your resume. Please try again.",
            });
          }
        },
      );
    },
    [saveResumeData, signedInUser],
  );

  useEffect(() => {
    const wasEnabled = previousSaveResumeDataRef.current;
    previousSaveResumeDataRef.current = saveResumeData;
    if (!signedInUser || wasEnabled === saveResumeData) return;

    if (!saveResumeData) {
      latestPersistenceRequestRef.current += 1;
      persistenceAbortRef.current?.abort();
      persistenceAbortRef.current = null;
      if (pendingSavedResumeRef.current) {
        setPersistenceState({ status: "session-only" });
      }
      return;
    }

    const pendingResume = pendingSavedResumeRef.current;
    if (pendingResume) persistResume(pendingResume);
  }, [persistResume, saveResumeData, signedInUser]);

  const loadAccountResume = useCallback(async () => {
    if (!signedInUser) return;

    savedResumeLoadRequestRef.current?.abort();
    const controller = new AbortController();
    savedResumeLoadRequestRef.current = controller;
    setSavedResumeLoadState({ status: "loading" });

    try {
      const savedResume = await loadSavedResume(
        signedInUser,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      if (savedResume) {
        const loadedResume: ResumeParseResult = {
          fileName: "Saved resume",
          fileType: "pdf",
          text: savedResume.resumeText,
          characterCount: savedResume.resumeText.length,
          warnings: [],
        };
        setResume(loadedResume);
        setResumeIsLoadedFromAccount(true);

        if (savedResume.profile) {
          setReadyPreferences(savedResume.profile.preferences);
          setAnalysisState({ status: "success", profile: savedResume.profile });
          lastAutomaticAttemptRef.current = {
            resume: loadedResume,
            preferences: savedResume.profile.preferences,
          };
          onProfileChange(savedResume.profile);
        }
      }

      setSavedResumeLoadState({ status: "ready" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSavedResumeLoadState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t load your saved resume. You can retry or upload a new one.",
      });
    } finally {
      if (savedResumeLoadRequestRef.current === controller) {
        savedResumeLoadRequestRef.current = null;
      }
    }
  }, [onProfileChange, signedInUser]);

  useEffect(() => {
    if (!signedInUser) return;
    const frame = window.requestAnimationFrame(() => {
      void loadAccountResume();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadAccountResume, signedInUser]);

  const clearAnalysis = useCallback(() => {
    analysisRequestRef.current?.abort();
    analysisRequestRef.current = null;
    lastAutomaticAttemptRef.current = null;
    setAnalysisState(null);
    onProfileChange(null);
  }, [onProfileChange]);

  const handleResultChange = useCallback(
    (nextResult: ResumeParseResult | null) => {
      analysisRequestRef.current?.abort();
      analysisRequestRef.current = null;
      lastAutomaticAttemptRef.current = null;
      setResume(nextResult);
      setResumeIsLoadedFromAccount(false);
      setSavedResumeLoadState({ status: "ready" });
      setReadyPreferences(null);
      setAnalysisState(null);
      onProfileChange(null);

      if (nextResult && signedInUser) {
        persistResume({ resumeText: nextResult.text, profile: null });
      } else {
        setPersistenceState({ status: "idle" });
      }
    },
    [onProfileChange, persistResume, signedInUser],
  );

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
        previousAttempt.preferences.radiusMiles === preferences.radiusMiles &&
        previousAttempt.preferences.workArrangements.length ===
          preferences.workArrangements.length &&
        previousAttempt.preferences.workArrangements.every(
          (arrangement, index) =>
            arrangement === preferences.workArrangements[index],
        ) &&
        previousAttempt.preferences.employmentTypes.length ===
          preferences.employmentTypes.length &&
        previousAttempt.preferences.employmentTypes.every(
          (employmentType, index) =>
            employmentType === preferences.employmentTypes[index],
        ) &&
        previousAttempt.preferences.additionalLocations.length ===
          preferences.additionalLocations.length &&
        previousAttempt.preferences.additionalLocations.every(
          (location, index) => location === preferences.additionalLocations[index],
        ) &&
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
      if (signedInUser) {
        persistResume({ resumeText: resumeToAnalyze.text, profile: null });
      }

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
        if (signedInUser) {
          persistResume({ resumeText: resumeToAnalyze.text, profile });
        }
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
    [onProfileChange, persistResume, signedInUser],
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

  const retryPersistence = useCallback(() => {
    const pendingResume = pendingSavedResumeRef.current;
    if (pendingResume) persistResume(pendingResume);
  }, [persistResume]);

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
      {savedResumeLoadState.status === "loading" ? (
        <section className="uploader-card saved-resume-loading" aria-label="Loading saved resume">
          <span className="spinner" aria-hidden="true" />
          <p role="status">Checking your account for a saved resume…</p>
        </section>
      ) : (
        <>
          {savedResumeLoadState.status === "error" && (
            <div className="notice notice--error saved-resume-notice" role="alert">
              <span className="notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>Couldn’t load saved resume</strong>
                <p>{savedResumeLoadState.message}</p>
                <div className="notice-actions">
                  <button type="button" onClick={() => void loadAccountResume()}>
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}
          <ResumeUploader
            key={resumeIsLoadedFromAccount ? "saved-resume" : "resume-upload"}
            initialResult={resumeIsLoadedFromAccount ? resume : null}
            initialResultIsSaved={resumeIsLoadedFromAccount}
            useReplaceLabel={Boolean(signedInUser)}
            onResultChange={handleResultChange}
          />
        </>
      )}
      {signedInUser && persistenceState.status === "saving" && (
        <p className="resume-persistence-status" role="status">
          <span className="spinner spinner--small" aria-hidden="true" />
          Saving resume to your account…
        </p>
      )}
      {signedInUser && persistenceState.status === "saved" && (
        <p className="resume-persistence-status resume-persistence-status--saved" role="status">
          Resume changes saved to your account.
        </p>
      )}
      {signedInUser && persistenceState.status === "session-only" && (
        <p className="resume-persistence-status" role="status">
          Resume changes are kept only in this session. Resume saving is off.
        </p>
      )}
      {signedInUser && persistenceState.status === "error" && (
        <div className="notice notice--error saved-resume-notice" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div>
            <strong>Couldn’t save resume</strong>
            <p>{persistenceState.message}</p>
            <div className="notice-actions">
              <button type="button" onClick={retryPersistence}>Try again</button>
            </div>
          </div>
        </div>
      )}
      {resume && (
        <JobPreferences identity={identity} onReadyChange={handleReadyChange} />
      )}
      {analysisState && (
        <ResumeAnalysis
          state={analysisState}
          persistsToAccount={Boolean(signedInUser && saveResumeData)}
          onRetry={retryAnalysis}
        />
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
  const [accountDataVersion, setAccountDataVersion] = useState(0);
  const [userResumePrivacy, setUserResumePrivacy] =
    useState<UserResumePrivacyState | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const choiceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const mainHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resumePrivacyRequestRef = useRef<AbortController | null>(null);
  const firebaseAvailable = isFirebaseClientConfigured();

  const loadResumePrivacy = useCallback(async (user: User) => {
    resumePrivacyRequestRef.current?.abort();
    const controller = new AbortController();
    resumePrivacyRequestRef.current = controller;

    try {
      const privacy = await loadResumePrivacySettings(user, controller.signal);
      if (controller.signal.aborted) return;
      setUserResumePrivacy({
        userId: user.uid,
        view: { status: "ready", privacy },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setUserResumePrivacy({
        userId: user.uid,
        view: {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "We couldn’t load your resume privacy setting.",
        },
      });
    } finally {
      if (resumePrivacyRequestRef.current === controller) {
        resumePrivacyRequestRef.current = null;
      }
    }
  }, []);

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
    if (authState.status !== "user") {
      resumePrivacyRequestRef.current?.abort();
      resumePrivacyRequestRef.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void loadResumePrivacy(authState.user);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      resumePrivacyRequestRef.current?.abort();
      resumePrivacyRequestRef.current = null;
    };
  }, [authState, loadResumePrivacy]);

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
  const resumePrivacyState: ResumePrivacyViewState =
    identity?.kind === "user" &&
    userResumePrivacy?.userId === identity.user.uid
      ? userResumePrivacy.view
      : { status: "loading" };
  const saveResumeData =
    identity?.kind === "user" &&
    resumePrivacyState.status === "ready" &&
    resumePrivacyState.privacy.saveResumeData;

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
          <ThemeToggle />
        </div>
      </nav>

      <div className="page-content" id="top">
        <div hidden={activeView !== "match"}>
          <header className="hero">
            <p className="eyebrow">Job search, simplified</p>
            <h1 ref={mainHeadingRef} tabIndex={-1}>
              Your one-stop shop for job searching.
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
                key={`${identityKey}:${accountDataVersion}`}
                identity={identity}
                onProfileChange={handleProfileChange}
                saveResumeData={Boolean(saveResumeData)}
              />

            <p className="privacy-note">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 1.75a4 4 0 0 0-4 4v2H5A1.75 1.75 0 0 0 3.25 9.5v6.75A1.75 1.75 0 0 0 5 18h10a1.75 1.75 0 0 0 1.75-1.75V9.5A1.75 1.75 0 0 0 15 7.75h-1v-2a4 4 0 0 0-4-4Zm2.5 6h-5v-2a2.5 2.5 0 0 1 5 0v2Z" />
              </svg>
              {identity.kind === "user"
                ? saveResumeData
                  ? "Extracted resume text, your latest AI profile, and job preferences are saved to your account. The original file is not stored. "
                  : "New resume text and AI profiles stay only in this session; job preferences still save to your account. "
                : "Resume files and AI profiles are not saved. Guest preferences stay only in this browser tab. "}
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
            resumePrivacyState={resumePrivacyState}
            onResumePrivacyChange={(privacy: ResumePrivacyStatus) => {
              if (identity.kind !== "user") return;
              setUserResumePrivacy({
                userId: identity.user.uid,
                view: { status: "ready", privacy },
              });
            }}
            onReloadResumePrivacy={() => {
              if (identity.kind === "user") {
                setUserResumePrivacy({
                  userId: identity.user.uid,
                  view: { status: "loading" },
                });
                void loadResumePrivacy(identity.user);
              }
            }}
            onDataDeleted={() => {
              setSessionProfile(null);
              setAccountDataVersion((version) => version + 1);
              if (identity.kind === "user") {
                setUserResumePrivacy({
                  userId: identity.user.uid,
                  view: {
                    status: "ready",
                    privacy: {
                      saveResumeData: true,
                      hasSavedResumeData: false,
                    },
                  },
                });
              }
            }}
          />
        )}
      </div>
    </main>
  );
}
