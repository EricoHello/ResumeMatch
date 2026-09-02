import "server-only";

import type { ResumeMatchDataExport } from "./types";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

type FetchProvider = typeof fetch;

export class AccountDataEmailConfigurationError extends Error {
  constructor() {
    super("Account data email delivery is not configured.");
    this.name = "AccountDataEmailConfigurationError";
  }
}

export class AccountDataEmailDeliveryError extends Error {
  constructor() {
    super("Account data email delivery failed.");
    this.name = "AccountDataEmailDeliveryError";
  }
}

export class ResendAccountDataEmailSender {
  constructor(private readonly fetchProvider: FetchProvider = fetch) {}

  async send(recipient: string, dataExport: ResumeMatchDataExport) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();

    if (!apiKey || !from) {
      throw new AccountDataEmailConfigurationError();
    }

    const attachment = Buffer.from(
      `${JSON.stringify(dataExport, null, 2)}\n`,
      "utf8",
    ).toString("base64");

    let response: Response;

    try {
      response = await this.fetchProvider(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: "Your ResumeMatch data",
          text: [
            "Here is the copy of the data currently stored in your ResumeMatch account.",
            "The attached JSON file contains your saved preferences, extracted resume text, AI candidate profile, resume privacy setting, point totals, and point history.",
            "If you did not request this email, secure your Google account and contact ResumeMatch support.",
          ].join("\n\n"),
          attachments: [
            {
              filename: "resumematch-data.json",
              content: attachment,
            },
          ],
        }),
      });
    } catch {
      throw new AccountDataEmailDeliveryError();
    }

    if (!response.ok) {
      throw new AccountDataEmailDeliveryError();
    }
  }
}

export const accountDataEmailSender = new ResendAccountDataEmailSender();
