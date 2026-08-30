# Firestore data model

ResumeMatch uses Firebase Authentication for identity and a server-mediated API for current preference reads and writes. The browser never chooses a user ID: `GET` and `PUT /api/preferences` verify a Firebase ID token, then derive the Firestore path from the decoded UID.

## Current persisted data

Authenticated preferences are stored at:

```text
users/{uid}/preferences/job
```

The document contains only:

```text
schemaVersion: 1
targetLocation: string
minimumSalary: integer
salaryCurrency: "USD"
salaryPeriod: "year"
createdAt: timestamp
updatedAt: timestamp
```

Guest preferences are stored in browser `sessionStorage` only. Uploaded resume files and extracted text remain in request/browser memory and are never written to Firestore.

At the final intake step, the UI assembles an in-memory `ResumeAnalysisInput` from the parsed resume and validated preferences. The server sends this data to Gemini for structured extraction. The returned profile stays in browser memory for the current flow and is not persisted by ResumeMatch.

## Session-only AI profile data

The current AI profile contains:

```text
summary: string
skills: string[]
experienceLevel: "entry" | "mid" | "senior" | "lead" | "executive" | "unknown"
recentJobTitles: string[]
targetRoles: string[]
searchKeywords: string[]
preferences.targetLocation: string
preferences.minimumSalary: integer
```

This profile prepares the data needed by a future job-search step. The current application does not search for jobs, score matches, or write the profile to Firestore.

## Reserved future persistence

If profile persistence is added later, AI-created resume profiles have the reserved path:

```text
users/{uid}/resumeProfiles/{profileId}
```

A future persisted profile could contain fields such as:

```text
summary: string
skills: string[]
experienceLevel: string
recentJobTitles: string[]
targetRoles: string[]
searchKeywords: string[]
analyzedAt: timestamp
```

This iteration does not create profile documents or empty placeholders. Firestore rules continue to deny all access to the reserved collection until persistence and its schema validation are implemented in a separate iteration.

## Security boundary

- Preference API calls require a verified Firebase ID token.
- The UID always comes from the verified token, never request JSON or query parameters.
- The API accepts only `targetLocation` and `minimumSalary` and applies strict validation.
- Firestore rules permit only owner-scoped access to the exact preference document and deny collection listing, deletion, cross-user access, and all unmatched paths.
- Firebase Admin operations bypass Firestore rules, so API authentication and validation remain mandatory.
