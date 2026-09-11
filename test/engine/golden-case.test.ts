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
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
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
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
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

// Third Golden Clinical Case (issue #18 clinical HITL approval, Candidate B, State A): a
// solitary part-solid nodule below 6mm. Human-reviewed expected outcome (no routine follow-up),
// verified directly against MacMahon et al. 2017 Recommendation 4.
const goldenCasePartSolidStateAInput: ClinicalInputState = {
  nodule_morphology: "part-solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
  nodule_size_mm: 5,
  nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("Golden Clinical Case (part-solid, whole nodule 5mm, age 55, solitary, no exclusions) -- issue #18 State A", () => {
  const trace = evaluate(goldenCasePartSolidStateAInput, release);

  it("passes the Clinical Pathway Gate onto the part-solid pathway", () => {
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-part-solid-initial",
    });
  });

  it("Fleischner produces RECOMMENDATION via the <6mm rule, no-routine-follow-up form", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-LT6MM");
    expect((fleischner?.recommendation as any)?.noRoutineFollowUp).toBe(true);
    expect((fleischner?.recommendation as any)?.intervals).toBeUndefined();
    expect((fleischner?.recommendation as any)?.actions).toBeUndefined();
  });

  it("S3 and BTS produce no Source Evaluation Outcome at all (no Atomic Clinical Rule bound to this pathway)", () => {
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
  });

  it("Recommendation Set contains exactly the one RECOMMENDATION-state entry (Fleischner)", () => {
    expect(trace.recommendationSet).toHaveLength(1);
    expect(trace.recommendationSet[0].recommendationSourceId).toBe("fleischner");
  });
});

// Fourth Golden Clinical Case (issue #18 clinical HITL approval, Candidate B, State B): a
// solitary part-solid nodule with whole-nodule diameter >=6mm and solid component <6mm.
// Human-reviewed expected outcome (persistence-surveillance), verified directly against
// MacMahon et al. 2017 Recommendation 4, paragraph 2.
const goldenCasePartSolidStateBInput: ClinicalInputState = {
  nodule_morphology: "part-solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
  nodule_size_mm: 7,
  nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
  solid_component_diameter_measurements: [
    { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
  ],
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("Golden Clinical Case (part-solid, whole nodule 7mm, solid component 5mm, age 55, solitary, no exclusions) -- issue #18 State B", () => {
  const trace = evaluate(goldenCasePartSolidStateBInput, release);

  it("passes the Clinical Pathway Gate onto the part-solid pathway", () => {
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-part-solid-initial",
    });
  });

  it("Fleischner produces RECOMMENDATION via the >=6mm/solid<6mm rule, persistence-surveillance form", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
    );

    const recommendation = fleischner?.recommendation as any;
    expect(recommendation.persistenceConfirmation).toEqual({
      label: "CT to confirm persistence",
      timing: { kind: "specified", intervals: ["3-6 months"] },
    });
    expect(recommendation.ifPersistent).toEqual({
      label: "CT surveillance",
      timing: { kind: "specified", intervals: ["annually until 5 years"] },
    });

    const anchors = recommendation.provenanceAnchors;
    expect(anchors).toHaveLength(4);
    const roles = anchors.map((a: any) => a.role).sort();
    expect(roles).toEqual([
      "local-management",
      "primary-management",
      "solid-component-measurement",
      "whole-nodule-measurement",
    ]);
  });

  it("the recommendation records both independently-resolved measurements used, never falsely reporting only one", () => {
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.recommendation?.measurementBasisUsed).toBe("diameter");
    expect(fleischner?.recommendation?.measurementsUsed).toEqual({
      wholeNodule: { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      solidComponent: { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
    });
  });

  it("S3 and BTS produce no Source Evaluation Outcome at all (no Atomic Clinical Rule bound to this pathway)", () => {
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
  });

  it("the input's solid_component_diameter_measurements is echoed unchanged in the trace, structurally separate from nodule_diameter_measurements", () => {
    expect(trace.normalizedClinicalInputState.nodule_diameter_measurements).toEqual([
      { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
    ]);
    expect(trace.normalizedClinicalInputState.solid_component_diameter_measurements).toEqual([
      { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
    ]);
  });
});

// Fifth Golden Clinical Case group (issue #15, Candidate A0; clinical HITL approval
// #5603995097; architecture corrected per reviews #5604290019/#5605350412): the S3-only solid
// follow-up positive discharge branch, its explicit-false/missing/not-applicable siblings, and
// two isolation cases. Human-reviewed expected outcomes -- G1-G6 exactly as approved on #15.
const followUpBaseInput: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  nodule_count: 1,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("Golden Clinical Case G1 (solid follow-up, S3 volume-stability criterion confirmed) -- issue #15 Candidate A0", () => {
  const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);

  it("passes the Clinical Pathway Gate onto the solid follow-up pathway", () => {
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-follow-up",
    });
  });

  it("S3 produces RECOMMENDATION: no routine follow-up, clinician-attestation basis, no fabricated measurement basis", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-VOLUME-STABLE");
    expect((s3?.recommendation as any)?.noRoutineFollowUp).toBe(true);
    expect(s3?.recommendation?.clinicalCriterionUsed).toBe("clinician-attestation");
    expect(s3?.recommendation?.measurementBasisUsed).toBeUndefined();
    expect(s3?.recommendation?.measurementsUsed).toBeUndefined();
  });

  it("Fleischner and BTS produce no Source Evaluation Outcome at all (no Atomic Clinical Rule bound to this pathway)", () => {
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
  });

  it("Recommendation Set contains exactly the one RECOMMENDATION-state entry (S3)", () => {
    expect(trace.recommendationSet).toHaveLength(1);
    expect(trace.recommendationSet[0].recommendationSourceId).toBe("s3");
  });
});

describe("Golden Clinical Case G2 (solid follow-up, S3 criterion explicitly not met) -- issue #15 Candidate A0", () => {
  const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: false }, release);

  it("S3 produces OUTSIDE_CURRENT_RULESET_SCOPE, never an inferred growth/work-up recommendation", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(s3?.recommendation).toBeUndefined();
  });

  it("Recommendation Set is empty -- no complement-inferred recommendation exists anywhere in this Release", () => {
    expect(trace.recommendationSet).toHaveLength(0);
  });
});

describe("Golden Clinical Case G3 (solid follow-up, S3 criterion not supplied) -- issue #15 Candidate A0", () => {
  const trace = evaluate({ ...followUpBaseInput }, release);

  it("S3 produces INSUFFICIENT_INPUT, with no diameter/volume field required to reach evaluation at all", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
    expect(s3?.reason).toContain("s3_volume_stability_criterion_met");
  });
});

describe("Golden Clinical Case G4 (solid follow-up, S3 applicability fails) -- issue #15 Candidate A0", () => {
  const trace = evaluate(
    { ...followUpBaseInput, known_malignancy_history: true, s3_volume_stability_criterion_met: true },
    release,
  );

  it("S3 produces NOT_APPLICABLE -- applicability is still checked before the new rule", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.state).toBe("NOT_APPLICABLE");
  });
});

describe("Golden Clinical Case G5 (pathway isolation: initial-assessment input with the follow-up field accidentally populated) -- issue #15 Candidate A0", () => {
  const trace = evaluate(
    {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      nodule_size_mm: 7,
      nodule_volume_mm3: 180,
      age: 55,
      known_malignancy_history: false,
      immunocompromised: false,
      s3_volume_stability_criterion_met: true,
    },
    release,
  );

  it("the initial solid pathway remains selected, not the follow-up pathway", () => {
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
  });

  it("the new follow-up rule cannot activate; existing initial outcomes are unaffected", () => {
    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-5TO8MM");
    expect(trace.sourceEvaluationOutcomes.map((o) => o.recommendationSourceId).sort()).toEqual([
      "fleischner",
      "s3",
    ]);
  });
});

describe("Golden Clinical Case G6 (morphology isolation: part-solid follow-up-shaped input) -- issue #15 Candidate A0", () => {
  const trace = evaluate(
    {
      nodule_morphology: "part-solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      age: 55,
      known_malignancy_history: false,
      immunocompromised: false,
      s3_volume_stability_criterion_met: true,
    },
    release,
  );

  it("no Clinical Pathway Gate matches this morphology/timepoint combination", () => {
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
  });

  it("the new S3 follow-up rule cannot activate; no Source Evaluation Outcome is produced", () => {
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });
});
