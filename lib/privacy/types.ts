export type ResumePrivacySettings = {
  saveResumeData: boolean;
};

export type ResumePrivacyStatus = ResumePrivacySettings & {
  hasSavedResumeData: boolean;
};

export type GetResumePrivacyResponse = {
  data: {
    privacy: ResumePrivacyStatus;
  };
};

export type SaveResumePrivacyResponse = GetResumePrivacyResponse;

export type ResumePrivacyErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_PRIVACY_SETTING"
  | "PRIVACY_UNAVAILABLE";

export type ResumePrivacyErrorResponse = {
  error: {
    code: ResumePrivacyErrorCode;
    message: string;
  };
};
