// issue #15 Candidate A0: targeted engine-dispatch coverage for the new clinical-condition-shaped
// Atomic Clinical Rule branch in evaluateSingleAtomicRule() (no measurementBasis, a bounded
// `conditions` array). Verifies the true/false/missing dispatch directly, that no measurement
// input is ever required to reach RECOMMENDATION, that no measurementBasisUsed is fabricated, and
// that every existing measurement-shaped rule's measurementBasisUsed/measurementsUsed output is
// exactly unchanged by this addition (final review #5605350412's regression requirement).
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { loadTestRelease } from "../helpers/loadTestRelease";
import type { ClinicalInputState } from "../../src/engine/types";

const release = loadTestRelease();

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

const followUpBaseInput: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  nodule_count: 1,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("clinical-condition-shaped Atomic Clinical Rule dispatch (issue #15 Candidate A0)", () => {
  it("true -> RECOMMENDATION", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-VOLUME-STABLE");
  });

  it("false -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: false }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("missing -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate({ ...followUpBaseInput }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("no diameter or volume input is required to reach RECOMMENDATION -- the input carries neither field at all", () => {
    const input = { ...followUpBaseInput, s3_volume_stability_criterion_met: true };
    expect(input.nodule_size_mm).toBeUndefined();
    expect((input as ClinicalInputState).nodule_volume_mm3).toBeUndefined();
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("RECOMMENDATION");
  });

  it("no measurementBasisUsed or measurementsUsed is fabricated; clinicalCriterionUsed is the exact closed value", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const recommendation = outcomeFor(trace, "s3")?.recommendation;
    expect(recommendation?.measurementBasisUsed).toBeUndefined();
    expect(recommendation?.measurementsUsed).toBeUndefined();
    expect(recommendation?.clinicalCriterionUsed).toBe("clinician-attestation");
  });

  it("the OUTSIDE_CURRENT_RULESET_SCOPE outcome carries no recommendation and no complement-inferred content", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: false }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.recommendation).toBeUndefined();
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
