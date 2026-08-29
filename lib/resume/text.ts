/**
 * Produces predictable plain text without changing the document's paragraph
 * structure. This is intentionally separate from extraction so a structured or
 * AI-backed parser can be added later without changing the upload boundary.
 */
export function normalizeResumeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u000B\u000C\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u200B\uFEFF]/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
