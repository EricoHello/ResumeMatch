import "server-only";

import { getFirebaseAdminAuth } from "./admin";

export class FirebaseAuthenticationError extends Error {
  constructor() {
    super("Firebase authentication failed.");
    this.name = "FirebaseAuthenticationError";
  }
}

export class FirebaseAuthenticationUnavailableError extends Error {
  constructor() {
    super("Firebase authentication is unavailable.");
    this.name = "FirebaseAuthenticationUnavailableError";
  }
}

export class FirebaseAuthenticatedEmailUnavailableError extends Error {
  constructor() {
    super("The authenticated Firebase user does not have a verified email address.");
    this.name = "FirebaseAuthenticatedEmailUnavailableError";
  }
}

export type AuthenticatedFirebaseIdentity = {
  userId: string;
  email: string;
};

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    throw new FirebaseAuthenticationError();
  }

  return match[1];
}

async function verifyFirebaseRequest(request: Request) {
  const token = readBearerToken(request);
  let auth: ReturnType<typeof getFirebaseAdminAuth>;

  try {
    auth = getFirebaseAdminAuth();
  } catch {
    throw new FirebaseAuthenticationUnavailableError();
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);

    if (typeof decodedToken.uid !== "string" || decodedToken.uid.length === 0) {
      throw new FirebaseAuthenticationError();
    }

    return decodedToken;
  } catch {
    throw new FirebaseAuthenticationError();
  }
}

export async function authenticateFirebaseRequest(
  request: Request,
): Promise<string> {
  return (await verifyFirebaseRequest(request)).uid;
}

export async function authenticateFirebaseIdentity(
  request: Request,
): Promise<AuthenticatedFirebaseIdentity> {
  const decodedToken = await verifyFirebaseRequest(request);
  const email = decodedToken.email?.trim();

  if (!email || decodedToken.email_verified !== true) {
    throw new FirebaseAuthenticatedEmailUnavailableError();
  }

  return { userId: decodedToken.uid, email };
}
