// Entry times are local "HH:MM" strings on the entry's calendar date.
// ?now=HH:MM pins "now" (used for reproducible screenshots).
const pinned = typeof location !== "undefined" ? new URLSearchParams(location.search).get("now") : null;
export function nowHM(): string {
  if (pinned && /^\d{2}:\d{2}$/.test(pinned)) return pinned;
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
export const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** Gap that splits the timeline into visual clusters (no meal names). */
export const CLUSTER_GAP_MIN = 45;
