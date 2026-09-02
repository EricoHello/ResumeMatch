import type {
  PointAccountSnapshot,
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
  parsePointAccountSnapshot,
  PointIdempotencyConflictError,
} from "./validation";

const GUEST_POINTS_KEY = "resumematch:guest-points:v1";

type StoredGuestPoints = PointAccountSnapshot & {
  version: 1;
};

let memoryPoints: PointAccountSnapshot | null = null;

export class InsufficientGuestPointsError extends Error {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super("The guest point balance is insufficient for this spend.");
    this.name = "InsufficientGuestPointsError";
  }
}

function emptyGuestPoints(): PointAccountSnapshot {
  return { points: emptyPointBalance(), history: [] };
}

function persistGuestPoints(snapshot: PointAccountSnapshot) {
  memoryPoints = snapshot;
  if (typeof window === "undefined") return;

  const stored: StoredGuestPoints = { version: 1, ...snapshot };
  try {
    window.sessionStorage.setItem(GUEST_POINTS_KEY, JSON.stringify(stored));
  } catch {
    // The in-memory copy keeps points available for the active page.
  }
}

export function readGuestPoints(): PointAccountSnapshot {
  if (typeof window === "undefined") return memoryPoints ?? emptyGuestPoints();

  try {
    const raw = window.sessionStorage.getItem(GUEST_POINTS_KEY);
    if (!raw) return memoryPoints ?? emptyGuestPoints();

    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== 1
    ) {
      return emptyGuestPoints();
    }

    const parsed = parsePointAccountSnapshot(value);
    memoryPoints = parsed;
    return parsed;
  } catch {
    return memoryPoints ?? emptyGuestPoints();
  }
}

function mutateGuestPoints(
  kind: PointTransactionKind,
  input: PointMutationInput,
  allowNegative: boolean,
): PointMutationResult {
  const current = readGuestPoints();
  const entryId = `${kind}:${input.idempotencyKey}`;
  const existingEntry = current.history.find((entry) => entry.id === entryId);

  if (existingEntry) {
    if (!isSamePointEvent(existingEntry, kind, input)) {
      throw new PointIdempotencyConflictError();
    }
    return { applied: false, points: current.points, entry: existingEntry };
  }

  if (
    kind === "spend" &&
    !allowNegative &&
    current.points.balance < input.amount
  ) {
    throw new InsufficientGuestPointsError(
      current.points.balance,
      input.amount,
    );
  }

  const signedAmount = kind === "earn" ? input.amount : -input.amount;
  const points = {
    balance: current.points.balance + signedAmount,
    totalEarned:
      current.points.totalEarned + (kind === "earn" ? input.amount : 0),
    totalSpent:
      current.points.totalSpent + (kind === "spend" ? input.amount : 0),
  };
  const entry: PointHistoryEntry = {
    id: entryId,
    kind,
    action: input.action,
    amount: signedAmount,
    description: input.description,
    timestamp: new Date().toISOString(),
  };

  persistGuestPoints({ points, history: [entry, ...current.history] });
  return { applied: true, points, entry };
}

export function earnGuestPoints(input: PointMutationInput) {
  return mutateGuestPoints(
    "earn",
    normalizePointMutationInput(input),
    false,
  );
}

export function spendGuestPoints(input: SpendPointsInput) {
  const normalized = normalizeSpendPointsInput(input);
  return mutateGuestPoints(
    "spend",
    normalized,
    normalized.allowNegative === true,
  );
}

export function clearGuestPoints() {
  memoryPoints = null;
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(GUEST_POINTS_KEY);
  } catch {
    // The in-memory copy has still been cleared.
  }
}

