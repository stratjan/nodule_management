// issue #18 final spec review, correction 1: proves the exact commit-decision logic FieldInput
// (and App.tsx's solid-component input) rely on to reject decimal-mm authoring -- a pure
// predicate, tested directly without needing a component-rendering test harness (none exists in
// this repo; this mirrors the existing pure-predicate testing style already used for
// pathwayNavigation.ts).
import { describe, expect, it } from "vitest";
import { parseWholeMmDiameter } from "../../src/workflow/wholeMmInput";

describe("parseWholeMmDiameter", () => {
  it("accepts whole-mm values -- 6 and 7 are committable", () => {
    expect(parseWholeMmDiameter("6")).toBe(6);
    expect(parseWholeMmDiameter("7")).toBe(7);
  });

  it("rejects a fractional value -- 6.5 cannot be committed", () => {
    expect(parseWholeMmDiameter("6.5")).toBe("invalid");
  });

  it("rejects other fractional values, never rounding", () => {
    expect(parseWholeMmDiameter("6.1")).toBe("invalid");
    expect(parseWholeMmDiameter("0.9")).toBe("invalid");
  });

  it("treats an empty string as clearing the field, not an invalid entry", () => {
    expect(parseWholeMmDiameter("")).toBeUndefined();
  });

  it("rejects non-numeric and non-finite input", () => {
    expect(parseWholeMmDiameter("abc")).toBe("invalid");
    expect(parseWholeMmDiameter("Infinity")).toBe("invalid");
    expect(parseWholeMmDiameter("NaN")).toBe("invalid");
  });

  it("accepts zero and negative-sign-free whole values", () => {
    expect(parseWholeMmDiameter("0")).toBe(0);
  });
});
