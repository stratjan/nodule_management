// Approved Golden Clinical Case regression (issue #5 final clinical approval, issue #7).
// This is the ONLY fixture whose expected outcomes are currently human-approved. Do not add
// more Golden Clinical Cases without human clinical review.
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { loadTestRelease } from "../helpers/loadTestRelease";
import type { ClinicalInputState } from "../../src/engine/types";

const release = loadTestRelease();

const goldenCaseInput: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
  nodule_size_mm: 7,
  nodule_volume_mm3: 180,
  nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("Golden Clinical Case (7mm / 180mm3, age 55, solitary, no exclusions)", () => {
  const trace = evaluate(goldenCaseInput, release);

  it("passes the Clinical Pathway Gate", () => {
    expect(trace.clinicalPathwayGate.passed).toBe(true);
  });

  it("S3 produces RECOMMENDATION: CT surveillance at 3, 6-12, 18-24 months", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect((s3?.recommendation as any)?.clinicalEndpoint).toBe("CT surveillance");
    expect((s3?.recommendation as any)?.intervals).toEqual(["3 months", "6-12 months", "18-24 months"]);
    expect(s3?.recommendation?.measurementBasisUsed).toBe("volume");
  });

  it("Fleischner produces RECOMMENDATION: CT surveillance at 6-12 months", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect((fleischner?.recommendation as any)?.clinicalEndpoint).toBe("CT surveillance");
    expect((fleischner?.recommendation as any)?.intervals).toEqual(["6-12 months"]);
    expect(fleischner?.recommendation?.measurementBasisUsed).toBe("diameter");
  });

  it("BTS produces no Source Evaluation Outcome at all (absent from the Release)", () => {
    const bts = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "bts");
    expect(bts).toBeUndefined();
    expect(trace.sourceEvaluationOutcomes).toHaveLength(2);
  });

  it("Recommendation Set contains exactly the two RECOMMENDATION-state entries", () => {
    expect(trace.recommendationSet).toHaveLength(2);
    expect(trace.recommendationSet.map((r) => r.recommendationSourceId).sort()).toEqual([
      "fleischner",
      "s3",
    ]);
  });

  it("does not flag measurement discordance (7mm and 180mm3 agree)", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.measurementDiscordance).toBeUndefined();
  });
});

// Second Golden Clinical Case (issue #20 clinical closeout, #14): a representative >8mm
// Fleischner input. Human-reviewed expected outcome, not invented by an implementation agent.
const goldenCaseGt8mmInput: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
  nodule_size_mm: 15,
  nodule_diameter_measurements: [{ valueMm: 15, conventionId: "fleischner-2017-average-diameter" }],
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("Golden Clinical Case (15mm Fleischner-bound diameter, age 55, solitary, no exclusions) -- issue #20", () => {
  const trace = evaluate(goldenCaseGt8mmInput, release);

  it("passes the Clinical Pathway Gate", () => {
    expect(trace.clinicalPathwayGate.passed).toBe(true);
  });

  it("Fleischner produces RECOMMENDATION via the new >8mm rule, in its structured form", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GT8TO30MM");
    expect(fleischner?.recommendation?.measurementBasisUsed).toBe("diameter");

    const recommendation = fleischner?.recommendation as any;
    expect(recommendation.clinicalEndpoint).toBeUndefined();
    expect(recommendation.intervals).toBeUndefined();
    expect(recommendation.provenance).toBeUndefined();

    const labels = recommendation.actions.map((a: any) => a.label);
    expect(labels).toEqual(
      expect.arrayContaining(["CT surveillance", "PET-CT", "Biopsy/tissue sampling"]),
    );
    expect(labels).toHaveLength(3);

    const ctSurveillance = recommendation.actions.find((a: any) => a.label === "CT surveillance");
    expect(ctSurveillance.timing).toEqual({ kind: "specified", intervals: ["3 months"] });

    const petCt = recommendation.actions.find((a: any) => a.label === "PET-CT");
    expect(petCt.timing).toEqual({ kind: "not-specified-by-source" });

    const biopsy = recommendation.actions.find((a: any) => a.label === "Biopsy/tissue sampling");
    expect(biopsy.timing).toEqual({ kind: "not-specified-by-source" });

    const anchors = recommendation.provenanceAnchors;
    expect(anchors).toHaveLength(3);
    const roles = anchors.map((a: any) => a.role).sort();
    expect(roles).toEqual(["management", "measurement", "scope"]);
  });

  it("S3 remains blocked at this size (OUTSIDE_CURRENT_RULESET_SCOPE, unaffected by the Fleischner >8mm addition)", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("Recommendation Set contains exactly the one RECOMMENDATION-state entry (Fleischner)", () => {
    expect(trace.recommendationSet).toHaveLength(1);
    expect(trace.recommendationSet[0].recommendationSourceId).toBe("fleischner");
  });

  it("the input's nodule_diameter_measurements is echoed unchanged in the trace, alongside the untouched, separately-populated nodule_size_mm", () => {
    expect(trace.normalizedClinicalInputState.nodule_size_mm).toBe(15);
    expect(trace.normalizedClinicalInputState.nodule_diameter_measurements).toEqual([
      { valueMm: 15, conventionId: "fleischner-2017-average-diameter" },
    ]);
  });
});
