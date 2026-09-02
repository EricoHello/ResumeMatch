import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

import type {
  AwardJobClickRequest,
  JobClickRewardContext,
} from "./job-click-types";

const ELIGIBILITY_SCHEMA_VERSION = 1;
const ELIGIBILITY_LIFETIME_MS = 24 * 60 * 60 * 1_000;

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;
type SearchIdProvider = () => string;
type ClickTokenProvider = () => string;

type StoredJobClickEligibility = {
  schemaVersion: typeof ELIGIBILITY_SCHEMA_VERSION;
  clickTokenHashes: string[];
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export class InvalidJobClickEligibilityError extends Error {
  constructor() {
    super("The job click is not eligible for points.");
    this.name = "InvalidJobClickEligibilityError";
  }
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.length > 0 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export class FirestoreJobClickEligibilityRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
    private readonly createSearchId: SearchIdProvider = randomUUID,
    private readonly createClickToken: ClickTokenProvider = () =>
      randomBytes(32).toString("base64url"),
  ) {}

  async issue(
    userId: string | null,
    jobCount: number,
  ): Promise<JobClickRewardContext | null> {
    if (!Number.isInteger(jobCount) || jobCount < 0 || jobCount > 3) {
      throw new Error("The displayed job count is invalid.");
    }
    if (jobCount === 0) return null;

    const searchId = this.createSearchId();
    const clickTokens = Array.from(
      { length: jobCount },
      () => this.createClickToken(),
    );
    const context = { searchId, clickTokens };

    if (!userId) return context;

    const createdAt = this.now();
    const expiresAt = Timestamp.fromMillis(
      createdAt.toMillis() + ELIGIBILITY_LIFETIME_MS,
    );
    const stored: StoredJobClickEligibility = {
      schemaVersion: ELIGIBILITY_SCHEMA_VERSION,
      clickTokenHashes: clickTokens.map(tokenHash),
      createdAt,
      expiresAt,
    };

    await this.document(userId, searchId).create(stored);
    return context;
  }

  async validate(userId: string, input: AwardJobClickRequest) {
    const snapshot = await this.document(userId, input.searchId).get();
    const data = snapshot.data();
    if (
      !snapshot.exists ||
      data?.schemaVersion !== ELIGIBILITY_SCHEMA_VERSION ||
      !Array.isArray(data.clickTokenHashes) ||
      data.clickTokenHashes.length < 1 ||
      data.clickTokenHashes.length > 3 ||
      !data.clickTokenHashes.every(
        (hash: unknown) =>
          typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
      ) ||
      !(data.createdAt instanceof Timestamp) ||
      !(data.expiresAt instanceof Timestamp) ||
      data.expiresAt.toMillis() < this.now().toMillis() ||
      input.jobIndex >= data.clickTokenHashes.length ||
      !hashesMatch(
        data.clickTokenHashes[input.jobIndex],
        tokenHash(input.clickToken),
      )
    ) {
      throw new InvalidJobClickEligibilityError();
    }

    return { jobCount: data.clickTokenHashes.length };
  }

  async complete(userId: string, searchId: string) {
    await this.document(userId, searchId).delete();
  }

  private document(userId: string, searchId: string) {
    return this.getFirestore()
      .collection("users")
      .doc(userId)
      .collection("pointRewardEligibility")
      .doc(searchId);
  }
}

export const jobClickEligibility =
  new FirestoreJobClickEligibilityRepository();

