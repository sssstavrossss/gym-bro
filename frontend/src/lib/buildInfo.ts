/** "Build 421f4f3 · 16 Nov 2026". A build without a commit (a local dev server) reads "Build dev";
 * the date drops out when the build didn't record it. */
export function buildLabel(sha: string, builtAt: string): string {
  const parts: string[] = [];
  const short = sha.trim().slice(0, 7);
  parts.push(`Build ${short || "dev"}`);
  const date = builtAt ? new Date(builtAt) : null;
  if (date && !Number.isNaN(date.getTime())) {
    parts.push(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date));
  }
  return parts.join(" · ");
}
