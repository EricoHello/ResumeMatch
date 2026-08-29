import { expect, test, type Page } from "@playwright/test";

import {
  createBrowserFile,
  createDocxResume,
  createPdfResume,
  DOCX_MIME_TYPE,
  DOCX_RESUME_TEXT,
  PDF_MIME_TYPE,
  PDF_RESUME_TEXT,
} from "../helpers/documents";

async function openUploader(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /choose or drop a resume file/i }),
  ).toBeVisible();
}

function uploadError(page: Page) {
  return page
    .getByRole("alert")
    .filter({ hasText: /Couldn’t process this resume/i });
}

test("uploads a real PDF and displays its extracted text", async ({ page }) => {
  await openUploader(page);

  await page.getByLabel("Upload resume").setInputFiles(
    createBrowserFile("ada-resume.pdf", PDF_MIME_TYPE, await createPdfResume()),
  );

  await expect(
    page.getByRole("heading", { name: "Extracted resume text" }),
  ).toBeVisible();
  const output = page.getByLabel("Extracted resume text");
  await expect(output).toContainText(PDF_RESUME_TEXT.name);
  await expect(output).toContainText(PDF_RESUME_TEXT.role);
  await expect(output).toContainText(PDF_RESUME_TEXT.skill);
});

test("uploads a real DOCX and displays its extracted text", async ({ page }) => {
  await openUploader(page);

  await page.getByLabel("Upload resume").setInputFiles(
    createBrowserFile(
      "grace-resume.docx",
      DOCX_MIME_TYPE,
      await createDocxResume(),
    ),
  );

  await expect(
    page.getByRole("heading", { name: "Extracted resume text" }),
  ).toBeVisible();
  const output = page.getByLabel("Extracted resume text");
  await expect(output).toContainText(DOCX_RESUME_TEXT.name);
  await expect(output).toContainText(DOCX_RESUME_TEXT.role);
  await expect(output).toContainText(DOCX_RESUME_TEXT.skill);
});

test("rejects an unsupported file and recovers on the next upload", async ({
  page,
}) => {
  await openUploader(page);

  await page.getByLabel("Upload resume").setInputFiles({
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not a supported resume format."),
  });

  await expect(uploadError(page)).toContainText(/PDF|DOCX|unsupported/i);

  await page.getByLabel("Upload resume").setInputFiles(
    createBrowserFile("ada-resume.pdf", PDF_MIME_TYPE, await createPdfResume()),
  );

  await expect(uploadError(page)).toHaveCount(0);
  await expect(page.getByLabel("Extracted resume text")).toContainText(
    PDF_RESUME_TEXT.name,
  );
});

test("reports a corrupt document and remains usable", async ({ page }) => {
  await openUploader(page);

  await page.getByLabel("Upload resume").setInputFiles({
    name: "corrupt.pdf",
    mimeType: PDF_MIME_TYPE,
    buffer: Buffer.from("%PDF-1.7\nThis is deliberately not a valid PDF."),
  });

  await expect(uploadError(page)).toContainText(/parse|read|invalid|failed/i);

  await page.getByLabel("Upload resume").setInputFiles(
    createBrowserFile(
      "grace-resume.docx",
      DOCX_MIME_TYPE,
      await createDocxResume(),
    ),
  );

  await expect(uploadError(page)).toHaveCount(0);
  await expect(page.getByLabel("Extracted resume text")).toContainText(
    DOCX_RESUME_TEXT.name,
  );
});
