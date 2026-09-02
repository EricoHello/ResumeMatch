import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FirestorePointsRepository,
  InsufficientPointsError,
} from "@/lib/points/repository";
import { PointIdempotencyConflictError } from "@/lib/points/validation";

const USER_ID = "verified-user";
const NOW = Timestamp.fromDate(new Date("2026-09-01T12:00:00.000Z"));

type FakeReference = {
  kind: "user" | "history";
  id: string;
  get?: () => Promise<FakeSnapshot>;
  collection?: (name: string) => FakeHistoryCollection;
};

type FakeSnapshot = {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
  get: (field: string) => unknown;
};

type FakeHistoryCollection = {
  doc: (id: string) => FakeReference;
  orderBy: () => {
    limit: (limit: number) => { get: () => Promise<{ docs: FakeSnapshot[] }> };
    get: () => Promise<{ docs: FakeSnapshot[] }>;
  };
};

function createFirestoreDouble() {
  let userData: Record<string, unknown> | undefined;
  const history = new Map<string, Record<string, unknown>>();

  const snapshotFor = (reference: FakeReference): FakeSnapshot => {
    const data =
      reference.kind === "user" ? userData : history.get(reference.id);
    return {
      exists: data !== undefined,
      id: reference.id,
      data: () => data,
      get: (field) => data?.[field],
    };
  };

  const historySnapshots = () =>
    [...history.entries()]
      .sort(
        ([, left], [, right]) =>
          (right.timestamp as Timestamp).toMillis() -
          (left.timestamp as Timestamp).toMillis(),
      )
      .map(([id]) => snapshotFor({ kind: "history", id }));

  const historyCollection: FakeHistoryCollection = {
    doc: vi.fn((id: string) => ({ kind: "history" as const, id })),
    orderBy: vi.fn(() => ({
      limit: vi.fn((limit: number) => ({
        get: vi.fn(async () => ({ docs: historySnapshots().slice(0, limit) })),
      })),
      get: vi.fn(async () => ({ docs: historySnapshots() })),
    })),
  };
  const userReference: FakeReference = {
    kind: "user",
    id: USER_ID,
    get: async () => snapshotFor(userReference),
    collection: vi.fn(() => historyCollection),
  };
  const transaction = {
    get: vi.fn(async (reference: FakeReference) => snapshotFor(reference)),
    set: vi.fn(
      (
        _reference: FakeReference,
        data: Record<string, unknown>,
      ) => {
        userData = { ...userData, ...data };
      },
    ),
    create: vi.fn(
      (reference: FakeReference, data: Record<string, unknown>) => {
        if (history.has(reference.id)) throw new Error("already exists");
        history.set(reference.id, data);
      },
    ),
  };
  const firestore = {
    collection: vi.fn(() => ({ doc: vi.fn(() => userReference) })),
    getAll: vi.fn(async (...references: FakeReference[]) =>
      references.map(snapshotFor),
    ),
    runTransaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  return { firestore, history, transaction };
}

const FIRST_AWARD = {
  amount: 15,
  action: "copy_search_term",
  description: "Copied the first generated search term",
  idempotencyKey: "search-123:copy:1",
};

describe("FirestorePointsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atomically earns points and treats a repeated action as a no-op", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    const first = await repository.earn(USER_ID, FIRST_AWARD);
    const retry = await repository.earn(USER_ID, FIRST_AWARD);

    expect(first).toMatchObject({
      applied: true,
      points: { balance: 15, totalEarned: 15, totalSpent: 0 },
      entry: { kind: "earn", amount: 15 },
    });
    expect(retry).toEqual({ ...first, applied: false });
    expect(double.history).toHaveLength(1);
    expect(double.transaction.create).toHaveBeenCalledOnce();
    expect(double.transaction.set).toHaveBeenCalledOnce();
  });

  it("rejects reuse of an earning key for different event details", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );
    await repository.earn(USER_ID, FIRST_AWARD);

    await expect(
      repository.earn(USER_ID, {
        ...FIRST_AWARD,
        amount: 25,
      }),
    ).rejects.toBeInstanceOf(PointIdempotencyConflictError);
    expect(double.history).toHaveLength(1);
  });

  it("tracks spending independently and makes spend retries safe", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );
    await repository.earn(USER_ID, FIRST_AWARD);
    const spend = {
      amount: 10,
      action: "future_reward",
      description: "Unlocked a future reward",
      idempotencyKey: "reward-456",
    };

    const first = await repository.spend(USER_ID, spend);
    const retry = await repository.spend(USER_ID, spend);

    expect(first).toMatchObject({
      applied: true,
      points: { balance: 5, totalEarned: 15, totalSpent: 10 },
      entry: { kind: "spend", amount: -10 },
    });
    expect(retry).toEqual({ ...first, applied: false });
    expect(double.history).toHaveLength(2);
  });

  it("blocks ordinary overspending but explicitly supports post-paid debt", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );
    const spend = {
      amount: 20,
      action: "post_paid_reward",
      description: "Final cost for a completed operation",
      idempotencyKey: "post-paid-1",
    };

    await expect(repository.spend(USER_ID, spend)).rejects.toEqual(
      new InsufficientPointsError(0, 20),
    );
    await expect(
      repository.spend(USER_ID, { ...spend, allowNegative: true }),
    ).resolves.toMatchObject({
      points: { balance: -20, totalEarned: 0, totalSpent: 20 },
    });
  });

  it("reads zero defaults and returns the ledger without idempotency keys", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );

    await expect(repository.get(USER_ID)).resolves.toEqual({
      points: { balance: 0, totalEarned: 0, totalSpent: 0 },
      history: [],
    });

    await repository.earn(USER_ID, FIRST_AWARD);
    const snapshot = await repository.get(USER_ID, { historyLimit: null });

    expect(snapshot.points).toEqual({
      balance: 15,
      totalEarned: 15,
      totalSpent: 0,
    });
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.history[0]).not.toHaveProperty("idempotencyKey");
  });

  it("checks a complete set of idempotent earning events", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestorePointsRepository(
      () => double.firestore as never,
      () => NOW,
    );
    const secondAward = {
      ...FIRST_AWARD,
      idempotencyKey: "search-123:copy:2",
    };
    await repository.earn(USER_ID, FIRST_AWARD);

    await expect(
      repository.hasEarnings(USER_ID, [
        FIRST_AWARD.idempotencyKey,
        secondAward.idempotencyKey,
      ]),
    ).resolves.toBe(false);

    await repository.earn(USER_ID, secondAward);
    await expect(
      repository.hasEarnings(USER_ID, [
        FIRST_AWARD.idempotencyKey,
        secondAward.idempotencyKey,
      ]),
    ).resolves.toBe(true);
  });
});
