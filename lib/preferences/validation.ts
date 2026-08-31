import {
  WORK_ARRANGEMENTS,
  type JobPreferences,
  type WorkArrangement,
} from "./types";

const LEGACY_PREFERENCE_KEYS = ["minimumSalary", "targetLocation"] as const;
const PREFERENCE_KEYS = [
  "additionalLocations",
  "minimumSalary",
  "radiusMiles",
  "targetLocation",
  "workArrangement",
] as const;

export const MAX_TARGET_LOCATION_LENGTH = 120;
export const MAX_MINIMUM_SALARY = 10_000_000;
export const DEFAULT_RADIUS_MILES = 25;
export const MIN_RADIUS_MILES = 5;
export const MAX_RADIUS_MILES = 100;
export const MAX_ADDITIONAL_LOCATIONS = 3;

export class PreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferencesValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJobPreferences(value: unknown): JobPreferences {
  if (!isRecord(value)) {
    throw new PreferencesValidationError(
      "Job preferences must be a JSON object.",
    );
  }

  const keys = Object.keys(value).sort();

  const isLegacy =
    keys.length === LEGACY_PREFERENCE_KEYS.length &&
    LEGACY_PREFERENCE_KEYS.every((key, index) => keys[index] === key);
  const isCurrent =
    keys.length === PREFERENCE_KEYS.length &&
    PREFERENCE_KEYS.every((key, index) => keys[index] === key);

  if (!isLegacy && !isCurrent) {
    throw new PreferencesValidationError(
      "Include exactly targetLocation, additionalLocations, radiusMiles, workArrangement, and minimumSalary.",
    );
  }

  if (typeof value.targetLocation !== "string") {
    throw new PreferencesValidationError(
      "Target location must be a text value.",
    );
  }

  const targetLocation = value.targetLocation.trim();

  if (
    targetLocation.length < 1 ||
    targetLocation.length > MAX_TARGET_LOCATION_LENGTH
  ) {
    throw new PreferencesValidationError(
      `Target location must be between 1 and ${MAX_TARGET_LOCATION_LENGTH} characters.`,
    );
  }

  const minimumSalary = value.minimumSalary;

  if (
    typeof minimumSalary !== "number" ||
    !Number.isFinite(minimumSalary) ||
    !Number.isInteger(minimumSalary) ||
    minimumSalary < 0 ||
    minimumSalary > MAX_MINIMUM_SALARY
  ) {
    throw new PreferencesValidationError(
      `Minimum salary must be a whole number between 0 and ${MAX_MINIMUM_SALARY}.`,
    );
  }

  if (isLegacy) {
    return {
      targetLocation,
      additionalLocations: [],
      radiusMiles: DEFAULT_RADIUS_MILES,
      workArrangement: /\bremote\b/i.test(targetLocation) ? "remote" : "any",
      minimumSalary,
    };
  }

  if (!Array.isArray(value.additionalLocations)) {
    throw new PreferencesValidationError(
      "Additional locations must be a list of cities.",
    );
  }

  if (value.additionalLocations.length > MAX_ADDITIONAL_LOCATIONS) {
    throw new PreferencesValidationError(
      `Add no more than ${MAX_ADDITIONAL_LOCATIONS} additional cities.`,
    );
  }

  const additionalLocations = value.additionalLocations.map((location) => {
    if (typeof location !== "string") {
      throw new PreferencesValidationError(
        "Each additional location must be a text value.",
      );
    }

    const normalized = location.trim();
    if (
      normalized.length < 1 ||
      normalized.length > MAX_TARGET_LOCATION_LENGTH
    ) {
      throw new PreferencesValidationError(
        `Each additional location must be between 1 and ${MAX_TARGET_LOCATION_LENGTH} characters.`,
      );
    }
    return normalized;
  });

  const normalizedLocations = [targetLocation, ...additionalLocations].map(
    (location) => location.toLocaleLowerCase(),
  );
  if (new Set(normalizedLocations).size !== normalizedLocations.length) {
    throw new PreferencesValidationError("Each preferred city must be unique.");
  }

  const radiusMiles = value.radiusMiles;
  if (
    typeof radiusMiles !== "number" ||
    !Number.isInteger(radiusMiles) ||
    radiusMiles < MIN_RADIUS_MILES ||
    radiusMiles > MAX_RADIUS_MILES
  ) {
    throw new PreferencesValidationError(
      `Mile radius must be a whole number between ${MIN_RADIUS_MILES} and ${MAX_RADIUS_MILES}.`,
    );
  }

  if (
    typeof value.workArrangement !== "string" ||
    !WORK_ARRANGEMENTS.includes(value.workArrangement as WorkArrangement)
  ) {
    throw new PreferencesValidationError(
      "Job type must be any, remote, hybrid, or in person.",
    );
  }

  return {
    targetLocation,
    additionalLocations,
    radiusMiles,
    workArrangement: value.workArrangement as WorkArrangement,
    minimumSalary,
  };
}
