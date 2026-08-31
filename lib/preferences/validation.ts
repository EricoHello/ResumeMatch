import {
  EMPLOYMENT_TYPES,
  WORK_ARRANGEMENTS,
  type EmploymentType,
  type JobPreferences,
  type WorkArrangement,
} from "./types";

const LEGACY_PREFERENCE_KEYS = ["minimumSalary", "targetLocation"] as const;
const VERSION_TWO_PREFERENCE_KEYS = [
  "additionalLocations",
  "minimumSalary",
  "radiusMiles",
  "targetLocation",
  "workArrangement",
] as const;
const VERSION_THREE_PREFERENCE_KEYS = [
  "additionalLocations",
  "employmentTypes",
  "minimumSalary",
  "radiusMiles",
  "targetLocation",
  "workArrangement",
] as const;
const PREFERENCE_KEYS = [
  "additionalLocations",
  "employmentTypes",
  "minimumSalary",
  "radiusMiles",
  "targetLocation",
  "workArrangements",
] as const;

export const MAX_TARGET_LOCATION_LENGTH = 120;
export const MAX_MINIMUM_SALARY = 10_000_000;
export const DEFAULT_RADIUS_MILES = 25;
export const MIN_RADIUS_MILES = 5;
export const MAX_RADIUS_MILES = 100;
export const MAX_ADDITIONAL_LOCATIONS = 3;
export const DEFAULT_WORK_ARRANGEMENTS: WorkArrangement[] = [
  ...WORK_ARRANGEMENTS,
];
export const DEFAULT_EMPLOYMENT_TYPES: EmploymentType[] = [...EMPLOYMENT_TYPES];

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
  const isVersionTwo =
    keys.length === VERSION_TWO_PREFERENCE_KEYS.length &&
    VERSION_TWO_PREFERENCE_KEYS.every((key, index) => keys[index] === key);
  const isVersionThree =
    keys.length === VERSION_THREE_PREFERENCE_KEYS.length &&
    VERSION_THREE_PREFERENCE_KEYS.every((key, index) => keys[index] === key);
  const isCurrent =
    keys.length === PREFERENCE_KEYS.length &&
    PREFERENCE_KEYS.every((key, index) => keys[index] === key);

  if (!isLegacy && !isVersionTwo && !isVersionThree && !isCurrent) {
    throw new PreferencesValidationError(
      "Include exactly targetLocation, additionalLocations, radiusMiles, workArrangements, employmentTypes, and minimumSalary.",
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
      workArrangements: /\bremote\b/i.test(targetLocation)
        ? ["remote"]
        : [...DEFAULT_WORK_ARRANGEMENTS],
      employmentTypes: [...DEFAULT_EMPLOYMENT_TYPES],
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

  let workArrangements: WorkArrangement[];
  if (isCurrent) {
    if (!Array.isArray(value.workArrangements)) {
      throw new PreferencesValidationError("Work arrangements must be a list.");
    }

    workArrangements = value.workArrangements.map((workArrangement) => {
      if (
        typeof workArrangement !== "string" ||
        !WORK_ARRANGEMENTS.includes(workArrangement as WorkArrangement)
      ) {
        throw new PreferencesValidationError(
          "Work arrangements can only include remote, hybrid, or in person.",
        );
      }
      return workArrangement as WorkArrangement;
    });

    if (new Set(workArrangements).size !== workArrangements.length) {
      throw new PreferencesValidationError(
        "Each work arrangement can only be included once.",
      );
    }
  } else {
    if (
      typeof value.workArrangement !== "string" ||
      (value.workArrangement !== "any" &&
        !WORK_ARRANGEMENTS.includes(value.workArrangement as WorkArrangement))
    ) {
      throw new PreferencesValidationError(
        "Work arrangement must be any, remote, hybrid, or in person.",
      );
    }
    workArrangements =
      value.workArrangement === "any"
        ? [...DEFAULT_WORK_ARRANGEMENTS]
        : [value.workArrangement as WorkArrangement];
  }

  let employmentTypes: EmploymentType[];
  if (isVersionTwo) {
    employmentTypes = [...DEFAULT_EMPLOYMENT_TYPES];
  } else {
    if (!Array.isArray(value.employmentTypes)) {
      throw new PreferencesValidationError(
        "Employment types must be a list.",
      );
    }

    employmentTypes = value.employmentTypes.map((employmentType) => {
      if (
        typeof employmentType !== "string" ||
        !EMPLOYMENT_TYPES.includes(employmentType as EmploymentType)
      ) {
        throw new PreferencesValidationError(
          "Employment types can only include contract, full time, part time, or seasonal.",
        );
      }
      return employmentType as EmploymentType;
    });

    if (new Set(employmentTypes).size !== employmentTypes.length) {
      throw new PreferencesValidationError(
        "Each employment type can only be included once.",
      );
    }
  }

  return {
    targetLocation,
    additionalLocations,
    radiusMiles,
    workArrangements,
    employmentTypes,
    minimumSalary,
  };
}
