// issue #15 Candidate A0: targeted engine-dispatch coverage for the clinical-condition-shaped
// Atomic Clinical Rule branch in evaluateSingleAtomicRule() (no measurementBasis, a bounded
// `conditions` array). Verifies the true/false/missing dispatch directly, that no measurement
// input is ever required to reach RECOMMENDATION, that no measurementBasisUsed is fabricated, and
// that every existing measurement-shaped rule's measurementBasisUsed/measurementsUsed output is
// exactly unchanged by this addition (final review #5605350412's regression requirement).
//
// issue #28/#15 Candidate B1: this generic bare-`conditions` dispatch branch is proven with a
// synthetic, non-clinical fixture -- not the real S3 rule -- because the live test release's own
// S3/GR-4 rule is now sufficientConditionGroups-shaped (ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT
// supersedes the bare-conditions-shaped ACR-S3-FOLLOWUP-VOLUME-STABLE in the active build set).
// The bare-`conditions` dispatch code itself is unmodified and remains real, tested, and reachable
// (any future bare-conditions-shaped rule, and every historical Release still embedding
// ACR-S3-FOLLOWUP-VOLUME-STABLE-r1 -- see historicalA0Regression.test.ts).
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { loadTestRelease } from "../helpers/loadTestRelease";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision } from "../../src/engine/types";

const release = loadTestRelease();

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/clinicalConditionRule.test.ts",
};

const syntheticGate = rev({
  ruleId: "TEST-COND-GATE",
  revisionId: "TEST-COND-GATE-r1",
  kind: "pathway-gate",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  clinicalPathwayId: "incidental-solitary-solid-initial",
  conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
});

const syntheticApplicability = rev({
  ruleId: "TEST-COND-SAR",
  revisionId: "TEST-COND-SAR-r1",
  kind: "source-applicability",
  recommendationSourceId: "test-only-condition-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
});

const syntheticConditionRule = rev({
  ruleId: "TEST-COND-RULE",
  revisionId: "TEST-COND-RULE-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-condition-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_criterion", op: "eq", value: true }],
  recommendation: {
    noRoutineFollowUp: true,
    rationale: "Synthetic fixture for bare-conditions dispatch testing only -- not real clinical content.",
  },
});

const conditionRelease = buildRuleSetRelease([syntheticGate, syntheticApplicability, syntheticConditionRule]);
const conditionBaseInput = {
  test_only_gate_field: "yes",
  test_only_app_field: true,
} as unknown as ClinicalInputState;

function conditionOutcomeFor(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "test-only-condition-source");
}

describe("clinical-condition-shaped Atomic Clinical Rule dispatch (issue #15 Candidate A0, generic/synthetic per issue #28)", () => {
  it("true -> RECOMMENDATION", () => {
    const trace = evaluate({ ...conditionBaseInput, test_only_criterion: true } as unknown as ClinicalInputState, conditionRelease);
    const outcome = conditionOutcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedRuleId).toBe("TEST-COND-RULE");
  });

  it("false -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate({ ...conditionBaseInput, test_only_criterion: false } as unknown as ClinicalInputState, conditionRelease);
    expect(conditionOutcomeFor(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("missing -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate(conditionBaseInput, conditionRelease);
    expect(conditionOutcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("no diameter or volume input is required to reach RECOMMENDATION -- the input carries neither field at all", () => {
    const input = { ...conditionBaseInput, test_only_criterion: true } as unknown as ClinicalInputState;
    expect(input.nodule_size_mm).toBeUndefined();
    expect(input.nodule_volume_mm3).toBeUndefined();
    const trace = evaluate(input, conditionRelease);
    expect(conditionOutcomeFor(trace)?.state).toBe("RECOMMENDATION");
  });

  it("no measurementBasisUsed or measurementsUsed is fabricated; clinicalCriterionUsed is the exact closed value", () => {
    const trace = evaluate({ ...conditionBaseInput, test_only_criterion: true } as unknown as ClinicalInputState, conditionRelease);
    const recommendation = conditionOutcomeFor(trace)?.recommendation;
    expect(recommendation?.measurementBasisUsed).toBeUndefined();
    expect(recommendation?.measurementsUsed).toBeUndefined();
    expect(recommendation?.clinicalCriterionUsed).toBe("clinician-attestation");
  });

  it("the OUTSIDE_CURRENT_RULESET_SCOPE outcome carries no recommendation and no complement-inferred content", () => {
    const trace = evaluate({ ...conditionBaseInput, test_only_criterion: false } as unknown as ClinicalInputState, conditionRelease);
    expect(conditionOutcomeFor(trace)?.recommendation).toBeUndefined();
  });
});

describe("existing measurement-shaped rules emit exactly the same payload shape as before (regression)", () => {
  const solidInitialInput: ClinicalInputState = {
    nodule_morphology: "solid",
    assessment_context: "incidental",
    assessment_timepoint: "initial",
    nodule_count: 1,
    age: 55,
    known_malignancy_history: false,
    immunocompromised: false,
    nodule_size_mm: 7,
    nodule_volume_mm3: 180,
    nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
  };

  it("S3 volume-preferred rule: measurementBasisUsed 'volume', no measurementsUsed, no clinicalCriterionUsed", () => {
    const trace = evaluate(solidInitialInput, release);
    const recommendation = outcomeFor(trace, "s3")?.recommendation;
    expect(recommendation?.matchedRuleId).toBe("ACR-S3-5TO8MM");
    expect(recommendation?.measurementBasisUsed).toBe("volume");
    expect(recommendation?.measurementsUsed).toBeUndefined();
    expect(recommendation?.clinicalCriterionUsed).toBeUndefined();
  });

  it("Fleischner convention-bound diameter rule: measurementBasisUsed 'diameter', unchanged measurementsUsed.wholeNodule, no clinicalCriterionUsed", () => {
    const trace = evaluate(solidInitialInput, release);
    const recommendation = outcomeFor(trace, "fleischner")?.recommendation;
    expect(recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-6TO8MM");
    expect(recommendation?.measurementBasisUsed).toBe("diameter");
    // ACR-FLEISCHNER-6TO8MM declares measurementConventionId (whole-nodule only, no
    // solidComponentMeasurementConventionId) -- unchanged pre-existing behavior, not new to this
    // slice: the convention-bound dispatch path always reports which value it resolved.
    expect(recommendation?.measurementsUsed).toEqual({
      wholeNodule: { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
    });
    expect(recommendation?.clinicalCriterionUsed).toBeUndefined();
  });

  it("Fleischner >8mm diameter rule (plain, no measurementConventionId path taken for the shadow field): measurementBasisUsed 'diameter'", () => {
    const trace = evaluate(
      {
        ...solidInitialInput,
        nodule_size_mm: 15,
        nodule_diameter_measurements: [{ valueMm: 15, conventionId: "fleischner-2017-average-diameter" }],
      },
      release,
    );
    const recommendation = outcomeFor(trace, "fleischner")?.recommendation;
    expect(recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GT8TO30MM");
    expect(recommendation?.measurementBasisUsed).toBe("diameter");
    expect(recommendation?.clinicalCriterionUsed).toBeUndefined();
  });

  it("part-solid dual-measurement rule: measurementBasisUsed 'diameter' plus the full measurementsUsed shape, unchanged", () => {
    const trace = evaluate(
      {
        nodule_morphology: "part-solid",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        age: 55,
        known_malignancy_history: false,
        immunocompromised: false,
        nodule_size_mm: 7,
        nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
        solid_component_diameter_measurements: [
          { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
        ],
      },
      release,
    );
    const recommendation = outcomeFor(trace, "fleischner")?.recommendation;
    expect(recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM");
    expect(recommendation?.measurementBasisUsed).toBe("diameter");
    expect(recommendation?.measurementsUsed).toEqual({
      wholeNodule: { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      solidComponent: { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
    });
    expect(recommendation?.clinicalCriterionUsed).toBeUndefined();
  });
});
