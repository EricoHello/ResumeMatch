# ResumeMatch

The first working ResumeMatch ingestion pipeline. Upload a PDF or DOCX resume and review the normalized plain text extracted from it. AI parsing, scoring, job matching, authentication, and persistence are intentionally outside this iteration.

## What is included

- Drag-and-drop upload UI built with `react-dropzone`
- Real upload progress, parsing, success, and recovery states
- Server-side PDF extraction with `pdf-parse`
- Server-side DOCX extraction with `mammoth`
- Extension, MIME type, file signature, empty-file, and 10 MiB limit checks
- Stable API errors for unsupported, malformed, and textless files
- In-memory processing only; uploaded files and extracted text are not persisted
- Unit, route integration, and browser end-to-end tests using generated documents
- Railway Railpack configuration and a health endpoint

## Run locally

Node 24 is required. The repository includes an `.nvmrc` and an exact Node engine for deployment parity.

```bash
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then upload a PDF or DOCX resume.

## Verify

Run the static checks, parser/route tests, and production build:

```bash
npm run verify
```

Run the real browser upload-to-display tests:

```bash
npm run test:e2e
```

The local Playwright configuration uses Google Chrome by default. Set `PLAYWRIGHT_CHANNEL` to another installed Playwright channel, or install Chromium with `npx playwright install chromium`. Set `BASE_URL` to run the same suite against an existing local or deployed service.

```bash
BASE_URL=https://your-service.up.railway.app npm run test:e2e
```

All PDF and DOCX test files are generated in memory. No personal resume fixtures are stored in the repository.

## API

`POST /api/resumes/parse` accepts `multipart/form-data` with one field named `resume`.

Successful response:

```json
{
  "data": {
    "fileName": "resume.pdf",
    "fileType": "pdf",
    "text": "Extracted resume text...",
    "characterCount": 24
  }
}
```

Errors return a stable code and safe user-facing message:

```json
{
  "error": {
    "code": "UNSUPPORTED_FILE_TYPE",
    "message": "Upload a PDF or DOCX file."
  }
}
```

`GET /api/health` returns HTTP 200 when the service is ready.

## Deploy to Railway

1. Push this repository to GitHub and create a Railway service from the repository.
2. Railway reads `railway.json`, builds the Next.js app with Railpack, and runs `npm run start` on its injected `PORT`.
3. Generate a public domain in the service's Networking settings.
4. Open the domain and upload both a PDF and DOCX, or run the Playwright suite against it with `BASE_URL` as shown above.

No database, volume, secrets, or environment variables are required for this iteration. The configured `/api/health` check prevents an unhealthy release from receiving traffic.

## Current limitations

- Scanned or image-only PDFs need OCR, which is not included.
- Legacy `.doc` files are not DOCX and are rejected.
- Extraction returns normalized plain text rather than reconstructing document layout.
- Files are buffered in request memory and limited to 10 MiB.

The format-specific extractors and upload validation live under `lib/resume`; a later AI parser can consume their common normalized-text result without changing the upload boundary.
