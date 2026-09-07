// Multi-pathway Clinical Pathway Gate selection (issue #17): evaluate-all, three-valued partial-
// input classification (MATCHED/NOT_MATCHED/INDETERMINATE), typed fail-closed ambiguity, and
// cross-pathway Atomic Clinical Rule isolation. Real GR-1/GR-2 content for the real-pathway
// cases; a synthetic, non-clinical fixture pair (mirroring ruleAmbiguity.test.ts's convention)
// for the ambiguous-match case only.
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousPathwayMatchError } from "../../src/engine/evaluate";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision } from "../../src/engine/types";
import { loadTestRelease } from "../helpers/loadTestRelease";

const release = loadTestRelease();

const baseApplicability = {
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
} as const;

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

describe("pathway selection: real GR-1/GR-2", () => {
  it("Solid input selects incidental-solitary-solid-initial", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
    expect(trace.clinicalPathwayGates).toHaveLength(2);
  });

  it("pure-ground-glass input selects incidental-solitary-pure-ggn-initial", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "pure-ground-glass",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: [
        { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      ],
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-pure-ggn-initial",
    });
  });

  it("a morphology value matching neither gate, plus another missing gate field, is NO_PATHWAY_MATCHED (both gates definitively NOT_MATCHED, never masked by the other missing field)", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "part-solid",
      assessment_timepoint: "initial",
      nodule_count: 1,
      // assessment_context intentionally omitted
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
    expect(trace.clinicalPathwayGates.every((g) => g.state === "NOT_MATCHED")).toBe(true);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("missing morphology only, with every other GR-1/GR-2 field compatible, is INSUFFICIENT_INPUT (gates INDETERMINATE, not excluded)", () => {
    const input: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    expect(trace.clinicalPathwayGates.every((g) => g.state === "INDETERMINATE")).toBe(true);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("a known mismatching morphology for one gate, with that gate's other fields missing, still yields INSUFFICIENT_INPUT when the other pathway remains genuinely possible", () => {
    // solid matches GR-1 exactly on morphology (definitively excludes GR-2), but GR-1 itself is
    // still missing assessment_context -- GR-1 must be INDETERMINATE, not excluded, so the
    // overall state is INSUFFICIENT_INPUT, never NO_PATHWAY_MATCHED.
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_timepoint: "initial",
      nodule_count: 1,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    const solidGate = trace.clinicalPathwayGates.find(
      (g) => g.clinicalPathwayId === "incidental-solitary-solid-initial",
    );
    const ggnGate = trace.clinicalPathwayGates.find(
      (g) => g.clinicalPathwayId === "incidental-solitary-pure-ggn-initial",
    );
    expect(solidGate?.state).toBe("INDETERMINATE");
    expect(ggnGate?.state).toBe("NOT_MATCHED");
  });
});

describe("cross-pathway Atomic Clinical Rule isolation (issue #17)", () => {
  it("a Solid input at a diameter also inside the GGN >=6mm range never matches a GGN rule", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: [
        { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      ],
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-6TO8MM",
    );
  });

  it("a pure-GGN input at a diameter also inside Solid's 6-8mm range never matches the Solid rule", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "pure-ground-glass",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: [
        { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      ],
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-GGN-GTE6MM",
    );
  });
});

describe("synthetic double-gate ambiguity (issue #17)", () => {
  function rev(raw: unknown): RuleRevision {
    return ruleRevisionSchema.parse(raw) as RuleRevision;
  }

  const syntheticProvenance = {
    sourceDocument: "test fixture -- not a real clinical source",
    version: "n/a",
    originalLanguage: "English",
    sourceType: "Synthetic test fixture",
    locator: "test/engine/pathwaySelection.test.ts",
  };

  // Two synthetic gates, built into their own standalone release -- never combined with the
  // real GR-1/GR-2 release. Each must declare one of the two real closed-enum clinicalPathwayId
  // values (issue #17 closes that vocabulary), but their conditions are entirely synthetic and
  // both trivially match the same synthetic input field, to exercise the ambiguity guard without
  // touching real clinical semantics.
  const gateA = rev({
    ruleId: "TEST-PATHWAY-AMBIGUITY-GATE-A",
    revisionId: "TEST-PATHWAY-AMBIGUITY-GATE-A-r1",
    kind: "pathway-gate",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    clinicalPathwayId: "incidental-solitary-solid-initial",
    conditions: [{ field: "test_only_ambiguous_gate_field", op: "eq", value: "yes" }],
  });

  const gateB = rev({
    ruleId: "TEST-PATHWAY-AMBIGUITY-GATE-B",
    revisionId: "TEST-PATHWAY-AMBIGUITY-GATE-B-r1",
    kind: "pathway-gate",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    clinicalPathwayId: "incidental-solitary-pure-ggn-initial",
    conditions: [{ field: "test_only_ambiguous_gate_field", op: "eq", value: "yes" }],
  });

  it("evaluate() throws AmbiguousPathwayMatchError when more than one Pathway Gate matches, rather than returning any pathwaySelection value", () => {
    const ambiguousRelease = buildRuleSetRelease([gateA, gateB]);
    const input = {
      test_only_ambiguous_gate_field: "yes",
    } as unknown as ClinicalInputState;

    expect(() => evaluate(input, ambiguousRelease)).toThrow(AmbiguousPathwayMatchError);
  });
});
