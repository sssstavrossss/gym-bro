// Playwright sets these before the app boots. Production ignores X-Test-Oid
// unless the API was started with ASPNETCORE_ENVIRONMENT=E2e and E2E_AUTH=true.
export function e2eSession(): { oid: string } | null {
  try {
    if (sessionStorage.getItem("gymbro-e2e") !== "1") return null;
    const oid = sessionStorage.getItem("gymbro-e2e-oid");
    if (!oid) return null;
    return { oid };
  } catch {
    return null;
  }
}
