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
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "dotnet run --project backend/GymBro.Api --no-launch-profile",
      cwd: "..",
      url: "http://127.0.0.1:8100/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: apiEnv,
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
