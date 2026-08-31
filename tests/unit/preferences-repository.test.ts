import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FirestorePreferencesRepository } from "@/lib/preferences/repository";

const USER_ID = "firebase-user-123";
const PREFERENCES = {
  targetLocation: "Seattle, WA",
  additionalLocations: ["Portland, OR"],
  radiusMiles: 25,
  workArrangements: ["remote", "hybrid"] as const,
  employmentTypes: ["contract", "full_time"] as const,
  minimumSalary: 125_000,
};

function createFirestoreDouble(
  snapshot: { exists: boolean; data?: () => unknown; get?: (key: string) => unknown },
) {
  const document = { get: vi.fn() };
  const preferencesCollection = { doc: vi.fn(() => document) };
  const userDocument = {
    collection: vi.fn(() => preferencesCollection),
  };
  const usersCollection = { doc: vi.fn(() => userDocument) };
  const transaction = {
    get: vi.fn(async () => snapshot),
    set: vi.fn(),
  };
  const firestore = {
    collection: vi.fn(() => usersCollection),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  return {
    document,
    firestore,
    preferencesCollection,
    transaction,
    userDocument,
    usersCollection,
  };
}

describe("FirestorePreferencesRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the exact server-owned schema at the scoped user path", async () => {
    const updatedAt = Timestamp.fromMillis(2_000);
    const double = createFirestoreDouble({ exists: false });
    const repository = new FirestorePreferencesRepository(
      () => double.firestore as never,
      () => updatedAt,
    );

    await expect(repository.save(USER_ID, PREFERENCES)).resolves.toEqual(
      PREFERENCES,
    );
    expect(double.firestore.collection).toHaveBeenCalledWith("users");
    expect(double.usersCollection.doc).toHaveBeenCalledWith(USER_ID);
    expect(double.userDocument.collection).toHaveBeenCalledWith("preferences");
    expect(double.preferencesCollection.doc).toHaveBeenCalledWith("job");
    expect(double.transaction.set).toHaveBeenCalledWith(double.document, {
      schemaVersion: 4,
      targetLocation: "Seattle, WA",
      additionalLocations: ["Portland, OR"],
      radiusMiles: 25,
      workArrangements: ["remote", "hybrid"],
      employmentTypes: ["contract", "full_time"],
      minimumSalary: 125_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      createdAt: updatedAt,
      updatedAt,
    });
  });

  it("preserves createdAt while replacing the document on update", async () => {
    const createdAt = Timestamp.fromMillis(1_000);
    const updatedAt = Timestamp.fromMillis(2_000);
    const double = createFirestoreDouble({
      exists: true,
      get: (key) => (key === "createdAt" ? createdAt : undefined),
    });
    const repository = new FirestorePreferencesRepository(
      () => double.firestore as never,
      () => updatedAt,
    );

    await repository.save(USER_ID, PREFERENCES);

    expect(double.transaction.set).toHaveBeenCalledWith(
      double.document,
      expect.objectContaining({ createdAt, updatedAt }),
    );
    expect(Object.keys(double.transaction.set.mock.calls[0][1])).toEqual([
      "schemaVersion",
      "targetLocation",
      "additionalLocations",
      "radiusMiles",
      "workArrangements",
      "employmentTypes",
      "minimumSalary",
      "salaryCurrency",
      "salaryPeriod",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("returns only the public preference fields", async () => {
    const double = createFirestoreDouble({ exists: false });
    double.document.get.mockResolvedValue({
      exists: true,
      data: () => ({
        ...PREFERENCES,
        schemaVersion: 4,
        salaryCurrency: "USD",
        salaryPeriod: "year",
        futureAiProfile: { skills: ["private"] },
      }),
    });
    const repository = new FirestorePreferencesRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual(PREFERENCES);
  });

  it("loads legacy preference documents with the new defaults", async () => {
    const double = createFirestoreDouble({ exists: false });
    double.document.get.mockResolvedValue({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        targetLocation: "Remote",
        minimumSalary: 100_000,
      }),
    });
    const repository = new FirestorePreferencesRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      targetLocation: "Remote",
      additionalLocations: [],
      radiusMiles: 25,
      workArrangements: ["remote"],
      employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
      minimumSalary: 100_000,
    });
  });

  it("returns null when the scoped preference document does not exist", async () => {
    const double = createFirestoreDouble({ exists: false });
    double.document.get.mockResolvedValue({ exists: false });
    const repository = new FirestorePreferencesRepository(
      () => double.firestore as never,
    );

    await expect(repository.get(USER_ID)).resolves.toBeNull();
  });
});
