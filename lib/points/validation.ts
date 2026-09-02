import type {
  PointAccountSnapshot,
  PointBalance,
  PointHistoryEntry,
  PointMutationInput,
  PointTransactionKind,
  SpendPointsInput,
} from "./types";

const MAX_POINT_AMOUNT = 1_000_000;
const MAX_ACTION_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_IDEMPOTENCY_KEY_LENGTH = 240;

export class InvalidPointMutationError extends Error {
  constructor(message = "The point mutation is invalid.") {
    super(message);
    this.name = "InvalidPointMutationError";
  }
}

export class PointIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already associated with another point event.");
    this.name = "PointIdempotencyConflictError";
  }
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new InvalidPointMutationError(`${field} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new InvalidPointMutationError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }

  return normalized;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function normalizePointMutationInput(
  input: PointMutationInput,
): PointMutationInput {
  if (
    !isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_POINT_AMOUNT
  ) {
    throw new InvalidPointMutationError(
      `amount must be a positive integer no greater than ${MAX_POINT_AMOUNT}.`,
    );
  }

  return {
    amount: input.amount,
    action: requiredString(input.action, "action", MAX_ACTION_LENGTH),
    description: requiredString(
      input.description,
      "description",
      MAX_DESCRIPTION_LENGTH,
    ),
    idempotencyKey: requiredString(
      input.idempotencyKey,
      "idempotencyKey",
      MAX_IDEMPOTENCY_KEY_LENGTH,
    ),
  };
}

export function normalizeSpendPointsInput(
  input: SpendPointsInput,
): SpendPointsInput {
  if (
    input.allowNegative !== undefined &&
    typeof input.allowNegative !== "boolean"
  ) {
    throw new InvalidPointMutationError("allowNegative must be a boolean.");
  }

  return {
    ...normalizePointMutationInput(input),
    ...(input.allowNegative === undefined
      ? {}
      : { allowNegative: input.allowNegative }),
  };
}

export function parsePointBalance(value: unknown): PointBalance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid point balance data.");
  }

  const candidate = value as Record<string, unknown>;
  const { balance, totalEarned, totalSpent } = candidate;
  if (
    !isSafeInteger(balance) ||
    !isSafeInteger(totalEarned) ||
    !isSafeInteger(totalSpent) ||
    totalEarned < 0 ||
    totalSpent < 0 ||
    balance !== totalEarned - totalSpent
  ) {
    throw new Error("Invalid point balance data.");
  }

  return { balance, totalEarned, totalSpent };
}

export function parsePointHistoryEntry(value: unknown): PointHistoryEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid point history data.");
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  const amount = candidate.amount;
  const timestamp = candidate.timestamp;
  if (
    (kind !== "earn" && kind !== "spend") ||
    !isSafeInteger(amount) ||
    amount === 0 ||
    (kind === "earn" && amount < 0) ||
    (kind === "spend" && amount > 0) ||
    typeof timestamp !== "string" ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error("Invalid point history data.");
  }

  return {
    id: requiredString(candidate.id, "id", 200),
    kind,
    action: requiredString(candidate.action, "action", MAX_ACTION_LENGTH),
    amount,
    description: requiredString(
      candidate.description,
      "description",
      MAX_DESCRIPTION_LENGTH,
    ),
    timestamp,
  };
}

export function parsePointAccountSnapshot(
  value: unknown,
): PointAccountSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid point account data.");
  }

  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.history)) {
    throw new Error("Invalid point account data.");
  }

  return {
    points: parsePointBalance(candidate.points),
    history: candidate.history.map(parsePointHistoryEntry),
  };
}

export function isSamePointEvent(
  entry: Pick<PointHistoryEntry, "kind" | "action" | "amount" | "description">,
  kind: PointTransactionKind,
  input: PointMutationInput,
) {
  const signedAmount = kind === "earn" ? input.amount : -input.amount;
  return (
    entry.kind === kind &&
    entry.action === input.action &&
    entry.amount === signedAmount &&
    entry.description === input.description
  );
}

