# ResumeMatch AI

ResumeMatch now supports the complete POC matching flow:

```text
Google Sign-In or Guest → Resume upload → Text extraction → Job preferences → AI resume profile → 3 live job matches
```

PDF and DOCX files are parsed into raw text. Signed-in users can load and save job preferences through a Firebase-authenticated Next.js API; guest preferences stay only in the current browser tab. The extracted text and preferences are sent once to the free-tier Gemini 3.5 Flash-Lite model. When the user starts a search, ResumeMatch combines that existing profile with the saved location and minimum salary in one JSearch request, then ranks and returns up to three current listings locally without running Gemini again.

## Included

- Optional Google Sign-In with Firebase Authentication
- Session-only guest mode with no guest Firestore writes
- Drag-and-drop PDF/DOCX upload with progress and recovery states
- Server-side PDF extraction with `pdf-parse` and DOCX extraction with `mammoth`
- Raw extracted-text display
- Target city/location and annual minimum salary questions
- Fast, structured AI resume parsing with Gemini 3.5 Flash-Lite
- One-request live job search through JSearch by OpenWeb Ninja
- Local relevance ranking using target roles, skills, location, recency, and available salary
- Three accessible job cards with direct view/apply links and graceful missing-salary handling
- Accessible processing, success, error, and retry states
- Owner-scoped Firestore preference persistence for signed-in users
- Strict API validation and Firebase ID-token verification
- Firestore rules and emulator tests for owner isolation and schema enforcement
- Session-only AI profile data with no resume-profile Firestore writes
- Railway configuration and health check

Uploaded files, extracted resume text, generated AI profiles, and job results are processed in memory and are not persisted by ResumeMatch. Only a compact search query derived from the structured profile is sent to JSearch; resume text is not sent to the job provider. On Gemini's free tier, Google states that submitted content may be used to improve its products; review the [Gemini API pricing and data-use details](https://ai.google.dev/gemini-api/docs/pricing) before using real personal data.

## Local setup

Node 24 is required. Install dependencies, then create `.env.local` from `.env.example`.

```bash
nvm use
npm ci
cp .env.example .env.local
```

Set the six `NEXT_PUBLIC_FIREBASE_*` values in `.env.local`. For local Firebase Admin access, set either:

```dotenv
FIREBASE_SERVICE_ACCOUNT_FILE=/absolute/path/to/firebase-adminsdk.json
```

or the full JSON object in `FIREBASE_SERVICE_ACCOUNT_JSON`. Never commit a service-account file or expose its contents through a `NEXT_PUBLIC_*` variable.

Set the free Gemini API key as a server-only variable:

```dotenv
GEMINI_API_KEY=your-google-ai-studio-key
```

Never prefix the Gemini key with `NEXT_PUBLIC_`; the browser calls the local analysis route and the key remains on the server.
Restrict the key to the Generative Language API in Google Cloud so it cannot be
used with unrelated Google APIs if it is ever exposed outside the application.

Set the OpenWeb Ninja key as a second server-only variable:

```dotenv
OPENWEBNINJA_API_KEY=your-openweb-ninja-key
```

Never prefix this key with `NEXT_PUBLIC_`. The browser calls ResumeMatch's local job-search route, so the provider credential is not sent to the client.

Job-search pipeline diagnostics are logged automatically in development. To temporarily enable the same safe diagnostics in Railway logs, set `JOB_SEARCH_DEBUG=true`. The logs include the generated query, raw and normalized job counts, the count remaining after relevance filtering, and top titles/scores; they never include API keys or resume text.

Start the app and open [http://localhost:3000](http://localhost:3000):

```bash
npm run dev
```

If the browser Firebase variables are omitted, Google Sign-In is disabled but guest mode remains available.

## Verification

Run application tests, static checks, and a production build:

```bash
npm run verify
```

Run the Firestore security suite with Java 21 or newer installed:

```bash
npm run test:rules
```

Run browser tests against a locally built production server:

```bash
npm run test:e2e
```

The Playwright suite generates PDF and DOCX fixtures in memory; no personal resume is stored in the repository. Set `BASE_URL` to test an existing local or deployed service.

```bash
BASE_URL=https://your-service.up.railway.app npm run test:e2e
```

## API

`POST /api/resumes/parse` accepts one `multipart/form-data` field named `resume` and returns normalized raw text. Files are validated by extension, MIME type, signature, content, and a 10 MiB limit.

`POST /api/resumes/analyze` accepts extracted resume text plus validated job preferences, makes one structured-output request to Gemini 3.5 Flash-Lite, and returns the session-only resume profile. The route has strict input limits and never returns the API key. Both signed-in and guest users can use it.

`POST /api/jobs/search` accepts the already-generated candidate profile, makes one broad request to JSearch's `search-v2` endpoint, and locally selects up to three results. The provider query uses the primary target role, one strongest non-duplicate search keyword, and the preferred location. Location, recency, and salary remain ranking preferences rather than hard filters; a missing salary is neutral rather than grounds for exclusion. The route does not invoke Gemini, accept raw resume text, or expose the OpenWeb Ninja key.

The AI and job-search routes include small per-client, in-process rate limits to reduce accidental
free-tier quota exhaustion. These are intentionally best-effort guards: they reset on
deploys and is not shared across Railway replicas. Use a durable shared limiter or
an edge protection layer before increasing public traffic or replica count.

`GET /api/preferences` loads the authenticated user's preferences. `PUT /api/preferences` validates and updates them. Both routes require a current Firebase ID token:

```http
Authorization: Bearer <firebase-id-token>
```

The backend verifies that token with Firebase Admin and derives the user ID from the decoded token. It never accepts a user ID from the request body or query string.

See [docs/firestore-data-model.md](docs/firestore-data-model.md) for the exact persisted schema and session-only AI-profile boundary.

## Firebase deployment

Deploy the checked-in Firestore rules to the Firebase project before enabling preference persistence in production:

```bash
npx firebase login
npx firebase deploy --only firestore:rules --project <firebase-project-id>
```

The checked-in `.firebaserc` intentionally names only a demo project used by emulator tests, so production deployment requires an explicit project selection.

## Railway deployment

Railway reads `railway.json`, builds the Next.js application with Railpack, starts it with the injected `PORT`, and checks `/api/health`.

Configure these variables on the Railway service:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` containing the complete service-account JSON object
- `GEMINI_API_KEY` containing a free-tier Google AI Studio API key
- `OPENWEBNINJA_API_KEY` containing the OpenWeb Ninja key for JSearch

The public Firebase variables must be present during the Railway build because Next.js embeds them in the browser bundle. The Admin credential is server-only and is read lazily at request time. Keep the Railway domain in Firebase Authentication's authorized-domain list.

After deployment, verify both formats and both access modes: Google Sign-In with preference save/load/update, and guest mode with no `/api/preferences` request. In both modes, confirm that AI processing reaches success and one explicit job search returns up to three view/apply links without exposing either server key in browser requests or bundles.

## Current boundaries

- Job results and profiles remain session-only; saved searches and applications are not implemented.
- The POC returns the strongest available current matches but does not guarantee that every listing publishes salary data.
- Scanned/image-only PDFs need OCR, which is not included.
- Legacy `.doc` files are rejected; only DOCX is supported.
- Extraction returns normalized plain text rather than reconstructing page layout.
- Uploads are buffered in request memory and limited to 10 MiB.
