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

At the final intake step, the UI can assemble the in-memory `ResumeAnalysisInput` type from the parsed resume and validated preferences. This is the handoff boundary for a later AI layer; nothing consumes or persists that payload in this iteration.

## Reserved AI profile data

Future AI-created resume profiles have the reserved path:

```text
users/{uid}/resumeProfiles/{profileId}
```

A future profile can contain fields such as:

```text
summary: string
skills: string[]
experienceLevel: string
recentJobTitles: string[]
targetRoles: string[]
searchKeywords: string[]
analyzedAt: timestamp
```

This iteration does not create profile documents, empty placeholders, or fake AI values. Firestore rules deny all access to the reserved collection until the AI feature and its schema validation are implemented.

## Security boundary

- Preference API calls require a verified Firebase ID token.
- The UID always comes from the verified token, never request JSON or query parameters.
- The API accepts only `targetLocation` and `minimumSalary` and applies strict validation.
- Firestore rules permit only owner-scoped access to the exact preference document and deny collection listing, deletion, cross-user access, and all unmatched paths.
- Firebase Admin operations bypass Firestore rules, so API authentication and validation remain mandatory.
