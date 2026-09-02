# Firestore data model

ResumeMatch uses Firebase Authentication for identity and server-mediated APIs for account data. The browser never chooses a user ID: every account route verifies a Firebase ID token and derives the Firestore path from its decoded UID.

## Current persisted data

Authenticated job preferences are stored at:

```text
users/{uid}/preferences/job
```

The current schema contains:

```text
schemaVersion: 4
targetLocation: string
additionalLocations: string[]
radiusMiles: integer
workArrangements: ("remote" | "hybrid" | "in_person")[]
employmentTypes: ("contract" | "full_time" | "part_time" | "seasonal")[]
minimumSalary: integer
salaryCurrency: "USD"
salaryPeriod: "year"
createdAt: timestamp
updatedAt: timestamp
```

The latest saved resume state is stored at:

```text
users/{uid}/resumeProfiles/current
```

It contains normalized extracted resume text and the latest AI candidate profile, when one has been generated. The original PDF or DOCX file is never stored.

```text
schemaVersion: 1
resumeText: string
profile: ResumeProfile | null
createdAt: timestamp
updatedAt: timestamp
```

The signed-in user's resume-storage choice is stored at:

```text
users/{uid}/settings/privacy
```

```text
schemaVersion: 1
saveResumeData: boolean
createdAt: timestamp
updatedAt: timestamp
```

If this document does not exist, `saveResumeData` defaults to `true`. When it is `false`, new resume text and AI profiles remain in the current page session. Job preferences continue to save normally. Resume writes read this setting within the same Firestore transaction as the write, so a concurrent setting change prevents a stale write from committing.

Guest preferences are stored in browser `sessionStorage`. Guest resume text and profiles stay in the current page session and are never written to Firestore.

## Points and rewards

```text
users/{uid}
  points: {
    schemaVersion: 1,
    balance: number,
    totalEarned: number,
    totalSpent: number,
    updatedAt: timestamp
  }

users/{uid}/pointHistory/{sha256(kind + idempotencyKey)}
  schemaVersion: 1
  kind: "earn" | "spend"
  action: string
  amount: number
  description: string
  idempotencyKey: string
  timestamp: timestamp

users/{uid}/pointRewardEligibility/{searchId}
  schemaVersion: 1
  clickTokenHashes: string[]
  createdAt: timestamp
  expiresAt: timestamp
```

`earnPoints` and `spendPoints` are server-only functions. Each mutation runs in one Firestore transaction so the aggregate balance and ledger cannot diverge. The deterministic history document ID makes a stable action occurrence safe to retry; reusing its idempotency key returns the original event without applying the amount again. Ordinary spends require enough balance. A trusted post-paid operation may explicitly allow a negative balance, but no current feature does so.

`GET /api/points` returns the authenticated user's aggregate totals and 50 most recent history entries. It does not expose a generic mutation endpoint.

Guest points use session storage plus an in-memory fallback and are cleared with the guest session. They are never written to Firestore.

Each successful live job search receives one opaque reward token per displayed card. For signed-in users, only token hashes and a 24-hour expiration are stored; job titles, companies, URLs, and other result data are not persisted. `POST /api/points/job-click` verifies the authenticated user, search, card index, and token before awarding 10 points. The three card-specific ledger keys prevent repeat awards, and the all-three ledger key grants the 5-point bonus only once. Completed eligibility is deleted after the bonus; incomplete records are safe to remove after `expiresAt`.

## Account data actions

`POST /api/account/data` reads the current preference, saved-resume, privacy, and points data, builds a JSON export containing `savedPreferences`, `extractedResumeText`, `aiCandidateProfile`, `privacySettings`, and `points`, and emails it only to the verified email address in the authenticated Firebase token. The client cannot provide or override the recipient.

`DELETE /api/resumes/saved` deletes only `users/{uid}/resumeProfiles/current`. It is used when a user turns resume saving off and chooses to remove the previously stored resume text and AI profile. Preferences and the privacy setting are not deleted.

`DELETE /api/account/data` recursively deletes the complete Firestore subtree rooted at `users/{uid}`, where `uid` comes only from the verified token. This covers the current documents and any future nested ResumeMatch documents. It does not delete the user's Google or Firebase Authentication identity.

## Security boundary

- Preference, saved-resume, privacy-setting, points, export, and deletion API calls require a verified Firebase ID token.
- The UID always comes from the verified token, never request JSON, query parameters, or a browser-selected path.
- Data exports require a verified email claim and use it as the sole recipient.
- The preference, privacy-setting, and saved-resume APIs apply strict schema and size validation.
- Firestore rules allow owner-scoped reads of preferences, point aggregates, and point history. Point writes, reward eligibility, and resume profiles remain server-managed; unmatched paths are denied.
- Firebase Admin operations bypass Firestore rules, so API authentication, validation, and exact path construction remain mandatory.
