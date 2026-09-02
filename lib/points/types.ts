export type PointBalance = {
  balance: number;
  totalEarned: number;
  totalSpent: number;
};

export type PointTransactionKind = "earn" | "spend";

export type PointHistoryEntry = {
  id: string;
  kind: PointTransactionKind;
  action: string;
  amount: number;
  description: string;
  timestamp: string;
};

export type PointAccountSnapshot = {
  points: PointBalance;
  history: PointHistoryEntry[];
};

export type PointAccountViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PointAccountSnapshot }
  | { status: "error"; message: string };

export type PointMutationInput = {
  amount: number;
  action: string;
  description: string;
  /**
   * A stable identifier for one logical action occurrence. Include any natural
   * scope, such as a search/session ID and result index, so request retries use
   * the same key while a genuinely new occurrence uses a new key.
   */
  idempotencyKey: string;
};

export type SpendPointsInput = PointMutationInput & {
  /**
   * Reserved for post-paid operations whose actual cost is known only after
   * completion. Ordinary spends fail when the balance is insufficient.
   */
  allowNegative?: boolean;
};

export type PointMutationResult = {
  applied: boolean;
  points: PointBalance;
  entry: PointHistoryEntry;
};

export type PointsResponse = {
  data: PointAccountSnapshot;
};

export type PointsErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "POINTS_UNAVAILABLE";

export type PointsErrorResponse = {
  error: {
    code: PointsErrorCode;
    message: string;
  };
};

export function emptyPointBalance(): PointBalance {
  return { balance: 0, totalEarned: 0, totalSpent: 0 };
}
