import { describe, expect, it } from "vitest";
import { checkDigit, formatBarcode, fromScan, fromTyped, missCopy, steadyReader, upcEToUpcA, validGtin } from "../src/lib/barcode";

describe("check digit", () => {
  it("matches printed codes", () => {
    expect(checkDigit("703801000945")).toBe(7);
    expect(checkDigit("01234567890")).toBe(5);
    expect(checkDigit("9638507")).toBe(4);
    expect(validGtin("7038010009457")).toBe(true);
    expect(validGtin("7038010009458")).toBe(false);
    expect(validGtin("1234567")).toBe(false);
  });
});

describe("UPC-E", () => {
  it("writes each ending out as UPC-A", () => {
    expect(upcEToUpcA("04252614")).toBe("042100005264");
    expect(upcEToUpcA("01234531")).toBe("012300000451");
    expect(upcEToUpcA("01234541")).toBe("012340000051");
    expect(upcEToUpcA("01234565")).toBe("012345000065");
    expect(upcEToUpcA("21234565")).toBeNull();
  });
});

describe("fromScan", () => {
  it("keeps food formats with a correct check digit", () => {
    expect(fromScan("ean_13", "7038010009457")).toBe("7038010009457");
    expect(fromScan("ean_8", "96385074")).toBe("96385074");
    expect(fromScan("upc_a", "012345678905")).toBe("012345678905");
    expect(fromScan("upc_e", "04252614")).toBe("042100005264");
  });
  it("drops misreads and other formats", () => {
    expect(fromScan("ean_13", "7038010009458")).toBeNull();
    expect(fromScan("qr_code", "7038010009457")).toBeNull();
    expect(fromScan("code_128", "96385074")).toBeNull();
  });
});

describe("fromTyped", () => {
  it("takes 8 to 14 digits with spaces or dashes", () => {
    expect(fromTyped(" 7 038010 009457 ")).toBe("7038010009457");
    expect(fromTyped("9638-5074")).toBe("96385074");
    expect(fromTyped("1234567")).toBeNull();
    expect(fromTyped("123456789012345")).toBeNull();
    expect(fromTyped("70380a0009457")).toBeNull();
  });
});

describe("formatBarcode", () => {
  it("groups as printed", () => {
    expect(formatBarcode("7038010009457")).toBe("7 038010 009457");
    expect(formatBarcode("012345678905")).toBe("0 12345 67890 5");
    expect(formatBarcode("96385074")).toBe("9638 5074");
    expect(formatBarcode("12345678901234")).toBe("12345678901234");
  });
});

describe("steadyReader", () => {
  it("needs the same code twice in a row", () => {
    const read = steadyReader();
    expect(read("7038010009457")).toBeNull();
    expect(read(null)).toBeNull();
    expect(read("96385074")).toBeNull();
    expect(read("7038010009457")).toBeNull();
    expect(read("7038010009457")).toBe("7038010009457");
  });
});

describe("missCopy", () => {
  it("says why nothing was found", () => {
    expect(missCopy("not_found")).toBe("Not in the food list or on Open Food Facts.");
    expect(missCopy("rate_limited")).toContain("busy");
    expect(missCopy("unavailable")).toContain("Couldn't reach Open Food Facts");
    expect(missCopy("offline")).toContain("connection");
  });
});
