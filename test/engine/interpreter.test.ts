// Direct interpreter unit coverage for the new `gt` operator (issue #20). Exact values at and
// around the 8mm boundary, using normalized whole-mm values consistent with Fleischner's
// stated rounding convention.
import { describe, expect, it } from "vitest";
import { evaluateConditions } from "../../src/engine/interpreter";
import type { ClinicalInputState } from "../../src/engine/types";

describe("evaluateConditions: gt operator", () => {
  it("8mm does not satisfy gt 8", () => {
    const input: ClinicalInputState = { nodule_size_mm: 8 };
    const result = evaluateConditions([{ field: "nodule_size_mm", op: "gt", value: 8 }], input);
    expect(result.allFieldsPresent).toBe(true);
    expect(result.matched).toBe(false);
  });

  it("9mm satisfies gt 8", () => {
    const input: ClinicalInputState = { nodule_size_mm: 9 };
    const result = evaluateConditions([{ field: "nodule_size_mm", op: "gt", value: 8 }], input);
    expect(result.allFieldsPresent).toBe(true);
    expect(result.matched).toBe(true);
  });

  it("a missing field is reported via allFieldsPresent, same as every other operator", () => {
    const input: ClinicalInputState = {};
    const result = evaluateConditions([{ field: "nodule_size_mm", op: "gt", value: 8 }], input);
    expect(result.allFieldsPresent).toBe(false);
    expect(result.missingFields).toEqual(["nodule_size_mm"]);
  });
});
