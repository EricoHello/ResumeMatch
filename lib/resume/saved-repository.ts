import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import {
  readSaveResumeDataSetting,
  resumePrivacyDocument,
} from "@/lib/privacy/repository";

import type { SavedResume, SaveSavedResumeResult } from "./saved-types";
import { parseSavedResume } from "./saved-validation";

const SAVED_RESUME_DOCUMENT = "current";

type StoredSavedResume = SavedResume & {
  schemaVersion: 2;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;

export class FirestoreSavedResumeRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
  ) {}

  async get(userId: string): Promise<SavedResume | null> {
    const snapshot = await this.document(userId).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (data?.schemaVersion !== 1 && data?.schemaVersion !== 2) {
      throw new Error("Unsupported saved resume schema.");
    }

    return parseSavedResume({
      resumeText: data.resumeText,
      // Version 1 profiles predate resume-improvement recommendations. Keep
      // their extracted text and require a fresh analysis instead of inventing
      // or displaying a stale recommendation.
      profile: data.schemaVersion === 1 ? null : data.profile,
    });
  }

  async exists(userId: string): Promise<boolean> {
    return (await this.document(userId).get()).exists;
  }

  async save(
    userId: string,
    savedResume: SavedResume,
  ): Promise<SaveSavedResumeResult> {
    const normalized = parseSavedResume(savedResume);
    const firestore = this.getFirestore();
    const document = this.document(userId, firestore);
    const privacyDocument = resumePrivacyDocument(firestore, userId);

    const persisted = await firestore.runTransaction(async (transaction) => {
      const privacySnapshot = await transaction.get(privacyDocument);
      if (!readSaveResumeDataSetting(privacySnapshot)) return false;

      const snapshot = await transaction.get(document);
      const timestamp = this.now();
      const existingCreatedAt = snapshot.exists
        ? snapshot.get("createdAt")
        : undefined;
      const createdAt =
        existingCreatedAt instanceof Timestamp
          ? existingCreatedAt
          : timestamp;
      const storedResume: StoredSavedResume = {
        schemaVersion: 2,
        resumeText: normalized.resumeText,
        profile: normalized.profile,
        createdAt,
        updatedAt: timestamp,
      };

      transaction.set(document, storedResume);
      return true;
    });

    return { savedResume: normalized, persisted };
  }

  async delete(userId: string): Promise<void> {
    await this.document(userId).delete();
  }

  private document(userId: string, firestore = this.getFirestore()) {
    return firestore
      .collection("users")
      .doc(userId)
      .collection("resumeProfiles")
      .doc(SAVED_RESUME_DOCUMENT);
  }
}

export const savedResumeRepository = new FirestoreSavedResumeRepository();
