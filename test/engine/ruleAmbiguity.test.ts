// Runtime ambiguity guard (issue #20), using synthetic non-clinical fixtures only. Constructs a
// release where two Approved Atomic Clinical Rules for one source both match a given input in a
// way release-time validation cannot deterministically prove ahead of time (their conditions are
// on different fields, so releaseBuilder's same-field overlap check finds nothing to reject) --
// asserts evaluate() refuses to pick a winner.
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousRuleMatchError } from "../../src/engine/evaluate";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision } from "../../src/engine/types";

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/ruleAmbiguity.test.ts",
};

const gate = rev({
  ruleId: "TEST-AMBIGUITY-GATE",
  revisionId: "TEST-AMBIGUITY-GATE-r1",
  kind: "pathway-gate",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  clinicalPathwayId: "test-only-ambiguity-pathway",
  conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
});

const applicability = rev({
  ruleId: "TEST-AMBIGUITY-SAR",
  revisionId: "TEST-AMBIGUITY-SAR-r1",
  kind: "source-applicability",
  recommendationSourceId: "test-only-ambiguity-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
});

function syntheticAtomicRule(ruleId: string, field: string) {
  return rev({
    ruleId,
    revisionId: `${ruleId}-r1`,
    kind: "atomic-clinical-rule",
    recommendationSourceId: "test-only-ambiguity-source",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    measurementBasis: "diameter",
    diameterConditions: [{ field, op: "gte", value: 5 }],
    recommendation: {
      clinicalEndpoint: "test-only-not-a-real-recommendation",
      intervals: ["n/a"],
      rationale: "Synthetic fixture for runtime ambiguity testing only -- not real clinical content.",
    },
  });
}

const ruleA = syntheticAtomicRule("TEST-AMBIGUITY-RULE-A", "test_only_field_x");
const ruleB = syntheticAtomicRule("TEST-AMBIGUITY-RULE-B", "test_only_field_y");

describe("runtime ambiguity guard (issue #20)", () => {
  it("release assembly does NOT reject the pair -- different fields, not deterministically provable as overlapping", () => {
    expect(() => buildRuleSetRelease([gate, applicability, ruleA, ruleB])).not.toThrow();
  });

  it("evaluate() throws AmbiguousRuleMatchError when both rules match at runtime, rather than returning any outcome", () => {
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);
    const input = {
      test_only_gate_field: "yes",
      test_only_app_field: true,
      // Present so the (unrelated) legacy nodule_size_mm presence check does not itself produce
      // INSUFFICIENT_INPUT before either synthetic field is ever evaluated.
      nodule_size_mm: 999,
      test_only_field_x: 10,
      test_only_field_y: 10,
    } as unknown as ClinicalInputState;

    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });
});
