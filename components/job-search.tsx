"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PreferenceIdentity } from "@/components/job-preferences";
import type { ResumeProfile } from "@/lib/analysis/types";
import {
  JobSearchClientError,
  searchJobs,
} from "@/lib/jobs/client";
import type { JobMatch } from "@/lib/jobs/types";
import {
  awardGuestJobClick,
  awardSignedInJobClick,
} from "@/lib/points/job-click-client";
import type {
  AwardJobClickResult,
  JobClickRewardContext,
} from "@/lib/points/job-click-types";

type JobSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; retryAfterSeconds?: number }
  | {
      status: "success";
      jobs: JobMatch[];
      rewardContext: JobClickRewardContext | null;
    };

function employmentLabel(value: string | null) {
  if (!value) return null;
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SearchRetry({
  retryAfterSeconds,
  onRetry,
}: {
  retryAfterSeconds?: number;
  onRetry: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil(retryAfterSeconds ?? 0)),
  );

  useEffect(() => {
    if (remaining === 0) return;
    const deadline = Date.now() + remaining * 1_000;
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setRemaining(next);
      if (next === 0) window.clearInterval(interval);
    }, 1_000);
    return () => window.clearInterval(interval);
    // A new error remounts this action with a new server-provided delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="job-search-error-actions">
      {remaining > 0 && (
        <p role="status" aria-live="polite">
          Try again in {remaining} {remaining === 1 ? "second" : "seconds"}.
        </p>
      )}
      <button
        type="button"
        className="primary-button job-search-button"
        disabled={remaining > 0}
        onClick={onRetry}
      >
        Try job search again
      </button>
    </div>
  );
}

function JobCard({ job, onApply }: { job: JobMatch; onApply: () => void }) {
  const details = [
    employmentLabel(job.employmentType),
    job.postedAt,
    job.isRemote && !/\bremote\b/i.test(job.location) ? "Remote option" : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <li className="job-card">
      <div className="job-card-topline">
        <div>
          <p className="job-company">{job.company}</p>
          <h3>{job.title}</h3>
        </div>
        <span className="job-rank-badge">Match</span>
      </div>

      <dl className="job-facts">
        <div>
          <dt>Location</dt>
          <dd>{job.location}</dd>
        </div>
        <div>
          <dt>Salary</dt>
          <dd className={job.salary ? undefined : "job-salary-missing"}>
            {job.salary ?? "Salary not listed"}
          </dd>
        </div>
      </dl>

      {details.length > 0 && (
        <p className="job-meta">{details.join(" · ")}</p>
      )}

      {job.matchedSkills.length > 0 && (
        <p className="job-match-reason">
          Matches {job.matchedSkills.slice(0, 3).join(", ")}
        </p>
      )}

      <a
        className="job-apply-link"
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onApply}
        onAuxClick={(event) => {
          if (event.button === 1) onApply();
        }}
      >
        View &amp; apply
        <span aria-hidden="true">↗</span>
      </a>
    </li>
  );
}

export function JobSearch({
  profile,
  identity,
  onPointsAwarded,
}: {
  profile: ResumeProfile;
  identity: PreferenceIdentity;
  onPointsAwarded?: (result: AwardJobClickResult) => void;
}) {
  const [state, setState] = useState<JobSearchState>({ status: "idle" });
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const rewardTimeoutRef = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      if (rewardTimeoutRef.current !== null) {
        window.clearTimeout(rewardTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (state.status === "idle") return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [state.status]);

  const runSearch = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading" });
    if (rewardTimeoutRef.current !== null) {
      window.clearTimeout(rewardTimeoutRef.current);
      rewardTimeoutRef.current = null;
    }
    setRewardMessage(null);

    try {
      const result = await searchJobs(
        profile,
        controller.signal,
        identity.kind === "user" ? identity.user : null,
      );
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "success", ...result });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t search for jobs right now. Please try again.",
        retryAfterSeconds:
          error instanceof JobSearchClientError && error.status === 429
            ? error.retryAfterSeconds
            : undefined,
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [identity, profile]);

  const showReward = useCallback((result: AwardJobClickResult) => {
    const earned =
      (result.clickAwarded ? 10 : 0) + (result.bonusAwarded ? 5 : 0);
    if (earned === 0) return;
    setRewardMessage(
      result.clickAwarded && result.bonusAwarded
        ? "+10 pts · +5 bonus"
        : result.clickAwarded
          ? "+10 pts"
          : "+5 bonus",
    );
    if (rewardTimeoutRef.current !== null) {
      window.clearTimeout(rewardTimeoutRef.current);
    }
    rewardTimeoutRef.current = window.setTimeout(() => {
      setRewardMessage(null);
      rewardTimeoutRef.current = null;
    }, 2600);
    onPointsAwarded?.(result);
  }, [onPointsAwarded]);

  const handleJobClick = useCallback(
    (context: JobClickRewardContext, jobIndex: number) => {
      if (rewardTimeoutRef.current !== null) {
        window.clearTimeout(rewardTimeoutRef.current);
        rewardTimeoutRef.current = null;
      }
      setRewardMessage(null);
      if (identity.kind === "guest") {
        try {
          showReward(awardGuestJobClick(context, jobIndex));
        } catch {
          // Opening the job remains the primary action if points are unavailable.
        }
        return;
      }

      void awardSignedInJobClick(identity.user, context, jobIndex).then(
        showReward,
        () => {
          // Opening the job remains the primary action if points are unavailable.
        },
      );
    },
    [identity, showReward],
  );

  const heading =
    state.status === "idle"
      ? "Find your best current matches"
      : state.status === "loading"
        ? "Searching current jobs"
        : state.status === "error"
          ? "Couldn’t finish the job search"
          : state.jobs.length === 0
            ? "No relevant jobs found"
            : `${state.jobs.length} relevant ${state.jobs.length === 1 ? "job" : "jobs"} found`;

  return (
    <section
      className={`job-search-card job-search-card--${state.status}`}
      aria-labelledby="job-search-heading"
      aria-busy={state.status === "loading"}
    >
      <div className="card-heading job-search-heading">
        <div>
          <p className="step-label">Step 4 of 4</p>
          <h2
            id="job-search-heading"
            ref={headingRef}
            tabIndex={state.status === "idle" ? undefined : -1}
          >
            {heading}
          </h2>
        </div>
        <span className="format-badge">JSearch</span>
      </div>

      {state.status === "idle" && (
        <div className="job-search-start">
          <p>
            ResumeMatch will make one live search using a resume-supported target
            role and your preferred area, then rank the best three available
            results using your complete profile and minimum salary.
          </p>
          <button
            type="button"
            className="primary-button job-search-button"
            onClick={() => void runSearch()}
          >
            Find 3 job matches
          </button>
          <small>One API request is used when you start this search.</small>
        </div>
      )}

      {state.status === "loading" && (
        <div className="job-search-loading">
          <div
            className="job-search-progress"
            role="progressbar"
            aria-label="Job search progress"
            aria-valuetext="Searching current job listings"
          >
            <span />
          </div>
          <div className="job-search-loading-copy" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>Finding and ranking relevant openings…</strong>
              <p>This live search may take longer than resume analysis.</p>
            </div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="notice notice--error job-search-error" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div>
            <strong>Search didn’t finish</strong>
            <p>{state.message}</p>
            <SearchRetry
              retryAfterSeconds={state.retryAfterSeconds}
              onRetry={() => void runSearch()}
            />
          </div>
        </div>
      )}

      {state.status === "success" && (
        <>
          {state.jobs.length > 0 ? (
            <>
              <div className="job-search-success" role="status">
                <span className="analysis-check" aria-hidden="true">✓</span>
                <div>
                  <strong>Your current matches are ready</strong>
                  <p>Jobs without published salary information remain eligible.</p>
                </div>
              </div>
              {rewardMessage && (
                <p className="job-points-status" role="status" aria-live="polite">
                  {rewardMessage}
                </p>
              )}
              <ol className="job-list" aria-label="Relevant job matches">
                {state.jobs.map((job, jobIndex) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onApply={() => {
                      if (state.rewardContext) {
                        handleJobClick(state.rewardContext, jobIndex);
                      }
                    }}
                  />
                ))}
              </ol>
            </>
          ) : (
            <div className="job-search-empty" role="status">
              <p>
                JSearch did not return a reasonably related opening with a usable apply link.
              </p>
            </div>
          )}
          <p className="job-source">
            Current listings powered by{" "}
            <a
              href="https://www.openwebninja.com/api/jsearch"
              target="_blank"
              rel="noopener noreferrer"
            >
              JSearch by OpenWeb Ninja
            </a>
            . ResumeMatch does not persist these results.
          </p>
        </>
      )}
    </section>
  );
}
