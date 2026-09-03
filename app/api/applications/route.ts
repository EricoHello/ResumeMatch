import { NextResponse } from "next/server";

import {
  ApplicationNotFoundError,
  applicationsRepository,
} from "@/lib/applications/repository";
import type {
  ApplicationsErrorCode,
  ApplicationsErrorResponse,
  CreateApplicationResponse,
  DeleteApplicationResponse,
  GetApplicationsResponse,
  UpdateApplicationResponse,
} from "@/lib/applications/types";
import {
  ApplicationValidationError,
  parseApplicationId,
  parseApplicationUpdates,
  parseCreateApplication,
} from "@/lib/applications/validation";
import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";

export const runtime = "nodejs";
export const MAX_APPLICATION_REQUEST_BYTES = 16 * 1024;

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

class InvalidApplicationRequestError extends Error {}
class ApplicationRequestTooLargeError extends InvalidApplicationRequestError {}

function errorResponse(
  code: ApplicationsErrorCode,
  message: string,
  status: number,
) {
  const body: ApplicationsErrorResponse = { error: { code, message } };
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

async function authenticatedUserId(request: Request) {
  try {
    return {
      status: "authenticated" as const,
      userId: await authenticateFirebaseRequest(request),
    };
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return { status: "required" as const };
    }
    return { status: "unavailable" as const };
  }
}

function authenticationError(
  authentication: Awaited<ReturnType<typeof authenticatedUserId>>,
) {
  if (authentication.status === "required") {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to manage job applications.",
      401,
    );
  }
  if (authentication.status === "unavailable") {
    return errorResponse(
      "AUTH_UNAVAILABLE",
      "We couldn't verify your sign-in right now. Please try again.",
      503,
    );
  }
  return null;
}

function acceptsJson(request: Request) {
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

async function jsonBody(request: Request) {
  if (!acceptsJson(request)) {
    throw new InvalidApplicationRequestError("Send application data as JSON.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_APPLICATION_REQUEST_BYTES
  ) {
    throw new ApplicationRequestTooLargeError(
      "The application request is too large.",
    );
  }
  if (!request.body) {
    throw new InvalidApplicationRequestError(
      "The request body must contain valid JSON.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_APPLICATION_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new ApplicationRequestTooLargeError(
          "The application request is too large.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApplicationRequestTooLargeError) throw error;
    throw new InvalidApplicationRequestError(
      "The request body must contain valid JSON.",
    );
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new InvalidApplicationRequestError(
      "The request body must contain valid JSON.",
    );
  }
}

export async function GET(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to load applications.", 401);
  }

  try {
    const applications = await applicationsRepository.list(authentication.userId);
    const body: GetApplicationsResponse = { data: { applications } };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't load your applications. Please try again.",
      503,
    );
  }
}

export async function POST(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to add an application.", 401);
  }

  let application;
  try {
    application = parseCreateApplication(await jsonBody(request));
  } catch (error) {
    const invalidRequest = error instanceof InvalidApplicationRequestError;
    const requestTooLarge = error instanceof ApplicationRequestTooLargeError;
    return errorResponse(
      invalidRequest ? "INVALID_REQUEST" : "INVALID_APPLICATION",
      error instanceof Error
        ? error.message
        : "The application is invalid.",
      requestTooLarge ? 413 : invalidRequest ? 400 : 422,
    );
  }

  try {
    const result = await applicationsRepository.create(
      authentication.userId,
      application,
    );
    const body: CreateApplicationResponse = { data: result };
    return NextResponse.json(body, {
      status: result.created ? 201 : 200,
      headers: RESPONSE_HEADERS,
    });
  } catch {
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't add this application. Please try again.",
      503,
    );
  }
}

export async function PATCH(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to update applications.", 401);
  }

  let applicationId;
  let operation:
    | { kind: "fields"; updates: ReturnType<typeof parseApplicationUpdates> }
    | { kind: "archive"; archived: boolean };
  try {
    const body = await jsonBody(request);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      (Object.keys(body).sort().join(",") !== "applicationId,updates" &&
        Object.keys(body).sort().join(",") !== "applicationId,archived")
    ) {
      throw new ApplicationValidationError(
        "Include applicationId with updates or archived.",
      );
    }
    applicationId = parseApplicationId(
      (body as Record<string, unknown>).applicationId,
    );
    const record = body as Record<string, unknown>;
    if ("updates" in record) {
      operation = {
        kind: "fields",
        updates: parseApplicationUpdates(record.updates),
      };
    } else {
      if (typeof record.archived !== "boolean") {
        throw new ApplicationValidationError(
          "Archived state must be a Boolean.",
        );
      }
      operation = { kind: "archive", archived: record.archived };
    }
  } catch (error) {
    const invalidRequest = error instanceof InvalidApplicationRequestError;
    const requestTooLarge = error instanceof ApplicationRequestTooLargeError;
    return errorResponse(
      invalidRequest ? "INVALID_REQUEST" : "INVALID_APPLICATION",
      error instanceof Error
        ? error.message
        : "The application update is invalid.",
      requestTooLarge ? 413 : invalidRequest ? 400 : 422,
    );
  }

  try {
    const application =
      operation.kind === "fields"
        ? await applicationsRepository.update(
            authentication.userId,
            applicationId,
            operation.updates,
          )
        : await applicationsRepository.setArchived(
            authentication.userId,
            applicationId,
            operation.archived,
          );
    const body: UpdateApplicationResponse = { data: { application } };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) {
      return errorResponse(
        "APPLICATION_NOT_FOUND",
        "This application no longer exists.",
        404,
      );
    }
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't update this application. Please try again.",
      503,
    );
  }
}

export async function DELETE(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to delete applications.", 401);
  }

  let applicationId;
  try {
    const body = await jsonBody(request);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).join(",") !== "applicationId"
    ) {
      throw new ApplicationValidationError("Include exactly applicationId.");
    }
    applicationId = parseApplicationId(
      (body as Record<string, unknown>).applicationId,
    );
  } catch (error) {
    const invalidRequest = error instanceof InvalidApplicationRequestError;
    const requestTooLarge = error instanceof ApplicationRequestTooLargeError;
    return errorResponse(
      invalidRequest ? "INVALID_REQUEST" : "INVALID_APPLICATION",
      error instanceof Error ? error.message : "The application ID is invalid.",
      requestTooLarge ? 413 : invalidRequest ? 400 : 422,
    );
  }

  try {
    await applicationsRepository.delete(authentication.userId, applicationId);
    const body: DeleteApplicationResponse = {
      data: { deleted: true, applicationId },
    };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) {
      return errorResponse(
        "APPLICATION_NOT_FOUND",
        "This application no longer exists.",
        404,
      );
    }
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't delete this application. Please try again.",
      503,
    );
  }
}
