/** "Build 421f4f3 · 16 Nov 2026". Either part drops out when the build didn't record it. */
export function buildLabel(sha: string, builtAt: string): string {
  const parts: string[] = [];
  const short = sha.trim().slice(0, 7);
  if (short) parts.push(`Build ${short}`);
  const date = builtAt ? new Date(builtAt) : null;
  if (date && !Number.isNaN(date.getTime())) {
    parts.push(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date));
  }
  return parts.join(" · ");
}
