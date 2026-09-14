// issue #28/#15 Candidate B1: source-agnostic, synthetic-fixture coverage for the generic
// sufficientConditionGroups mechanism (bounded OR-of-AND inside one Atomic Clinical Rule) --
// mirrors ruleAmbiguity.test.ts's discipline of proving a general engine mechanism with
// non-clinical fixtures, never using Candidate B1's own real S3 rule as the only proof of the
// architecture.
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
  locator: "test/engine/sufficientConditionGroups.test.ts",
};

const gate = rev({
  ruleId: "TEST-GROUPS-GATE",
  revisionId: "TEST-GROUPS-GATE-r1",
  kind: "pathway-gate",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  // clinicalPathwayId must be one of the real closed-enum values (issue #17); this release is
  // built standalone in this test, never combined with the real Release, so reuse is inert.
  clinicalPathwayId: "incidental-solitary-solid-initial",
  conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
});

const applicability = rev({
  ruleId: "TEST-GROUPS-SAR",
  revisionId: "TEST-GROUPS-SAR-r1",
  kind: "source-applicability",
  recommendationSourceId: "test-only-groups-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
});

const groupedRule = rev({
  ruleId: "TEST-GROUPS-RULE",
  revisionId: "TEST-GROUPS-RULE-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-groups-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenanceAnchors: [
    { role: "test-only-role-a", provenance: syntheticProvenance },
    { role: "test-only-role-b", provenance: syntheticProvenance },
  ],
  sufficientConditionGroups: [
    {
      groupId: "group-a",
      conditions: [{ field: "test_only_field_a", op: "eq", value: true }],
      provenanceRole: "test-only-role-a",
    },
    {
      groupId: "group-b",
      conditions: [{ field: "test_only_field_b", op: "gt", value: 100 }],
      provenanceRole: "test-only-role-b",
    },
  ],
  recommendation: {
    noRoutineFollowUp: true,
    rationale: "Synthetic fixture for sufficientConditionGroups testing only -- not real clinical content.",
  },
});

// A genuinely separate, non-grouped Atomic Clinical Rule for the SAME source, standing in for a
// future Candidate B2: conditions on a different field, so release-time overlap validation cannot
// prove it non-overlapping with groupedRule, but it is not declared as convergent with it either.
const separateRule = rev({
  ruleId: "TEST-GROUPS-SEPARATE-RULE",
  revisionId: "TEST-GROUPS-SEPARATE-RULE-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-groups-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_separate_field", op: "eq", value: true }],
  recommendation: {
    clinicalEndpoint: "test-only-not-a-real-recommendation",
    intervals: ["n/a"],
    rationale: "Synthetic fixture standing in for a future, separately-governed rule (e.g. B2) -- not real clinical content.",
  },
});

const baseInput = {
  test_only_gate_field: "yes",
  test_only_app_field: true,
} as unknown as ClinicalInputState;

function outcomeFor(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "test-only-groups-source");
}

describe("sufficientConditionGroups generic reduction semantics (issue #28/#15 Candidate B1)", () => {
  const release = buildRuleSetRelease([gate, applicability, groupedRule]);

  it("1. group A MATCHED, group B INDETERMINATE (missing) -> RECOMMENDATION", () => {
    const trace = evaluate({ ...baseInput, test_only_field_a: true } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("RECOMMENDATION");
  });

  it("2. group A NOT_MATCHED, group B INDETERMINATE (missing) -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate({ ...baseInput, test_only_field_a: false } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("3. group A MATCHED, group B MATCHED -> RECOMMENDATION, both groupIds reported", () => {
    const trace = evaluate(
      { ...baseInput, test_only_field_a: true, test_only_field_b: 150 } as unknown as ClinicalInputState,
      release,
    );
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["group-a", "group-b"]);
  });

  it("4. group A MATCHED, group B NOT_MATCHED -> RECOMMENDATION", () => {
    const trace = evaluate(
      { ...baseInput, test_only_field_a: true, test_only_field_b: 50 } as unknown as ClinicalInputState,
      release,
    );
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["group-a"]);
  });

  it("5. all groups NOT_MATCHED -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate(
      { ...baseInput, test_only_field_a: false, test_only_field_b: 50 } as unknown as ClinicalInputState,
      release,
    );
    expect(outcomeFor(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("6. declaration-order audit: matchedSufficientConditionGroupIds preserves authored group order, never sorted or first-only", () => {
    const trace = evaluate(
      { ...baseInput, test_only_field_a: true, test_only_field_b: 150 } as unknown as ClinicalInputState,
      release,
    );
    const ids = outcomeFor(trace)?.recommendation?.matchedSufficientConditionGroupIds;
    expect(ids).toEqual(["group-a", "group-b"]);
    expect(ids?.length).toBe(2);
  });

  it("matchedRuleId/matchedRevisionId stay singular -- exactly one Atomic Clinical Rule matched, by construction", () => {
    const trace = evaluate(
      { ...baseInput, test_only_field_a: true, test_only_field_b: 150 } as unknown as ClinicalInputState,
      release,
    );
    const recommendation = outcomeFor(trace)?.recommendation;
    expect(recommendation?.matchedRuleId).toBe("TEST-GROUPS-RULE");
    expect(recommendation?.matchedRevisionId).toBe("TEST-GROUPS-RULE-r1");
  });

  it("no measurementBasisUsed or clinicalCriterionUsed is fabricated for a grouped match", () => {
    const trace = evaluate({ ...baseInput, test_only_field_a: true } as unknown as ClinicalInputState, release);
    const recommendation = outcomeFor(trace)?.recommendation;
    expect(recommendation?.measurementBasisUsed).toBeUndefined();
    expect(recommendation?.clinicalCriterionUsed).toBeUndefined();
  });
});

describe("7. cross-rule conflict preservation: convergence-grouping does not suppress AmbiguousRuleMatchError for a genuinely separate rule (issue #28)", () => {
  it("release assembly does NOT reject the pair -- different fields, not deterministically provable as overlapping", () => {
    expect(() => buildRuleSetRelease([gate, applicability, groupedRule, separateRule])).not.toThrow();
  });

  it("evaluate() still throws AmbiguousRuleMatchError when the grouped rule and a separate rule both match -- no special exception for convergence-grouping", () => {
    const release = buildRuleSetRelease([gate, applicability, groupedRule, separateRule]);
    const input = {
      ...baseInput,
      test_only_field_a: true,
      test_only_separate_field: true,
    } as unknown as ClinicalInputState;

    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });
});
