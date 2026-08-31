import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/resumes/parse/route";
import {
  createDocxResume,
  createPdfResume,
  DOCX_MIME_TYPE,
  DOCX_RESUME_TEXT,
  PDF_MIME_TYPE,
  PDF_RESUME_TEXT,
} from "../helpers/documents";

const ENDPOINT = "http://localhost/api/resumes/parse";

function fileFromBuffer(buffer: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buffer)], name, { type });
}

function createUploadRequest(file?: File): Request {
  const formData = new FormData();
  if (file) {
    formData.set("resume", file);
  }

  return new Request(ENDPOINT, { method: "POST", body: formData });
}

describe("POST /api/resumes/parse", () => {
  beforeEach(() => {
    vi.stubEnv("MAINTENANCE_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns maintenance mode before reading or parsing an upload", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "true");

    const response = await POST(
      new Request(ENDPOINT, { method: "POST", body: "not multipart data" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MAINTENANCE_MODE",
        message: expect.stringContaining("currently in development"),
      },
    });
  });

  it("parses a generated PDF through the complete route", async () => {
    const file = fileFromBuffer(
      await createPdfResume(),
      "ada-resume.pdf",
      PDF_MIME_TYPE,
    );

    const response = await POST(createUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: expect.objectContaining({
        characterCount: expect.any(Number),
        fileName: "ada-resume.pdf",
        fileType: "pdf",
        text: expect.stringContaining(PDF_RESUME_TEXT.name),
      }),
    });
    expect(body.data.text).toContain(PDF_RESUME_TEXT.skill);
    expect(body.data.characterCount).toBe(body.data.text.length);
  });

  it("parses a generated DOCX through the complete route", async () => {
    const file = fileFromBuffer(
      await createDocxResume(),
      "grace-resume.docx",
      DOCX_MIME_TYPE,
    );

    const response = await POST(createUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        characterCount: expect.any(Number),
        fileName: "grace-resume.docx",
        fileType: "docx",
        text: expect.stringContaining(DOCX_RESUME_TEXT.name),
      }),
    );
    expect(body.data.text).toContain(DOCX_RESUME_TEXT.skill);
    expect(body.data.characterCount).toBe(body.data.text.length);
  });

  it("returns a stable error when the upload field is missing", async () => {
    const response = await POST(createUploadRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_REQUIRED",
        message: expect.any(String),
      },
    });
  });

  it("rejects unsupported file formats", async () => {
    const response = await POST(
      createUploadRequest(
        new File(["plain text"], "resume.txt", { type: "text/plain" }),
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNSUPPORTED_FILE_TYPE",
        message: expect.any(String),
      },
    });
  });

  it("rejects an extension whose contents do not match", async () => {
    const response = await POST(
      createUploadRequest(
        new File(["not a PDF"], "resume.pdf", { type: PDF_MIME_TYPE }),
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_TYPE_MISMATCH",
        message: expect.any(String),
      },
    });
  });

  it("reports a corrupt file that has a valid signature", async () => {
    const response = await POST(
      createUploadRequest(
        new File(
          ["%PDF-1.7\nThis is not a complete PDF."],
          "corrupt.pdf",
          { type: PDF_MIME_TYPE },
        ),
      ),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PARSING_FAILED",
        message: expect.any(String),
      },
    });
  });

  it("rejects files over the upload limit without parsing them", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(Buffer.from("%PDF-1.7"));
    const response = await POST(
      createUploadRequest(
        new File([oversized], "oversized.pdf", { type: PDF_MIME_TYPE }),
      ),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_TOO_LARGE",
        message: expect.any(String),
      },
    });
  });
});
