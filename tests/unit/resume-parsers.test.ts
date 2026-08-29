import { describe, expect, it } from "vitest";

import { parseDocx } from "@/lib/resume/parsers/docx";
import { parsePdf } from "@/lib/resume/parsers/pdf";
import { normalizeResumeText } from "@/lib/resume/text";
import {
  createDocxResume,
  createPdfResume,
  DOCX_RESUME_TEXT,
  PDF_RESUME_TEXT,
} from "../helpers/documents";

describe("resume format parsers", () => {
  it("extracts text from a generated PDF", async () => {
    const extraction = await parsePdf(await createPdfResume());

    expect(extraction.text).toContain(PDF_RESUME_TEXT.name);
    expect(extraction.text).toContain(PDF_RESUME_TEXT.role);
    expect(extraction.text).toContain(PDF_RESUME_TEXT.skill);
    expect(extraction.warnings).toEqual(expect.any(Array));
  });

  it("extracts text from a generated DOCX", async () => {
    const extraction = await parseDocx(await createDocxResume());

    expect(extraction.text).toContain(DOCX_RESUME_TEXT.name);
    expect(extraction.text).toContain(DOCX_RESUME_TEXT.role);
    expect(extraction.text).toContain(DOCX_RESUME_TEXT.skill);
    expect(extraction.warnings).toEqual(expect.any(Array));
  });
});

describe("normalizeResumeText", () => {
  it("normalizes platform line endings and removes extraction artifacts", () => {
    expect(
      normalizeResumeText(
        "\uFEFF  Ada Lovelace  \r\n\r\n\r\n  TypeScript\u0000  \r\n",
      ),
    ).toBe("Ada Lovelace\n\nTypeScript");
  });
});
