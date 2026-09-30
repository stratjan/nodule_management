// Pure wizard navigation predicates (ADR-0006 repo layout: workflow = question sequencing/
// navigation only, no clinical logic). These decide whether the UI may advance past pathway
// identification -- they mirror the Clinical Pathway Gates' structural nodule_count requirements
// (GR-1..GR-4: nodule_count = 1; GR-5: nodule_count >= 2) at the navigation level ONLY. The
// engine's Clinical Pathway Gate (src/engine/evaluate.ts) remains the sole clinical authority on
// whether a pathway actually matched; these predicates never substitute for that evaluation, they
// only decide when to show the "Continue" step and which fields to ask.
import type { ClinicalInputState } from "../engine/types";
import { multipleSubsolidPathwayFields, pathwayFields } from "./fields";

type FieldValue = string | number | boolean | undefined;

/** issue #16 Candidate A: why a multiple-nodule pathway-step input is outside what this Rule-Set
 * Release covers -- a navigation mirror only, never a clinical outcome. */
export type PathwayStepOutOfScopeReason = "multiple-follow-up" | "multiple-contains-solid" | "multiple-disseminated";

/** issue #16 Candidate A: the multiple-nodule branch applies to a whole-number nodule count of at
 * least 2. Any other value (1, cleared, fractional) is not the multiple branch. */
function isMultipleNoduleCount(value: FieldValue): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 2;
}

/**
 * issue #16 Candidate A: branch-aware replacement for the former isNoduleCountOutOfScope. For a
 * multiple-nodule count, reports the specific reason the entered pathway-identity facts fall
 * outside Candidate A (follow-up timepoint; a set containing a fully solid nodule; a disseminated/
 * diffuse/miliary/metastatic-pattern presentation), or null when nothing entered so far excludes
 * it. The solitary branch (nodule_count = 1) and an unanswered count always return null --
 * solitary navigation is unchanged.
 */
export function pathwayStepOutOfScopeReason(
  input: Partial<ClinicalInputState>,
): PathwayStepOutOfScopeReason | null {
  if (!isMultipleNoduleCount(input.nodule_count)) return null;
  if (input.assessment_timepoint === "follow-up") return "multiple-follow-up";
  if (input.multiple_nodules_all_subsolid === false) return "multiple-contains-solid";
  if (input.multiple_nodules_discrete_circumscribed === false) return "multiple-disseminated";
  return null;
}

function allAnswered(input: Partial<ClinicalInputState>, ids: string[]): boolean {
  return ids.every((id) => input[id as keyof ClinicalInputState] !== undefined);
}

export function canContinuePastPathwayStep(input: Partial<ClinicalInputState>): boolean {
  if (input.nodule_count === 1) {
    return allAnswered(
      input,
      pathwayFields.map((field) => field.id),
    );
  }
  if (isMultipleNoduleCount(input.nodule_count)) {
    // issue #16 Candidate A: nodule_morphology is neither shown nor required in the multiple
    // branch -- the two set-level facts replace it.
    return (
      allAnswered(input, [
        "assessment_context",
        "assessment_timepoint",
        "nodule_count",
        ...multipleSubsolidPathwayFields.map((field) => field.id),
      ]) && pathwayStepOutOfScopeReason(input) === null
    );
  }
  return false;
}

/** issue #16 Candidate A: the exact input shape GR-5 gates on (incidental, initial, nodule_count
 * >= 2, subsolid-only set, discrete/circumscribed presentation) -- decides whether step 2 shows the
 * Fleischner multiple-subsolid size-state question instead of the measurement block. */
export function isMultipleSubsolidShape(input: Partial<ClinicalInputState>): boolean {
  return (
    input.assessment_context === "incidental" &&
    input.assessment_timepoint === "initial" &&
    isMultipleNoduleCount(input.nodule_count) &&
    input.multiple_nodules_all_subsolid === true &&
    input.multiple_nodules_discrete_circumscribed === true
  );
}

/**
 * issue #15 Candidate A0, renamed for Candidate B1 (issue #28), extended for Candidate C: pure
 * decision for App.tsx's handleChange -- whether an edit to one of the four pathway-identity
 * fields should clear every GR-4-follow-up-only field (`s3_volume_stability_criterion_met`,
 * `s3_vdt_days`, `s3_general_condition_precludes_further_workup_or_therapy`). All three fields are
 * only ever meaningful for the exact solid/incidental/follow-up/solitary pathway shape; any edit
 * that moves one of those four fields away from the value that shape requires invalidates all
 * three, so none must ever silently carry over onto a Clinical Input State it was never given for.
 * Extracted as its own pure predicate (mirroring canContinuePastPathwayStep above) so this reset
 * rule is unit-testable without a React component harness. Editing any OTHER
 * field (including the S3 applicability facts age/known_malignancy_history/immunocompromised, and
 * the three GR-4 follow-up fields themselves) must never clear any of them. The predicate itself is
 * field-agnostic -- it only answers "did this edit leave the GR-4 pathway shape?" -- so it governs
 * all three fields identically with no duplicated pathway-identity logic anywhere else.
 */
export function shouldClearGr4FollowUpFields(
  id: string,
  value: string | number | boolean | undefined,
): boolean {
  return (
    (id === "nodule_morphology" && value !== "solid") ||
    (id === "assessment_timepoint" && value !== "follow-up") ||
    (id === "assessment_context" && value !== "incidental") ||
    (id === "nodule_count" && value !== 1)
  );
}

/**
 * issue #15 Candidate B1, extended for Candidate C: the actual GR-4 follow-up field reset
 * shouldClearGr4FollowUpFields decides, applied to a Clinical Input State -- the one authoritative
 * implementation App.tsx's handleChange calls, so there is no second, separately-maintained copy
 * of "delete all three fields" anywhere in the UI layer, and so the full reset (not merely the
 * boolean decision) is unit-testable without a React component harness.
 */
export function applyGr4FollowUpReset(
  next: ClinicalInputState,
  id: string,
  value: string | number | boolean | undefined,
): ClinicalInputState {
  if (!shouldClearGr4FollowUpFields(id, value)) return next;
  const reset = { ...next };
  delete reset.s3_volume_stability_criterion_met;
  delete reset.s3_vdt_days;
  delete reset.s3_general_condition_precludes_further_workup_or_therapy;
  return reset;
}

/**
 * issue #16 Candidate A (final spec §9): stale-state lifecycle across the solitary/multiple
 * boundary, called from App.tsx's handleChange after applyGr4FollowUpReset (disjoint field sets,
 * order-independent). Only ever deletes -- nothing repopulates a deleted field, so re-entering
 * either branch never resurrects a prior value.
 *
 * - Leaving solitary (nodule_count edited to any value !== 1): the solitary morphology/measurement
 *   fields are deleted (the two measurement arrays defensively -- App.tsx never stores them).
 * - Leaving multiple (nodule_count edited to anything that is not a whole number >= 2): the three
 *   multiple-subsolid facts are deleted.
 * - Leaving the GR-5 shape without leaving multiple (timepoint !== "initial", context !==
 *   "incidental", or either set-level pathway fact edited to anything other than true): only the
 *   Fleischner size-state fact is deleted -- a pathway-specific step-2 field never survives its
 *   pathway shape.
 *
 * Editing nodule_count between two values >= 2, the size-state fact itself, the set-level facts to
 * true, or the source-neutral applicability facts (age/known_malignancy_history/immunocompromised)
 * clears nothing.
 */
export function applyNoduleCountBranchReset(
  next: ClinicalInputState,
  id: string,
  value: FieldValue,
): ClinicalInputState {
  const reset = { ...next };

  if (id === "nodule_count") {
    if (value !== 1) {
      delete reset.nodule_morphology;
      delete reset.nodule_size_mm;
      delete reset.nodule_volume_mm3;
      delete reset.nodule_diameter_measurements;
      delete reset.solid_component_diameter_measurements;
    }
    if (!isMultipleNoduleCount(value)) {
      delete reset.multiple_nodules_all_subsolid;
      delete reset.multiple_nodules_discrete_circumscribed;
      delete reset.fleischner_multiple_subsolid_any_gte_6mm;
    }
    return reset;
  }

  const leavesGr5Shape =
    (id === "assessment_timepoint" && value !== "initial") ||
    (id === "assessment_context" && value !== "incidental") ||
    (id === "multiple_nodules_all_subsolid" && value !== true) ||
    (id === "multiple_nodules_discrete_circumscribed" && value !== true);
  if (leavesGr5Shape) {
    delete reset.fleischner_multiple_subsolid_any_gte_6mm;
  }
  return reset;
}
