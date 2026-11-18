import { describe, expect, it } from "vitest";
import { dispositionName } from "../src/lib/download";

describe("dispositionName", () => {
  it("reads the UTF-8 name first", () => {
    expect(dispositionName("attachment; filename=gym-bro-export-2026-11-18.zip; filename*=UTF-8''gym-bro-export-2026-11-18.zip")).toBe("gym-bro-export-2026-11-18.zip");
    expect(dispositionName("attachment; filename*=UTF-8''m%C3%A5ltid.zip")).toBe("måltid.zip");
  });

  it("falls back to the plain name, quoted or not", () => {
    expect(dispositionName('attachment; filename="export.zip"')).toBe("export.zip");
    expect(dispositionName("attachment; filename=export.zip")).toBe("export.zip");
    expect(dispositionName("attachment; filename*=UTF-8''%E0%A4%A; filename=plain.zip")).toBe("plain.zip");
  });

  it("is null without a name", () => {
    expect(dispositionName(null)).toBeNull();
    expect(dispositionName("attachment")).toBeNull();
  });
});
