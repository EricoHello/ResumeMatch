import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AccountDataEmailConfigurationError,
  AccountDataEmailDeliveryError,
  ResendAccountDataEmailSender,
} from "@/lib/account/email";

const DATA_EXPORT = {
  schemaVersion: 2 as const,
  generatedAt: "2026-08-30T12:00:00.000Z",
  data: {
    savedPreferences: null,
    extractedResumeText: "Private extracted resume text.",
    aiCandidateProfile: null,
    privacySettings: { saveResumeData: true },
  },
};

describe("ResendAccountDataEmailSender", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "resend-secret-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "ResumeMatch <data@resumematch.test>");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the complete JSON export only to the supplied authenticated address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const sender = new ResendAccountDataEmailSender(fetchMock as typeof fetch);

    await sender.send("owner@example.test", DATA_EXPORT);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer resend-secret-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body)) as {
      to: string[];
      from: string;
      attachments: Array<{ filename: string; content: string }>;
    };
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.from).toBe("ResumeMatch <data@resumematch.test>");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe("resumematch-data.json");
    expect(
      JSON.parse(Buffer.from(body.attachments[0].content, "base64").toString()),
    ).toEqual(DATA_EXPORT);
  });

  it("fails closed when mail configuration is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    const sender = new ResendAccountDataEmailSender(fetchMock as typeof fetch);

    await expect(
      sender.send("owner@example.test", DATA_EXPORT),
    ).rejects.toBeInstanceOf(AccountDataEmailConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts provider and network failures to a safe delivery error", async () => {
    const providerFailure = new ResendAccountDataEmailSender(
      vi.fn().mockResolvedValue(new Response(null, { status: 422 })) as typeof fetch,
    );
    const networkFailure = new ResendAccountDataEmailSender(
      vi.fn().mockRejectedValue(new Error("private network detail")) as typeof fetch,
    );

    await expect(
      providerFailure.send("owner@example.test", DATA_EXPORT),
    ).rejects.toEqual(new AccountDataEmailDeliveryError());
    await expect(
      networkFailure.send("owner@example.test", DATA_EXPORT),
    ).rejects.toEqual(new AccountDataEmailDeliveryError());
  });
});
