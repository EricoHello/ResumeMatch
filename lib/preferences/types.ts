export const WORK_ARRANGEMENTS = [
  "any",
  "remote",
  "hybrid",
  "in_person",
] as const;

export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export type JobPreferences = {
  targetLocation: string;
  additionalLocations: string[];
  radiusMiles: number;
  workArrangement: WorkArrangement;
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
