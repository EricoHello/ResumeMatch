import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

import type { ApplicationSettings } from "./types";
import { parseApplicationSettings } from "./validation";

const APPLICATION_SETTINGS_DOCUMENT = "applications";
const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  autoArchiveDays: 30,
};

type StoredApplicationSettings = ApplicationSettings & {
  schemaVersion: 1;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;

export class FirestoreApplicationSettingsRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
  ) {}

  async get(userId: string): Promise<ApplicationSettings> {
    const snapshot = await this.document(userId).get();
    if (!snapshot.exists) return { ...DEFAULT_APPLICATION_SETTINGS };

    const data = snapshot.data();
    if (data?.schemaVersion !== 1) {
      throw new Error("Unsupported application settings schema.");
    }
    return parseApplicationSettings({
      autoArchiveDays: data.autoArchiveDays,
    });
  }

  async save(
    userId: string,
    settings: ApplicationSettings,
  ): Promise<ApplicationSettings> {
    const normalized = parseApplicationSettings(settings);
    const firestore = this.getFirestore();
    const document = this.document(userId, firestore);

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
      const stored: StoredApplicationSettings = {
        schemaVersion: 1,
        ...normalized,
        createdAt,
        updatedAt: timestamp,
      };
      transaction.set(document, stored);
    });

    return normalized;
  }

  private document(userId: string, firestore = this.getFirestore()) {
    return firestore
      .collection("users")
      .doc(userId)
      .collection("settings")
      .doc(APPLICATION_SETTINGS_DOCUMENT);
  }
}

export const applicationSettingsRepository =
  new FirestoreApplicationSettingsRepository();
