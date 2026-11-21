import { describe, expect, it } from "vitest";
import { countryTag, foodTitle, isForeign, originLine, sourceName } from "../src/lib/foodOrigin";

const kylling = { source: "mvt", name: "Kylling, filet, rå", nameEn: "Chicken, fillet, raw", country: "NO" };
const kyckling = { source: "slv", name: "Kyckling bröstfilé rå", nameEn: "Chicken breast fillet raw", country: "SE" };
const kana = { source: "fineli", name: "Broileri, rintafilee, paistettu", nameEn: "Chicken breast fillet, fried", country: "FI" };
const mine = { source: "custom", name: "Mormors grøt", nameEn: null, country: null };

describe("food origin", () => {
  it("shows a home food by its own name with its English name on the second line", () => {
    expect(isForeign(kylling, "NO")).toBe(false);
    expect(foodTitle(kylling, "NO")).toBe("Kylling, filet, rå");
    expect(countryTag(kylling, "NO")).toBeNull();
    expect(originLine(kylling, "NO")).toBe("Chicken, fillet, raw · ");
  });

  it("shows another country's food by its English name, tagged with the country, naming its table", () => {
    expect(isForeign(kyckling, "NO")).toBe(true);
    expect(foodTitle(kyckling, "NO")).toBe("Chicken breast fillet raw");
    expect(countryTag(kyckling, "NO")).toBe("Sweden");
    expect(originLine(kyckling, "NO")).toBe("Livsmedelsverket · ");
  });

  it("names Fineli and Finland for a Finnish food", () => {
    expect(countryTag(kana, "NO")).toBe("Finland");
    expect(originLine(kana, "NO")).toBe("Fineli · ");
  });

  it("treats the home country as given, so a Swedish home shows Norwegian foods as foreign", () => {
    expect(foodTitle(kyckling, "SE")).toBe("Kyckling bröstfilé rå");
    expect(countryTag(kylling, "SE")).toBe("Norway");
    expect(originLine(kylling, "SE")).toBe("Matvaretabellen · ");
  });

  it("keeps the own name when a foreign food has no English one, and own foods have no country", () => {
    expect(foodTitle({ ...kyckling, nameEn: " " }, "NO")).toBe("Kyckling bröstfilé rå");
    expect(isForeign(mine, "NO")).toBe(false);
    expect(originLine(mine, "NO")).toBe("");
    expect(originLine({ ...kylling, nameEn: "Kylling, filet, rå" }, "NO")).toBe("");
    expect(sourceName("unknown")).toBeNull();
  });
});
