import { describe, expect, it } from "vitest";
import tsv from "../../backend/GymBro.Api/Profiles/zone-countries.tsv?raw";
import {
  allCountries,
  countryMovedText,
  countryName,
  countryTables,
  FOOD_COUNTRY_CODES,
  searchCountries,
} from "../src/lib/foodCountries";

describe("food countries", () => {
  it("offers the same countries the server accepts", () => {
    const lines = tsv.split("\n").filter((line: string) => line && !line.startsWith("#"));
    const server = [...new Set(lines.map((line: string) => line.split("\t")[1]))].sort();
    expect([...FOOD_COUNTRY_CODES]).toEqual(server);
  });

  it("names countries in English and lists them by name", () => {
    expect(countryName("SE")).toBe("Sweden");
    expect(countryName("NO")).toBe("Norway");
    const names = allCountries(["SE", "DK", "NO"]).map((row) => row.name);
    expect(names).toEqual(["Denmark", "Norway", "Sweden"]);
  });

  it("names each country's tables, or global foods where there is none", () => {
    expect(countryTables("NO")).toBe("Matvaretabellen · Kassalapp");
    expect(countryTables("SE")).toBe("Livsmedelsverket");
    expect(countryTables("FI")).toBe("Fineli");
    expect(countryTables("FR")).toBe("Global foods");
  });

  it("finds a country by the start of its name first, then within it, and by its code", () => {
    const rows = allCountries(["SE", "NO", "GB", "US", "FI"]);
    expect(searchCountries(rows, "sw").map((row) => row.code)).toEqual(["SE"]);
    expect(searchCountries(rows, "united").map((row) => row.code)).toEqual(["GB", "US"]);
    expect(searchCountries(rows, "land").map((row) => row.code)).toEqual(["FI"]);
    expect(searchCountries(rows, "no").map((row) => row.code)).toEqual(["NO"]);
    expect(searchCountries(rows, "  ")).toHaveLength(5);
    expect(searchCountries(allCountries(["CI"]), "cote")).toHaveLength(1);
  });

  it("says what a move to a new country changes", () => {
    expect(countryMovedText("SE")).toBe("In Sweden: Swedish foods first");
    expect(countryMovedText("FR")).toBe("In France: foods by their English names");
  });
});
