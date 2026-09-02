import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FirestoreJobClickEligibilityRepository,
  InvalidJobClickEligibilityError,
} from "@/lib/points/job-click-eligibility";

const NOW = Timestamp.fromDate(new Date("2026-09-01T12:00:00.000Z"));

function createFirestoreDouble() {
  let stored: Record<string, unknown> | undefined;
  const document = {
    create: vi.fn(async (data: Record<string, unknown>) => {
      stored = data;
    }),
    get: vi.fn(async () => ({
      exists: stored !== undefined,
      data: () => stored,
    })),
    delete: vi.fn(async () => {
      stored = undefined;
    }),
  };
  const firestore = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({ doc: vi.fn(() => document) })),
      })),
    })),
  };
  return { firestore, document, readStored: () => stored };
}

describe("FirestoreJobClickEligibilityRepository", () => {
  it("issues guest context without writing to Firestore", async () => {
    const double = createFirestoreDouble();
    const tokens = ["token-one", "token-two", "token-three"];
    const repository = new FirestoreJobClickEligibilityRepository(
      () => double.firestore as never,
      () => NOW,
      () => "search-123",
      () => tokens.shift() as string,
    );

    await expect(repository.issue(null, 3)).resolves.toEqual({
      searchId: "search-123",
      clickTokens: ["token-one", "token-two", "token-three"],
    });
    expect(double.firestore.collection).not.toHaveBeenCalled();
  });

  it("stores only token hashes for a signed-in eligible search", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestoreJobClickEligibilityRepository(
      () => double.firestore as never,
      () => NOW,
      () => "search-123",
      () => "private-click-token",
    );

    const context = await repository.issue("verified-user", 1);
    const stored = double.readStored();

    expect(context).toEqual({
      searchId: "search-123",
      clickTokens: ["private-click-token"],
    });
    expect(stored?.clickTokenHashes).toEqual([
      createHash("sha256")
        .update("private-click-token", "utf8")
        .digest("hex"),
    ]);
    expect(JSON.stringify(stored)).not.toContain("private-click-token");
  });

  it("accepts the issued card token and rejects another token", async () => {
    const double = createFirestoreDouble();
    const repository = new FirestoreJobClickEligibilityRepository(
      () => double.firestore as never,
      () => NOW,
      () => "search-123",
      () => "valid-click-token",
    );
    await repository.issue("verified-user", 1);

    await expect(
      repository.validate("verified-user", {
        searchId: "search-123",
        jobIndex: 0,
        clickToken: "valid-click-token",
      }),
    ).resolves.toEqual({ jobCount: 1 });
    await expect(
      repository.validate("verified-user", {
        searchId: "search-123",
        jobIndex: 0,
        clickToken: "invented-click-token",
      }),
    ).rejects.toBeInstanceOf(InvalidJobClickEligibilityError);
  });
});

