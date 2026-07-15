import { describe, expect, it } from "vitest";
import { slugify } from "../src/server/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Northline Product Studio")).toBe("northline-product-studio");
  });

  it("strips diacritics and symbols", () => {
    expect(slugify("Café & Co.")).toBe("cafe-co");
  });

  it("trims leading/trailing separators and caps length", () => {
    expect(slugify("  --Apex Health--  ")).toBe("apex-health");
    expect(slugify("x".repeat(100))).toHaveLength(48);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugify("???")).toBe("");
  });
});
