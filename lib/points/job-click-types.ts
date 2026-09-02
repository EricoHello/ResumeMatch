import type { PointBalance } from "./types";

export type JobClickRewardContext = {
  searchId: string;
  clickTokens: string[];
};

export type AwardJobClickRequest = {
  searchId: string;
  jobIndex: number;
  clickToken: string;
};

export type AwardJobClickResult = {
  points: PointBalance;
  clickAwarded: boolean;
  bonusAwarded: boolean;
};

export type AwardJobClickResponse = {
  data: AwardJobClickResult;
};

export type AwardJobClickErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_JOB_CLICK"
  | "POINTS_UNAVAILABLE";

export type AwardJobClickErrorResponse = {
  error: {
    code: AwardJobClickErrorCode;
    message: string;
  };
};

export function jobClickIdempotencyKey(searchId: string, jobIndex: number) {
  return `job-search:${searchId}:job:${jobIndex}`;
}

export function allJobClicksIdempotencyKey(searchId: string) {
  return `job-search:${searchId}:all-clicked`;
}

