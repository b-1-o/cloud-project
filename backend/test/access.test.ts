import { describe, expect, it } from "vitest";
import { canEdit, canRead, normalizeTitle } from "../src/access";

describe("document permissions", () => {
  it("lets only owners and editors change documents", () => {
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(canEdit("admin")).toBe(false);
  });
  it("rejects unknown read roles", () => {
    expect(canRead("viewer")).toBe(true);
    expect(canRead("unknown")).toBe(false);
  });
  it("normalizes title length and empty input", () => {
    expect(normalizeTitle("  Meeting notes ")).toBe("Meeting notes");
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("x".repeat(140))).toHaveLength(120);
    expect(normalizeTitle(42)).toBeNull();
  });
});
