import { NextResponse } from "next/server";

import { accountDataEmailSender } from "@/lib/account/email";
import { accountDataRepository } from "@/lib/account/repository";
import type {
  AccountDataErrorCode,
  AccountDataErrorResponse,
  DeleteAccountDataResponse,
  SendAccountDataResponse,
} from "@/lib/account/types";
import {
  authenticateFirebaseIdentity,
  authenticateFirebaseRequest,
  FirebaseAuthenticatedEmailUnavailableError,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(
  code: AccountDataErrorCode,
  message: string,
  status: number,
) {
  const body: AccountDataErrorResponse = { error: { code, message } };
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function authenticationError(error: unknown) {
  if (error instanceof FirebaseAuthenticationError) {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to manage your ResumeMatch data.",
      401,
    );
  }

  if (error instanceof FirebaseAuthenticatedEmailUnavailableError) {
    return errorResponse(
      "EMAIL_UNAVAILABLE",
      "Your signed-in account needs a verified email address before we can send your data.",
      422,
    );
  }

  return errorResponse(
    "AUTH_UNAVAILABLE",
    "We couldn't verify your sign-in right now. Please try again.",
    503,
  );
}

export async function POST(request: Request) {
  let identity;

  try {
    identity = await authenticateFirebaseIdentity(request);
  } catch (error) {
    return authenticationError(error);
  }

  let dataExport;

  try {
    dataExport = await accountDataRepository.export(identity.userId);
  } catch {
    return errorResponse(
      "DATA_UNAVAILABLE",
      "We couldn't prepare your ResumeMatch data right now. Please try again.",
      503,
    );
  }

  try {
    await accountDataEmailSender.send(identity.email, dataExport);
  } catch {
    return errorResponse(
      "EMAIL_DELIVERY_UNAVAILABLE",
      "We couldn't email your ResumeMatch data right now. Please try again.",
      503,
    );
  }

  const body: SendAccountDataResponse = { data: { sent: true } };
  return NextResponse.json(body, { headers: RESPONSE_HEADERS });
}

export async function DELETE(request: Request) {
  let userId;

  try {
    userId = await authenticateFirebaseRequest(request);
  } catch (error) {
    return authenticationError(error);
  }

  try {
    await accountDataRepository.delete(userId);
  } catch {
    return errorResponse(
      "DELETE_UNAVAILABLE",
      "We couldn't delete your ResumeMatch data right now. Please try again.",
      503,
    );
  }

  const body: DeleteAccountDataResponse = { data: { deleted: true } };
  return NextResponse.json(body, { headers: RESPONSE_HEADERS });
}
