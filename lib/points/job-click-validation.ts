import type {
  AwardJobClickRequest,
  JobClickRewardContext,
} from "./job-click-types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SEARCH_ID_LENGTH = 100;
const MAX_CLICK_TOKEN_LENGTH = 100;

export class JobClickValidationError extends Error {
  constructor(message = "The job-click reward request is invalid.") {
    super(message);
    this.name = "JobClickValidationError";
  }
}

function identifier(
  value: unknown,
  field: string,
  maximumLength: number,
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new JobClickValidationError(`${field} is invalid.`);
  }
  return value;
}

export function parseAwardJobClickRequest(
  value: unknown,
): AwardJobClickRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JobClickValidationError();
  }

  const candidate = value as Record<string, unknown>;
  if (
    !Object.keys(candidate).every((key) =>
      ["searchId", "jobIndex", "clickToken"].includes(key),
    ) ||
    !Number.isInteger(candidate.jobIndex) ||
    (candidate.jobIndex as number) < 0 ||
    (candidate.jobIndex as number) > 2
  ) {
    throw new JobClickValidationError();
  }

  return {
    searchId: identifier(
      candidate.searchId,
      "searchId",
      MAX_SEARCH_ID_LENGTH,
    ),
    jobIndex: candidate.jobIndex as number,
    clickToken: identifier(
      candidate.clickToken,
      "clickToken",
      MAX_CLICK_TOKEN_LENGTH,
    ),
  };
}

export function parseJobClickRewardContext(
  value: unknown,
): JobClickRewardContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new JobClickValidationError("The job reward context is invalid.");
  }

  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.clickTokens) ||
    candidate.clickTokens.length < 1 ||
    candidate.clickTokens.length > 3
  ) {
    throw new JobClickValidationError("The job reward context is invalid.");
  }

  return {
    searchId: identifier(
      candidate.searchId,
      "searchId",
      MAX_SEARCH_ID_LENGTH,
    ),
    clickTokens: candidate.clickTokens.map((token) =>
      identifier(token, "clickToken", MAX_CLICK_TOKEN_LENGTH),
    ),
  };
}

