import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

import type { ResumePrivacySettings } from "./types";

const PRIVACY_DOCUMENT = "privacy";

type StoredResumePrivacySettings = ResumePrivacySettings & {
  schemaVersion: 1;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;

export function resumePrivacyDocument(firestore: Firestore, userId: string) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("settings")
    .doc(PRIVACY_DOCUMENT);
}

export function readSaveResumeDataSetting(snapshot: {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}): boolean {
  if (!snapshot.exists) return true;

  const data = snapshot.data();
  if (
    data?.schemaVersion !== 1 ||
    typeof data.saveResumeData !== "boolean"
  ) {
    throw new Error("Unsupported resume privacy settings schema.");
  }

  return data.saveResumeData;
}

export class FirestoreResumePrivacyRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
  ) {}

  async get(userId: string): Promise<ResumePrivacySettings> {
    const snapshot = await resumePrivacyDocument(
      this.getFirestore(),
      userId,
    ).get();

    return { saveResumeData: readSaveResumeDataSetting(snapshot) };
  }

  async save(
    userId: string,
    settings: ResumePrivacySettings,
  ): Promise<ResumePrivacySettings> {
    const firestore = this.getFirestore();
    const document = resumePrivacyDocument(firestore, userId);

    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      const timestamp = this.now();
      const existingCreatedAt = snapshot.exists
        ? snapshot.get("createdAt")
        : undefined;
      const createdAt =
        existingCreatedAt instanceof Timestamp
          ? existingCreatedAt
          : timestamp;
      const storedSettings: StoredResumePrivacySettings = {
        schemaVersion: 1,
        saveResumeData: settings.saveResumeData,
        createdAt,
        updatedAt: timestamp,
      };

      transaction.set(document, storedSettings);
    });

    return settings;
  }
}

export const resumePrivacyRepository =
  new FirestoreResumePrivacyRepository();
