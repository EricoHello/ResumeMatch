import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FirestoreResumePrivacyRepository } from "@/lib/privacy/repository";

const USER_ID = "verified-user";

function firestoreDouble(snapshot: {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  get?: (field: string) => unknown;
}) {
  const document = { get: vi.fn().mockResolvedValue(snapshot) };
  const settings = { doc: vi.fn().mockReturnValue(document) };
  const userDocument = {
    collection: vi.fn().mockReturnValue(settings),
  };
  const users = { doc: vi.fn().mockReturnValue(userDocument) };
  const transaction = {
    get: vi.fn().mockResolvedValue(snapshot),
    set: vi.fn(),
  };
  const firestore = {
    collection: vi.fn().mockReturnValue(users),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  return { document, firestore, settings, transaction, userDocument, users };
}

describe("FirestoreResumePrivacyRepository", () => {
  it("defaults resume saving to enabled when no setting exists", async () => {
    const double = firestoreDouble({ exists: false, data: () => undefined });
    const repository = new FirestoreResumePrivacyRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      saveResumeData: true,
    });
  });

  it("returns a persisted disabled setting", async () => {
    const double = firestoreDouble({
      exists: true,
      data: () => ({ schemaVersion: 1, saveResumeData: false }),
    });
    const repository = new FirestoreResumePrivacyRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      saveResumeData: false,
    });
  });

  it("stores the setting under only the verified user's settings document", async () => {
    const now = Timestamp.fromMillis(2_000);
    const double = firestoreDouble({ exists: false, data: () => undefined });
    const repository = new FirestoreResumePrivacyRepository(
      () => double.firestore as never,
      () => now,
    );

    await expect(
      repository.save(USER_ID, { saveResumeData: false }),
    ).resolves.toEqual({ saveResumeData: false });
    expect(double.firestore.collection).toHaveBeenCalledWith("users");
    expect(double.users.doc).toHaveBeenCalledWith(USER_ID);
    expect(double.userDocument.collection).toHaveBeenCalledWith("settings");
    expect(double.settings.doc).toHaveBeenCalledWith("privacy");
    expect(double.transaction.set).toHaveBeenCalledWith(double.document, {
      schemaVersion: 1,
      saveResumeData: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("rejects malformed stored settings instead of enabling writes", async () => {
    const double = firestoreDouble({
      exists: true,
      data: () => ({ schemaVersion: 99, saveResumeData: true }),
    });
    const repository = new FirestoreResumePrivacyRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).rejects.toThrow(
      "Unsupported resume privacy settings schema",
    );
  });
});
