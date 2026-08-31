export const WORK_ARRANGEMENTS = [
  "remote",
  "hybrid",
  "in_person",
] as const;

export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  in_person: "In person",
};

export const EMPLOYMENT_TYPES = [
  "contract",
  "full_time",
  "part_time",
  "seasonal",
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  contract: "Contract",
  full_time: "Full time",
  part_time: "Part time",
  seasonal: "Seasonal",
};

export type JobPreferences = {
  targetLocation: string;
  additionalLocations: string[];
  radiusMiles: number;
  workArrangements: readonly WorkArrangement[];
  employmentTypes: readonly EmploymentType[];
  minimumSalary: number;
};

export type GetPreferencesResponse = {
  data: {
    preferences: JobPreferences | null;
  };
};

export type SavePreferencesResponse = {
  data: {
    preferences: JobPreferences;
  };
};

export type PreferencesErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_PREFERENCES"
  | "PREFERENCES_UNAVAILABLE";

export type PreferencesErrorResponse = {
  error: {
    code: PreferencesErrorCode;
    message: string;
  };
};
