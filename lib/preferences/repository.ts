import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

import type { JobPreferences } from "./types";
import { parseJobPreferences } from "./validation";

const PREFERENCES_DOCUMENT = "job";

type StoredJobPreferences = JobPreferences & {
  schemaVersion: 2;
  salaryCurrency: "USD";
  salaryPeriod: "year";
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;

export class FirestorePreferencesRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
  ) {}

  async get(userId: string): Promise<JobPreferences | null> {
    const snapshot = await this.document(userId).get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data();

    const basePreferences = {
      targetLocation: data?.targetLocation,
      minimumSalary: data?.minimumSalary,
    };

    return data?.schemaVersion === 2
      ? parseJobPreferences({
          ...basePreferences,
          additionalLocations: data.additionalLocations,
          radiusMiles: data.radiusMiles,
          workArrangement: data.workArrangement,
        })
      : parseJobPreferences(basePreferences);
  }

  async save(
    userId: string,
    preferences: JobPreferences,
  ): Promise<JobPreferences> {
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
      const storedPreferences: StoredJobPreferences = {
        schemaVersion: 2,
        targetLocation: preferences.targetLocation,
        additionalLocations: preferences.additionalLocations,
        radiusMiles: preferences.radiusMiles,
        workArrangement: preferences.workArrangement,
        minimumSalary: preferences.minimumSalary,
        salaryCurrency: "USD",
        salaryPeriod: "year",
        createdAt,
        updatedAt: timestamp,
      };

      transaction.set(document, storedPreferences);
    });

    return preferences;
  }

  private document(userId: string, firestore = this.getFirestore()) {
    return firestore
      .collection("users")
      .doc(userId)
      .collection("preferences")
      .doc(PREFERENCES_DOCUMENT);
  }
}

export const preferencesRepository = new FirestorePreferencesRepository();
