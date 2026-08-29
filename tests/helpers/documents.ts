import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const PDF_MIME_TYPE = "application/pdf";
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const PDF_RESUME_TEXT = {
  name: "Ada Lovelace",
  role: "Senior Software Engineer",
  skill: "TypeScript and distributed systems",
} as const;

export const DOCX_RESUME_TEXT = {
  name: "Grace Hopper",
  role: "Principal Computer Scientist",
  skill: "Compilers and systems architecture",
} as const;

export async function createPdfResume(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([612, 792]);

  page.drawText(PDF_RESUME_TEXT.name, {
    x: 54,
    y: 730,
    size: 22,
    font: boldFont,
  });
  page.drawText(PDF_RESUME_TEXT.role, {
    x: 54,
    y: 700,
    size: 13,
    font,
  });
  page.drawText(`Skills: ${PDF_RESUME_TEXT.skill}`, {
    x: 54,
    y: 665,
    size: 11,
    font,
  });

  return Buffer.from(await document.save());
}

export async function createDocxResume(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                bold: true,
                size: 32,
                text: DOCX_RESUME_TEXT.name,
              }),
            ],
          }),
          new Paragraph(DOCX_RESUME_TEXT.role),
          new Paragraph(`Skills: ${DOCX_RESUME_TEXT.skill}`),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}

export function createBrowserFile(
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  return { name, mimeType, buffer };
}
