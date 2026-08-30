import { expect, test, type Page, type Request } from "@playwright/test";

import {
  createBrowserFile,
  createPdfResume,
  PDF_MIME_TYPE,
  PDF_RESUME_TEXT,
} from "../helpers/documents";

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

test("completes the guest intake flow without calling the preferences API", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);

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

  await expect(
    page.getByRole("heading", { name: "Ready for AI Analysis" }),
  ).toBeVisible();
  await expect(extractedText).toContainText(PDF_RESUME_TEXT.name);
  expect(preferenceRequests).toHaveLength(0);
});

test("validates guest preferences and leaves them editable after completion", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);

  await enterGuestMode(page);
  await uploadPdfResume(page);

  const location = page.getByLabel("Target city or location");
  const salary = page.getByLabel("Minimum acceptable salary");
  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  const readyHeading = page.getByRole("heading", {
    name: "Ready for AI Analysis",
  });

  await location.fill("Remote");
  await continueButton.click();

  await expect(salary).toBeFocused();
  await expect(readyHeading).toHaveCount(0);
  expect(
    await salary.evaluate((input) =>
      (input as HTMLInputElement).checkValidity(),
    ),
  ).toBe(false);

  await salary.fill("120000");
  await continueButton.click();
  await expect(readyHeading).toBeVisible();

  await location.fill("New York, NY");
  await expect(readyHeading).toHaveCount(0);
  await continueButton.click();

  await expect(readyHeading).toBeVisible();
  await expect(location).toHaveValue("New York, NY");
  await expect(salary).toHaveValue("120000");
  expect(preferenceRequests).toHaveLength(0);
});

test("restores guest preferences after a reload without persisting them to Firestore", async ({
  page,
}) => {
  const preferenceRequests = watchPreferenceRequests(page);

  await enterGuestMode(page);
  await uploadPdfResume(page);

  await page.getByLabel("Target city or location").fill("Austin, TX");
  await page.getByLabel("Minimum acceptable salary").fill("135000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ready for AI Analysis" }),
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
    page.getByRole("heading", { name: "Ready for AI Analysis" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ready for AI Analysis" }),
  ).toBeVisible();
  expect(preferenceRequests).toHaveLength(0);
});
