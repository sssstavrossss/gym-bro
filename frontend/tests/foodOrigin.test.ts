import { describe, expect, it } from "vitest";
import { countryTag, foodTitle, isForeign, originLine, sourceName } from "../src/lib/foodOrigin";

const kylling = { source: "mvt", name: "Kylling, filet, rå", nameEn: "Chicken, fillet, raw", country: "NO" };
const kyckling = { source: "slv", name: "Kyckling bröstfilé rå", nameEn: "Chicken breast fillet raw", country: "SE" };
const mine = { source: "custom", name: "Mormors grøt", nameEn: null, country: null };

describe("food origin", () => {
  it("shows a home food by its own name with its English name on the second line", () => {
    expect(isForeign(kylling)).toBe(false);
    expect(foodTitle(kylling)).toBe("Kylling, filet, rå");
    expect(countryTag(kylling)).toBeNull();
    expect(originLine(kylling)).toBe("Chicken, fillet, raw · ");
  });

  it("shows another country's food by its English name, tagged with the country, naming its table", () => {
    expect(isForeign(kyckling)).toBe(true);
    expect(foodTitle(kyckling)).toBe("Chicken breast fillet raw");
    expect(countryTag(kyckling)).toBe("Sweden");
    expect(originLine(kyckling)).toBe("Livsmedelsverket · ");
  });

  it("treats the home country as given, so a Swedish home shows Norwegian foods as foreign", () => {
    expect(foodTitle(kyckling, "SE")).toBe("Kyckling bröstfilé rå");
    expect(countryTag(kylling, "SE")).toBe("Norway");
    expect(originLine(kylling, "SE")).toBe("Matvaretabellen · ");
  });

  it("keeps the own name when a foreign food has no English one, and own foods have no country", () => {
    expect(foodTitle({ ...kyckling, nameEn: " " })).toBe("Kyckling bröstfilé rå");
    expect(isForeign(mine)).toBe(false);
    expect(originLine(mine)).toBe("");
    expect(originLine({ ...kylling, nameEn: "Kylling, filet, rå" })).toBe("");
    expect(sourceName("unknown")).toBeNull();
  });
});
