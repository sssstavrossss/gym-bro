import { describe, expect, it } from "vitest";
import type { ProfileResponse } from "../src/api";
import { buildBody, convertFormUnits, formFromProfile } from "../src/state/profile";

const saved: ProfileResponse = {
  sex: "male",
  birthYear: 1990,
  heightCm: 182,
  activity: "moderate",
  goal: "lose",
  rateKgPerWeek: 0.5,
  goalWeightKg: 80,
  proteinSetting: "normal",
  proteinGramsPerKg: 2,
  fatSetting: "normal",
  fatPercent: 25,
  timeZone: "UTC",
  timeZoneFollowsDevice: true,
  weightUnit: "lb",
  heightUnit: "ftin",
};

function body(form: ReturnType<typeof formFromProfile>, from: ProfileResponse | null = saved) {
  const built = buildBody(form, from, 2026);
  if ("error" in built) throw new Error(built.error);
  return built.body;
}

describe("profile form in pounds and feet", () => {
  it("shows the saved values in the account's units", () => {
    const form = formFromProfile(saved);
    expect(form.goalWeight).toBe("176.4");
    expect(form.heightFt).toBe("5");
    expect(form.heightIn).toBe("11.7");
    expect(form.weightUnit).toBe("lb");
  });

  it("sends the saved kilograms and centimetres when they weren't edited", () => {
    const sent = body(formFromProfile(saved));
    expect(sent.goalWeightKg).toBe(80);
    expect(sent.heightCm).toBe(182);
  });

  it("converts what was typed", () => {
    const form = formFromProfile(saved);
    form.goalWeight = "165";
    form.heightFt = "6";
    form.heightIn = "";
    const sent = body(form);
    expect(sent.goalWeightKg).toBe(74.84);
    expect(sent.heightCm).toBe(182.9);
  });

  it("names the range in the shown unit", () => {
    const form = formFromProfile(saved);
    form.goalWeight = "700";
    expect(buildBody(form, saved, 2026)).toEqual({ error: "Goal weight should be between 66.2 and 661.3 lb, with one decimal." });
    form.goalWeight = "165";
    form.heightIn = "12";
    expect(buildBody(form, saved, 2026)).toEqual({ error: "Height should be between 3 ft 3.4 in and 8 ft 2.4 in." });
    form.heightIn = "11";
    form.rate = "0.3";
    expect(buildBody(form, saved, 2026)).toEqual({ error: "Choose a rate of 0.6, 1.1, 1.7, or 2.2 lb per week." });
  });

  it("switches units without drifting off the saved values", () => {
    const form = formFromProfile(saved);
    convertFormUnits(form, "kg", "cm", saved);
    expect(form.goalWeight).toBe("80");
    expect(form.heightCm).toBe("182");
    convertFormUnits(form, "lb", "ftin", saved);
    expect(form.goalWeight).toBe("176.4");
    expect(form.heightIn).toBe("11.7");
  });

  it("carries typed values across a switch before there is a profile", () => {
    const form = formFromProfile({ ...saved, weightUnit: "kg", heightUnit: "cm" });
    form.weighIn = "81.6";
    form.heightCm = "175";
    convertFormUnits(form, "lb", "ftin", null);
    expect(form.weighIn).toBe("179.9");
    expect(form.heightFt).toBe("5");
    expect(form.heightIn).toBe("8.9");
  });
});

describe("Setup switched to feet after typing centimetres", () => {
  it("sends the centimetres while the feet and inches still show them", () => {
    const form = formFromProfile({ ...saved, weightUnit: "kg", heightUnit: "cm" });
    form.heightCm = "180";
    convertFormUnits(form, "kg", "ftin", null);
    expect(body(form, null).heightCm).toBe(180);
    form.heightIn = "11";
    expect(body(form, null).heightCm).toBe(180.3);
  });
});
