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

const JOB_MATCHES = [
  {
    id: "staff-one",
    title: "Staff Software Engineer",
    company: "Northstar Systems",
    location: "Seattle, WA",
    salary: "$165,000–$195,000 / year",
    applyUrl: "https://jobs.example.test/staff-one",
    postedAt: "2 days ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: ["TypeScript", "Distributed systems"],
  },
  {
    id: "platform-two",
    title: "Senior Platform Engineer",
    company: "Waypoint",
    location: "Remote — United States",
    salary: null,
    applyUrl: "https://jobs.example.test/platform-two",
    postedAt: "5 days ago",
    employmentType: "FULLTIME",
    isRemote: true,
    matchedSkills: ["API design"],
  },
  {
    id: "backend-three",
    title: "Senior Backend Engineer",
    company: "Atlas Cloud",
    location: "Bellevue, WA",
    salary: "$150,000 / year",
    applyUrl: "https://jobs.example.test/backend-three",
    postedAt: "1 week ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: ["TypeScript"],
  },
] as const;

type AnalysisPreferences = {
  targetLocation: string;
  additionalLocations: string[];
  radiusMiles: number;
  workArrangements: ("remote" | "hybrid" | "in_person")[];
  employmentTypes: (
    | "contract"
    | "full_time"
    | "part_time"
    | "seasonal"
  )[];
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

async function mockDeferredJobSearch(page: Page) {
  const requests: Request[] = [];
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route("**/api/jobs/search", async (route) => {
    requests.push(route.request());
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: JOB_MATCHES,
        searchedAt: "2026-08-30T16:00:00.000Z",
      }),
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

function watchSavedResumeRequests(page: Page) {
  const requests: Request[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/resumes/saved") {
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

test("switches color theme and keeps the choice after reload", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
});

test("shows guest Account details and returns to the active matching session", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);
  await mockSuccessfulAnalysis(page);

  await enterGuestMode(page);
  await uploadPdfResume(page);
  await page.getByLabel("Target city or location").fill("Remote");
  await page.getByLabel("Minimum acceptable salary").fill("95000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your resume is ready for the next step" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  const accountPage = page.getByLabel("Account", { exact: true });
  await expect(accountPage.getByText("Guest status")).toBeVisible();
  await expect(accountPage.getByText("Remote", { exact: true })).toBeVisible();
  await expect(accountPage.getByText("$95,000 / year", { exact: true })).toBeVisible();
  await expect(
    accountPage.getByText("Staff Software Engineer", { exact: true }),
  ).toBeVisible();
  await expect(
    accountPage.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to resume matching" }).click();
  await expect(
    page.getByRole("heading", { name: "Your resume is ready for the next step" }),
  ).toBeVisible();
  await expect(page.getByLabel("Extracted resume text")).toContainText(
    PDF_RESUME_TEXT.name,
  );
  expect(preferenceRequests).toHaveLength(0);
});

test("completes analysis and one live search for three guest job matches", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);
  const jobSearchRequests = watchJobSearchRequests(page);
  const jobSearch = await mockDeferredJobSearch(page);
  const analysis = await mockDeferredAnalysis(page, {
    targetLocation: "Seattle, WA",
    additionalLocations: ["Portland, OR"],
    radiusMiles: 50,
    workArrangements: ["hybrid"],
    employmentTypes: ["contract", "full_time"],
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
  await page.getByRole("button", { name: /add another city/i }).click();
  await page
    .getByRole("textbox", { name: "Additional city 1", exact: true })
    .fill("Portland, OR");
  for (let step = 0; step < 5; step += 1) {
    await page.getByLabel("Search radius").press("ArrowRight");
  }
  await page.getByRole("checkbox", { name: "Remote" }).uncheck();
  await page.getByRole("checkbox", { name: "In person" }).uncheck();
  await page.getByRole("checkbox", { name: "Part time" }).uncheck();
  await page.getByRole("checkbox", { name: "Seasonal" }).uncheck();
  await page.getByLabel("Minimum acceptable salary").fill("145000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  try {
    await expect(page.getByText("Step 3 of 4", { exact: true })).toBeVisible();
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
  await expect(
    page.getByText("Seattle, WA, Portland, OR · 50 mi radius", { exact: true }),
  ).toBeVisible();
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
      additionalLocations: ["Portland, OR"],
      radiusMiles: 50,
      workArrangements: ["hybrid"],
      employmentTypes: ["contract", "full_time"],
      minimumSalary: 145000,
    },
  });
  expect(preferenceRequests).toHaveLength(0);
  expect(jobSearchRequests).toHaveLength(0);

  await expect(page.getByText("Step 4 of 4", { exact: true })).toBeVisible();
  const findJobs = page.getByRole("button", { name: "Find 3 job matches" });
  await expect(findJobs).toBeVisible();
  await findJobs.click();

  try {
    await expect(
      page.getByRole("heading", { name: "Searching current jobs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Job search progress" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({
        hasText: "Finding and ranking relevant openings…",
      }),
    ).toBeVisible();
    await expect.poll(() => jobSearch.requests.length).toBe(1);
  } finally {
    jobSearch.releaseResponse();
  }

  await expect(
    page.getByRole("heading", { name: "3 relevant jobs found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Relevant job matches" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(page.getByText("Northstar Systems")).toBeVisible();
  await expect(page.getByText("Salary not listed")).toBeVisible();
  await expect(page.getByRole("link", { name: /view & apply/i })).toHaveCount(3);

  expect(jobSearchRequests).toHaveLength(1);
  expect(jobSearch.requests).toHaveLength(1);
  expect(jobSearch.requests[0].postDataJSON()).toEqual({
    profile: analysisProfile({
      targetLocation: "Seattle, WA",
      additionalLocations: ["Portland, OR"],
      radiusMiles: 50,
      workArrangements: ["hybrid"],
      employmentTypes: ["contract", "full_time"],
      minimumSalary: 145000,
    }),
  });
  expect(jobSearch.requests[0].postDataJSON()).not.toHaveProperty("resumeText");
  expect(analysis.requests).toHaveLength(1);
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
          additionalLocations: [],
          radiusMiles: 25,
          workArrangements: ["remote", "hybrid", "in_person"],
          employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
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
  const savedResumeRequests = watchSavedResumeRequests(page);
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
  expect(savedResumeRequests).toHaveLength(0);
});
