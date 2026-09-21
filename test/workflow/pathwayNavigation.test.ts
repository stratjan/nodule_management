// Pure predicate test -- no UI testing dependency needed. Confirms the wizard's Continue
// button is gated correctly on nodule_count, per issue #7 user story 2 ("if I enter more than
// one discrete nodule, I want the tool to tell me this pathway is scoped to a solitary nodule
// and stop there"). The engine's Clinical Pathway Gate remains the actual clinical authority;
// this only governs UI navigation.
import { describe, expect, it } from "vitest";
import {
  applyGr4FollowUpReset,
  canContinuePastPathwayStep,
  isNoduleCountOutOfScope,
  shouldClearGr4FollowUpFields,
} from "../../src/workflow/pathwayNavigation";
import type { ClinicalInputState } from "../../src/engine/types";

const completePathway: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
};

describe("canContinuePastPathwayStep", () => {
  it("allows continuing once all pathway fields are answered and nodule_count = 1", () => {
    expect(canContinuePastPathwayStep(completePathway)).toBe(true);
  });

  it("blocks continuing when nodule_count > 1, even though all fields are answered", () => {
    expect(canContinuePastPathwayStep({ ...completePathway, nodule_count: 2 })).toBe(false);
  });

  it("blocks continuing when any pathway field is still unanswered", () => {
    const { nodule_morphology, ...incomplete } = completePathway;
    expect(canContinuePastPathwayStep(incomplete)).toBe(false);
  });

  it("blocks continuing on an empty input", () => {
    expect(canContinuePastPathwayStep({})).toBe(false);
  });

  it("issue #15 Candidate A0: allows continuing for the solid follow-up pathway shape (assessment_timepoint = follow-up) -- this predicate is field-list-driven and pathway-agnostic, unaffected by the new UI select option", () => {
    const followUpPathway: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
    };
    expect(canContinuePastPathwayStep(followUpPathway)).toBe(true);
  });
});

describe("shouldClearGr4FollowUpFields (issue #15 Candidate A0/B1, §13 reset/stale-state behavior)", () => {
  it("clears when morphology changes away from solid", () => {
    expect(shouldClearGr4FollowUpFields("nodule_morphology", "part-solid")).toBe(true);
    expect(shouldClearGr4FollowUpFields("nodule_morphology", "pure-ground-glass")).toBe(true);
  });

  it("does NOT clear when morphology is (re-)set to solid", () => {
    expect(shouldClearGr4FollowUpFields("nodule_morphology", "solid")).toBe(false);
  });

  it("clears when assessment_timepoint changes away from follow-up", () => {
    expect(shouldClearGr4FollowUpFields("assessment_timepoint", "initial")).toBe(true);
  });

  it("does NOT clear when assessment_timepoint is (re-)set to follow-up", () => {
    expect(shouldClearGr4FollowUpFields("assessment_timepoint", "follow-up")).toBe(false);
  });

  it("clears when assessment_context changes away from incidental", () => {
    expect(shouldClearGr4FollowUpFields("assessment_context", "screening")).toBe(true);
  });

  it("clears when nodule_count changes away from 1", () => {
    expect(shouldClearGr4FollowUpFields("nodule_count", 2)).toBe(true);
  });

  it("does NOT clear when nodule_count is (re-)set to 1", () => {
    expect(shouldClearGr4FollowUpFields("nodule_count", 1)).toBe(false);
  });

  it("does NOT clear on any of the three S3 applicability fields -- these are a separate clinical fact, not either GR-4 follow-up field itself", () => {
    expect(shouldClearGr4FollowUpFields("age", 70)).toBe(false);
    expect(shouldClearGr4FollowUpFields("known_malignancy_history", true)).toBe(false);
    expect(shouldClearGr4FollowUpFields("immunocompromised", true)).toBe(false);
  });

  it("does NOT clear when any of the three GR-4 follow-up fields itself changes", () => {
    expect(shouldClearGr4FollowUpFields("s3_volume_stability_criterion_met", true)).toBe(false);
    expect(shouldClearGr4FollowUpFields("s3_volume_stability_criterion_met", false)).toBe(false);
    expect(shouldClearGr4FollowUpFields("s3_vdt_days", 700)).toBe(false);
    expect(
      shouldClearGr4FollowUpFields("s3_general_condition_precludes_further_workup_or_therapy", true),
    ).toBe(false);
  });

  it("does NOT clear on an unrelated/unknown field id", () => {
    expect(shouldClearGr4FollowUpFields("nodule_size_mm", 7)).toBe(false);
  });
});

describe("applyGr4FollowUpReset (issue #15 Candidate B1, extended for Candidate C): actual state-transition behavior, all three GR-4 follow-up fields", () => {
  const allThreeFieldsSet: ClinicalInputState = {
    nodule_morphology: "solid",
    assessment_context: "incidental",
    assessment_timepoint: "follow-up",
    nodule_count: 1,
    s3_volume_stability_criterion_met: true,
    s3_vdt_days: 700,
    s3_general_condition_precludes_further_workup_or_therapy: true,
  };

  it("morphology away from solid clears all three fields", () => {
    const next = { ...allThreeFieldsSet, nodule_morphology: "part-solid" as const };
    const result = applyGr4FollowUpReset(next, "nodule_morphology", "part-solid");
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
    expect(result.s3_vdt_days).toBeUndefined();
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });

  it("assessment_context away from incidental clears all three fields", () => {
    const next = { ...allThreeFieldsSet, assessment_context: "screening" };
    const result = applyGr4FollowUpReset(next, "assessment_context", "screening");
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
    expect(result.s3_vdt_days).toBeUndefined();
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });

  it("assessment_timepoint away from follow-up clears all three fields", () => {
    const next = { ...allThreeFieldsSet, assessment_timepoint: "initial" as const };
    const result = applyGr4FollowUpReset(next, "assessment_timepoint", "initial");
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
    expect(result.s3_vdt_days).toBeUndefined();
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });

  it("nodule_count away from 1 clears all three fields", () => {
    const next = { ...allThreeFieldsSet, nodule_count: 2 };
    const result = applyGr4FollowUpReset(next, "nodule_count", 2);
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
    expect(result.s3_vdt_days).toBeUndefined();
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });

  it("an unrelated edit while GR-4 still applies preserves all three fields", () => {
    const next = { ...allThreeFieldsSet, age: 60 };
    const result = applyGr4FollowUpReset(next, "age", 60);
    expect(result.s3_volume_stability_criterion_met).toBe(true);
    expect(result.s3_vdt_days).toBe(700);
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBe(true);
  });

  it("editing the general-condition field itself while remaining on the GR-4 shape does not clear the other two fields", () => {
    const next = { ...allThreeFieldsSet, s3_general_condition_precludes_further_workup_or_therapy: false };
    const result = applyGr4FollowUpReset(
      next,
      "s3_general_condition_precludes_further_workup_or_therapy",
      false,
    );
    expect(result.s3_volume_stability_criterion_met).toBe(true);
    expect(result.s3_vdt_days).toBe(700);
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBe(false);
  });

  it("the volume-stability attestation alone (no VDT or general-condition ever entered) still clears exactly as before -- no regression on the existing A0 behavior", () => {
    const volumeOnly: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      s3_volume_stability_criterion_met: true,
    };
    const next = { ...volumeOnly, nodule_morphology: "pure-ground-glass" as const };
    const result = applyGr4FollowUpReset(next, "nodule_morphology", "pure-ground-glass");
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
  });

  it("returning later to the exact GR-4 shape does not resurrect a previously-cleared value -- the clinician must re-enter it", () => {
    // Round-trip: leave GR-4 (clears all three), then re-enter the exact GR-4 shape via a second
    // edit. applyGr4FollowUpReset only ever deletes; nothing repopulates the fields on re-entry, so
    // the caller (App.tsx) naturally never resurrects them as long as it does not carry over
    // deleted state -- verified here by simulating both edits in sequence.
    const leftGr4 = applyGr4FollowUpReset(
      { ...allThreeFieldsSet, nodule_morphology: "part-solid" as const },
      "nodule_morphology",
      "part-solid",
    );
    expect(leftGr4.s3_volume_stability_criterion_met).toBeUndefined();
    expect(leftGr4.s3_vdt_days).toBeUndefined();
    expect(leftGr4.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();

    const backToGr4 = applyGr4FollowUpReset(
      { ...leftGr4, nodule_morphology: "solid" },
      "nodule_morphology",
      "solid",
    );
    expect(backToGr4.s3_volume_stability_criterion_met).toBeUndefined();
    expect(backToGr4.s3_vdt_days).toBeUndefined();
    expect(backToGr4.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });
});

describe("isNoduleCountOutOfScope", () => {
  it("is false when nodule_count is unanswered", () => {
    expect(isNoduleCountOutOfScope({})).toBe(false);
  });

  it("is false when nodule_count = 1", () => {
    expect(isNoduleCountOutOfScope({ nodule_count: 1 })).toBe(false);
  });

  it("is true when nodule_count > 1", () => {
    expect(isNoduleCountOutOfScope({ nodule_count: 2 })).toBe(true);
  });
});
