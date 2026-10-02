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
  pathwayStepOutOfScopeReason,
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

  it("case 28: follow-up timepoint with multiple nodules -> multiple-follow-up", () => {
    expect(
      pathwayStepOutOfScopeReason({ ...validMultipleSubsolid, assessment_timepoint: "follow-up" }),
    ).toBe("multiple-follow-up");
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

  it("returns the approved mixed / >=6 / follow-up / disseminated reasons", () => {
    expect(pathwayStepOutOfScopeReason({ ...validB, multiple_nodules_all_solid: false })).toBe(
      "multiple-mixed-solid-subsolid",
    );
    expect(
      pathwayStepOutOfScopeReason({ ...validB, fleischner_multiple_solid_all_lt_6mm: false }),
    ).toBe("multiple-solid-gte-6mm");
    expect(pathwayStepOutOfScopeReason({ ...validB, assessment_timepoint: "follow-up" })).toBe(
      "multiple-follow-up",
    );
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
