import { defineConfig, devices } from "@playwright/test";

const configuredBaseUrl = process.env.BASE_URL?.replace(/\/$/, "");
const localBaseUrl = "http://127.0.0.1:3000";
const baseURL = configuredBaseUrl ?? localBaseUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "chrome"),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: configuredBaseUrl
    ? undefined
    : {
        command:
          "npm run build && npm run start -- --hostname 127.0.0.1 --port 3000",
        reuseExistingServer: true,
        timeout: 180_000,
        url: localBaseUrl,
      },
});
