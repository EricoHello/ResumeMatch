import { expect, test, type Page, type Request } from "@playwright/test";

import {
  createBrowserFile,
  createPdfResume,
  PDF_MIME_TYPE,
  PDF_RESUME_TEXT,
} from "../helpers/documents";

const PROFILE_DETAILS = {
  summary:
    "Senior software engineer with experience building reliable distributed systems.",
  skills: ["TypeScript", "Distributed systems", "API design"],
  experienceLevel: "senior",
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["TypeScript", "distributed systems", "platform engineering"],
} as const;

type AnalysisPreferences = {
  targetLocation: string;
  minimumSalary: number;
};

function analysisProfile(preferences: AnalysisPreferences) {
  return { ...PROFILE_DETAILS, preferences };
}

function watchJobSearchRequests(page: Page) {
  const requests: Request[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/") && /jobs?|matches/i.test(pathname)) {
      requests.push(request);
    }
  });

  return requests;
}

async function mockSuccessfulAnalysis(page: Page) {
  const requests: Request[] = [];

  await page.route("**/api/resumes/analyze", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      preferences: AnalysisPreferences;
    };
    requests.push(request);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: analysisProfile(body.preferences) }),
    });
  });

  return requests;
}

async function mockDeferredAnalysis(
  page: Page,
  preferences: AnalysisPreferences,
) {
  const requests: Request[] = [];
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route("**/api/resumes/analyze", async (route) => {
    requests.push(route.request());
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: analysisProfile(preferences) }),
    });
  });

  return { releaseResponse, requests };
}

function watchPreferenceRequests(page: Page) {
  const requests: Request[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/preferences") {
      requests.push(request);
    }
  });

  return requests;
}

async function enterGuestMode(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  await expect(page.getByText("Guest session", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Upload resume")).toBeAttached();
}

async function uploadPdfResume(page: Page) {
  await page.getByLabel("Upload resume").setInputFiles(
    createBrowserFile("ada-resume.pdf", PDF_MIME_TYPE, await createPdfResume()),
  );

  await expect(
    page.getByRole("heading", { name: "Extracted resume text" }),
  ).toBeVisible();
  await expect(page.getByLabel("Extracted resume text")).toContainText(
    PDF_RESUME_TEXT.name,
  );
  await expect(
    page.getByRole("heading", { name: "Job preferences" }),
  ).toBeVisible();
}

test("offers Google Sign-In and guest mode before showing the uploader", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Choose how to continue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue as Guest" }),
  ).toBeVisible();
  await expect(page.getByLabel("Upload resume")).toHaveCount(0);
});

test("shows analysis progress and completes the structured guest profile", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);
  const jobSearchRequests = watchJobSearchRequests(page);
  const analysis = await mockDeferredAnalysis(page, {
    targetLocation: "Seattle, WA",
    minimumSalary: 145000,
  });

  await enterGuestMode(page);
  await uploadPdfResume(page);

  const extractedText = page.getByLabel("Extracted resume text");
  await expect(extractedText).toContainText(PDF_RESUME_TEXT.role);
  await expect(extractedText).toContainText(PDF_RESUME_TEXT.skill);

  await expect(page.getByLabel("Target city or location")).toBeVisible();
  await expect(page.getByLabel("Minimum acceptable salary")).toBeVisible();
  await expect(page.getByText("Annual salary in USD.")).toBeVisible();

  await page.getByLabel("Target city or location").fill("Seattle, WA");
  await page.getByLabel("Minimum acceptable salary").fill("145000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  try {
    await expect(page.getByText("Step 3 of 3", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Analyzing your resume" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({
        hasText: "Gemini is analyzing your resume…",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Resume analysis progress" }),
    ).toBeVisible();
  } finally {
    analysis.releaseResponse();
  }

  await expect(
    page.getByRole("heading", {
      name: "Your resume is ready for the next step",
    }),
  ).toBeVisible();
  const success = page.getByRole("status").filter({
    hasText: "Analysis complete",
  });
  await expect(success).toContainText("Next: finding relevant jobs.");
  await expect(page.locator(".analysis-check")).toHaveText("✓");

  await expect(
    page.getByRole("heading", { name: "Resume profile preview" }),
  ).toBeVisible();
  await expect(page.getByText(PROFILE_DETAILS.summary)).toBeVisible();
  await expect(page.getByText("Senior", { exact: true })).toBeVisible();
  await expect(page.getByText("Seattle, WA", { exact: true })).toBeVisible();
  await expect(page.getByText("$145,000 / year", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Skills" })).toContainText(
    "TypeScript",
  );
  await expect(extractedText).toContainText(PDF_RESUME_TEXT.name);

  await expect.poll(() => analysis.requests.length).toBe(1);
  expect(analysis.requests[0].method()).toBe("POST");
  expect(analysis.requests[0].postDataJSON()).toEqual({
    resumeText: expect.stringContaining(PDF_RESUME_TEXT.name),
    preferences: {
      targetLocation: "Seattle, WA",
      minimumSalary: 145000,
    },
  });
  expect(preferenceRequests).toHaveLength(0);
  expect(jobSearchRequests).toHaveLength(0);
  await expect(
    page.getByRole("button", {
      name: /find (?:relevant )?jobs|search jobs|view job matches/i,
    }),
  ).toHaveCount(0);
});

test("validates guest preferences and leaves them editable after completion", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);
  const analysisRequests = await mockSuccessfulAnalysis(page);

  await enterGuestMode(page);
  await uploadPdfResume(page);

  const location = page.getByLabel("Target city or location");
  const salary = page.getByLabel("Minimum acceptable salary");
  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  const successHeading = page.getByRole("heading", {
    name: "Your resume is ready for the next step",
  });

  await location.fill("Remote");
  await continueButton.click();

  await expect(salary).toBeFocused();
  await expect(successHeading).toHaveCount(0);
  expect(
    await salary.evaluate((input) =>
      (input as HTMLInputElement).checkValidity(),
    ),
  ).toBe(false);

  await salary.fill("120000");
  await continueButton.click();
  await expect(successHeading).toBeVisible();

  await location.fill("New York, NY");
  await expect(successHeading).toHaveCount(0);
  await continueButton.click();

  await expect(successHeading).toBeVisible();
  await expect(location).toHaveValue("New York, NY");
  await expect(salary).toHaveValue("120000");
  await expect.poll(() => analysisRequests.length).toBe(2);
  expect(preferenceRequests).toHaveLength(0);
});

test("shows a safe analysis error and retries the request", async ({ page }) => {
  const preferenceRequests = watchPreferenceRequests(page);
  const jobSearchRequests = watchJobSearchRequests(page);
  const requests: Request[] = [];
  let releaseRetry = () => {};
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });

  await page.route("**/api/resumes/analyze", async (route) => {
    requests.push(route.request());

    if (requests.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ANALYSIS_UNAVAILABLE",
            message: "The analysis service is temporarily unavailable.",
          },
        }),
      });
      return;
    }

    await retryGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: analysisProfile({
          targetLocation: "Remote",
          minimumSalary: 125000,
        }),
      }),
    });
  });

  await enterGuestMode(page);
  await uploadPdfResume(page);
  await page.getByLabel("Target city or location").fill("Remote");
  await page.getByLabel("Minimum acceptable salary").fill("125000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Couldn’t analyze your resume" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "The analysis service is temporarily unavailable.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Try analysis again" }).click();
  try {
    await expect(
      page.getByRole("heading", { name: "Analyzing your resume" }),
    ).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
  } finally {
    releaseRetry();
  }

  await expect(
    page.getByRole("heading", {
      name: "Your resume is ready for the next step",
    }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(preferenceRequests).toHaveLength(0);
  expect(jobSearchRequests).toHaveLength(0);
});

test("restores guest preferences after a reload without persisting them to Firestore", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);
  const analysisRequests = await mockSuccessfulAnalysis(page);

  await enterGuestMode(page);
  await uploadPdfResume(page);

  await page.getByLabel("Target city or location").fill("Austin, TX");
  await page.getByLabel("Minimum acceptable salary").fill("135000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your resume is ready for the next step",
    }),
  ).toBeVisible();

  await page.reload();

  await expect(page.getByText("Guest session", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Upload resume")).toBeAttached();
  await uploadPdfResume(page);

  await expect(page.getByLabel("Target city or location")).toHaveValue(
    "Austin, TX",
  );
  await expect(page.getByLabel("Minimum acceptable salary")).toHaveValue(
    "135000",
  );
  await expect(
    page.getByRole("heading", {
      name: "Your resume is ready for the next step",
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your resume is ready for the next step",
    }),
  ).toBeVisible();
  await expect.poll(() => analysisRequests.length).toBe(2);
  expect(preferenceRequests).toHaveLength(0);
});
