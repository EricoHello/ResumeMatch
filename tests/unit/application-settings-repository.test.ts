import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FirestoreApplicationSettingsRepository } from "@/lib/applications/settings-repository";

const USER_ID = "firebase-user";
const NOW = Timestamp.fromDate(new Date("2026-09-02T18:00:00.000Z"));

function firestoreDouble(snapshot: {
  exists: boolean;
  data?: () => Record<string, unknown>;
  get?: (field: string) => unknown;
}) {
  const document = { get: vi.fn(async () => snapshot) };
  const settingsCollection = { doc: vi.fn(() => document) };
  const userDocument = { collection: vi.fn(() => settingsCollection) };
  const usersCollection = { doc: vi.fn(() => userDocument) };
  const transaction = {
    get: vi.fn(async () => snapshot),
    set: vi.fn(),
  };
  const firestore = {
    collection: vi.fn(() => usersCollection),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
    ),
  };
  return {
    document,
    firestore,
    settingsCollection,
    transaction,
    userDocument,
    usersCollection,
  };
}

describe("FirestoreApplicationSettingsRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults automatic archiving to 30 days", async () => {
    const double = firestoreDouble({ exists: false });
    const repository = new FirestoreApplicationSettingsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      autoArchiveDays: 30,
    });
  });

  it("saves a selected inactivity period at the scoped settings path", async () => {
    const double = firestoreDouble({ exists: false });
    const repository = new FirestoreApplicationSettingsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    await expect(
      repository.save(USER_ID, { autoArchiveDays: 60 }),
    ).resolves.toEqual({ autoArchiveDays: 60 });

    expect(double.firestore.collection).toHaveBeenCalledWith("users");
    expect(double.usersCollection.doc).toHaveBeenCalledWith(USER_ID);
    expect(double.userDocument.collection).toHaveBeenCalledWith("settings");
    expect(double.settingsCollection.doc).toHaveBeenCalledWith("applications");
    expect(double.transaction.set).toHaveBeenCalledWith(double.document, {
      schemaVersion: 1,
      autoArchiveDays: 60,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("supports disabling automatic archiving with Never", async () => {
    const double = firestoreDouble({
      exists: true,
      data: () => ({ schemaVersion: 1, autoArchiveDays: null }),
    });
    const repository = new FirestoreApplicationSettingsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      autoArchiveDays: null,
    });
  });
});
