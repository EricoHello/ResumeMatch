import { NextResponse } from "next/server";

import {
  JSearchConfigurationError,
  JSearchProviderError,
  JSearchResponseError,
  jSearchClient,
} from "@/lib/jobs/jsearch";
import {
  jobSearchClientKey,
  jobSearchRateLimiter,
} from "@/lib/jobs/rate-limit";
import type {
  SearchJobsErrorCode,
  SearchJobsErrorResponse,
  SearchJobsSuccessResponse,
} from "@/lib/jobs/types";
import {
  JobSearchValidationError,
  parseSearchJobsRequest,
} from "@/lib/jobs/validation";

export const runtime = "nodejs";
export const MAX_JOB_SEARCH_REQUEST_BYTES = 64 * 1024;

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

function errorResponse(
  code: SearchJobsErrorCode,
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  const body: SearchJobsErrorResponse = { error: { code, message } };
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JOB_SEARCH_REQUEST_BYTES
  ) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) throw new InvalidRequestBodyError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_JOB_SEARCH_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new InvalidRequestBodyError();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidRequestBodyError();
  }
}

export async function POST(request: Request) {
  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
    "";
  if (mediaType !== "application/json") {
    return errorResponse(
      "INVALID_REQUEST",
      "Send the candidate profile as JSON.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "The job-search request is too large.",
        413,
      );
    }
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain valid JSON.",
      400,
    );
  }

  let profile;
  try {
    profile = parseSearchJobsRequest(body).profile;
  } catch (error) {
    return errorResponse(
      "INVALID_SEARCH_INPUT",
      error instanceof JobSearchValidationError
        ? error.message
        : "The job-search input is invalid.",
      422,
    );
  }

  const rateLimit = jobSearchRateLimiter.consume(jobSearchClientKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many job searches. Please wait before searching again.",
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const jobs = await jSearchClient.search(profile, request.signal);
    const response: SearchJobsSuccessResponse = {
      jobs,
      searchedAt: new Date().toISOString(),
    };
    return NextResponse.json(response, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof JSearchConfigurationError) {
      return errorResponse(
        "SEARCH_UNAVAILABLE",
        "Job search is not available right now.",
        503,
      );
    }
    if (error instanceof JSearchProviderError && error.status === 429) {
      return errorResponse(
        "RATE_LIMITED",
        "Job search has reached its current quota. Please wait and try again.",
        429,
        { "Retry-After": "60" },
      );
    }
    if (error instanceof JSearchProviderError || error instanceof JSearchResponseError) {
      return errorResponse(
        "SEARCH_FAILED",
        "We couldn’t finish this job search. Please try again.",
        502,
      );
    }
    return errorResponse(
      "SEARCH_UNAVAILABLE",
      "Job search is not available right now.",
      503,
    );
  }
}
