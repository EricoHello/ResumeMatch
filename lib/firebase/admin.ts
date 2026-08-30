import "server-only";

import { readFileSync } from "node:fs";

import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type AppOptions,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type ServiceAccountJson = {
  project_id?: unknown;
  projectId?: unknown;
  client_email?: unknown;
  clientEmail?: unknown;
  private_key?: unknown;
  privateKey?: unknown;
};

function requiredString(
  value: unknown,
  fieldName: string,
  sourceName: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${sourceName} is missing ${fieldName}.`);
  }

  return value;
}

function parseServiceAccount(
  rawValue: string,
  sourceName: string,
): ServiceAccount {
  let parsed: ServiceAccountJson;

  try {
    parsed = JSON.parse(rawValue) as ServiceAccountJson;
  } catch {
    throw new Error(`${sourceName} must contain valid JSON.`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceName} must contain a service-account object.`);
  }

  const projectId = requiredString(
    parsed.project_id ?? parsed.projectId,
    "project_id",
    sourceName,
  );
  const clientEmail = requiredString(
    parsed.client_email ?? parsed.clientEmail,
    "client_email",
    sourceName,
  );
  const privateKey = requiredString(
    parsed.private_key ?? parsed.privateKey,
    "private_key",
    sourceName,
  ).replace(/\\n/g, "\n");

  return { projectId, clientEmail, privateKey };
}

function getProjectId(): string | undefined {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.GCLOUD_PROJECT
  );
}

function usesFirebaseEmulator(): boolean {
  return Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST,
  );
}

function getAdminOptions(): AppOptions {
  const projectId = getProjectId();

  if (usesFirebaseEmulator()) {
    if (!projectId) {
      throw new Error(
        "Set FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID when using Firebase emulators.",
      );
    }

    return { projectId };
  }

  const inlineServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (inlineServiceAccount) {
    const serviceAccount = parseServiceAccount(
      inlineServiceAccount,
      "FIREBASE_SERVICE_ACCOUNT_JSON",
    );

    return {
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    const serviceAccountFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;

    if (serviceAccountFile) {
      let fileContents: string;

      try {
        fileContents = readFileSync(serviceAccountFile, "utf8");
      } catch {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_FILE could not be read.");
      }

      const serviceAccount = parseServiceAccount(
        fileContents,
        "FIREBASE_SERVICE_ACCOUNT_FILE",
      );

      return {
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      };
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required in production.");
  }

  throw new Error(
    "Configure FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE for Firebase Admin.",
  );
}

export function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(getAdminOptions());
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore(): Firestore {
  return getFirestore(getFirebaseAdminApp());
}
