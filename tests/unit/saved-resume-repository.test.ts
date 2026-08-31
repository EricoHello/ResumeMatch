import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FirestoreSavedResumeRepository } from "@/lib/resume/saved-repository";

const USER_ID = "verified-user";
const SAVED_RESUME = {
  resumeText: "Ada Lovelace is a senior software engineer with TypeScript.",
  profile: null,
};

function firestoreDouble(snapshot: {
  exists: boolean;
  data?: () => unknown;
  get?: (key: string) => unknown;
}) {
  const document = { get: vi.fn() };
  const resumeProfiles = { doc: vi.fn(() => document) };
  const userDocument = { collection: vi.fn(() => resumeProfiles) };
  const users = { doc: vi.fn(() => userDocument) };
  const transaction = {
    get: vi.fn(async () => snapshot),
    set: vi.fn(),
  };
  const firestore = {
    collection: vi.fn(() => users),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  return { document, firestore, resumeProfiles, transaction, userDocument, users };
}

describe("FirestoreSavedResumeRepository", () => {
  it("writes only extracted text and profile under the verified user's current record", async () => {
    const now = Timestamp.fromMillis(2_000);
    const double = firestoreDouble({ exists: false });
    const repository = new FirestoreSavedResumeRepository(
      () => double.firestore as never,
      () => now,
    );

    await expect(repository.save(USER_ID, SAVED_RESUME)).resolves.toEqual(
      SAVED_RESUME,
    );
    expect(double.firestore.collection).toHaveBeenCalledWith("users");
    expect(double.users.doc).toHaveBeenCalledWith(USER_ID);
    expect(double.userDocument.collection).toHaveBeenCalledWith("resumeProfiles");
    expect(double.resumeProfiles.doc).toHaveBeenCalledWith("current");
    expect(double.transaction.set).toHaveBeenCalledWith(double.document, {
      schemaVersion: 1,
      resumeText: SAVED_RESUME.resumeText,
      profile: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("preserves the original creation time when replacing a resume", async () => {
    const createdAt = Timestamp.fromMillis(1_000);
    const updatedAt = Timestamp.fromMillis(2_000);
    const double = firestoreDouble({
      exists: true,
      get: (field) => (field === "createdAt" ? createdAt : undefined),
    });
    const repository = new FirestoreSavedResumeRepository(
      () => double.firestore as never,
      () => updatedAt,
    );

    await repository.save(USER_ID, SAVED_RESUME);
    expect(double.transaction.set).toHaveBeenCalledWith(
      double.document,
      expect.objectContaining({ createdAt, updatedAt }),
    );
  });

  it("returns the validated public record and omits server metadata", async () => {
    const double = firestoreDouble({ exists: false });
    double.document.get.mockResolvedValue({
      exists: true,
      data: () => ({
        ...SAVED_RESUME,
        schemaVersion: 1,
        createdAt: Timestamp.fromMillis(1_000),
        updatedAt: Timestamp.fromMillis(2_000),
      }),
    });
    const repository = new FirestoreSavedResumeRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual(SAVED_RESUME);
  });
});
