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
  // clinicalPathwayId must be one of the real closed-enum values (issue #17) -- this release is
  // built standalone in this test, never combined with the real GR-1/GR-2 release, so reusing a
  // real pathway id here is inert and does not affect any real clinical evaluation.
  clinicalPathwayId: "incidental-solitary-solid-initial",
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

// issue #26: a synthetic analog of the real ACR-FLEISCHNER-PARTSOLID-LT6MM / Candidate-C pair,
// proving the underlying mechanism (not anything specific to those two rule IDs) generalizes: a
// rule using the pre-existing measurementConventionId-only dispatch (field nodule_size_mm) and a
// rule using the new solidComponentMeasurementConventionId-only dispatch (field
// solid_component_size_mm, no measurementConventionId at all) condition on different fields, so
// release-time overlap validation cannot prove them non-overlapping -- but they are not actually
// mutually exclusive, so evaluate() must still throw AmbiguousRuleMatchError when both match.
// (Two solid-component-only rules cannot reproduce this: both would necessarily condition on the
// same solid_component_size_mm field, which release-time validation CAN and does correctly reject
// at build time -- see the "not mutually exclusive" note on the real-rule test in
// boundary.test.ts.)
const syntheticWholeNoduleOnlyRule = rev({
  ruleId: "TEST-AMBIGUITY-WHOLE-ONLY",
  revisionId: "TEST-AMBIGUITY-WHOLE-ONLY-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-ambiguity-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  measurementBasis: "diameter",
  measurementConventionId: "fleischner-2017-average-diameter",
  diameterConditions: [{ field: "nodule_size_mm", op: "lt", value: 6 }],
  recommendation: {
    clinicalEndpoint: "test-only-not-a-real-recommendation",
    intervals: ["n/a"],
    rationale: "Synthetic fixture for runtime ambiguity testing only -- not real clinical content.",
  },
});

const syntheticSolidComponentOnlyRule = rev({
  ruleId: "TEST-AMBIGUITY-SOLID-ONLY",
  revisionId: "TEST-AMBIGUITY-SOLID-ONLY-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-ambiguity-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  measurementBasis: "diameter",
  solidComponentMeasurementConventionId: "fleischner-2017-solid-component-long-axis",
  diameterConditions: [{ field: "solid_component_size_mm", op: "gt", value: 8 }],
  recommendation: {
    clinicalEndpoint: "test-only-not-a-real-recommendation",
    intervals: ["n/a"],
    rationale: "Synthetic fixture for runtime ambiguity testing only -- not real clinical content.",
  },
});

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

  it("issue #26: the new solid-component-only dispatch branch is not exempt from this guard -- release assembly does NOT reject a measurementConventionId-only rule paired with a solidComponentMeasurementConventionId-only rule on a different field (mirrors the real Rule-1/Candidate-C pair)", () => {
    expect(() =>
      buildRuleSetRelease([gate, applicability, syntheticWholeNoduleOnlyRule, syntheticSolidComponentOnlyRule]),
    ).not.toThrow();
  });

  it("issue #26: evaluate() throws AmbiguousRuleMatchError when both the measurementConventionId-only rule and the solidComponentMeasurementConventionId-only rule match the same input, rather than guessing -- the general mechanism, independent of the real clinical rule IDs", () => {
    const release = buildRuleSetRelease([
      gate,
      applicability,
      syntheticWholeNoduleOnlyRule,
      syntheticSolidComponentOnlyRule,
    ]);
    const input = {
      test_only_gate_field: "yes",
      test_only_app_field: true,
      nodule_size_mm: 5,
      nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
      solid_component_diameter_measurements: [
        { valueMm: 9, conventionId: "fleischner-2017-solid-component-long-axis" },
      ],
    } as unknown as ClinicalInputState;

    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });
});
