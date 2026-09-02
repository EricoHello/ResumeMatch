import "server-only";

import { createHash } from "node:crypto";

import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

import type {
  PointAccountSnapshot,
  PointBalance,
  PointHistoryEntry,
  PointMutationInput,
  PointMutationResult,
  PointTransactionKind,
  SpendPointsInput,
} from "./types";
import { emptyPointBalance } from "./types";
import {
  isSamePointEvent,
  normalizePointMutationInput,
  normalizeSpendPointsInput,
  PointIdempotencyConflictError,
} from "./validation";

const POINTS_SCHEMA_VERSION = 1;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;

type StoredPointBalance = PointBalance & {
  schemaVersion: typeof POINTS_SCHEMA_VERSION;
  updatedAt: Timestamp;
};

type StoredPointHistoryEntry = {
  schemaVersion: typeof POINTS_SCHEMA_VERSION;
  kind: PointTransactionKind;
  action: string;
  amount: number;
  description: string;
  idempotencyKey: string;
  timestamp: Timestamp;
};

type PointReadOptions = {
  /** `null` is reserved for trusted uses such as a complete account export. */
  historyLimit?: number | null;
};

export class InsufficientPointsError extends Error {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super("The point balance is insufficient for this spend.");
    this.name = "InsufficientPointsError";
  }
}

function parseStoredPointBalance(snapshot: DocumentSnapshot): PointBalance {
  if (!snapshot.exists) return emptyPointBalance();

  const value: unknown = snapshot.get("points");
  if (value === undefined) return emptyPointBalance();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unsupported point balance schema.");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== POINTS_SCHEMA_VERSION ||
    !Number.isSafeInteger(candidate.balance) ||
    !Number.isSafeInteger(candidate.totalEarned) ||
    !Number.isSafeInteger(candidate.totalSpent) ||
    (candidate.totalEarned as number) < 0 ||
    (candidate.totalSpent as number) < 0 ||
    candidate.balance !==
      (candidate.totalEarned as number) - (candidate.totalSpent as number)
  ) {
    throw new Error("Unsupported point balance schema.");
  }

  return {
    balance: candidate.balance as number,
    totalEarned: candidate.totalEarned as number,
    totalSpent: candidate.totalSpent as number,
  };
}

function parseStoredHistoryEntry(
  snapshot: QueryDocumentSnapshot | DocumentSnapshot,
): PointHistoryEntry & { idempotencyKey: string } {
  const data = snapshot.data();
  if (
    data?.schemaVersion !== POINTS_SCHEMA_VERSION ||
    (data.kind !== "earn" && data.kind !== "spend") ||
    typeof data.action !== "string" ||
    !Number.isSafeInteger(data.amount) ||
    data.amount === 0 ||
    (data.kind === "earn" && data.amount < 0) ||
    (data.kind === "spend" && data.amount > 0) ||
    typeof data.description !== "string" ||
    typeof data.idempotencyKey !== "string" ||
    !(data.timestamp instanceof Timestamp)
  ) {
    throw new Error("Unsupported point history schema.");
  }

  return {
    id: snapshot.id,
    kind: data.kind,
    action: data.action,
    amount: data.amount,
    description: data.description,
    idempotencyKey: data.idempotencyKey,
    timestamp: data.timestamp.toDate().toISOString(),
  };
}

function historyDocumentId(kind: PointTransactionKind, key: string) {
  return createHash("sha256")
    .update(`${kind}\0${key}`, "utf8")
    .digest("hex");
}

function publicHistoryEntry(
  entry: PointHistoryEntry & { idempotencyKey: string },
): PointHistoryEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    action: entry.action,
    amount: entry.amount,
    description: entry.description,
    timestamp: entry.timestamp,
  };
}

function normalizedHistoryLimit(options: PointReadOptions) {
  const limit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  if (limit === null) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new Error(
      `historyLimit must be between 1 and ${MAX_HISTORY_LIMIT}, or null.`,
    );
  }
  return limit;
}

export class FirestorePointsRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
  ) {}

  async get(
    userId: string,
    options: PointReadOptions = {},
  ): Promise<PointAccountSnapshot> {
    const firestore = this.getFirestore();
    const userDocument = this.userDocument(userId, firestore);
    const historyLimit = normalizedHistoryLimit(options);
    const orderedHistory = userDocument
      .collection("pointHistory")
      .orderBy("timestamp", "desc");
    const historyQuery =
      historyLimit === null ? orderedHistory : orderedHistory.limit(historyLimit);

    const [userSnapshot, historySnapshot] = await Promise.all([
      userDocument.get(),
      historyQuery.get(),
    ]);

    return {
      points: parseStoredPointBalance(userSnapshot),
      history: historySnapshot.docs.map((snapshot) =>
        publicHistoryEntry(parseStoredHistoryEntry(snapshot)),
      ),
    };
  }

  async earn(
    userId: string,
    input: PointMutationInput,
  ): Promise<PointMutationResult> {
    return this.mutate(userId, "earn", normalizePointMutationInput(input), false);
  }

  async spend(
    userId: string,
    input: SpendPointsInput,
  ): Promise<PointMutationResult> {
    const normalized = normalizeSpendPointsInput(input);
    return this.mutate(
      userId,
      "spend",
      normalized,
      normalized.allowNegative === true,
    );
  }

  private async mutate(
    userId: string,
    kind: PointTransactionKind,
    input: PointMutationInput,
    allowNegative: boolean,
  ): Promise<PointMutationResult> {
    const firestore = this.getFirestore();
    const userDocument = this.userDocument(userId, firestore);
    const entryId = historyDocumentId(kind, input.idempotencyKey);
    const historyDocument = userDocument
      .collection("pointHistory")
      .doc(entryId);

    return firestore.runTransaction(async (transaction) => {
      const historySnapshot = await transaction.get(historyDocument);
      const userSnapshot = await transaction.get(userDocument);
      const currentPoints = parseStoredPointBalance(userSnapshot);

      if (historySnapshot.exists) {
        const existingEntry = parseStoredHistoryEntry(historySnapshot);
        if (
          existingEntry.idempotencyKey !== input.idempotencyKey ||
          !isSamePointEvent(existingEntry, kind, input)
        ) {
          throw new PointIdempotencyConflictError();
        }

        return {
          applied: false,
          points: currentPoints,
          entry: publicHistoryEntry(existingEntry),
        };
      }

      if (
        kind === "spend" &&
        !allowNegative &&
        currentPoints.balance < input.amount
      ) {
        throw new InsufficientPointsError(
          currentPoints.balance,
          input.amount,
        );
      }

      const timestamp = this.now();
      const signedAmount = kind === "earn" ? input.amount : -input.amount;
      const points: PointBalance = {
        balance: currentPoints.balance + signedAmount,
        totalEarned:
          currentPoints.totalEarned + (kind === "earn" ? input.amount : 0),
        totalSpent:
          currentPoints.totalSpent + (kind === "spend" ? input.amount : 0),
      };
      const storedPoints: StoredPointBalance = {
        schemaVersion: POINTS_SCHEMA_VERSION,
        ...points,
        updatedAt: timestamp,
      };
      const storedEntry: StoredPointHistoryEntry = {
        schemaVersion: POINTS_SCHEMA_VERSION,
        kind,
        action: input.action,
        amount: signedAmount,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        timestamp,
      };
      const entry: PointHistoryEntry = {
        id: entryId,
        kind,
        action: input.action,
        amount: signedAmount,
        description: input.description,
        timestamp: timestamp.toDate().toISOString(),
      };

      transaction.set(userDocument, { points: storedPoints }, { merge: true });
      transaction.create(historyDocument, storedEntry as DocumentData);

      return { applied: true, points, entry };
    });
  }

  private userDocument(userId: string, firestore = this.getFirestore()) {
    return firestore.collection("users").doc(userId);
  }
}

export const pointsRepository = new FirestorePointsRepository();

export function getPoints(
  userId: string,
  options?: PointReadOptions,
): Promise<PointAccountSnapshot> {
  return pointsRepository.get(userId, options);
}

export function earnPoints(
  userId: string,
  input: PointMutationInput,
): Promise<PointMutationResult> {
  return pointsRepository.earn(userId, input);
}

export function spendPoints(
  userId: string,
  input: SpendPointsInput,
): Promise<PointMutationResult> {
  return pointsRepository.spend(userId, input);
}
