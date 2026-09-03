import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applicationDocumentId,
  FirestoreApplicationsRepository,
} from "@/lib/applications/repository";

const USER_ID = "firebase-user-123";
const NOW = Timestamp.fromDate(new Date("2026-09-02T18:00:00.000Z"));
const INPUT = {
  title: "Staff Software Engineer",
  company: "Northstar",
  location: "Seattle, WA",
  salary: "$160,000–$190,000 / year",
  jobUrl: "https://jobs.example.test/opening?id=123&utm=test",
  source: "JSearch",
  sourceJobId: "job-123",
  origin: "resumematch" as const,
  status: "Applying" as const,
  appliedDate: null,
  notes: "",
  nextAction: null,
  nextActionDate: null,
};

function storedApplication(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    ...INPUT,
    dateAdded: Timestamp.fromDate(new Date("2026-09-01T12:00:00.000Z")),
    lastUpdated: Timestamp.fromDate(new Date("2026-09-01T12:00:00.000Z")),
    ...overrides,
  };
}

function firestoreDouble(snapshot: {
  exists: boolean;
  id?: string;
  data?: () => Record<string, unknown>;
}, queryData: Array<{ id: string; data: Record<string, unknown> }> = []) {
  const document = { id: "generated-id" };
  const orderedQuery = {
    limit: vi.fn(),
    get: vi.fn(),
  };
  orderedQuery.limit.mockReturnValue(orderedQuery);
  const queryDocuments = queryData.map((item) => ({
    id: item.id,
    ref: { id: item.id },
    data: () => item.data,
  }));
  orderedQuery.get.mockResolvedValue({ docs: queryDocuments });
  const applicationsCollection = {
    doc: vi.fn((id?: string) => {
      document.id = id ?? "generated-id";
      return document;
    }),
    orderBy: vi.fn(() => orderedQuery),
  };
  const userDocument = { collection: vi.fn(() => applicationsCollection) };
  const usersCollection = { doc: vi.fn(() => userDocument) };
  const transaction = {
    get: vi.fn(async (target: unknown) =>
      target === orderedQuery
        ? { docs: queryDocuments }
        : { id: document.id, ...snapshot },
    ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const firestore = {
    collection: vi.fn(() => usersCollection),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  return {
    applicationsCollection,
    document,
    firestore,
    orderedQuery,
    transaction,
    userDocument,
    usersCollection,
  };
}

describe("FirestoreApplicationsRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an Applying entry at the URL-derived user path", async () => {
    const double = firestoreDouble({ exists: false });
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    const result = await repository.create(USER_ID, INPUT);

    expect(result.created).toBe(true);
    expect(result.application).toMatchObject({
      id: applicationDocumentId(INPUT.jobUrl),
      status: "Applying",
      appliedDate: null,
      dateAdded: "2026-09-02T18:00:00.000Z",
      lastUpdated: "2026-09-02T18:00:00.000Z",
      lastActivityAt: "2026-09-02T18:00:00.000Z",
      archived: false,
    });
    expect(double.firestore.collection).toHaveBeenCalledWith("users");
    expect(double.usersCollection.doc).toHaveBeenCalledWith(USER_ID);
    expect(double.userDocument.collection).toHaveBeenCalledWith("applications");
    expect(double.applicationsCollection.doc).toHaveBeenCalledWith(
      applicationDocumentId(INPUT.jobUrl),
    );
    expect(double.transaction.create).toHaveBeenCalledWith(double.document, {
      schemaVersion: 2,
      ...INPUT,
      dateAdded: NOW,
      lastUpdated: NOW,
      lastActivityAt: NOW,
      archived: false,
      archivedAt: null,
      archiveReason: null,
    });
  });

  it("returns an existing URL entry without resetting its progress", async () => {
    const existing = storedApplication({
      status: "Interview",
      appliedDate: "2026-09-01",
      notes: "Panel interview scheduled",
    });
    const double = firestoreDouble({
      exists: true,
      data: () => existing,
    });
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    const result = await repository.create(USER_ID, INPUT);

    expect(result).toMatchObject({
      created: false,
      application: {
        status: "Interview",
        appliedDate: "2026-09-01",
        notes: "Panel interview scheduled",
        lastActivityAt: "2026-09-02T18:00:00.000Z",
      },
    });
    expect(double.transaction.create).not.toHaveBeenCalled();
    expect(double.transaction.update).toHaveBeenCalledWith(
      double.document,
      expect.objectContaining({
        schemaVersion: 2,
        lastActivityAt: NOW,
        lastUpdated: NOW,
      }),
    );
  });

  it("sets the applied date when a user confirms Applied status", async () => {
    const double = firestoreDouble({
      exists: true,
      data: () => storedApplication(),
    });
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    const updated = await repository.update(USER_ID, "application-1", {
      status: "Applied",
      notes: "Submitted on the company site",
    });

    expect(updated).toMatchObject({
      status: "Applied",
      appliedDate: "2026-09-02",
      notes: "Submitted on the company site",
      lastUpdated: "2026-09-02T18:00:00.000Z",
      lastActivityAt: "2026-09-02T18:00:00.000Z",
    });
    expect(double.transaction.update).toHaveBeenCalledWith(double.document, {
      schemaVersion: 2,
      lastActivityAt: NOW,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      status: "Applied",
      notes: "Submitted on the company site",
      appliedDate: "2026-09-02",
      lastUpdated: NOW,
    });
  });

  it("auto-archives inactive applications without changing status", async () => {
    const inactiveAt = Timestamp.fromDate(new Date("2026-07-01T12:00:00.000Z"));
    const double = firestoreDouble(
      { exists: false },
      [
        {
          id: "inactive",
          data: storedApplication({
            status: "Assessment",
            lastUpdated: inactiveAt,
          }),
        },
        {
          id: "recent",
          data: storedApplication({
            lastUpdated: Timestamp.fromDate(
              new Date("2026-08-20T12:00:00.000Z"),
            ),
          }),
        },
      ],
    );
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
      async () => 30,
    );

    const applications = await repository.list(USER_ID);

    expect(applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "inactive",
          status: "Assessment",
          archived: true,
          archiveReason: "inactivity",
          archivedAt: "2026-09-02T18:00:00.000Z",
          lastActivityAt: "2026-07-01T12:00:00.000Z",
        }),
        expect.objectContaining({ id: "recent", archived: false }),
      ]),
    );
    expect(double.transaction.update).toHaveBeenCalledOnce();
    expect(double.transaction.update).toHaveBeenCalledWith(
      { id: "inactive" },
      expect.objectContaining({
        archived: true,
        archiveReason: "inactivity",
        lastActivityAt: inactiveAt,
        lastUpdated: NOW,
      }),
    );
  });

  it.each(["Interview", "Offer"] as const)(
    "does not auto-archive an inactive %s application",
    async (status) => {
      const double = firestoreDouble(
        { exists: false },
        [
          {
            id: status.toLowerCase(),
            data: storedApplication({
              status,
              lastUpdated: Timestamp.fromDate(
                new Date("2026-06-01T12:00:00.000Z"),
              ),
            }),
          },
        ],
      );
      const repository = new FirestoreApplicationsRepository(
        () => double.firestore as never,
        () => NOW,
        async () => 14,
      );

      await expect(repository.list(USER_ID)).resolves.toEqual([
        expect.objectContaining({ status, archived: false }),
      ]);
      expect(double.transaction.update).not.toHaveBeenCalled();
    },
  );

  it("disables auto-archiving when the setting is Never", async () => {
    const double = firestoreDouble(
      { exists: false },
      [
        {
          id: "old-application",
          data: storedApplication({
            lastUpdated: Timestamp.fromDate(
              new Date("2025-01-01T12:00:00.000Z"),
            ),
          }),
        },
      ],
    );
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
      async () => null,
    );

    await expect(repository.list(USER_ID)).resolves.toEqual([
      expect.objectContaining({ archived: false }),
    ]);
    expect(double.firestore.runTransaction).not.toHaveBeenCalled();
    expect(double.transaction.update).not.toHaveBeenCalled();
  });

  it("archives and restores separately from application status", async () => {
    const originalActivity = Timestamp.fromDate(
      new Date("2026-08-20T12:00:00.000Z"),
    );
    const archiveDouble = firestoreDouble({
      exists: true,
      data: () => storedApplication({
        status: "Applied",
        lastUpdated: originalActivity,
      }),
    });
    const archiveRepository = new FirestoreApplicationsRepository(
      () => archiveDouble.firestore as never,
      () => NOW,
    );

    const archived = await archiveRepository.setArchived(
      USER_ID,
      "application-1",
      true,
    );

    expect(archived).toMatchObject({
      status: "Applied",
      archived: true,
      archiveReason: "manual",
      lastActivityAt: "2026-08-20T12:00:00.000Z",
    });

    const restoreDouble = firestoreDouble({
      exists: true,
      data: () => ({
        ...storedApplication({ status: "Applied" }),
        schemaVersion: 2,
        lastActivityAt: originalActivity,
        archived: true,
        archivedAt: originalActivity,
        archiveReason: "manual",
      }),
    });
    const restoreRepository = new FirestoreApplicationsRepository(
      () => restoreDouble.firestore as never,
      () => NOW,
    );

    const restored = await restoreRepository.setArchived(
      USER_ID,
      "application-1",
      false,
    );
    expect(restored).toMatchObject({
      status: "Applied",
      archived: false,
      archivedAt: null,
      archiveReason: null,
      lastActivityAt: "2026-09-02T18:00:00.000Z",
    });
  });

  it("permanently deletes only the scoped application", async () => {
    const double = firestoreDouble({
      exists: true,
      data: () => storedApplication(),
    });
    const repository = new FirestoreApplicationsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    await repository.delete(USER_ID, "application-1");

    expect(double.applicationsCollection.doc).toHaveBeenCalledWith(
      "application-1",
    );
    expect(double.transaction.delete).toHaveBeenCalledWith(double.document);
  });

  it("normalizes URL query order for duplicate document IDs", () => {
    expect(
      applicationDocumentId("https://jobs.example.test/opening?b=2&a=1#apply"),
    ).toBe(
      applicationDocumentId("https://jobs.example.test/opening?a=1&b=2"),
    );
  });
});
