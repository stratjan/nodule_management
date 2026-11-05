// Pure predicate test -- no UI testing dependency needed. Confirms the wizard's Continue
// button is gated correctly on nodule_count, per issue #7 user story 2 ("if I enter more than
// one discrete nodule, I want the tool to tell me this pathway is scoped to a solitary nodule
// and stop there"). The engine's Clinical Pathway Gate remains the actual clinical authority;
// this only governs UI navigation.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyGr4FollowUpReset,
  applyNoduleCountBranchReset,
  canContinuePastPathwayStep,
  isMultipleSubsolidShape,
  isMultipleSolidLt6mmShape,
  isMultipleSolidGte6mmShape,
  isMultipleSolidGte6mmFirstFollowUpShape,
  pathwayStepOutOfScopeReason,
  requiresFirstFollowUpOriginAnswer,
  shouldClearGr4FollowUpFields,
} from "../../src/workflow/pathwayNavigation";
import {
  FLEISCHNER_MULTIPLE_SUBSOLID_MEASUREMENT_HELP_TEXT,
  multipleSubsolidFleischnerFields,
  multipleSubsolidPathwayFields,
} from "../../src/workflow/fields";
import type { ClinicalInputState } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  it("blocks continuing when nodule_count > 1 with only the solitary fields answered (issue #16 Candidate A: the multiple branch needs its own set-level facts instead of morphology)", () => {
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
      fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false,
    };
    expect(canContinuePastPathwayStep(followUpPathway)).toBe(true);
    // issue #16 Candidate D (sign-off 6376704317 B): the origin must be answered first.
    const { fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: _origin, ...unanswered } = followUpPathway;
    expect(canContinuePastPathwayStep(unanswered)).toBe(false);
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

// issue #16 Candidate A (final spec comment 5858670823 §8/§9, acceptance cases 24-28).
const validMultipleSubsolid: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: true,
  multiple_nodules_discrete_circumscribed: true,
};

describe("pathwayStepOutOfScopeReason (issue #16 Candidate A, replaces isNoduleCountOutOfScope)", () => {
  it("is null when nodule_count is unanswered", () => {
    expect(pathwayStepOutOfScopeReason({})).toBeNull();
  });

  it("is null for the solitary branch (nodule_count = 1), even with follow-up timepoint -- solitary navigation is unchanged", () => {
    expect(pathwayStepOutOfScopeReason({ nodule_count: 1 })).toBeNull();
    expect(pathwayStepOutOfScopeReason({ ...completePathway, assessment_timepoint: "follow-up" })).toBeNull();
  });

  it("case 28: a valid Candidate-A state has no out-of-scope reason (no notice shown)", () => {
    expect(pathwayStepOutOfScopeReason(validMultipleSubsolid)).toBeNull();
  });

  it("case 28: a multiple count with nothing else answered yet has no out-of-scope reason", () => {
    expect(pathwayStepOutOfScopeReason({ nodule_count: 2 })).toBeNull();
  });

  it("case 28 (updated for #16 Candidate D readiness P3-3): follow-up timepoint with multiple nodules -> multiple-follow-up once the origin is explicitly false; no reason yet while it is unanswered", () => {
    expect(
      pathwayStepOutOfScopeReason({ ...validMultipleSubsolid, assessment_timepoint: "follow-up", fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false }),
    ).toBe("multiple-follow-up");
    expect(
      pathwayStepOutOfScopeReason({ ...validMultipleSubsolid, assessment_timepoint: "follow-up" }),
    ).toBeNull();
  });

  it("Candidate-B expansion: F2 false alone is pending; an explicitly mixed set is out of scope", () => {
    expect(
      pathwayStepOutOfScopeReason({ ...validMultipleSubsolid, multiple_nodules_all_subsolid: false }),
    ).toBeNull();
    expect(
      pathwayStepOutOfScopeReason({
        ...validMultipleSubsolid,
        multiple_nodules_all_subsolid: false,
        multiple_nodules_all_solid: false,
      }),
    ).toBe("multiple-mixed-solid-subsolid");
  });

  it("case 28: a disseminated presentation (F3 false) -> multiple-disseminated", () => {
    expect(
      pathwayStepOutOfScopeReason({ ...validMultipleSubsolid, multiple_nodules_discrete_circumscribed: false }),
    ).toBe("multiple-disseminated");
  });
});

describe("canContinuePastPathwayStep: multiple-nodule branch (issue #16 Candidate A)", () => {
  it("case 27: a valid GR-5 shape can continue with no nodule_morphology and no measurement", () => {
    expect(validMultipleSubsolid.nodule_morphology).toBeUndefined();
    expect(canContinuePastPathwayStep(validMultipleSubsolid)).toBe(true);
  });

  it("blocks continuing while either set-level fact is unanswered", () => {
    const { multiple_nodules_all_subsolid, ...noF2 } = validMultipleSubsolid;
    const { multiple_nodules_discrete_circumscribed, ...noF3 } = validMultipleSubsolid;
    expect(canContinuePastPathwayStep(noF2)).toBe(false);
    expect(canContinuePastPathwayStep(noF3)).toBe(false);
  });

  it("blocks continuing while context or timepoint is unanswered", () => {
    const { assessment_context, ...noContext } = validMultipleSubsolid;
    const { assessment_timepoint, ...noTimepoint } = validMultipleSubsolid;
    expect(canContinuePastPathwayStep(noContext)).toBe(false);
    expect(canContinuePastPathwayStep(noTimepoint)).toBe(false);
  });

  it("blocks continuing for every out-of-scope reason", () => {
    expect(canContinuePastPathwayStep({ ...validMultipleSubsolid, assessment_timepoint: "follow-up" })).toBe(false);
    expect(canContinuePastPathwayStep({ ...validMultipleSubsolid, multiple_nodules_all_subsolid: false })).toBe(false);
    expect(
      canContinuePastPathwayStep({ ...validMultipleSubsolid, multiple_nodules_discrete_circumscribed: false }),
    ).toBe(false);
  });

  it("blocks continuing for a nodule_count that is neither 1 nor a whole number >= 2", () => {
    expect(canContinuePastPathwayStep({ ...validMultipleSubsolid, nodule_count: 0 })).toBe(false);
    expect(canContinuePastPathwayStep({ ...validMultipleSubsolid, nodule_count: 2.5 })).toBe(false);
  });
});

describe("isMultipleSubsolidShape (issue #16 Candidate A)", () => {
  it("case 27: true for the GR-5 shape with no diameter/volume -- the term that makes App.tsx's canEvaluate true without a measurement", () => {
    expect(validMultipleSubsolid.nodule_size_mm).toBeUndefined();
    expect(validMultipleSubsolid.nodule_volume_mm3).toBeUndefined();
    expect(isMultipleSubsolidShape(validMultipleSubsolid)).toBe(true);
    expect(isMultipleSubsolidShape({ ...validMultipleSubsolid, nodule_count: 2 })).toBe(true);
  });

  it("false whenever any GR-5 condition is not met", () => {
    expect(isMultipleSubsolidShape({ ...validMultipleSubsolid, nodule_count: 1 })).toBe(false);
    expect(isMultipleSubsolidShape({ ...validMultipleSubsolid, assessment_timepoint: "follow-up" })).toBe(false);
    expect(isMultipleSubsolidShape({ ...validMultipleSubsolid, assessment_context: "screening" })).toBe(false);
    expect(isMultipleSubsolidShape({ ...validMultipleSubsolid, multiple_nodules_all_subsolid: false })).toBe(false);
    expect(
      isMultipleSubsolidShape({ ...validMultipleSubsolid, multiple_nodules_discrete_circumscribed: false }),
    ).toBe(false);
    const { multiple_nodules_all_subsolid, ...noF2 } = validMultipleSubsolid;
    expect(isMultipleSubsolidShape(noF2)).toBe(false);
  });
});

describe("applyNoduleCountBranchReset (issue #16 Candidate A, final spec §9)", () => {
  // Mirrors App.tsx's handleChange exactly: set the edited value, then apply both resets.
  function edit(prev: ClinicalInputState, id: string, value: string | number | boolean | undefined) {
    const next: ClinicalInputState = { ...prev, [id]: value };
    return applyNoduleCountBranchReset(applyGr4FollowUpReset(next, id, value), id, value);
  }

  const solitaryWithEverything: ClinicalInputState = {
    nodule_morphology: "solid",
    assessment_context: "incidental",
    assessment_timepoint: "follow-up",
    nodule_count: 1,
    nodule_size_mm: 7,
    nodule_volume_mm3: 180,
    nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
    solid_component_diameter_measurements: [
      { valueMm: 4, conventionId: "fleischner-2017-solid-component-long-axis" },
    ],
    s3_volume_stability_criterion_met: true,
    s3_vdt_days: 700,
    s3_general_condition_precludes_further_workup_or_therapy: true,
    age: 55,
    known_malignancy_history: false,
    immunocompromised: false,
  };

  const multipleWithEverything: ClinicalInputState = {
    ...validMultipleSubsolid,
    fleischner_multiple_subsolid_any_gte_6mm: true,
    age: 55,
    known_malignancy_history: false,
    immunocompromised: false,
  };

  it("case 24: count 1 -> 3 clears morphology, diameter, volume, both measurement arrays, and all GR-4 follow-up fields; applicability kept", () => {
    const result = edit(solitaryWithEverything, "nodule_count", 3);
    expect(result.nodule_count).toBe(3);
    expect(result.nodule_morphology).toBeUndefined();
    expect(result.nodule_size_mm).toBeUndefined();
    expect(result.nodule_volume_mm3).toBeUndefined();
    expect(result.nodule_diameter_measurements).toBeUndefined();
    expect(result.solid_component_diameter_measurements).toBeUndefined();
    expect(result.s3_volume_stability_criterion_met).toBeUndefined();
    expect(result.s3_vdt_days).toBeUndefined();
    expect(result.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
    expect(result.age).toBe(55);
    expect(result.known_malignancy_history).toBe(false);
    expect(result.immunocompromised).toBe(false);
  });

  it("case 25: count 3 -> 1 clears F2, F3, F4; applicability kept", () => {
    const result = edit(multipleWithEverything, "nodule_count", 1);
    expect(result.multiple_nodules_all_subsolid).toBeUndefined();
    expect(result.multiple_nodules_discrete_circumscribed).toBeUndefined();
    expect(result.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    expect(result.age).toBe(55);
  });

  it("clearing nodule_count leaves both branches: solitary and multiple fields are all cleared", () => {
    const fromMultiple = edit(multipleWithEverything, "nodule_count", undefined);
    expect(fromMultiple.multiple_nodules_all_subsolid).toBeUndefined();
    expect(fromMultiple.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    const fromSolitary = edit(solitaryWithEverything, "nodule_count", undefined);
    expect(fromSolitary.nodule_morphology).toBeUndefined();
    expect(fromSolitary.nodule_size_mm).toBeUndefined();
  });

  it("case 26: 1 -> 3 -> 1 never resurrects a solitary field", () => {
    const toMultiple = edit(solitaryWithEverything, "nodule_count", 3);
    const backToSolitary = edit(toMultiple, "nodule_count", 1);
    expect(backToSolitary.nodule_morphology).toBeUndefined();
    expect(backToSolitary.nodule_size_mm).toBeUndefined();
    expect(backToSolitary.nodule_volume_mm3).toBeUndefined();
    expect(backToSolitary.nodule_diameter_measurements).toBeUndefined();
    expect(backToSolitary.solid_component_diameter_measurements).toBeUndefined();
    expect(backToSolitary.s3_volume_stability_criterion_met).toBeUndefined();
    expect(backToSolitary.s3_vdt_days).toBeUndefined();
    expect(backToSolitary.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
  });

  it("case 26: 3 -> 1 -> 3 never resurrects a multiple-subsolid field", () => {
    const toSolitary = edit(multipleWithEverything, "nodule_count", 1);
    const backToMultiple = edit(toSolitary, "nodule_count", 3);
    expect(backToMultiple.multiple_nodules_all_subsolid).toBeUndefined();
    expect(backToMultiple.multiple_nodules_discrete_circumscribed).toBeUndefined();
    expect(backToMultiple.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
  });

  it("case 26b: count 3 -> 4 clears nothing", () => {
    expect(edit(multipleWithEverything, "nodule_count", 4)).toEqual({ ...multipleWithEverything, nodule_count: 4 });
  });

  it("case 26b: editing F4 itself clears nothing", () => {
    expect(edit(multipleWithEverything, "fleischner_multiple_subsolid_any_gte_6mm", false)).toEqual({
      ...multipleWithEverything,
      fleischner_multiple_subsolid_any_gte_6mm: false,
    });
  });

  it("case 26b: editing F2/F3 to true clears nothing", () => {
    expect(edit(multipleWithEverything, "multiple_nodules_all_subsolid", true)).toEqual(multipleWithEverything);
    expect(edit(multipleWithEverything, "multiple_nodules_discrete_circumscribed", true)).toEqual(
      multipleWithEverything,
    );
  });

  it("case 26b: editing an applicability fact clears nothing", () => {
    expect(edit(multipleWithEverything, "age", 70)).toEqual({ ...multipleWithEverything, age: 70 });
    expect(edit(multipleWithEverything, "immunocompromised", true)).toEqual({
      ...multipleWithEverything,
      immunocompromised: true,
    });
  });

  it("case 26c: timepoint -> follow-up clears F4 only; F2/F3 retained", () => {
    const result = edit(multipleWithEverything, "assessment_timepoint", "follow-up");
    expect(result.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    expect(result.multiple_nodules_all_subsolid).toBe(true);
    expect(result.multiple_nodules_discrete_circumscribed).toBe(true);
  });

  it("case 26c: context changed away from incidental clears F4 only; F2/F3 retained", () => {
    const result = edit(multipleWithEverything, "assessment_context", "screening");
    expect(result.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    expect(result.multiple_nodules_all_subsolid).toBe(true);
    expect(result.multiple_nodules_discrete_circumscribed).toBe(true);
  });

  it("case 26c: F2 -> false clears F4; F2 (now false) and F3 retained", () => {
    const result = edit(multipleWithEverything, "multiple_nodules_all_subsolid", false);
    expect(result.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    expect(result.multiple_nodules_all_subsolid).toBe(false);
    expect(result.multiple_nodules_discrete_circumscribed).toBe(true);
  });

  it("case 26c: F3 -> false clears F4; F2 and F3 (now false) retained", () => {
    const result = edit(multipleWithEverything, "multiple_nodules_discrete_circumscribed", false);
    expect(result.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
    expect(result.multiple_nodules_all_subsolid).toBe(true);
    expect(result.multiple_nodules_discrete_circumscribed).toBe(false);
  });

  it("an F4 cleared by leaving the GR-5 shape is not resurrected on re-entry", () => {
    const left = edit(multipleWithEverything, "assessment_timepoint", "follow-up");
    const back = edit(left, "assessment_timepoint", "initial");
    expect(back.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();
  });
});

describe("F4 clinician-facing wording (issue #16 implementation-readiness sign-off 5858952610 §4)", () => {
  it("the F4 help text states the binding Fleischner whole-nodule measurement convention verbatim", () => {
    expect(FLEISCHNER_MULTIPLE_SUBSOLID_MEASUREMENT_HELP_TEXT).toBe(
      "When determining whether any subsolid nodule is 6 mm or larger, use the established Fleischner whole-nodule diameter convention: average the long- and short-axis diameters and round to the nearest whole millimeter.",
    );
  });

  it("App.tsx renders the F4 help text in the multiple-subsolid step-2 block", () => {
    const appSource = readFileSync(join(__dirname, "../../src/ui/App.tsx"), "utf-8");
    expect(appSource).toContain("{FLEISCHNER_MULTIPLE_SUBSOLID_MEASUREMENT_HELP_TEXT}");
  });

  it("the F4 field keeps its approved label and stays a single set-level boolean (no measurement field introduced)", () => {
    expect(multipleSubsolidFleischnerFields).toEqual([
      {
        id: "fleischner_multiple_subsolid_any_gte_6mm",
        label:
          "Fleischner: at least one subsolid nodule measures 6 mm or larger (Yes = at least one ≥6 mm; No = all <6 mm)",
        type: "boolean",
      },
    ]);
  });

  it("the F2/F3 fields keep their approved labels", () => {
    expect(multipleSubsolidPathwayFields.map((f) => [f.id, f.label])).toEqual([
      ["multiple_nodules_all_subsolid", "All nodules are subsolid (pure ground-glass and/or part-solid); none is fully solid"],
      [
        "multiple_nodules_discrete_circumscribed",
        "Nodules are discrete/circumscribed (not a disseminated, diffuse, miliary, or metastatic-pattern presentation)",
      ],
    ]);
  });
});

describe("issue #16 Candidate B workflow/reset", () => {
  const validB: ClinicalInputState = {
    assessment_context: "incidental",
    assessment_timepoint: "initial",
    nodule_count: 3,
    multiple_nodules_all_subsolid: false,
    multiple_nodules_all_solid: true,
    multiple_nodules_discrete_circumscribed: true,
    fleischner_multiple_solid_all_lt_6mm: true,
    fleischner_multiple_solid_risk_category: "high",
  };

  function edit(prev: ClinicalInputState, id: string, value: string | number | boolean | undefined) {
    return applyNoduleCountBranchReset(
      applyGr4FollowUpReset({ ...prev, [id]: value }, id, value),
      id,
      value,
    );
  }

  it("recognizes the exact GR-6 shape without a conventional single-lesion measurement", () => {
    expect(isMultipleSolidLt6mmShape(validB)).toBe(true);
    expect(canContinuePastPathwayStep(validB)).toBe(true);
    expect(validB.nodule_size_mm).toBeUndefined();
    expect(validB.nodule_volume_mm3).toBeUndefined();
  });

  it("requires all-solid and all-<6 answers after all-subsolid=false", () => {
    const noSolid: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: false,
      multiple_nodules_discrete_circumscribed: true,
    };
    expect(canContinuePastPathwayStep(noSolid)).toBe(false);
    expect(canContinuePastPathwayStep({ ...noSolid, multiple_nodules_all_solid: true })).toBe(false);
  });

  it("returns the approved mixed / follow-up / disseminated reasons; >=6 mm is no longer a stop (#16 Candidate C)", () => {
    expect(pathwayStepOutOfScopeReason({ ...validB, multiple_nodules_all_solid: false })).toBe(
      "multiple-mixed-solid-subsolid",
    );
    expect(
      pathwayStepOutOfScopeReason({ ...validB, fleischner_multiple_solid_all_lt_6mm: false }),
    ).toBeNull();
    expect(
      canContinuePastPathwayStep({ ...validB, fleischner_multiple_solid_all_lt_6mm: false }),
    ).toBe(true);
    expect(
      pathwayStepOutOfScopeReason({ ...validB, assessment_timepoint: "follow-up", fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false }),
    ).toBe("multiple-follow-up");
    expect(
      pathwayStepOutOfScopeReason({ ...validB, multiple_nodules_discrete_circumscribed: false }),
    ).toBe("multiple-disseminated");
  });

  it("Candidate A -> B clears A F4; Candidate B -> A clears B-specific state", () => {
    const a: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_subsolid_any_gte_6mm: true,
    };
    const toB = edit(a, "multiple_nodules_all_subsolid", false);
    expect(toB.fleischner_multiple_subsolid_any_gte_6mm).toBeUndefined();

    const toA = edit(validB, "multiple_nodules_all_subsolid", true);
    expect(toA.multiple_nodules_all_solid).toBeUndefined();
    expect(toA.fleischner_multiple_solid_all_lt_6mm).toBeUndefined();
    expect(toA.fleischner_multiple_solid_risk_category).toBeUndefined();

    const clearedBranch = edit(validB, "multiple_nodules_all_subsolid", undefined);
    expect(clearedBranch.multiple_nodules_all_solid).toBeUndefined();
    expect(clearedBranch.fleischner_multiple_solid_all_lt_6mm).toBeUndefined();
    expect(clearedBranch.fleischner_multiple_solid_risk_category).toBeUndefined();
  });

  it("leaving the GR-6 shape clears risk and re-entry does not resurrect it", () => {
    for (const [id, value] of [
      ["assessment_context", "screening"],
      ["assessment_timepoint", "follow-up"],
      ["multiple_nodules_all_solid", false],
      ["multiple_nodules_discrete_circumscribed", false],
      ["fleischner_multiple_solid_all_lt_6mm", false],
    ] as const) {
      expect(edit(validB, id, value).fleischner_multiple_solid_risk_category).toBeUndefined();
    }
    const left = edit(validB, "assessment_timepoint", "follow-up");
    const back = edit(left, "assessment_timepoint", "initial");
    expect(back.fleischner_multiple_solid_risk_category).toBeUndefined();
  });

  it("case 37: count 1 -> 3 from a full solitary state clears solitary morphology/measurement/GR-4 fields", () => {
    const solitary: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      nodule_morphology: "solid",
      nodule_size_mm: 7,
      nodule_volume_mm3: 150,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 700,
    };
    const multiple = edit(solitary, "nodule_count", 3);
    for (const key of ["nodule_morphology", "nodule_size_mm", "nodule_volume_mm3", "s3_volume_stability_criterion_met", "s3_vdt_days"] as const) {
      expect(multiple[key]).toBeUndefined();
    }
  });

  it("cases 38/39: crossing A <-> B keeps the source-neutral discrete/circumscribed fact", () => {
    const a: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_subsolid_any_gte_6mm: false,
    };
    expect(edit(a, "multiple_nodules_all_subsolid", false).multiple_nodules_discrete_circumscribed).toBe(true);
    expect(edit(validB, "multiple_nodules_all_subsolid", true).multiple_nodules_discrete_circumscribed).toBe(true);
  });

  it("case 40: all_solid -> false clears B-F3 as well as risk; the other exits keep B-F1/B-F3", () => {
    const mixed = edit(validB, "multiple_nodules_all_solid", false);
    expect(mixed.fleischner_multiple_solid_all_lt_6mm).toBeUndefined();
    expect(mixed.fleischner_multiple_solid_risk_category).toBeUndefined();
    for (const [id, value] of [
      ["assessment_context", "screening"],
      ["assessment_timepoint", "follow-up"],
      ["multiple_nodules_discrete_circumscribed", false],
    ] as const) {
      const left = edit(validB, id, value);
      expect(left.multiple_nodules_all_solid).toBe(true);
      expect(left.fleischner_multiple_solid_all_lt_6mm).toBe(true);
    }
  });

  it("case 41: no exit route resurrects risk on re-entering the exact B shape, including 3 -> 1 -> 3", () => {
    for (const [id, leave, back] of [
      ["assessment_context", "screening", "incidental"],
      ["assessment_timepoint", "follow-up", "initial"],
      ["multiple_nodules_discrete_circumscribed", false, true],
      ["fleischner_multiple_solid_all_lt_6mm", false, true],
    ] as const) {
      const reentered = edit(edit(validB, id, leave), id, back);
      expect(isMultipleSolidLt6mmShape(reentered)).toBe(true);
      expect(reentered.fleischner_multiple_solid_risk_category).toBeUndefined();
    }
    const viaSolid = edit(edit(edit(validB, "multiple_nodules_all_solid", false), "multiple_nodules_all_solid", true),
      "fleischner_multiple_solid_all_lt_6mm", true);
    expect(isMultipleSolidLt6mmShape(viaSolid)).toBe(true);
    expect(viaSolid.fleischner_multiple_solid_risk_category).toBeUndefined();

    const viaSolitary = edit(edit(validB, "nodule_count", 1), "nodule_count", 3);
    for (const key of [
      "multiple_nodules_all_subsolid",
      "multiple_nodules_all_solid",
      "multiple_nodules_discrete_circumscribed",
      "fleischner_multiple_solid_all_lt_6mm",
      "fleischner_multiple_solid_risk_category",
    ] as const) {
      expect(viaSolitary[key]).toBeUndefined();
    }
  });

  it("case 41b: count 3 -> 4, risk edits, re-affirming B facts, and applicability edits clear nothing", () => {
    for (const [id, value] of [
      ["nodule_count", 4],
      ["fleischner_multiple_solid_risk_category", "low"],
      ["multiple_nodules_all_solid", true],
      ["fleischner_multiple_solid_all_lt_6mm", true],
      ["multiple_nodules_discrete_circumscribed", true],
      ["age", 70],
      ["known_malignancy_history", false],
      ["immunocompromised", false],
    ] as const) {
      expect(edit(validB, id, value)).toEqual({ ...validB, [id]: value });
    }
  });
});

describe("issue #16 Candidate C workflow/reset (final spec 6264850117 cases 20-26)", () => {
  const SAFEGUARD = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
  const shapeC: ClinicalInputState = {
    assessment_context: "incidental",
    assessment_timepoint: "initial",
    nodule_count: 3,
    multiple_nodules_all_subsolid: false,
    multiple_nodules_all_solid: true,
    multiple_nodules_discrete_circumscribed: true,
    fleischner_multiple_solid_all_lt_6mm: false,
  };
  const validC: ClinicalInputState = {
    ...shapeC,
    fleischner_multiple_solid_no_individual_nodule_requires_solitary_management: true,
  };

  function edit(prev: ClinicalInputState, id: string, value: string | number | boolean | undefined) {
    return applyNoduleCountBranchReset(
      applyGr4FollowUpReset({ ...prev, [id]: value }, id, value),
      id,
      value,
    );
  }

  it("case 20: recognizes the exact GR-7 shape with no single-lesion measurement and no step-1 stop", () => {
    expect(isMultipleSolidGte6mmShape(shapeC)).toBe(true);
    expect(isMultipleSolidLt6mmShape(shapeC)).toBe(false);
    expect(pathwayStepOutOfScopeReason(shapeC)).toBeNull();
    expect(canContinuePastPathwayStep(shapeC)).toBe(true);
    expect(shapeC.nodule_size_mm).toBeUndefined();
    expect(shapeC.nodule_volume_mm3).toBeUndefined();
    for (const nodule_count of [2, 7]) {
      expect(isMultipleSolidGte6mmShape({ ...shapeC, nodule_count })).toBe(true);
    }
    for (const override of [
      { nodule_count: 1 },
      { nodule_count: 2.5 },
      { assessment_context: "screening" as const },
      { assessment_timepoint: "follow-up" as const },
      { multiple_nodules_all_subsolid: true },
      { multiple_nodules_all_solid: false },
      { multiple_nodules_discrete_circumscribed: false },
      { fleischner_multiple_solid_all_lt_6mm: true },
      { fleischner_multiple_solid_all_lt_6mm: undefined },
    ]) {
      expect(isMultipleSolidGte6mmShape({ ...shapeC, ...override })).toBe(false);
    }
    // the size answer is still required before continuing
    expect(
      canContinuePastPathwayStep({ ...shapeC, fleischner_multiple_solid_all_lt_6mm: undefined }),
    ).toBe(false);
  });

  it("case 21: the out-of-scope reason type has exactly the three remaining reasons", () => {
    const source = readFileSync(
      join(__dirname, "../../src/workflow/pathwayNavigation.ts"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    const start = source.indexOf("export type PathwayStepOutOfScopeReason =");
    const decl = source.slice(start, source.indexOf(";", start));
    expect([...decl.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "multiple-follow-up",
      "multiple-mixed-solid-subsolid",
      "multiple-disseminated",
    ]);
    expect(source).not.toContain("\"multiple-solid-gte-6mm\"");
    expect(pathwayStepOutOfScopeReason({ ...shapeC, multiple_nodules_all_solid: false })).toBe(
      "multiple-mixed-solid-subsolid",
    );
    expect(
      pathwayStepOutOfScopeReason({ ...shapeC, assessment_timepoint: "follow-up", fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false }),
    ).toBe("multiple-follow-up");
    expect(
      pathwayStepOutOfScopeReason({ ...shapeC, multiple_nodules_discrete_circumscribed: false }),
    ).toBe("multiple-disseminated");
  });

  const exits = [
    ["nodule_count", 1],
    ["nodule_count", undefined],
    ["nodule_count", 2.5],
    ["multiple_nodules_all_subsolid", true],
    ["multiple_nodules_all_subsolid", undefined],
    ["multiple_nodules_all_solid", false],
    ["multiple_nodules_all_solid", undefined],
    ["fleischner_multiple_solid_all_lt_6mm", true],
    ["fleischner_multiple_solid_all_lt_6mm", undefined],
    ["multiple_nodules_discrete_circumscribed", false],
    ["multiple_nodules_discrete_circumscribed", undefined],
    ["assessment_timepoint", "follow-up"],
    ["assessment_timepoint", undefined],
    ["assessment_context", "screening"],
    ["assessment_context", undefined],
  ] as const;

  it("case 22: every exit from the full C state clears the safeguard", () => {
    for (const [id, value] of exits) {
      const left = edit(validC, id, value);
      expect(left[SAFEGUARD], `${id}=${String(value)}`).toBeUndefined();
      expect(isMultipleSolidGte6mmShape(left)).toBe(false);
    }
  });

  it("case 23: no exit resurrects the safeguard on re-entering the exact C shape, including 3 -> 1 -> 3", () => {
    for (const [id, leave, back] of [
      ["assessment_context", "screening", "incidental"],
      ["assessment_timepoint", "follow-up", "initial"],
      ["multiple_nodules_discrete_circumscribed", false, true],
      ["fleischner_multiple_solid_all_lt_6mm", true, false],
      ["fleischner_multiple_solid_all_lt_6mm", undefined, false],
    ] as const) {
      const reentered = edit(edit(validC, id, leave), id, back);
      expect(isMultipleSolidGte6mmShape(reentered), id).toBe(true);
      expect(reentered[SAFEGUARD], id).toBeUndefined();
    }
    const viaSolid = edit(
      edit(edit(validC, "multiple_nodules_all_solid", false), "multiple_nodules_all_solid", true),
      "fleischner_multiple_solid_all_lt_6mm",
      false,
    );
    expect(isMultipleSolidGte6mmShape(viaSolid)).toBe(true);
    expect(viaSolid[SAFEGUARD]).toBeUndefined();

    let viaSubsolid = validC;
    for (const [id, value] of [
      ["multiple_nodules_all_subsolid", true],
      ["multiple_nodules_all_subsolid", false],
      ["multiple_nodules_all_solid", true],
      ["fleischner_multiple_solid_all_lt_6mm", false],
    ] as const) viaSubsolid = edit(viaSubsolid, id, value);
    expect(isMultipleSolidGte6mmShape(viaSubsolid)).toBe(true);
    expect(viaSubsolid[SAFEGUARD]).toBeUndefined();

    const viaSolitary = edit(edit(validC, "nodule_count", 1), "nodule_count", 3);
    for (const key of [
      "multiple_nodules_all_subsolid",
      "multiple_nodules_all_solid",
      "multiple_nodules_discrete_circumscribed",
      "fleischner_multiple_solid_all_lt_6mm",
      SAFEGUARD,
    ] as const) {
      expect(viaSolitary[key]).toBeUndefined();
    }
  });

  it("case 24: B (risk set) -> all_lt_6mm=false clears the risk; the safeguard stays absent", () => {
    const b: ClinicalInputState = {
      ...shapeC,
      fleischner_multiple_solid_all_lt_6mm: true,
      fleischner_multiple_solid_risk_category: "high",
    };
    const toC = edit(b, "fleischner_multiple_solid_all_lt_6mm", false);
    expect(isMultipleSolidGte6mmShape(toC)).toBe(true);
    expect(toC.fleischner_multiple_solid_risk_category).toBeUndefined();
    expect(toC[SAFEGUARD]).toBeUndefined();
  });

  it("case 25: C (safeguard set) -> all_lt_6mm=true clears the safeguard; the risk stays absent", () => {
    for (const safeguard of [true, false]) {
      const toB = edit({ ...shapeC, [SAFEGUARD]: safeguard }, "fleischner_multiple_solid_all_lt_6mm", true);
      expect(isMultipleSolidLt6mmShape(toB)).toBe(true);
      expect(toB[SAFEGUARD]).toBeUndefined();
      expect(toB.fleischner_multiple_solid_risk_category).toBeUndefined();
    }
  });

  it("case 26: count 3 -> 4, safeguard edits, re-affirming C facts, and applicability edits clear nothing", () => {
    for (const [id, value] of [
      ["nodule_count", 4],
      [SAFEGUARD, false],
      [SAFEGUARD, undefined],
      ["assessment_context", "incidental"],
      ["assessment_timepoint", "initial"],
      ["multiple_nodules_all_subsolid", false],
      ["multiple_nodules_all_solid", true],
      ["multiple_nodules_discrete_circumscribed", true],
      ["fleischner_multiple_solid_all_lt_6mm", false],
      ["age", 70],
      ["known_malignancy_history", true],
      ["immunocompromised", true],
    ] as const) {
      expect(edit(validC, id, value)).toEqual({ ...validC, [id]: value });
    }
  });
});

describe("issue #16 Candidate D workflow/reset (final spec 6411027075 §7.2, §8, cases 38-44; readiness 6614358295 P3-1/P3-2/P3-3)", () => {
  const OR = "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed";
  const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
  const OM = "clinician_decides_no_further_routine_nodule_surveillance";
  const RK = "fleischner_multiple_solid_risk_category";
  const applicability = { age: 60, known_malignancy_history: false, immunocompromised: false };
  const shapeD: ClinicalInputState = { assessment_context: "incidental", assessment_timepoint: "follow-up", [OR]: true };
  const validD: ClinicalInputState = { ...shapeD, ...applicability, [SG]: true, [OM]: false, [RK]: "high" };
  const shapeC: ClinicalInputState = {
    assessment_context: "incidental",
    assessment_timepoint: "initial",
    nodule_count: 3,
    multiple_nodules_all_subsolid: false,
    multiple_nodules_all_solid: true,
    multiple_nodules_discrete_circumscribed: true,
    fleischner_multiple_solid_all_lt_6mm: false,
  };

  /** Mirrors App.tsx handleChange, including the previous state (readiness P3-1). */
  function edit(prev: ClinicalInputState, id: string, value: string | number | boolean | undefined) {
    return applyNoduleCountBranchReset(applyGr4FollowUpReset({ ...prev, [id]: value }, id, value), id, value, prev);
  }
  const defined = (state: ClinicalInputState) =>
    Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined));

  it("case 38: every incidental follow-up must answer the origin first; the GR-8 shape continues with no count; out-of-scope reasons per origin (P3-3)", () => {
    const solitaryFollowUp: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
    };
    const multipleFollowUp: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 3,
      multiple_nodules_all_subsolid: false,
      multiple_nodules_all_solid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_solid_all_lt_6mm: false,
    };
    expect(canContinuePastPathwayStep(solitaryFollowUp)).toBe(false);
    expect(canContinuePastPathwayStep(multipleFollowUp)).toBe(false);
    expect(canContinuePastPathwayStep({ ...solitaryFollowUp, [OR]: false })).toBe(true);
    expect(canContinuePastPathwayStep(shapeD)).toBe(true);
    expect(canContinuePastPathwayStep({ ...shapeD, nodule_count: 3 })).toBe(true);
    expect(canContinuePastPathwayStep({ assessment_context: "incidental", assessment_timepoint: "follow-up" })).toBe(false);
    expect(pathwayStepOutOfScopeReason(shapeD)).toBeNull();
    expect(pathwayStepOutOfScopeReason({ ...shapeD, nodule_count: 3 })).toBeNull();
    expect(pathwayStepOutOfScopeReason(multipleFollowUp)).toBeNull();
    expect(pathwayStepOutOfScopeReason({ ...multipleFollowUp, [OR]: false })).toBe("multiple-follow-up");
    expect(canContinuePastPathwayStep({ ...multipleFollowUp, [OR]: false })).toBe(false);
    // initial assessments are never asked the origin
    expect(requiresFirstFollowUpOriginAnswer({ assessment_context: "incidental", assessment_timepoint: "initial" })).toBe(false);
    expect(canContinuePastPathwayStep(shapeC)).toBe(true);
  });

  it("case 39: the GR-8 shape mirrors GR-8 exactly and is independent of count and morphology", () => {
    expect(isMultipleSolidGte6mmFirstFollowUpShape(shapeD)).toBe(true);
    for (const stray of [{ nodule_count: 1 }, { nodule_count: 4 }, { nodule_morphology: "part-solid" }, { multiple_nodules_all_solid: false }]) {
      expect(isMultipleSolidGte6mmFirstFollowUpShape({ ...shapeD, ...stray })).toBe(true);
    }
    for (const breaker of [
      { [OR]: false },
      { [OR]: undefined },
      { assessment_timepoint: "initial" },
      { assessment_timepoint: undefined },
      { assessment_context: "screening" },
    ]) {
      expect(isMultipleSolidGte6mmFirstFollowUpShape({ ...shapeD, ...breaker })).toBe(false);
    }
    expect(requiresFirstFollowUpOriginAnswer(shapeD)).toBe(true);
  });

  it("case 40: each §8 edit deletes exactly the listed fields", () => {
    // leavesGr8 via timepoint/context: SG, OM, RK and OR itself
    expect(defined(edit(validD, "assessment_timepoint", "initial"))).toEqual({
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      ...applicability,
    });
    expect(defined(edit(validD, "assessment_context", undefined))).toEqual({
      assessment_timepoint: "follow-up",
      ...applicability,
    });
    // OR away from true: SG, OM, RK
    for (const value of [false, undefined]) {
      expect(defined(edit(validD, OR, value))).toEqual(
        defined({ assessment_context: "incidental", assessment_timepoint: "follow-up", [OR]: value, ...applicability }),
      );
    }
    // OR -> true: the current-appearance facts and the S3 follow-up fields
    const solitaryFollowUp: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      [OR]: false,
      nodule_size_mm: 7,
      nodule_volume_mm3: 150,
      nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
      solid_component_diameter_measurements: [{ valueMm: 3, conventionId: "fleischner-2017-solid-component-long-axis" }],
      multiple_nodules_all_subsolid: false,
      multiple_nodules_all_solid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_subsolid_any_gte_6mm: true,
      fleischner_multiple_solid_all_lt_6mm: false,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 700,
      s3_general_condition_precludes_further_workup_or_therapy: false,
      ...applicability,
    };
    expect(defined(edit(solitaryFollowUp, OR, true))).toEqual({ ...shapeD, ...applicability });
    // cascade: SG away from true -> OM, RK; OM away from false -> RK
    for (const value of [false, undefined]) {
      expect(defined(edit(validD, SG, value))).toEqual(defined({ ...shapeD, ...applicability, [SG]: value }));
    }
    for (const value of [true, undefined]) {
      expect(defined(edit(validD, OM, value))).toEqual(defined({ ...shapeD, ...applicability, [SG]: true, [OM]: value }));
    }
  });

  it("case 41 (P3-1, shared-field rule): on an established GR-8 episode, count/set-fact edits and re-affirming the GR-8 facts -- including the origin itself -- never delete SG, OM or RK", () => {
    for (const [id, value] of [
      ["nodule_count", 1],
      ["nodule_count", 3],
      ["nodule_count", undefined],
      ["multiple_nodules_all_subsolid", true],
      ["multiple_nodules_all_subsolid", false],
      ["multiple_nodules_all_subsolid", undefined],
      ["multiple_nodules_all_solid", false],
      ["multiple_nodules_all_solid", undefined],
      ["multiple_nodules_discrete_circumscribed", false],
      ["fleischner_multiple_solid_all_lt_6mm", true],
      ["fleischner_multiple_solid_all_lt_6mm", undefined],
      ["assessment_context", "incidental"],
      ["assessment_timepoint", "follow-up"],
      [OR, true],
      [SG, true],
      [OM, false],
      [RK, "low"],
      ["age", 70],
    ] as const) {
      const next = edit(validD, id, value);
      expect(next[SG], `${id}=${String(value)}`).toBe(true);
      expect(next[OM], `${id}=${String(value)}`).toBe(false);
      expect(next[RK], `${id}=${String(value)}`).toBe(id === RK ? value : "high");
      expect(next[OR], `${id}=${String(value)}`).toBe(true);
    }
  });

  it("P3-1: without the previous state, a timepoint re-affirmation is treated as a real change (conservative default); with it, it is a no-op", () => {
    const withoutPrevious = applyNoduleCountBranchReset({ ...validD }, "assessment_timepoint", "follow-up");
    expect(withoutPrevious[SG]).toBeUndefined();
    expect(withoutPrevious[RK]).toBeUndefined();
    expect(applyNoduleCountBranchReset({ ...validD }, "assessment_timepoint", "follow-up", validD)).toEqual(validD);
  });

  it("case 41 (origin identity): current count/set edits never clear the historical origin", () => {
    let state = validD;
    for (const [id, value] of [
      ["nodule_count", 1],
      ["nodule_count", 4],
      ["multiple_nodules_all_solid", false],
      ["nodule_morphology", "pure-ground-glass"],
    ] as const) {
      state = edit(state, id, value);
      expect(state[OR]).toBe(true);
    }
  });

  it("case 42: Candidate C (safeguard set) -> timepoint follow-up -> origin true leaves the safeguard absent; it is never resurrected across exit/re-entry", () => {
    for (const safeguard of [true, false]) {
      const c = { ...shapeC, ...applicability, [SG]: safeguard };
      const followUp = edit(c, "assessment_timepoint", "follow-up");
      expect(followUp[SG]).toBeUndefined();
      const d = edit(followUp, OR, true);
      expect(d[SG]).toBeUndefined();
      const answered = edit(edit(edit(d, SG, true), OM, false), RK, "low");
      const reentered = edit(edit(answered, OR, false), OR, true);
      expect(reentered[SG]).toBeUndefined();
      expect(reentered[OM]).toBeUndefined();
      expect(reentered[RK]).toBeUndefined();
    }
  });

  it("case 42 (P3-2, raw stale state): a genuine GR-7/initial -> GR-8/follow-up transition clears a stale Candidate-C safeguard even when a stray origin=true was already present", () => {
    const staleC: ClinicalInputState = {
      ...shapeC,
      ...applicability,
      [SG]: true,
      [OR]: true,
      [OM]: false,
      [RK]: "high",
    };
    const next = edit(staleC, "assessment_timepoint", "follow-up");
    expect(isMultipleSolidGte6mmFirstFollowUpShape(next)).toBe(true);
    expect(next[SG]).toBeUndefined();
    expect(next[OM]).toBeUndefined();
    expect(next[RK]).toBeUndefined();
  });

  it("case 42 (P3-2): the shared-field exemption is limited to count/set facts -- a context edit away from incidental is never exempt", () => {
    const next = edit(validD, "assessment_context", "screening");
    for (const key of [SG, OM, RK, OR] as const) expect(next[key]).toBeUndefined();
  });

  it("GR-8 cascade is a state invariant: no edit order leaves OM without SG=true or RK without SG=true and OM=false", () => {
    const raw: ClinicalInputState = { ...shapeD, [SG]: false, [OM]: true, [RK]: "high" };
    const next = edit(raw, "age", 70);
    expect(next[OM]).toBeUndefined();
    expect(next[RK]).toBeUndefined();
    const rawOm: ClinicalInputState = { ...shapeD, [SG]: true, [OM]: true, [RK]: "low" };
    expect(edit(rawOm, "age", 70)[RK]).toBeUndefined();
  });

  it("case 43: a solitary follow-up with S3 fields set -> origin true clears the S3 follow-up fields", () => {
    const solitary: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      [OR]: false,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 700,
      s3_general_condition_precludes_further_workup_or_therapy: true,
    };
    const next = edit(solitary, OR, true);
    expect(next.s3_volume_stability_criterion_met).toBeUndefined();
    expect(next.s3_vdt_days).toBeUndefined();
    expect(next.s3_general_condition_precludes_further_workup_or_therapy).toBeUndefined();
    expect(shouldClearGr4FollowUpFields(OR, true)).toBe(true);
    expect(shouldClearGr4FollowUpFields(OR, undefined)).toBe(true);
    expect(shouldClearGr4FollowUpFields(OR, false)).toBe(false);
  });

  it("case 44: off GR-8 the new fields' reset rules never touch Candidate A/B/C state", () => {
    const validB: ClinicalInputState = { ...shapeC, fleischner_multiple_solid_all_lt_6mm: true, [RK]: "high" };
    for (const [id, value] of [
      ["assessment_timepoint", "initial"],
      ["assessment_context", "incidental"],
      ["nodule_count", 4],
      ["age", 70],
    ] as const) {
      expect(edit(validB, id, value)).toEqual({ ...validB, [id]: value });
    }
  });
});
