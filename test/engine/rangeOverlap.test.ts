// Release-time numeric-range overlap detection (issue #20, PR #21 review): dedicated coverage
// for order-independence and empty/contradictory-range handling in
// assertNoOverlappingAtomicRules()/extractNumericRange()/rangesOverlap(). Those helpers are not
// exported -- per this repo's Testing Decisions precedent, these tests assert only on
// buildRuleSetRelease()'s external behavior (throw / no-throw), never on internal representation.
// Synthetic, non-clinical fixtures only, constructed inline -- never committed to clinical/rules/.
import { describe, expect, it } from "vitest";
import { buildRuleSetRelease, OverlappingRuleConditionsError } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { RuleRevision } from "../../src/engine/types";

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/rangeOverlap.test.ts",
};

const FIELD = "test_only_numeric_field";

function syntheticRule(
  ruleId: string,
  diameterConditions: Array<{ field: string; op: string; value: number }>,
) {
  return rev({
    ruleId,
    revisionId: `${ruleId}-r1`,
    kind: "atomic-clinical-rule",
    recommendationSourceId: "test-only-range-overlap-source",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    measurementBasis: "diameter",
    diameterConditions,
    recommendation: {
      clinicalEndpoint: "test-only-not-a-real-recommendation",
      intervals: ["n/a"],
      rationale:
        "Synthetic fixture for release-time range-overlap testing only -- not real clinical content.",
    },
  });
}

describe("release-time numeric-range overlap: order-independence and empty ranges (issue #20 PR #21 review)", () => {
  it("a redundant strict+non-strict pair at the same boundary combines to the strict bound, regardless of declaration order", () => {
    const adjacent = syntheticRule("TEST-RANGE-ADJACENT", [{ field: FIELD, op: "lte", value: 8 }]);

    const gtThenGte = syntheticRule("TEST-RANGE-GT-THEN-GTE", [
      { field: FIELD, op: "gt", value: 8 },
      { field: FIELD, op: "gte", value: 8 },
      { field: FIELD, op: "lte", value: 20 },
    ]);
    const gteThenGt = syntheticRule("TEST-RANGE-GTE-THEN-GT", [
      { field: FIELD, op: "gte", value: 8 },
      { field: FIELD, op: "gt", value: 8 },
      { field: FIELD, op: "lte", value: 20 },
    ]);

    // Both orderings must combine to the strict `>8` lower bound -- neither may falsely overlap
    // a rule whose range ends exactly at 8 (inclusive). Before the order-independence fix, the
    // gt-then-gte order incorrectly widened the bound to inclusive.
    expect(() => buildRuleSetRelease([adjacent, gtThenGte])).not.toThrow();
    expect(() => buildRuleSetRelease([adjacent, gteThenGt])).not.toThrow();
  });

  it("a genuine overlap is detected the same way regardless of which order a rule declares its own conditions in", () => {
    const base = syntheticRule("TEST-RANGE-BASE", [
      { field: FIELD, op: "gte", value: 5 },
      { field: FIELD, op: "lte", value: 10 },
    ]);
    const overlapAscending = syntheticRule("TEST-RANGE-OVERLAP-ASC", [
      { field: FIELD, op: "gt", value: 8 },
      { field: FIELD, op: "lte", value: 15 },
    ]);
    const overlapDescending = syntheticRule("TEST-RANGE-OVERLAP-DESC", [
      { field: FIELD, op: "lte", value: 15 },
      { field: FIELD, op: "gt", value: 8 },
    ]);

    expect(() => buildRuleSetRelease([base, overlapAscending])).toThrow(
      OverlappingRuleConditionsError,
    );
    expect(() => buildRuleSetRelease([base, overlapDescending])).toThrow(
      OverlappingRuleConditionsError,
    );
  });

  it("eq combined with pre-existing bounds narrows to a single point -- overlapping a neighbor that contains it, not one that excludes it", () => {
    const exactlyTen = syntheticRule("TEST-RANGE-EQ", [
      { field: FIELD, op: "eq", value: 10 },
      { field: FIELD, op: "gte", value: 5 },
      { field: FIELD, op: "lte", value: 20 },
    ]);
    const containsTen = syntheticRule("TEST-RANGE-CONTAINS-TEN", [
      { field: FIELD, op: "gte", value: 8 },
      { field: FIELD, op: "lte", value: 12 },
    ]);
    const excludesTen = syntheticRule("TEST-RANGE-EXCLUDES-TEN", [
      { field: FIELD, op: "gte", value: 11 },
      { field: FIELD, op: "lte", value: 20 },
    ]);

    expect(() => buildRuleSetRelease([exactlyTen, containsTen])).toThrow(
      OverlappingRuleConditionsError,
    );
    expect(() => buildRuleSetRelease([exactlyTen, excludesTen])).not.toThrow();
  });

  it("a contradictory, empty range (e.g. gte 10 AND lte 5) never falsely overlaps another rule on the same field", () => {
    const impossible = syntheticRule("TEST-RANGE-EMPTY", [
      { field: FIELD, op: "gte", value: 10 },
      { field: FIELD, op: "lte", value: 5 },
    ]);
    const anyOther = syntheticRule("TEST-RANGE-ANY", [
      { field: FIELD, op: "gte", value: 0 },
      { field: FIELD, op: "lte", value: 100 },
    ]);

    expect(() => buildRuleSetRelease([impossible, anyOther])).not.toThrow();
  });
});
