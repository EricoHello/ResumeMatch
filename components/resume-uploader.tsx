"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileRejection,
  useDropzone,
} from "react-dropzone";
import type { ParsedResume } from "@/lib/resume/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ACCEPTED_FILES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};

type Phase = "idle" | "uploading" | "parsing" | "success" | "error";

export type ResumeParseResult = ParsedResume;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rejectionMessage(rejections: FileRejection[]) {
  const firstError = rejections[0]?.errors[0];

  switch (firstError?.code) {
    case "file-too-large":
      return "That file is larger than 10 MiB. Choose a smaller resume and try again.";
    case "file-invalid-type":
      return "That file type isn’t supported. Choose a PDF or DOCX resume.";
    case "too-many-files":
      return "Upload one resume at a time.";
    default:
      return "We couldn’t use that file. Choose a PDF or DOCX resume under 10 MiB.";
  }
}

function responseError(responseText: string) {
  try {
    const body: unknown = JSON.parse(responseText);
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    // The fallback below covers empty or non-JSON responses.
  }

  return "We couldn’t extract text from this resume. Please try again.";
}

function parseResponse(responseText: string): ResumeParseResult | null {
  try {
    const body: unknown = JSON.parse(responseText);

    if (
      typeof body !== "object" ||
      body === null ||
      !("data" in body) ||
      typeof body.data !== "object" ||
      body.data === null
    ) {
      return null;
    }

    const data = body.data as Record<string, unknown>;
    if (
      typeof data.fileName !== "string" ||
      (data.fileType !== "pdf" && data.fileType !== "docx") ||
      typeof data.text !== "string"
    ) {
      return null;
    }

    return {
      fileName: data.fileName,
      fileType: data.fileType,
      text: data.text,
      characterCount:
        typeof data.characterCount === "number"
          ? data.characterCount
          : data.text.length,
      warnings: Array.isArray(data.warnings)
        ? data.warnings.filter(
            (warning): warning is string => typeof warning === "string",
          )
        : undefined,
    };
  } catch {
    return null;
  }
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M5.5 14.5v3A2.5 2.5 0 0 0 8 20h8a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2.75h6.25L18.5 8v11.25a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" />
      <path d="M13 3v5.25h5.25M8.75 13h6.5M8.75 16.5h6.5" />
    </svg>
  );
}

type ResumeUploaderProps = {
  onResultChange?: (result: ResumeParseResult | null) => void;
};

export function ResumeUploader({ onResultChange }: ResumeUploaderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ResumeParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upload = useCallback((file: File) => {
    const previousRequest = requestRef.current;
    requestRef.current = null;
    previousRequest?.abort();

    setSelectedFile(file);
    setResult(null);
    onResultChange?.(null);
    setError(null);
    setCopyState("idle");
    setUploadProgress(0);
    setPhase("uploading");

    const formData = new FormData();
    formData.append("resume", file, file.name);

    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/resumes/parse");

    const fail = (message: string) => {
      if (requestRef.current !== request) return;
      requestRef.current = null;
      setError(message);
      setPhase("error");
    };

    request.upload.addEventListener("progress", (event) => {
      if (requestRef.current !== request || !event.lengthComputable) return;

      const progress = Math.min(
        100,
        Math.round((event.loaded / event.total) * 100),
      );
      setUploadProgress(progress);
      if (progress === 100) setPhase("parsing");
    });

    request.upload.addEventListener("load", () => {
      if (requestRef.current !== request) return;
      setUploadProgress(100);
      setPhase("parsing");
    });

    request.addEventListener("load", () => {
      if (requestRef.current !== request) return;

      if (request.status < 200 || request.status >= 300) {
        fail(responseError(request.responseText));
        return;
      }

      const parsed = parseResponse(request.responseText);
      if (!parsed) {
        fail("The server returned an unexpected response. Please try again.");
        return;
      }

      requestRef.current = null;
      setResult(parsed);
      onResultChange?.(parsed);
      setPhase("success");
    });

    request.addEventListener("error", () => {
      fail("We couldn’t reach the server. Check your connection and try again.");
    });

    request.addEventListener("abort", () => {
      fail("The upload was cancelled.");
    });

    request.send(formData);
  }, [onResultChange]);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        setSelectedFile(null);
        setResult(null);
        onResultChange?.(null);
        setError(rejectionMessage(fileRejections));
        setPhase("error");
        return;
      }

      const file = acceptedFiles[0];
      if (file) upload(file);
    },
    [onResultChange, upload],
  );

  const isBusy = phase === "uploading" || phase === "parsing";
  const {
    getInputProps,
    getRootProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    accept: ACCEPTED_FILES,
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
    multiple: false,
    disabled: isBusy,
    onDrop,
  });

  const reset = useCallback(() => {
    const activeRequest = requestRef.current;
    requestRef.current = null;
    activeRequest?.abort();

    setPhase("idle");
    setUploadProgress(0);
    setSelectedFile(null);
    setResult(null);
    onResultChange?.(null);
    setError(null);
    setCopyState("idle");
  }, [onResultChange]);

  useEffect(() => {
    return () => {
      const activeRequest = requestRef.current;
      requestRef.current = null;
      activeRequest?.abort();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyText = async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  const dropzoneState = isDragReject
    ? "reject"
    : isDragAccept
      ? "accept"
      : isDragActive
        ? "active"
        : phase;

  const dropzoneTitle = isDragReject
    ? "This file isn’t supported"
    : isDragActive
      ? "Drop your resume to begin"
      : isBusy
        ? phase === "uploading"
          ? `Uploading… ${uploadProgress}%`
          : "Extracting resume text…"
        : phase === "success"
          ? "Upload another resume"
          : "Drop your resume here";

  return (
    <section className="uploader-card" aria-labelledby="uploader-heading">
      <div className="card-heading">
        <div>
          <p className="step-label">Step 1 of 2</p>
          <h2 id="uploader-heading" tabIndex={-1}>Upload your resume</h2>
        </div>
        <span className="format-badge">PDF · DOCX</span>
      </div>

      <div
        {...getRootProps({
          className: `dropzone dropzone--${dropzoneState}`,
          role: "button",
          "aria-label": `${dropzoneTitle}. Choose or drop a resume file.`,
        })}
      >
        <input {...getInputProps({ "aria-label": "Upload resume" })} />
        <span className="upload-icon">
          {isBusy ? <span className="spinner" /> : <UploadIcon />}
        </span>
        <div className="dropzone-copy">
          <p className="dropzone-title">{dropzoneTitle}</p>
          {!isBusy && (
            <p className="dropzone-help">
              Drag and drop, or <span>browse files</span>
            </p>
          )}
          <p className="dropzone-rules">PDF or DOCX · 10 MiB maximum</p>
        </div>

        {phase === "uploading" && (
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Resume upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadProgress}
          >
            <span style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {phase === "parsing" && (
          <div className="progress-track progress-track--indeterminate" aria-hidden="true">
            <span />
          </div>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {phase === "uploading" && `Uploading ${uploadProgress} percent.`}
        {phase === "parsing" && "Upload complete. Extracting resume text."}
        {phase === "success" && "Resume text extracted successfully."}
      </div>

      {selectedFile && (
        <div className="selected-file">
          <span className="file-icon">
            <FileIcon />
          </span>
          <span className="file-details">
            <strong title={selectedFile.name}>{selectedFile.name}</strong>
            <span>{formatFileSize(selectedFile.size)}</span>
          </span>
          {isBusy ? (
            <button className="text-button" type="button" onClick={reset}>
              Cancel
            </button>
          ) : (
            <span className={`file-status file-status--${phase}`}>
              {phase === "success" ? "Ready" : "Needs attention"}
            </span>
          )}
        </div>
      )}

      {phase === "error" && error && (
        <div className="notice notice--error" role="alert">
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <div>
            <strong>Couldn’t process this resume</strong>
            <p>{error}</p>
            <div className="notice-actions">
              {selectedFile && (
                <button type="button" onClick={() => upload(selectedFile)}>
                  Try again
                </button>
              )}
              <button type="button" onClick={reset}>
                Choose another file
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "success" && result && (
        <section className="result">
          <div className="result-heading">
            <div>
              <p className="success-label">
                <span aria-hidden="true">✓</span> Extraction complete
              </p>
              <h2 id="result-heading">Extracted resume text</h2>
            </div>
            <div className="result-actions">
              <button className="secondary-button" type="button" onClick={copyText}>
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "error"
                    ? "Copy failed"
                    : "Copy text"}
              </button>
              <button className="secondary-button" type="button" onClick={reset}>
                Start over
              </button>
            </div>
          </div>

          <div className="result-meta" aria-label="Extraction details">
            <span>{result.fileType.toUpperCase()}</span>
            <span>{result.characterCount.toLocaleString()} characters</span>
            <span title={result.fileName}>{result.fileName}</span>
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div className="notice notice--warning" role="status">
              <span className="notice-icon" aria-hidden="true">
                i
              </span>
              <div>
                <strong>Extraction note</strong>
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>
          )}

          <pre className="text-output" tabIndex={0} aria-label="Extracted resume text">
            {result.text}
          </pre>
          <p className="copy-feedback" role="status" aria-live="polite">
            {copyState === "copied" && "Text copied to your clipboard."}
            {copyState === "error" && "Couldn’t access your clipboard."}
          </p>
        </section>
      )}
    </section>
  );
}
