/** IANA zones the browser knows, with UTC included. A short fallback keeps old engines usable. */
export function allZones(): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) zones = ["Europe/London", "Europe/Oslo", "Europe/Athens", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** "America/New_York" reads as "America/New York". */
export function zoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

/** "UTC+1", "UTC+5:30", "UTC−5", "UTC+0" at the given moment. Empty when the engine can't tell. */
export function zoneOffset(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((item) => item.type === "timeZoneName")?.value ?? "";
    if (!part) return "";
    const offset = part.replace(/^GMT/, "");
    if (!offset) return "UTC+0";
    return `UTC${offset.replace("-", "−")}`;
  } catch {
    return "";
  }
}

/** "14:32" in the zone. */
export function zoneTime(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(at);
  } catch {
    return "";
  }
}

/**
 * Zones matching every word of the query, ignoring case, underscores and slashes.
 * A city that starts with the query comes first, then the rest in their usual order.
 */
export function searchZones(zones: readonly string[], query: string, limit = 50): string[] {
  const words = query.toLowerCase().replace(/[_/]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return zones.slice(0, limit);
  const hits = zones.filter((zone) => {
    const text = zone.toLowerCase().replace(/[_/]/g, " ");
    return words.every((word) => text.includes(word));
  });
  const first = words.join(" ");
  const city = (zone: string) => (zone.split("/").pop() ?? zone).toLowerCase().replace(/_/g, " ");
  return [...hits.filter((zone) => city(zone).startsWith(first)), ...hits.filter((zone) => !city(zone).startsWith(first))].slice(0, limit);
}

/** Before any search: the zones in the current zone's region (Europe/…), so the likely picks are on screen. */
export function suggestedZones(zones: readonly string[], current: string): string[] {
  const region = current.includes("/") ? current.split("/")[0] : "";
  if (!region) return zones.slice(0, 50);
  return zones.filter((zone) => zone.startsWith(`${region}/`));
}
