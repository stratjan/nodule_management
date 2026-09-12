// Synthetic, source-agnostic mechanics test for OperandInapplicabilityPrecondition (issue #26,
// architecture-review correction). The rule IDs, provenance, gate/applicability logic, and
// expected outcomes here are entirely synthetic and carry no real clinical content -- this file
// proves the mechanism itself (missing-operand exception, OR-across-entries, AND-within-entry,
// and its strict boundary against "ambiguous"/"resolved" states), not any Fleischner-specific
// fact, per ADR-0009's "correctness owned by this project, generic interpreter" requirement.
// MeasurementConventionId is a closed vocabulary (types.ts) that currently contains only the two
// governed Fleischner-named tokens ("fleischner-2017-average-diameter",
// "fleischner-2017-solid-component-long-axis") -- reused below purely as inert convention tags to
// satisfy that closed type, exactly as ruleAmbiguity.test.ts's own synthetic fixtures already do.
// Nothing in evaluate.ts's operand-inapplicability dispatch is keyed to these specific token
// values; the mechanism is generic regardless of which governed convention id is used.
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
  locator: "test/engine/operandInapplicability.test.ts",
};

const gate = rev({
  ruleId: "TEST-INAPPLICABILITY-GATE",
  revisionId: "TEST-INAPPLICABILITY-GATE-r1",
  kind: "pathway-gate",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  clinicalPathwayId: "incidental-solitary-solid-initial",
  conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
});

const applicability = rev({
  ruleId: "TEST-INAPPLICABILITY-SAR",
  revisionId: "TEST-INAPPLICABILITY-SAR-r1",
  kind: "source-applicability",
  recommendationSourceId: "test-only-inapplicability-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
});

// A synthetic "whole-nodule-shaped" rule -- stands in for the always-present, unconditionally-
// required operand a solid-component-only rule's precondition can reason about.
const wholeNoduleRule = rev({
  ruleId: "TEST-INAPPLICABILITY-WHOLE",
  revisionId: "TEST-INAPPLICABILITY-WHOLE-r1",
  kind: "atomic-clinical-rule",
  recommendationSourceId: "test-only-inapplicability-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  measurementBasis: "diameter",
  measurementConventionId: "fleischner-2017-average-diameter",
  diameterConditions: [{ field: "nodule_size_mm", op: "lt", value: 6 }],
  recommendation: {
    clinicalEndpoint: "test-only-not-a-real-recommendation",
    intervals: ["n/a"],
    rationale: "Synthetic fixture for operand-inapplicability testing only -- not real clinical content.",
  },
});

// The rule under test: a solid-component-only rule (no measurementConventionId of its own) whose
// missing solid-component operand is excused by TWO preconditions (proving OR across entries),
// each checking the synthetic whole-nodule rule's own operand/convention.
function solidComponentRuleWithPreconditions(preconditions: unknown[]) {
  return rev({
    ruleId: "TEST-INAPPLICABILITY-SOLID",
    revisionId: "TEST-INAPPLICABILITY-SOLID-r1",
    kind: "atomic-clinical-rule",
    recommendationSourceId: "test-only-inapplicability-source",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    measurementBasis: "diameter",
    solidComponentMeasurementConventionId: "fleischner-2017-solid-component-long-axis",
    diameterConditions: [{ field: "solid_component_size_mm", op: "gt", value: 8 }],
    operandInapplicabilityPreconditions: preconditions,
    recommendation: {
      clinicalEndpoint: "test-only-not-a-real-recommendation",
      intervals: ["n/a"],
      rationale: "Synthetic fixture for operand-inapplicability testing only -- not real clinical content.",
    },
  });
}

const belowThresholdPrecondition = {
  operand: "solidComponent",
  whenOperand: "wholeNodule",
  whenConventionId: "fleischner-2017-average-diameter",
  whenConditions: [{ field: "nodule_size_mm", op: "lt", value: 6 }],
  provenance: syntheticProvenance,
};
// A second, deliberately never-true entry -- present purely to prove OR (any ONE matching entry
// is sufficient; this one never matches, so if OR were broken and the interpreter required ALL
// entries to match, the excusal would incorrectly fail to fire).
const neverTruePrecondition = {
  operand: "solidComponent",
  whenOperand: "wholeNodule",
  whenConventionId: "fleischner-2017-average-diameter",
  whenConditions: [{ field: "nodule_size_mm", op: "eq", value: -1 }],
  provenance: syntheticProvenance,
};

const solidComponentRule = solidComponentRuleWithPreconditions([neverTruePrecondition, belowThresholdPrecondition]);

const release = buildRuleSetRelease([gate, applicability, wholeNoduleRule, solidComponentRule]);

function baseInput(overrides: Partial<ClinicalInputState>): ClinicalInputState {
  return {
    test_only_gate_field: "yes",
    test_only_app_field: true,
    ...overrides,
  } as unknown as ClinicalInputState;
}

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

describe("OperandInapplicabilityPrecondition -- generic, source-agnostic (issue #26)", () => {
  it("missing target operand + whenConditions satisfied via a different, resolved operand -> OUTSIDE_CURRENT_RULESET_SCOPE, not INSUFFICIENT_INPUT", () => {
    const input = baseInput({
      nodule_size_mm: 5,
      nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
      // solid_component_diameter_measurements deliberately omitted -- missing entirely.
    });
    const trace = evaluate(input, release);
    const outcome = outcomeFor(trace, "test-only-inapplicability-source");
    // The whole-nodule rule matches (5 < 6); the solid-component rule's own missing operand is
    // excused, so it does not report INSUFFICIENT_INPUT and does not mask that match.
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedRuleId).toBe("TEST-INAPPLICABILITY-WHOLE");
  });

  it("missing target operand + whenConditions NOT satisfied (other operand resolved, but condition false) -> falls back to INSUFFICIENT_INPUT unchanged", () => {
    const input = baseInput({
      nodule_size_mm: 20,
      nodule_diameter_measurements: [{ valueMm: 20, conventionId: "fleischner-2017-average-diameter" }],
    });
    const trace = evaluate(input, release);
    const outcome = outcomeFor(trace, "test-only-inapplicability-source");
    // Whole-nodule rule does not match (20 is not < 6) -> OUTSIDE_CURRENT_RULESET_SCOPE on its
    // own, but the solid-component rule's precondition also does not fire (20 is not < 6), so its
    // own missing operand is a genuine data gap -> INSUFFICIENT_INPUT wins overall.
    expect(outcome?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("missing target operand + the checked operand is ALSO unresolvable -> precondition cannot be evaluated, falls back to INSUFFICIENT_INPUT unchanged", () => {
    const input = baseInput({});
    const trace = evaluate(input, release);
    const outcome = outcomeFor(trace, "test-only-inapplicability-source");
    expect(outcome?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("target operand actually SUPPLIED -> precondition is never consulted; normal resolution proceeds and can still match", () => {
    const input = baseInput({
      nodule_size_mm: 20,
      nodule_diameter_measurements: [{ valueMm: 20, conventionId: "fleischner-2017-average-diameter" }],
      solid_component_diameter_measurements: [
        { valueMm: 9, conventionId: "fleischner-2017-solid-component-long-axis" },
      ],
    });
    const trace = evaluate(input, release);
    const outcome = outcomeFor(trace, "test-only-inapplicability-source");
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedRuleId).toBe("TEST-INAPPLICABILITY-SOLID");
  });

  it("target operand SUPPLIED and the precondition's own whenConditions would otherwise excuse a missing operand -> the guard is untouched: both rules can still match and evaluate() still throws AmbiguousRuleMatchError", () => {
    const input = baseInput({
      nodule_size_mm: 5,
      nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
      solid_component_diameter_measurements: [
        { valueMm: 9, conventionId: "fleischner-2017-solid-component-long-axis" },
      ],
    });
    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });

  it("AMBIGUOUS target operand (duplicate convention-bound entries) is never excused, even when whenConditions would otherwise match -- ambiguity remains INSUFFICIENT_INPUT unconditionally", () => {
    const input = baseInput({
      nodule_size_mm: 5,
      nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
      solid_component_diameter_measurements: [
        { valueMm: 9, conventionId: "fleischner-2017-solid-component-long-axis" },
        { valueMm: 11, conventionId: "fleischner-2017-solid-component-long-axis" },
      ],
    });
    const trace = evaluate(input, release);
    const outcome = outcomeFor(trace, "test-only-inapplicability-source");
    expect(outcome?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome?.reason).toContain("Multiple");
  });

  it("release assembly accepts the fixture; no schema/release-builder rejection introduced by this mechanism", () => {
    expect(() => buildRuleSetRelease([gate, applicability, wholeNoduleRule, solidComponentRule])).not.toThrow();
  });
});
