import { defineConfig, devices } from "@playwright/test";

const apiEnv = {
  ...process.env,
  ASPNETCORE_ENVIRONMENT: "E2e",
  E2E_AUTH: "true",
  ASPNETCORE_URLS: "http://127.0.0.1:8100",
  Database__Provider: "postgres",
  Postgres__Host: "127.0.0.1",
  Postgres__Port: "5432",
  Postgres__Database: "gymbro",
  Postgres__Username: "gymbro",
  Postgres__Password: "gymbro",
};

export default defineConfig({
  testDir: ".",
  testMatch: "retro-a11y.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  webServer: [
    {
      command: "dotnet run --project backend/GymBro.Api --no-launch-profile",
      cwd: "../..",
      url: "http://127.0.0.1:8100/api/health",
      reuseExistingServer: true,
      timeout: 180_000,
      env: apiEnv,
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      cwd: "..",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: "http://127.0.0.1:5173" },
    },
    {
      name: "iphone-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        baseURL: "http://127.0.0.1:5173",
      },
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: "http://127.0.0.1:5173" },
    },
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 13"], baseURL: "http://127.0.0.1:5173" },
    },
  ],
});
