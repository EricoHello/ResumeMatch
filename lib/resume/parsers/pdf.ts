import { PDFParse } from "pdf-parse";

import type { ResumeExtraction } from "../types";

export async function parsePdf(buffer: Buffer): Promise<ResumeExtraction> {
  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();

    return {
      text: result.text,
      warnings: [],
    };
  } finally {
    // Cleanup errors must not obscure the useful parse result or its failure.
    await parser.destroy().catch(() => undefined);
  }
}
