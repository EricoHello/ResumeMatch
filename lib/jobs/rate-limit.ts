import "server-only";

import {
  AnalysisRateLimiter,
  analysisClientKey,
} from "@/lib/analysis/rate-limit";

export const JOB_SEARCH_RATE_LIMIT = 3;
export const JOB_SEARCH_RATE_WINDOW_MS = 60_000;

export const jobSearchClientKey = analysisClientKey;
export const jobSearchRateLimiter = new AnalysisRateLimiter(
  JOB_SEARCH_RATE_LIMIT,
  JOB_SEARCH_RATE_WINDOW_MS,
);
