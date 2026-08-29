import * as mammoth from "mammoth";

import type { ResumeExtraction } from "../types";

const CONVERSION_WARNING =
  "Some document elements could not be converted to plain text.";

export async function parseDocx(buffer: Buffer): Promise<ResumeExtraction> {
  const result = await mammoth.extractRawText({ buffer });
  const hasWarnings = result.messages.some(
    (message) => message.type === "warning" || message.type === "error",
  );

  return {
    text: result.value,
    warnings: hasWarnings ? [CONVERSION_WARNING] : [],
  };
}
