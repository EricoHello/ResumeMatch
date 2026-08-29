import { ResumeParseError } from "./errors";
import type { ResumeFileType, ValidatedResumeFile } from "./types";

export const RESUME_FORM_FIELD = "resume";
export const MAX_RESUME_FILE_SIZE = 10 * 1024 * 1024;

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const CONTENT_TYPES_ENTRY = Buffer.from("[Content_Types].xml", "utf8");
const WORD_DOCUMENT_ENTRY = Buffer.from("word/document.xml", "utf8");

const MIME_TYPES: Record<ResumeFileType, ReadonlySet<string>> = {
  pdf: new Set(["application/pdf", "application/x-pdf"]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
};

const NEUTRAL_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]);

function fileTypeFromExtension(fileName: string): ResumeFileType | undefined {
  const extension = /\.([^.]+)$/.exec(fileName.trim().toLowerCase())?.[1];

  if (extension === "pdf" || extension === "docx") {
    return extension;
  }

  return undefined;
}

function fileTypeFromMime(mimeType: string): ResumeFileType | undefined {
  const normalizedMime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (MIME_TYPES.pdf.has(normalizedMime)) {
    return "pdf";
  }

  if (MIME_TYPES.docx.has(normalizedMime)) {
    return "docx";
  }

  return undefined;
}

function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return false;
  }

  const third = buffer[2];
  const fourth = buffer[3];

  return (
    (third === 0x03 && fourth === 0x04) ||
    (third === 0x05 && fourth === 0x06) ||
    (third === 0x07 && fourth === 0x08)
  );
}

function hasPdfSignature(buffer: Buffer): boolean {
  // PDF readers commonly permit a short transport prefix before the header.
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(PDF_SIGNATURE);
}

function hasDocxSignature(buffer: Buffer): boolean {
  // DOCX is an OOXML ZIP package. Verifying its required entry names prevents a
  // generic ZIP renamed to .docx from reaching Mammoth.
  return (
    hasZipSignature(buffer) &&
    buffer.includes(CONTENT_TYPES_ENTRY) &&
    buffer.includes(WORD_DOCUMENT_ENTRY)
  );
}

export function detectResumeFileType(
  buffer: Buffer,
): ResumeFileType | undefined {
  if (hasDocxSignature(buffer)) {
    return "docx";
  }

  if (hasPdfSignature(buffer)) {
    return "pdf";
  }

  return undefined;
}

function safeFileName(fileName: string, fileType: ResumeFileType): string {
  const name = fileName
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

  return name ? name.slice(0, 255) : `resume.${fileType}`;
}

export async function validateResumeFile(
  file: File,
): Promise<ValidatedResumeFile> {
  if (file.size === 0) {
    throw new ResumeParseError(
      "EMPTY_FILE",
      "The selected file is empty.",
      400,
    );
  }

  if (file.size > MAX_RESUME_FILE_SIZE) {
    throw new ResumeParseError(
      "FILE_TOO_LARGE",
      "The selected file is larger than the 10 MB limit.",
      413,
    );
  }

  const extensionType = fileTypeFromExtension(file.name);
  const normalizedMime = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const mimeType = fileTypeFromMime(normalizedMime);

  if (
    (!extensionType && Boolean(/\.[^.]+$/.exec(file.name.trim()))) ||
    (!mimeType && !NEUTRAL_MIME_TYPES.has(normalizedMime)) ||
    (!extensionType && !mimeType)
  ) {
    throw new ResumeParseError(
      "UNSUPPORTED_FILE_TYPE",
      "Upload a PDF or DOCX file.",
      415,
    );
  }

  if (extensionType && mimeType && extensionType !== mimeType) {
    throw new ResumeParseError(
      "FILE_TYPE_MISMATCH",
      "The file contents do not match its PDF or DOCX file type.",
      415,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Re-check the bytes read rather than trusting mutable upload metadata.
  if (buffer.length === 0) {
    throw new ResumeParseError(
      "EMPTY_FILE",
      "The selected file is empty.",
      400,
    );
  }

  if (buffer.length > MAX_RESUME_FILE_SIZE) {
    throw new ResumeParseError(
      "FILE_TOO_LARGE",
      "The selected file is larger than the 10 MB limit.",
      413,
    );
  }

  const detectedType = detectResumeFileType(buffer);
  const declaredType = extensionType ?? mimeType;

  if (!detectedType || detectedType !== declaredType) {
    throw new ResumeParseError(
      "FILE_TYPE_MISMATCH",
      "The file contents do not match its PDF or DOCX file type.",
      415,
    );
  }

  return {
    buffer,
    fileName: safeFileName(file.name, detectedType),
    fileType: detectedType,
    size: buffer.length,
  };
}
