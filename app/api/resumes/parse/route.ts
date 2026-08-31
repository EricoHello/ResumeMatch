import { NextResponse } from "next/server";

import { isMaintenanceMode, maintenanceResponse } from "@/lib/maintenance";
import {
  isResumeParseError,
  parseResumeFile,
  MAX_RESUME_FILE_SIZE,
  RESUME_FORM_FIELD,
  ResumeParseError,
} from "@/lib/resume";
import type {
  ParseResumeErrorResponse,
  ParseResumeSuccessResponse,
} from "@/lib/resume";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD = 512 * 1024;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(error: ResumeParseError) {
  const body: ParseResumeErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
    },
  };

  return NextResponse.json(body, {
    status: error.status,
    headers: RESPONSE_HEADERS,
  });
}

export async function POST(request: Request) {
  if (isMaintenanceMode()) {
    return maintenanceResponse();
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("multipart/form-data")) {
    return errorResponse(
      new ResumeParseError(
        "INVALID_FORM_DATA",
        "The upload could not be read. Send a multipart form with a resume file.",
        400,
      ),
    );
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESUME_FILE_SIZE + MAX_MULTIPART_OVERHEAD
  ) {
    return errorResponse(
      new ResumeParseError(
        "FILE_TOO_LARGE",
        "The selected file is larger than the 10 MB limit.",
        413,
      ),
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      new ResumeParseError(
        "INVALID_FORM_DATA",
        "The upload could not be read. Send a multipart form with a resume file.",
        400,
      ),
    );
  }

  const resumes = formData.getAll(RESUME_FORM_FIELD);
  const resume = resumes[0];

  if (resume === undefined) {
    return errorResponse(
      new ResumeParseError(
        "FILE_REQUIRED",
        "Choose a PDF or DOCX resume to upload.",
        400,
      ),
    );
  }

  if (resumes.length !== 1) {
    return errorResponse(
      new ResumeParseError(
        "INVALID_FILE",
        "Upload one resume at a time.",
        400,
      ),
    );
  }

  if (!(resume instanceof File)) {
    return errorResponse(
      new ResumeParseError(
        "INVALID_FILE",
        "The resume upload is not a valid file.",
        400,
      ),
    );
  }

  try {
    const data = await parseResumeFile(resume);
    const body: ParseResumeSuccessResponse = { data };

    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (isResumeParseError(error)) {
      return errorResponse(error);
    }

    return errorResponse(
      new ResumeParseError(
        "PARSING_FAILED",
        "We couldn't read text from this file. Try exporting it again as a PDF or DOCX.",
        422,
      ),
    );
  }
}
