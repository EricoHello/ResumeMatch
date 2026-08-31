"use client";

import type { User } from "firebase/auth";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  readGuestSession,
  saveGuestPreferences,
} from "@/lib/session/guest-session";
import {
  WORK_ARRANGEMENTS,
  type JobPreferences as JobPreferencesValue,
  type WorkArrangement,
} from "@/lib/preferences/types";
import {
  DEFAULT_RADIUS_MILES,
  MAX_ADDITIONAL_LOCATIONS,
  MAX_RADIUS_MILES,
  MIN_RADIUS_MILES,
  parseJobPreferences,
} from "@/lib/preferences/validation";

export type PreferenceIdentity =
  | { kind: "guest" }
  | { kind: "user"; user: User };

type JobPreferencesProps = {
  identity: PreferenceIdentity;
  onReadyChange: (preferences: JobPreferencesValue | null) => void;
};

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "error";

function samePreferences(
  first: JobPreferencesValue | null,
  second: JobPreferencesValue,
) {
  return (
    first?.targetLocation === second.targetLocation &&
    first.radiusMiles === second.radiusMiles &&
    first.workArrangement === second.workArrangement &&
    first.additionalLocations.length === second.additionalLocations.length &&
    first.additionalLocations.every(
      (location, index) => location === second.additionalLocations[index],
    ) &&
    first.minimumSalary === second.minimumSalary
  );
}

function parsePreferencesResponse(
  body: unknown,
): JobPreferencesValue | null | undefined {
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
    // Use the human-readable fallback for empty and non-JSON responses.
  }

  return fallback;
}

export function JobPreferences({
  identity,
  onReadyChange,
}: JobPreferencesProps) {
  const guestPreferences =
    identity.kind === "guest" ? readGuestSession()?.preferences ?? null : null;
  const [targetLocation, setTargetLocation] = useState(
    guestPreferences?.targetLocation ?? "",
  );
  const [additionalLocations, setAdditionalLocations] = useState<string[]>(
    guestPreferences?.additionalLocations ?? [],
  );
  const [radiusMiles, setRadiusMiles] = useState(
    guestPreferences?.radiusMiles ?? DEFAULT_RADIUS_MILES,
  );
  const [workArrangement, setWorkArrangement] = useState<WorkArrangement>(
    guestPreferences?.workArrangement ?? "any",
  );
  const [minimumSalary, setMinimumSalary] = useState(
    guestPreferences ? String(guestPreferences.minimumSalary) : "",
  );
  const [lastSaved, setLastSaved] = useState<JobPreferencesValue | null>(
    guestPreferences,
  );
  const [loadState, setLoadState] = useState<LoadState>(
    identity.kind === "user" ? "loading" : "ready",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const signedInUser = identity.kind === "user" ? identity.user : null;

  const loadPreferences = useCallback(async () => {
    if (!signedInUser) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadState("loading");
    setMessage(null);

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
            "We couldn’t load your saved preferences. You can retry or enter them below.",
          ),
        );
      }

      const body: unknown = await response.json();
      const preferences = parsePreferencesResponse(body);
      if (preferences === undefined) {
        throw new Error("The server returned an unexpected preferences response.");
      }

      if (controller.signal.aborted) return;
      setLastSaved(preferences);
      if (preferences && !dirtyRef.current) {
        setTargetLocation(preferences.targetLocation);
        setAdditionalLocations(preferences.additionalLocations);
        setRadiusMiles(preferences.radiusMiles);
        setWorkArrangement(preferences.workArrangement);
        setMinimumSalary(String(preferences.minimumSalary));
      }
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "We couldn’t load your saved preferences.",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [signedInUser]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (signedInUser) void loadPreferences();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadPreferences, signedInUser]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const markChanged = () => {
    dirtyRef.current = true;
    setSaveState("idle");
    setMessage(null);
    onReadyChange(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedLocation = targetLocation.trim();
    const normalizedAdditionalLocations = additionalLocations
      .map((location) => location.trim())
      .filter(Boolean);
    const normalizedSalary = Number(minimumSalary);

    if (!normalizedLocation || normalizedLocation.length > 120) {
      setSaveState("error");
      setMessage("Enter a target city or location using 120 characters or fewer.");
      return;
    }

    if (
      normalizedAdditionalLocations.some((location) => location.length > 120)
    ) {
      setSaveState("error");
      setMessage("Each additional city must use 120 characters or fewer.");
      return;
    }

    const normalizedCities = [
      normalizedLocation,
      ...normalizedAdditionalLocations,
    ].map((location) => location.toLocaleLowerCase());
    if (new Set(normalizedCities).size !== normalizedCities.length) {
      setSaveState("error");
      setMessage("Choose a different city for each preferred location.");
      return;
    }

    if (
      minimumSalary.trim() === "" ||
      !Number.isInteger(normalizedSalary) ||
      normalizedSalary < 0 ||
      normalizedSalary > 10_000_000
    ) {
      setSaveState("error");
      setMessage("Enter a whole-number salary between 0 and 10,000,000.");
      return;
    }

    const preferences: JobPreferencesValue = {
      targetLocation: normalizedLocation,
      additionalLocations: normalizedAdditionalLocations,
      radiusMiles,
      workArrangement,
      minimumSalary: normalizedSalary,
    };

    setTargetLocation(preferences.targetLocation);
    setAdditionalLocations(preferences.additionalLocations);
    setMinimumSalary(String(preferences.minimumSalary));
    setMessage(null);

    if (samePreferences(lastSaved, preferences)) {
      dirtyRef.current = false;
      setSaveState("idle");
      onReadyChange(preferences);
      return;
    }

    if (identity.kind === "guest") {
      saveGuestPreferences(preferences);
      dirtyRef.current = false;
      setLastSaved(preferences);
      onReadyChange(preferences);
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSaveState("saving");

    try {
      const token = await identity.user.getIdToken(true);
      if (controller.signal.aborted) return;

      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferences),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          await responseMessage(
            response,
            "We couldn’t save your preferences. Please try again.",
          ),
        );
      }

      const body: unknown = await response.json();
      const savedPreferences = parsePreferencesResponse(body);
      if (!savedPreferences) {
        throw new Error("The server returned an unexpected preferences response.");
      }

      if (controller.signal.aborted) return;
      dirtyRef.current = false;
      setTargetLocation(savedPreferences.targetLocation);
      setAdditionalLocations(savedPreferences.additionalLocations);
      setRadiusMiles(savedPreferences.radiusMiles);
      setWorkArrangement(savedPreferences.workArrangement);
      setMinimumSalary(String(savedPreferences.minimumSalary));
      setLastSaved(savedPreferences);
      setSaveState("idle");
      onReadyChange(savedPreferences);
    } catch (error) {
      if (controller.signal.aborted) return;
      setSaveState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "We couldn’t save your preferences. Please try again.",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const fieldsDisabled = loadState === "loading" || saveState === "saving";
  const currentPreferences =
    targetLocation.trim() && minimumSalary.trim() !== ""
      ? {
          targetLocation: targetLocation.trim(),
          additionalLocations: additionalLocations
            .map((location) => location.trim())
            .filter(Boolean),
          radiusMiles,
          workArrangement,
          minimumSalary: Number(minimumSalary),
        }
      : null;
  const usingSavedPreferences =
    currentPreferences !== null &&
    Number.isInteger(currentPreferences.minimumSalary) &&
    samePreferences(lastSaved, currentPreferences);

  return (
    <section className="preferences-card" aria-labelledby="preferences-heading">
      <div className="card-heading">
        <div>
          <p className="step-label">Step 2 of 4</p>
          <h2 id="preferences-heading" ref={headingRef} tabIndex={-1}>
            Job preferences
          </h2>
        </div>
        <span className="format-badge">4 filters</span>
      </div>

      <p className="preference-intro">
        Add the details a resume usually can’t tell us. You can change these before
        analysis.
      </p>

      {identity.kind === "user" && loadState === "loading" && (
        <div className="inline-status" role="status">
          <span className="spinner spinner--small" aria-hidden="true" />
          Loading your saved preferences…
        </div>
      )}

      {identity.kind === "user" && loadState === "ready" && lastSaved && (
        <p className="saved-note" role="status">
          Saved preferences loaded. Review them or make changes below.
        </p>
      )}

      {loadState === "error" && message && (
        <div className="notice notice--error" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div>
            <strong>Couldn’t load saved preferences</strong>
            <p>{message}</p>
            {identity.kind === "user" && (
              <div className="notice-actions">
                <button type="button" onClick={() => void loadPreferences()}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <form className="preference-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="target-location">Target city or location</label>
          <input
            id="target-location"
            type="text"
            name="targetLocation"
            autoComplete="address-level2"
            maxLength={120}
            placeholder="For example, Seattle, WA"
            value={targetLocation}
            disabled={fieldsDisabled}
            required
            onChange={(event) => {
              setTargetLocation(event.target.value);
              markChanged();
            }}
          />
        </div>

        {targetLocation.trim() && !/^remote$/i.test(targetLocation.trim()) && (
          <div className="field preference-wide-field radius-field">
            <div className="range-heading">
              <label htmlFor="location-radius">Search radius</label>
              <output htmlFor="location-radius">{radiusMiles} mi</output>
            </div>
            <input
              id="location-radius"
              type="range"
              name="radiusMiles"
              min={MIN_RADIUS_MILES}
              max={MAX_RADIUS_MILES}
              step={5}
              value={radiusMiles}
              disabled={fieldsDisabled}
              aria-describedby="location-radius-help"
              onChange={(event) => {
                setRadiusMiles(Number(event.target.value));
                markChanged();
              }}
            />
            <small id="location-radius-help" className="field-help">
              Look within {radiusMiles} miles of each selected city.
            </small>
          </div>
        )}

        <div className="field preference-wide-field additional-location-field">
          <div className="additional-location-heading">
            <div>
              <span className="field-label">Additional cities</span>
              <small className="field-help">Optional — add up to {MAX_ADDITIONAL_LOCATIONS}.</small>
            </div>
            {additionalLocations.length < MAX_ADDITIONAL_LOCATIONS && (
              <button
                className="secondary-button compact-button"
                type="button"
                disabled={fieldsDisabled}
                onClick={() => {
                  setAdditionalLocations((locations) => [...locations, ""]);
                  markChanged();
                }}
              >
                + Add another city
              </button>
            )}
          </div>
          {additionalLocations.map((location, index) => (
            <div className="additional-location-row" key={index}>
              <label className="sr-only" htmlFor={`additional-location-${index}`}>
                Additional city {index + 1}
              </label>
              <input
                id={`additional-location-${index}`}
                type="text"
                autoComplete="address-level2"
                maxLength={120}
                placeholder="For example, Portland, OR"
                value={location}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const value = event.target.value;
                  setAdditionalLocations((locations) =>
                    locations.map((item, itemIndex) =>
                      itemIndex === index ? value : item,
                    ),
                  );
                  markChanged();
                }}
              />
              <button
                className="remove-location-button"
                type="button"
                disabled={fieldsDisabled}
                aria-label={`Remove additional city ${index + 1}`}
                onClick={() => {
                  setAdditionalLocations((locations) =>
                    locations.filter((_, itemIndex) => itemIndex !== index),
                  );
                  markChanged();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <fieldset className="field preference-wide-field work-arrangement-field">
          <legend>Type of job</legend>
          <div className="work-arrangement-options">
            {WORK_ARRANGEMENTS.map((option) => {
              const labels: Record<WorkArrangement, string> = {
                any: "Any",
                remote: "Remote",
                hybrid: "Hybrid",
                in_person: "In person",
              };
              return (
                <label key={option}>
                  <input
                    type="radio"
                    name="workArrangement"
                    value={option}
                    checked={workArrangement === option}
                    disabled={fieldsDisabled}
                    onChange={() => {
                      setWorkArrangement(option);
                      markChanged();
                    }}
                  />
                  <span>{labels[option]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="minimum-salary">Minimum acceptable salary</label>
          <span className="salary-input">
            <span aria-hidden="true">$</span>
            <input
              id="minimum-salary"
              type="number"
              name="minimumSalary"
              aria-describedby="minimum-salary-help"
              inputMode="numeric"
              min={0}
              max={10_000_000}
              step={1}
              placeholder="100000"
              value={minimumSalary}
              disabled={fieldsDisabled}
              required
              onChange={(event) => {
                setMinimumSalary(event.target.value);
                markChanged();
              }}
            />
          </span>
          <small id="minimum-salary-help" className="field-help">
            Annual salary in USD.
          </small>
        </div>

        {saveState === "error" && loadState !== "error" && message && (
          <p className="form-error" role="alert">{message}</p>
        )}

        <p className="analysis-consent-note">
          Continuing sends your extracted resume text and preferences to Gemini for
          AI analysis.{" "}
          {identity.kind === "user"
            ? "The extracted text and latest generated profile are saved to your account; the original file is not stored. "
            : "ResumeMatch does not persist the resume text or generated profile for guests. "}
          Google states that free-tier submitted content may be used to
          improve its products; review the{" "}
          <a
            href="https://ai.google.dev/gemini-api/docs/pricing"
            target="_blank"
            rel="noreferrer"
          >
            Gemini API pricing and data-use terms
          </a>
          .
        </p>

        <div className="preference-actions">
          <p>
            {identity.kind === "guest"
              ? "Kept only for this browser tab."
              : "Saved securely to your account."}
          </p>
          <button className="primary-button" type="submit" disabled={fieldsDisabled}>
            {saveState === "saving"
              ? "Saving…"
              : identity.kind === "user"
                ? usingSavedPreferences
                  ? "Continue with saved preferences"
                  : lastSaved
                    ? "Save changes"
                    : "Save and continue"
                : "Continue"}
          </button>
        </div>
      </form>

    </section>
  );
}
