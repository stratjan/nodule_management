// Multi-pathway Clinical Pathway Gate selection (issue #17, extended by issue #18 for GR-3):
// evaluate-all, three-valued partial-input classification (MATCHED/NOT_MATCHED/INDETERMINATE),
// typed fail-closed ambiguity, and cross-pathway Atomic Clinical Rule isolation. Real
// GR-1/GR-2/GR-3 content for the real-pathway cases; a synthetic, non-clinical fixture pair
// (mirroring ruleAmbiguity.test.ts's convention) for the ambiguous-match case only.
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
    expect(trace.clinicalPathwayGates).toHaveLength(4);
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

  it("part-solid input selects incidental-solitary-part-solid-initial (issue #18)", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "part-solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 5,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-part-solid-initial",
    });
    expect(trace.clinicalPathwayGates).toHaveLength(4);
  });

  it("solid follow-up input selects incidental-solitary-solid-follow-up (issue #15 Candidate A0)", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      ...baseApplicability,
      s3_volume_stability_criterion_met: true,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-follow-up",
    });
    expect(trace.clinicalPathwayGates).toHaveLength(4);
  });

  it("GR-4 never co-matches GR-1/GR-2/GR-3 -- assessment_timepoint's initial/follow-up values are mutually exclusive by construction", () => {
    const initialInput: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const followUpInput: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      ...baseApplicability,
      s3_volume_stability_criterion_met: true,
    };
    expect(() => evaluate(initialInput, release)).not.toThrow();
    expect(() => evaluate(followUpInput, release)).not.toThrow();
    expect(evaluate(initialInput, release).pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
    expect(evaluate(followUpInput, release).pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-follow-up",
    });
  });

  it("a morphology value matching no gate, plus another missing gate field, is NO_PATHWAY_MATCHED (all three gates definitively NOT_MATCHED, never masked by the other missing field)", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "unknown-morphology",
      assessment_timepoint: "initial",
      nodule_count: 1,
      // assessment_context intentionally omitted
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
    expect(trace.clinicalPathwayGates.every((g) => g.state === "NOT_MATCHED")).toBe(true);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("missing morphology only, with every other GR-1/GR-2/GR-3 field compatible, is INSUFFICIENT_INPUT (those gates INDETERMINATE, not excluded)", () => {
    const input: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    // issue #15: GR-4 requires assessment_timepoint == "follow-up", which this input's supplied
    // "initial" definitively contradicts -- a known contradiction is never masked by the still-
    // missing morphology field, so GR-4 alone is NOT_MATCHED here, unlike GR-1/GR-2/GR-3 (which
    // have nothing in this input that contradicts them, only the missing morphology).
    const byPathway = Object.fromEntries(
      trace.clinicalPathwayGates.map((g) => [g.clinicalPathwayId, g.state]),
    );
    expect(byPathway["incidental-solitary-solid-initial"]).toBe("INDETERMINATE");
    expect(byPathway["incidental-solitary-pure-ggn-initial"]).toBe("INDETERMINATE");
    expect(byPathway["incidental-solitary-part-solid-initial"]).toBe("INDETERMINATE");
    expect(byPathway["incidental-solitary-solid-follow-up"]).toBe("NOT_MATCHED");
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

  it("a Solid input at a diameter also inside the part-solid >=6mm range never matches a part-solid rule (issue #18)", () => {
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

  it("a part-solid input never matches the Solid or pure-GGN Fleischner rules (issue #18)", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "part-solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: [
        { valueMm: 5, conventionId: "fleischner-2017-average-diameter" },
      ],
    };
    const trace = evaluate(input, release);
    const matchedRuleId = outcomeFor(trace, "fleischner")?.recommendation?.matchedRuleId;
    expect(matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-LT6MM");
    expect(matchedRuleId).not.toBe("ACR-FLEISCHNER-6TO8MM");
    expect(matchedRuleId).not.toBe("ACR-FLEISCHNER-GGN-LT6MM");
  });

  it("a solid initial-assessment input never matches the follow-up S3 rule, and vice versa (issue #15 Candidate A0)", () => {
    const initialInput: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_volume_mm3: 180,
    };
    const followUpInput: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      ...baseApplicability,
      s3_volume_stability_criterion_met: true,
    };
    const initialTrace = evaluate(initialInput, release);
    const followUpTrace = evaluate(followUpInput, release);
    expect(outcomeFor(initialTrace, "s3")?.recommendation?.matchedRuleId).toBe("ACR-S3-5TO8MM");
    expect(outcomeFor(followUpTrace, "s3")?.recommendation?.matchedRuleId).toBe(
      "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
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
