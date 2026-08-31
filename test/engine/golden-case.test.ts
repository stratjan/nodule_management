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
    expect(s3?.recommendation?.clinicalEndpoint).toBe("CT surveillance");
    expect(s3?.recommendation?.intervals).toEqual(["3 months", "6-12 months", "18-24 months"]);
    expect(s3?.recommendation?.measurementBasisUsed).toBe("volume");
  });

  it("Fleischner produces RECOMMENDATION: CT surveillance at 6-12 months", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.clinicalEndpoint).toBe("CT surveillance");
    expect(fleischner?.recommendation?.intervals).toEqual(["6-12 months"]);
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
