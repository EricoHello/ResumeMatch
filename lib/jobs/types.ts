import type { ResumeProfile } from "@/lib/analysis/types";
import type { JobClickRewardContext } from "@/lib/points/job-click-types";

export type SearchJobsRequest = {
  profile: ResumeProfile;
};

export type JobMatch = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  applyUrl: string;
  postedAt: string | null;
  employmentType: string | null;
  isRemote: boolean;
  matchedSkills: string[];
};

export type SearchJobsSuccessResponse = {
  jobs: JobMatch[];
  searchedAt: string;
  rewardContext: JobClickRewardContext | null;
};

export type SearchJobsResult = {
  jobs: JobMatch[];
  rewardContext: JobClickRewardContext | null;
};

export type SearchJobsErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "INVALID_SEARCH_INPUT"
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SEARCH_UNAVAILABLE"
  | "SEARCH_FAILED";

export type SearchJobsErrorResponse = {
  error: {
    code: SearchJobsErrorCode;
    message: string;
  };
};

export type JobCandidate = JobMatch & {
  workArrangement: "remote" | "hybrid" | "in_person" | "unknown";
  description: string;
  minimumSalary: number | null;
  maximumSalary: number | null;
  salaryPeriod: string | null;
  postedTimestamp: number | null;
};
