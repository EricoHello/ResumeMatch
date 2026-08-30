export type JobPreferences = {
  targetLocation: string;
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
