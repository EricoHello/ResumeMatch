"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PreferenceIdentity } from "@/components/job-preferences";
import type { ResumeProfile } from "@/lib/analysis/types";
import { saveResumePrivacySettings } from "@/lib/privacy/client";
import type { ResumePrivacyStatus } from "@/lib/privacy/types";
import {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  type JobPreferences,
} from "@/lib/preferences/types";
import { parseJobPreferences } from "@/lib/preferences/validation";
import type {
  PointAccountViewState,
  PointHistoryEntry,
} from "@/lib/points/types";
import { readGuestSession } from "@/lib/session/guest-session";
import { deleteSavedResume } from "@/lib/resume/saved-client";

export type ResumePrivacyViewState =
  | { status: "loading" }
  | { status: "ready"; privacy: ResumePrivacyStatus }
  | { status: "error"; message: string };

type AccountProps = {
  identity: PreferenceIdentity;
  profile: ResumeProfile | null;
  firebaseAvailable: boolean;
  authBusy: boolean;
  authMessage: string | null;
  pointsState: PointAccountViewState;
  onBack: () => void;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
  onLeaveGuestMode: () => void;
  onReloadPoints: () => void;
  onDataDeleted: () => void;
  resumePrivacyState: ResumePrivacyViewState;
  onResumePrivacyChange: (privacy: ResumePrivacyStatus) => void;
  onReloadResumePrivacy: () => void;
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

  try {
    return parseJobPreferences(data.preferences);
  } catch {
    return undefined;
  }
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

const POINT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function pointTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : POINT_DATE_FORMATTER.format(date);
}

function pointAmount(entry: PointHistoryEntry) {
  return `${entry.amount > 0 ? "+" : ""}${entry.amount} pts`;
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
        <dt>Preferred locations</dt>
        <dd>
          {[preferences.targetLocation, ...preferences.additionalLocations].join(", ")}
        </dd>
      </div>
      <div>
        <dt>Search radius</dt>
        <dd>{preferences.radiusMiles} miles</dd>
      </div>
      <div>
        <dt>Work arrangement</dt>
        <dd>
          {preferences.workArrangements.length
            ? preferences.workArrangements
                .map((arrangement) => WORK_ARRANGEMENT_LABELS[arrangement])
                .join(", ")
            : "None selected"}
        </dd>
      </div>
      <div>
        <dt>Type of job</dt>
        <dd>
          {preferences.employmentTypes.length
            ? preferences.employmentTypes
                .map((type) => EMPLOYMENT_TYPE_LABELS[type])
                .join(", ")
            : "None selected"}
        </dd>
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
  pointsState,
  onBack,
  onGoogleSignIn,
  onSignOut,
  onLeaveGuestMode,
  onReloadPoints,
  onDataDeleted,
  resumePrivacyState,
  onResumePrivacyChange,
  onReloadResumePrivacy,
}: AccountProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const dataActionRequestRef = useRef<AbortController | null>(null);
  const privacyActionRequestRef = useRef<AbortController | null>(null);
  const signedInUser = identity.kind === "user" ? identity.user : null;
  const guestPreferences =
    identity.kind === "guest" ? readGuestSession()?.preferences ?? null : null;
  const [preferencesState, setPreferencesState] = useState<PreferencesState>(() =>
    signedInUser
      ? { status: "loading" }
      : { status: "ready", preferences: guestPreferences },
  );
  const [dataAction, setDataAction] = useState<"send" | "delete" | null>(
    null,
  );
  const [dataActionMessage, setDataActionMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [privacyAction, setPrivacyAction] = useState<
    "updating" | "deleting-saved" | null
  >(null);
  const [privacyMessage, setPrivacyMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteSavedResumePromptOpen, setDeleteSavedResumePromptOpen] =
    useState(false);

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
      dataActionRequestRef.current?.abort();
      dataActionRequestRef.current = null;
      privacyActionRequestRef.current?.abort();
      privacyActionRequestRef.current = null;
    };
  }, [loadPreferences, signedInUser]);

  const runDataAction = async (action: "send" | "delete") => {
    if (!signedInUser) return;

    dataActionRequestRef.current?.abort();
    const controller = new AbortController();
    dataActionRequestRef.current = controller;
    setDataAction(action);
    setDataActionMessage(null);

    try {
      const token = await signedInUser.getIdToken(true);
      if (controller.signal.aborted) return;

      const response = await fetch("/api/account/data", {
        method: action === "send" ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          await responseMessage(
            response,
            action === "send"
              ? "We couldn’t email your ResumeMatch data. Please try again."
              : "We couldn’t delete your ResumeMatch data. Please try again.",
          ),
        );
      }

      if (controller.signal.aborted) return;

      if (action === "send") {
        setDataActionMessage({
          kind: "success",
          text: "Your ResumeMatch data was sent to your authenticated account email.",
        });
      } else {
        setDeleteConfirmationOpen(false);
        setDeleteSavedResumePromptOpen(false);
        setPreferencesState({ status: "ready", preferences: null });
        onDataDeleted();
        setDataActionMessage({
          kind: "success",
          text: "All ResumeMatch data stored in Firestore for your account has been permanently deleted.",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setDataActionMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : action === "send"
              ? "We couldn’t email your ResumeMatch data. Please try again."
              : "We couldn’t delete your ResumeMatch data. Please try again.",
      });
    } finally {
      if (dataActionRequestRef.current === controller) {
        dataActionRequestRef.current = null;
        setDataAction(null);
      }
    }
  };

  const updateResumePrivacy = async (saveResumeData: boolean) => {
    if (!signedInUser) return;

    privacyActionRequestRef.current?.abort();
    const controller = new AbortController();
    privacyActionRequestRef.current = controller;
    setPrivacyAction("updating");
    setPrivacyMessage(null);
    setDeleteSavedResumePromptOpen(false);

    try {
      const privacy = await saveResumePrivacySettings(
        signedInUser,
        saveResumeData,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      onResumePrivacyChange(privacy);
      if (!saveResumeData && privacy.hasSavedResumeData) {
        setDeleteSavedResumePromptOpen(true);
      } else {
        setPrivacyMessage({
          kind: "success",
          text: saveResumeData
            ? "Future resume text and AI profiles will be saved to your account."
            : "Future resume text and AI profiles will stay only in this session.",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setPrivacyMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn’t update your resume privacy setting. Please try again.",
      });
    } finally {
      if (privacyActionRequestRef.current === controller) {
        privacyActionRequestRef.current = null;
        setPrivacyAction(null);
      }
    }
  };

  const deletePreviouslySavedResume = async () => {
    if (!signedInUser) return;

    privacyActionRequestRef.current?.abort();
    const controller = new AbortController();
    privacyActionRequestRef.current = controller;
    setPrivacyAction("deleting-saved");
    setPrivacyMessage(null);

    try {
      await deleteSavedResume(signedInUser, controller.signal);
      if (controller.signal.aborted) return;

      onResumePrivacyChange({
        saveResumeData: false,
        hasSavedResumeData: false,
      });
      setDeleteSavedResumePromptOpen(false);
      setPrivacyMessage({
        kind: "success",
        text: "Your previously saved resume text and AI profile were permanently deleted. Job preferences remain saved.",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPrivacyMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn’t delete your saved resume data. Please try again.",
      });
    } finally {
      if (privacyActionRequestRef.current === controller) {
        privacyActionRequestRef.current = null;
        setPrivacyAction(null);
      }
    }
  };

  const resumeSavingEnabled =
    resumePrivacyState.status === "ready" &&
    resumePrivacyState.privacy.saveResumeData;
  const accountActionBusy =
    dataAction !== null ||
    privacyAction !== null ||
    deleteSavedResumePromptOpen;

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
            ? "Review the Google account, matching details, and points ResumeMatch already uses."
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

      <section
        className="account-card account-points-card"
        aria-labelledby="account-points-heading"
      >
        <div className="account-points-heading">
          <div>
            <p className="step-label">
              {identity.kind === "user" ? "Saved to your account" : "Current session"}
            </p>
            <h2 id="account-points-heading">Points &amp; rewards</h2>
          </div>
          {pointsState.status === "ready" && (
            <div className="account-point-balance" aria-label="Current point balance">
              <strong>{pointsState.snapshot.points.balance}</strong>
              <span>pts</span>
            </div>
          )}
        </div>

        {pointsState.status === "loading" && (
          <div className="inline-status" role="status">
            <span className="spinner spinner--small" aria-hidden="true" />
            Loading points…
          </div>
        )}

        {pointsState.status === "error" && (
          <div className="notice notice--error" role="alert">
            <span className="notice-icon" aria-hidden="true">!</span>
            <div>
              <strong>Couldn’t load points</strong>
              <p>{pointsState.message}</p>
              <div className="notice-actions">
                <button type="button" onClick={onReloadPoints}>
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {pointsState.status === "ready" && (
          <>
            <dl className="account-point-totals">
              <div>
                <dt>Total earned</dt>
                <dd>{pointsState.snapshot.points.totalEarned} pts</dd>
              </div>
              <div>
                <dt>Total spent</dt>
                <dd>{pointsState.snapshot.points.totalSpent} pts</dd>
              </div>
            </dl>

            <div className="account-point-history-heading">
              <h3>Point history</h3>
              <span>
                {identity.kind === "user"
                  ? "Persistent account history"
                  : "Clears when this guest session ends"}
              </span>
            </div>

            {pointsState.snapshot.history.length === 0 ? (
              <p className="account-empty">
                No point activity yet. View a suggested job to start earning.
              </p>
            ) : (
              <ol className="account-point-history">
                {pointsState.snapshot.history.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`account-point-kind account-point-kind--${entry.kind}`}
                      aria-hidden="true"
                    >
                      {entry.kind === "earn" ? "+" : "−"}
                    </span>
                    <span className="account-point-event">
                      <strong>{entry.description}</strong>
                      <time dateTime={entry.timestamp}>
                        {pointTimestamp(entry.timestamp)}
                      </time>
                    </span>
                    <strong
                      className={`account-point-amount account-point-amount--${entry.kind}`}
                    >
                      {pointAmount(entry)}
                    </strong>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

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
              <p className="step-label">
                {identity.kind === "user"
                  ? resumeSavingEnabled
                    ? "Saved to your account"
                    : "Resume saving off"
                  : "Current session"}
              </p>
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
              {identity.kind === "user"
                ? resumeSavingEnabled
                  ? "No saved AI candidate profile yet. Complete resume analysis to save one here."
                  : "No AI candidate profile in this session yet. Resume saving is turned off."
                : "No AI candidate profile in this session yet. Complete resume analysis to see a summary here."}
            </p>
          )}
          <p className="account-storage-note">
            {identity.kind === "user"
              ? resumeSavingEnabled
                ? "The latest AI candidate profile and extracted resume text are stored in your Firestore account. The original resume file is not stored."
                : "New resume text and AI profiles stay only in this page session. Job preferences still save normally."
              : "AI candidate profiles remain in memory for the current page session and are not persisted to Firestore."}
          </p>
        </section>
      </div>

      {identity.kind === "user" && (
        <section className="account-card resume-privacy-card" aria-labelledby="resume-privacy-heading">
          <div>
            <p className="step-label">Resume privacy</p>
            <h2 id="resume-privacy-heading">
              Save my resume for future sessions
            </h2>
            <p>
              When off, new extracted resume text and AI profiles remain only in
              this page session. Your job preferences and account access still save
              normally.
            </p>
          </div>

          {resumePrivacyState.status === "loading" && (
            <div className="inline-status resume-privacy-status" role="status">
              <span className="spinner spinner--small" aria-hidden="true" />
              Loading setting…
            </div>
          )}

          {resumePrivacyState.status === "error" && (
            <div className="resume-privacy-load-error" role="alert">
              <p>{resumePrivacyState.message}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={onReloadResumePrivacy}
              >
                Try again
              </button>
            </div>
          )}

          {resumePrivacyState.status === "ready" && (
            <button
              className="privacy-switch"
              type="button"
              role="switch"
              aria-checked={resumePrivacyState.privacy.saveResumeData}
              aria-labelledby="resume-privacy-heading"
              disabled={accountActionBusy}
              onClick={() =>
                void updateResumePrivacy(
                  !resumePrivacyState.privacy.saveResumeData,
                )
              }
            >
              <span className="privacy-switch-track" aria-hidden="true">
                <span />
              </span>
              <span>
                {privacyAction === "updating"
                  ? "Saving…"
                  : resumePrivacyState.privacy.saveResumeData
                    ? "On"
                    : "Off"}
              </span>
            </button>
          )}

          {deleteSavedResumePromptOpen && (
            <div
              className="delete-confirmation resume-delete-confirmation"
              role="alertdialog"
              aria-labelledby="saved-resume-delete-heading"
              aria-describedby="saved-resume-delete-description"
            >
              <div>
                <strong id="saved-resume-delete-heading">
                  Delete the resume data already saved?
                </strong>
                <p id="saved-resume-delete-description">
                  Resume saving is now off. You can keep the existing saved resume
                  text and AI profile, or permanently delete them now. Deletion
                  cannot be undone; job preferences will not be deleted.
                </p>
              </div>
              <div className="delete-confirmation-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={privacyAction === "deleting-saved"}
                  onClick={() => {
                    setDeleteSavedResumePromptOpen(false);
                    setPrivacyMessage({
                      kind: "success",
                      text: "Resume saving is off. Your previously saved resume data remains in Firestore.",
                    });
                  }}
                >
                  Keep saved data
                </button>
                <button
                  className="danger-button danger-button--solid"
                  type="button"
                  disabled={privacyAction === "deleting-saved"}
                  autoFocus
                  onClick={() => void deletePreviouslySavedResume()}
                >
                  {privacyAction === "deleting-saved"
                    ? "Deleting…"
                    : "Delete saved resume data"}
                </button>
              </div>
            </div>
          )}

          {privacyMessage && (
            <p
              className={`resume-privacy-message resume-privacy-message--${privacyMessage.kind}`}
              role={privacyMessage.kind === "error" ? "alert" : "status"}
            >
              {privacyMessage.text}
            </p>
          )}
        </section>
      )}

      {identity.kind === "user" && (
        <section className="account-card account-data-card" aria-labelledby="account-data-heading">
          <div>
            <p className="step-label">Privacy controls</p>
            <h2 id="account-data-heading">Your ResumeMatch data</h2>
            <p>
              Email yourself a JSON copy of the data saved for this account, or
              permanently remove all of it from Firestore. These actions only apply
              to the authenticated account shown above.
            </p>
          </div>
          <div className="account-data-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={accountActionBusy}
              onClick={() => void runDataAction("send")}
            >
              {dataAction === "send" ? "Sending…" : "Send My Data"}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={accountActionBusy}
              onClick={() => {
                setDataActionMessage(null);
                setDeleteConfirmationOpen(true);
              }}
            >
              Delete My Data
            </button>
          </div>

          {deleteConfirmationOpen && (
            <div
              className="delete-confirmation"
              role="alertdialog"
              aria-labelledby="delete-confirmation-heading"
              aria-describedby="delete-confirmation-description"
              onKeyDown={(event) => {
                if (event.key === "Escape" && dataAction !== "delete") {
                  setDeleteConfirmationOpen(false);
                }
              }}
            >
              <div>
                <strong id="delete-confirmation-heading">
                  Permanently delete your data?
                </strong>
                <p id="delete-confirmation-description">
                  This will delete your saved job preferences, extracted resume text,
                  AI candidate profile, point balance, and point history from Firestore.
                  This cannot be undone.
                </p>
              </div>
              <div className="delete-confirmation-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={dataAction === "delete"}
                  onClick={() => setDeleteConfirmationOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button danger-button--solid"
                  type="button"
                  disabled={dataAction === "delete"}
                  autoFocus
                  onClick={() => void runDataAction("delete")}
                >
                  {dataAction === "delete"
                    ? "Deleting…"
                    : "Yes, permanently delete"}
                </button>
              </div>
            </div>
          )}

          {dataActionMessage && (
            <p
              className={`account-data-message account-data-message--${dataActionMessage.kind}`}
              role={dataActionMessage.kind === "error" ? "alert" : "status"}
            >
              {dataActionMessage.text}
            </p>
          )}
        </section>
      )}

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
              ? resumeSavingEnabled
                ? "Signing out ends your authenticated ResumeMatch session. Your saved resume, latest AI profile, and job preferences remain in your account."
                : "Signing out ends this session. Job preferences and any resume data you chose to keep remain in your account."
              : "Sign in with Google to save job preferences across visits. Your current guest data stays session-only."}
          </p>
        </div>
        <div className="account-access-actions">
          {identity.kind === "user" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={authBusy || accountActionBusy}
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
