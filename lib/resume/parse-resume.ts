import { ResumeParseError } from "./errors";
import { parseDocx } from "./parsers/docx";
import { parsePdf } from "./parsers/pdf";
import { normalizeResumeText } from "./text";
import type { ParsedResume, ResumeExtraction } from "./types";
import { validateResumeFile } from "./validation";

export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const validatedFile = await validateResumeFile(file);
  let extraction: ResumeExtraction;

  try {
    extraction =
      validatedFile.fileType === "pdf"
        ? await parsePdf(validatedFile.buffer)
        : await parseDocx(validatedFile.buffer);
  } catch {
    throw new ResumeParseError(
      "PARSING_FAILED",
      "We couldn't read text from this file. Try exporting it again as a PDF or DOCX.",
      422,
    );
  }

  const text = normalizeResumeText(extraction.text);

  if (!text) {
    throw new ResumeParseError(
      "NO_TEXT_FOUND",
      "No readable text was found in this file.",
      422,
    );
  }

  return {
    fileName: validatedFile.fileName,
    fileType: validatedFile.fileType,
    text,
    characterCount: text.length,
    ...(extraction.warnings.length > 0
      ? { warnings: extraction.warnings }
      : {}),
  };
}
