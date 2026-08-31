import { NextResponse } from "next/server";

import { isMaintenanceMode, maintenanceResponse } from "@/lib/maintenance";
import {
  GeminiConfigurationError,
  GeminiProviderError,
  GeminiResponseError,
  geminiResumeAnalyzer,
} from "@/lib/analysis/gemini";
import {
  analysisClientKey,
  analysisRateLimiter,
} from "@/lib/analysis/rate-limit";
import type {
  AnalyzeResumeErrorCode,
  AnalyzeResumeErrorResponse,
  AnalyzeResumeSuccessResponse,
} from "@/lib/analysis/types";
import {
  AnalysisValidationError,
  parseAnalyzeResumeRequest,
} from "@/lib/analysis/validation";

export const runtime = "nodejs";

export const MAX_ANALYZE_REQUEST_BYTES = 256 * 1024;

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

function errorResponse(
  code: AnalyzeResumeErrorCode,
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  const body: AnalyzeResumeErrorResponse = {
    error: { code, message },
  };

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
    declaredLength > MAX_ANALYZE_REQUEST_BYTES
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
      if (receivedBytes > MAX_ANALYZE_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }

      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new InvalidRequestBodyError();
  }

  const bodyBytes = new Uint8Array(receivedBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new InvalidRequestBodyError();
  }
}

export async function POST(request: Request) {
  if (isMaintenanceMode()) {
    return maintenanceResponse();
  }

  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
    "";

  if (mediaType !== "application/json") {
    return errorResponse(
      "INVALID_REQUEST",
      "Send the resume analysis input as JSON.",
      400,
    );
  }

  let requestBody: unknown;

  try {
    requestBody = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "The resume analysis request is too large.",
        413,
      );
    }

    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain valid JSON.",
      400,
    );
  }

  let input;

  try {
    input = parseAnalyzeResumeRequest(requestBody);
  } catch (error) {
    return errorResponse(
      "INVALID_ANALYSIS_INPUT",
      error instanceof AnalysisValidationError
        ? error.message
        : "The resume analysis input is invalid.",
      422,
    );
  }

  const rateLimit = analysisRateLimiter.consume(analysisClientKey(request));

  if (!rateLimit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many resume analysis requests. Please wait and try again.",
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const profile = await geminiResumeAnalyzer.analyze(input, request.signal);
    const body: AnalyzeResumeSuccessResponse = { profile };

    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof GeminiConfigurationError) {
      return errorResponse(
        "ANALYSIS_UNAVAILABLE",
        "Resume analysis is not available right now.",
        503,
      );
    }

    if (
      error instanceof GeminiProviderError &&
      error.status === 429
    ) {
      return errorResponse(
        "RATE_LIMITED",
        "Resume analysis has reached its current quota. Please wait and try again.",
        429,
        { "Retry-After": "60" },
      );
    }

    if (
      error instanceof GeminiProviderError || error instanceof GeminiResponseError
    ) {
      return errorResponse(
        "ANALYSIS_FAILED",
        "We couldn't analyze this resume. Please try again.",
        502,
      );
    }

    return errorResponse(
      "ANALYSIS_UNAVAILABLE",
      "Resume analysis is not available right now.",
      503,
    );
  }
}
