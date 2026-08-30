import type { JobPreferences } from "./types";

const PREFERENCE_KEYS = ["minimumSalary", "targetLocation"] as const;

export const MAX_TARGET_LOCATION_LENGTH = 120;
export const MAX_MINIMUM_SALARY = 10_000_000;

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

  if (
    keys.length !== PREFERENCE_KEYS.length ||
    !PREFERENCE_KEYS.every((key, index) => keys[index] === key)
  ) {
    throw new PreferencesValidationError(
      "Include exactly targetLocation and minimumSalary.",
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

  return { targetLocation, minimumSalary };
}
