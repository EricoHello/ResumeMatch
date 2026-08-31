"use client";

import { useEffect, useRef, useState } from "react";
import type { ResumeProfile } from "@/lib/analysis/types";
import {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
} from "@/lib/preferences/types";

export type ResumeAnalysisState =
  | { status: "loading" }
  | { status: "error"; message: string; retryAfterSeconds?: number }
  | { status: "success"; profile: ResumeProfile };

type ResumeAnalysisProps = {
  state: ResumeAnalysisState;
  persistsToAccount?: boolean;
  onRetry: () => void;
};

function displayExperienceLevel(level: ResumeProfile["experienceLevel"]) {
  if (level === "unknown") return "Not determined";
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function ProfileList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="profile-field">
      <h4>{label}</h4>
      {values.length > 0 ? (
        <ul className="profile-tags" aria-label={label}>
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="profile-empty">Not identified</p>
      )}
    </div>
  );
}

function RetryAction({
  onRetry,
  retryAfterSeconds,
}: {
  onRetry: () => void;
  retryAfterSeconds?: number;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil(retryAfterSeconds ?? 0)),
  );

  useEffect(() => {
    if (remainingSeconds === 0) return;

    const deadline = Date.now() + remainingSeconds * 1000;
    const interval = window.setInterval(() => {
      const nextRemaining = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemaining);
      if (nextRemaining === 0) window.clearInterval(interval);
    }, 1000);

    return () => window.clearInterval(interval);
    // The retry action remounts after each request, so the initial delay is fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = remainingSeconds > 0;

  return (
    <>
      {waiting && (
        <p className="retry-countdown" role="status" aria-live="polite">
          Try again in {remainingSeconds} {remainingSeconds === 1 ? "second" : "seconds"}.
        </p>
      )}
      <div className="notice-actions">
        <button type="button" disabled={waiting} onClick={onRetry}>
          Try analysis again
        </button>
      </div>
    </>
  );
}

export function ResumeAnalysis({
  state,
  persistsToAccount = false,
  onRetry,
}: ResumeAnalysisProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [state.status]);

  return (
    <section
      className={`analysis-card analysis-card--${state.status}`}
      aria-labelledby="analysis-heading"
      aria-busy={state.status === "loading"}
    >
      <div className="card-heading analysis-card-heading">
        <div>
          <p className="step-label">Step 3 of 4</p>
          <h2 id="analysis-heading" ref={headingRef} tabIndex={-1}>
            {state.status === "loading" && "Analyzing your resume"}
            {state.status === "error" && "Couldn’t analyze your resume"}
            {state.status === "success" && "Your resume is ready for the next step"}
          </h2>
        </div>
        <span className="format-badge">Gemini</span>
      </div>

      {state.status === "loading" && (
        <div className="analysis-loading">
          <div
            className="analysis-progress"
            role="progressbar"
            aria-label="Resume analysis progress"
            aria-valuetext="Analysis in progress"
          >
            <span />
          </div>
          <p role="status" aria-live="polite">
            Gemini is analyzing your resume…
          </p>
          <small>This can take a few moments.</small>
        </div>
      )}

      {state.status === "error" && (
        <div className="notice notice--error analysis-error" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div>
            <strong>Analysis didn’t finish</strong>
            <p>{state.message}</p>
            <RetryAction
              onRetry={onRetry}
              retryAfterSeconds={state.retryAfterSeconds}
            />
          </div>
        </div>
      )}

      {state.status === "success" && (
        <>
          <div className="analysis-success" role="status">
            <span className="analysis-check" aria-hidden="true">✓</span>
            <div>
              <strong>Analysis complete</strong>
              <p>Next: finding relevant jobs.</p>
            </div>
          </div>

          <section className="profile-preview" aria-labelledby="profile-heading">
            <div className="profile-heading">
              <p className="success-label">Structured profile</p>
              <h3 id="profile-heading">Resume profile preview</h3>
            </div>

            <div className="profile-summary">
              <h4>Summary</h4>
              <p>{state.profile.summary}</p>
            </div>

            <dl className="profile-facts">
              <div>
                <dt>Experience level</dt>
                <dd>{displayExperienceLevel(state.profile.experienceLevel)}</dd>
              </div>
              <div>
                <dt>Target locations</dt>
                <dd>
                  {[
                    state.profile.preferences.targetLocation,
                    ...state.profile.preferences.additionalLocations,
                  ].join(", ")}
                  {` · ${state.profile.preferences.radiusMiles} mi radius`}
                </dd>
              </div>
              <div>
                <dt>Work arrangement</dt>
                <dd>
                  {state.profile.preferences.workArrangements.length
                    ? state.profile.preferences.workArrangements
                        .map(
                          (arrangement) =>
                            WORK_ARRANGEMENT_LABELS[arrangement],
                        )
                        .join(", ")
                    : "None selected"}
                </dd>
              </div>
              <div>
                <dt>Type of job</dt>
                <dd>
                  {state.profile.preferences.employmentTypes.length
                    ? state.profile.preferences.employmentTypes
                        .map((type) => EMPLOYMENT_TYPE_LABELS[type])
                        .join(", ")
                    : "None selected"}
                </dd>
              </div>
              <div>
                <dt>Minimum salary</dt>
                <dd>
                  ${state.profile.preferences.minimumSalary.toLocaleString("en-US")} / year
                </dd>
              </div>
            </dl>

            <div className="profile-grid">
              <ProfileList label="Skills" values={state.profile.skills} />
              <ProfileList
                label="Recent job titles"
                values={state.profile.recentJobTitles}
              />
              <ProfileList label="Target roles" values={state.profile.targetRoles} />
              <ProfileList
                label="Search keywords"
                values={state.profile.searchKeywords}
              />
            </div>
          </section>
        </>
      )}

      <p className="analysis-privacy">
        Your extracted resume text is sent to Gemini for this analysis.{" "}
        {persistsToAccount
          ? "ResumeMatch saves the extracted text and latest generated profile to your signed-in account; the original file is not stored."
          : "ResumeMatch does not persist the resume text or generated profile; this result stays only in memory on this page."}
      </p>
    </section>
  );
}
