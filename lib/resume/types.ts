export const RESUME_FILE_TYPES = ["pdf", "docx"] as const;

export type ResumeFileType = (typeof RESUME_FILE_TYPES)[number];

export const RESUME_PARSE_ERROR_CODES = [
  "INVALID_FORM_DATA",
  "FILE_REQUIRED",
  "INVALID_FILE",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TYPE_MISMATCH",
  "PARSING_FAILED",
  "NO_TEXT_FOUND",
] as const;

export type ResumeParseErrorCode =
  (typeof RESUME_PARSE_ERROR_CODES)[number];

export interface ResumeExtraction {
  text: string;
  warnings: string[];
}

export interface ValidatedResumeFile {
  buffer: Buffer;
  fileName: string;
  fileType: ResumeFileType;
  size: number;
}

export interface ParsedResume {
  fileName: string;
  fileType: ResumeFileType;
  text: string;
  characterCount: number;
  warnings?: string[];
}

export interface ParseResumeSuccessResponse {
  data: ParsedResume;
}

export interface ParseResumeErrorResponse {
  error: {
    code: ResumeParseErrorCode;
    message: string;
  };
}

export type ParseResumeResponse =
  | ParseResumeSuccessResponse
  | ParseResumeErrorResponse;
