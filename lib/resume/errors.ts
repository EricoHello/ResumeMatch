import type { ResumeParseErrorCode } from "./types";

export class ResumeParseError extends Error {
  readonly code: ResumeParseErrorCode;
  readonly status: number;

  constructor(
    code: ResumeParseErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ResumeParseError";
    this.code = code;
    this.status = status;
  }
}

export function isResumeParseError(error: unknown): error is ResumeParseError {
  return error instanceof ResumeParseError;
}
