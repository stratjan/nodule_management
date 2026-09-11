// Pure predicate test -- no UI testing dependency needed. Confirms the wizard's Continue
// button is gated correctly on nodule_count, per issue #7 user story 2 ("if I enter more than
// one discrete nodule, I want the tool to tell me this pathway is scoped to a solitary nodule
// and stop there"). The engine's Clinical Pathway Gate remains the actual clinical authority;
// this only governs UI navigation.
import { describe, expect, it } from "vitest";
import {
  canContinuePastPathwayStep,
  isNoduleCountOutOfScope,
  shouldClearS3FollowUpCriterion,
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

describe("shouldClearS3FollowUpCriterion (issue #15 Candidate A0, §13 reset/stale-state behavior)", () => {
  it("clears when morphology changes away from solid", () => {
    expect(shouldClearS3FollowUpCriterion("nodule_morphology", "part-solid")).toBe(true);
    expect(shouldClearS3FollowUpCriterion("nodule_morphology", "pure-ground-glass")).toBe(true);
  });

  it("does NOT clear when morphology is (re-)set to solid", () => {
    expect(shouldClearS3FollowUpCriterion("nodule_morphology", "solid")).toBe(false);
  });

  it("clears when assessment_timepoint changes away from follow-up", () => {
    expect(shouldClearS3FollowUpCriterion("assessment_timepoint", "initial")).toBe(true);
  });

  it("does NOT clear when assessment_timepoint is (re-)set to follow-up", () => {
    expect(shouldClearS3FollowUpCriterion("assessment_timepoint", "follow-up")).toBe(false);
  });

  it("clears when assessment_context changes away from incidental", () => {
    expect(shouldClearS3FollowUpCriterion("assessment_context", "screening")).toBe(true);
  });

  it("clears when nodule_count changes away from 1", () => {
    expect(shouldClearS3FollowUpCriterion("nodule_count", 2)).toBe(true);
  });

  it("does NOT clear when nodule_count is (re-)set to 1", () => {
    expect(shouldClearS3FollowUpCriterion("nodule_count", 1)).toBe(false);
  });

  it("does NOT clear on any of the three S3 applicability fields -- these are a separate clinical fact, not the attestation itself", () => {
    expect(shouldClearS3FollowUpCriterion("age", 70)).toBe(false);
    expect(shouldClearS3FollowUpCriterion("known_malignancy_history", true)).toBe(false);
    expect(shouldClearS3FollowUpCriterion("immunocompromised", true)).toBe(false);
  });

  it("does NOT clear when the attestation field itself changes", () => {
    expect(shouldClearS3FollowUpCriterion("s3_volume_stability_criterion_met", true)).toBe(false);
    expect(shouldClearS3FollowUpCriterion("s3_volume_stability_criterion_met", false)).toBe(false);
  });

  it("does NOT clear on an unrelated/unknown field id", () => {
    expect(shouldClearS3FollowUpCriterion("nodule_size_mm", 7)).toBe(false);
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
