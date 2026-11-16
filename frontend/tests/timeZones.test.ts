import { describe, expect, it } from "vitest";
import { allZones, searchZones, suggestedZones, zoneLabel, zoneOffset, zoneTime } from "../src/lib/timeZones";

describe("time zones", () => {
  const zones = ["Europe/London", "Europe/Oslo", "America/New_York", "Asia/Kolkata", "America/Argentina/Buenos_Aires"];

  it("finds cities by any word, city starts first", () => {
    expect(searchZones(zones, "oslo")).toEqual(["Europe/Oslo"]);
    expect(searchZones(zones, "new york")).toEqual(["America/New_York"]);
    expect(searchZones(zones, "europe")).toEqual(["Europe/London", "Europe/Oslo"]);
    expect(searchZones(zones, "buenos")).toEqual(["America/Argentina/Buenos_Aires"]);
    expect(searchZones(["Asia/Phnom_Penh", "America/Nome"], "no")).toEqual(["America/Nome", "Asia/Phnom_Penh"]);
    expect(searchZones(zones, "")).toEqual(zones);
  });

  it("labels zones and offsets", () => {
    expect(zoneLabel("America/New_York")).toBe("America/New York");
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(zoneOffset("Europe/Oslo", winter)).toBe("UTC+1");
    expect(zoneOffset("America/New_York", winter)).toBe("UTC−5");
    expect(zoneOffset("Asia/Kolkata", winter)).toBe("UTC+5:30");
    expect(zoneOffset("UTC", winter)).toBe("UTC+0");
    expect(zoneOffset("Not/AZone", winter)).toBe("");
    expect(zoneTime("Europe/Oslo", winter)).toBe("13:00");
  });

  it("suggests the current zone's region before a search", () => {
    expect(suggestedZones(zones, "Europe/Oslo")).toEqual(["Europe/London", "Europe/Oslo"]);
    expect(suggestedZones(zones, "UTC")).toEqual(zones);
  });

  it("always offers UTC", () => {
    expect(allZones()).toContain("UTC");
    expect(allZones()).toContain("Europe/Oslo");
  });
});
