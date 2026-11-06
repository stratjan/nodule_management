// Pure wizard navigation predicates (ADR-0006 repo layout: workflow = question sequencing/
// navigation only, no clinical logic). These decide whether the UI may advance past pathway
// identification -- they mirror the Clinical Pathway Gates' structural nodule_count requirements
// (GR-1..GR-4: nodule_count = 1; GR-5/GR-6/GR-7: nodule_count >= 2) at the navigation level ONLY.
// issue #16 Candidate D: GR-8 (incidental, follow-up, episode origin confirmed true) requires no
// nodule_count at all; GR-4-r2 additionally requires the same origin fact to be false, so every
// incidental follow-up must answer the origin question before continuing.
// The engine's Clinical Pathway Gate (src/engine/evaluate.ts) remains the sole clinical authority on
// whether a pathway actually matched; these predicates never substitute for that evaluation, they
// only decide when to show the "Continue" step and which fields to ask.
import type {
  ClinicalInputState,
  DecisionExecutionTrace,
  SourceEvaluationOutcome,
} from "../engine/types";
import {
  applicabilityFields,
  clinicianDispositionFields,
  multipleSolidFleischnerRiskFields,
  multipleSolidGte6mmSafeguardFields,
  pathwayFields,
} from "./fields";
import type { FieldDef } from "./fields";

type FieldValue = string | number | boolean | undefined;

/** issue #16 Candidate A: why a multiple-nodule pathway-step input is outside what this Rule-Set
 * Release covers -- a navigation mirror only, never a clinical outcome. Candidate C removed the
 * former multiple-solid >=6 mm stop: that shape is now the GR-7 pathway. */
export type PathwayStepOutOfScopeReason =
  | "multiple-follow-up"
  | "multiple-mixed-solid-subsolid"
  | "multiple-disseminated";

/** issue #16 Candidate A: the multiple-nodule branch applies to a whole-number nodule count of at
 * least 2. Any other value (1, cleared, fractional) is not the multiple branch. */
function isMultipleNoduleCount(value: FieldValue): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 2;
}

/** issue #16 Candidate D: every incidental follow-up must answer the episode-origin question with a
 * definite yes or no (sign-off 6376704317 B) -- GR-4-r2 and GR-8 both reference it. */
export function requiresFirstFollowUpOriginAnswer(input: Partial<ClinicalInputState>): boolean {
  return input.assessment_context === "incidental" && input.assessment_timepoint === "follow-up";
}

/** issue #16 Candidate D: exact GR-8 shape -- mirrors GR-8's conditions. Independent of the current
 * nodule count, morphology, and set composition (HITL 6338095264 Q2; sign-off C). */
export function isMultipleSolidGte6mmFirstFollowUpShape(input: Partial<ClinicalInputState>): boolean {
  return (
    input.assessment_context === "incidental" &&
    input.assessment_timepoint === "follow-up" &&
    input.fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed === true
  );
}

/** issue #16 Candidate D: GR-8 step-2 progressive disclosure -- the clinician-omission question is
 * rendered only once the governing-lesion safeguard is confirmed. Presentation only. */
export function showsGr8ClinicianDisposition(input: Partial<ClinicalInputState>): boolean {
  return input.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management === true;
}

/** issue #16 Candidate D: the Fleischner risk question is rendered only when the clinician chose to
 * continue to the Fleischner 18–24-month guidance. Presentation only. */
export function showsGr8FleischnerRisk(input: Partial<ClinicalInputState>): boolean {
  return (
    showsGr8ClinicianDisposition(input) && input.clinician_decides_no_further_routine_nodule_surveillance === false
  );
}

/** issue #16 Candidate D (spec §7.4 item 9): the GR-8 step-2 fields rendered at this state, built
 * from the same disclosure predicates App.tsx renders with. Used only to label the unresolved
 * inputs the engine dry run reports -- an unresolved field that is not rendered yet is not listed. */
export function gr8RenderedFields(input: Partial<ClinicalInputState>): FieldDef[] {
  return [
    ...multipleSolidGte6mmSafeguardFields,
    ...(showsGr8ClinicianDisposition(input) ? clinicianDispositionFields : []),
    ...(showsGr8FleischnerRisk(input) ? multipleSolidFleischnerRiskFields : []),
    ...applicabilityFields,
  ];
}

/**
 * issue #16 Candidate A: branch-aware replacement for the former isNoduleCountOutOfScope. For a
 * multiple-nodule count, reports the specific reason the entered pathway-identity facts fall
 * outside Candidate A (follow-up timepoint; a set containing a fully solid nodule; a disseminated/
 * diffuse/miliary/metastatic-pattern presentation), or null when nothing entered so far excludes
 * it. The solitary branch (nodule_count = 1) and an unanswered count always return null --
 * solitary navigation is unchanged.
 *
 * issue #16 Candidate D: the GR-8 shape is never out of scope, whatever the current count. A
 * multiple-nodule follow-up is reported as "multiple-follow-up" only once the origin is explicitly
 * false; while the origin is still unanswered nothing is reported yet (continuing is blocked by
 * canContinuePastPathwayStep until it is answered).
 */
export function pathwayStepOutOfScopeReason(
  input: Partial<ClinicalInputState>,
): PathwayStepOutOfScopeReason | null {
  if (isMultipleSolidGte6mmFirstFollowUpShape(input)) return null;
  if (!isMultipleNoduleCount(input.nodule_count)) return null;
  if (input.assessment_timepoint === "follow-up") {
    return input.fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed === false
      ? "multiple-follow-up"
      : null;
  }
  if (
    input.multiple_nodules_all_subsolid === false &&
    input.multiple_nodules_all_solid === false
  ) return "multiple-mixed-solid-subsolid";
  if (input.multiple_nodules_discrete_circumscribed === false) return "multiple-disseminated";
  return null;
}

function allAnswered(input: Partial<ClinicalInputState>, ids: string[]): boolean {
  return ids.every((id) => input[id as keyof ClinicalInputState] !== undefined);
}

export function canContinuePastPathwayStep(input: Partial<ClinicalInputState>): boolean {
  // issue #16 Candidate D (sign-off 6376704317 B/C): every incidental follow-up answers the origin
  // first; the GR-8 branch then continues with no count or morphology.
  if (
    requiresFirstFollowUpOriginAnswer(input) &&
    input.fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed === undefined
  ) return false;
  if (isMultipleSolidGte6mmFirstFollowUpShape(input)) return true;
  if (input.nodule_count === 1) {
    return allAnswered(
      input,
      pathwayFields.map((field) => field.id),
    );
  }
  if (isMultipleNoduleCount(input.nodule_count)) {
    if (!allAnswered(input, [
      "assessment_context",
      "assessment_timepoint",
      "nodule_count",
      "multiple_nodules_all_subsolid",
      "multiple_nodules_discrete_circumscribed",
    ])) return false;
    if (input.multiple_nodules_all_subsolid === false) {
      if (input.multiple_nodules_all_solid === undefined) return false;
      if (
        input.multiple_nodules_all_solid === true &&
        input.fleischner_multiple_solid_all_lt_6mm === undefined
      ) return false;
    }
    return pathwayStepOutOfScopeReason(input) === null;
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

/** issue #16 Candidate B: exact bounded GR-6 shape. */
export function isMultipleSolidLt6mmShape(input: Partial<ClinicalInputState>): boolean {
  return (
    input.assessment_context === "incidental" &&
    input.assessment_timepoint === "initial" &&
    isMultipleNoduleCount(input.nodule_count) &&
    input.multiple_nodules_all_subsolid === false &&
    input.multiple_nodules_all_solid === true &&
    input.multiple_nodules_discrete_circumscribed === true &&
    input.fleischner_multiple_solid_all_lt_6mm === true
  );
}

/** issue #16 Candidate C: exact bounded GR-7 shape -- mirrors GR-7's conditions; identical to the
 * GR-6 shape except that at least one solid nodule is >=6 mm (all_lt_6mm === false). */
export function isMultipleSolidGte6mmShape(input: Partial<ClinicalInputState>): boolean {
  return (
    input.assessment_context === "incidental" &&
    input.assessment_timepoint === "initial" &&
    isMultipleNoduleCount(input.nodule_count) &&
    input.multiple_nodules_all_subsolid === false &&
    input.multiple_nodules_all_solid === true &&
    input.multiple_nodules_discrete_circumscribed === true &&
    input.fleischner_multiple_solid_all_lt_6mm === false
  );
}

/**
 * issue #16 Candidate C (readiness 6268250838, binding clarification 2): whether the Results page
 * shows the neutral not-confirmed notice beside a Source Evaluation Outcome. True only when GR-7
 * (or, issue #16 Candidate D / HITL Q6, GR-8) matched, the clinician did not confirm the
 * governing-nodule safeguard (false, never absent), and
 * Fleischner returned OUTSIDE_CURRENT_RULESET_SCOPE. Reads the already-computed Decision Execution
 * Trace only -- presentation, never evaluation: it does not redirect, evaluate a solitary pathway,
 * identify a lesion, or alter the trace or the outcome.
 */
export function showsSolitarySafeguardNotConfirmedNotice(
  trace: DecisionExecutionTrace,
  outcome: SourceEvaluationOutcome,
): boolean {
  return (
    trace.pathwaySelection.state === "MATCHED" &&
    (trace.pathwaySelection.clinicalPathwayId === "incidental-multiple-solid-gte-6mm-initial" ||
      trace.pathwaySelection.clinicalPathwayId === "incidental-multiple-solid-gte-6mm-first-follow-up") &&
    trace.normalizedClinicalInputState
      .fleischner_multiple_solid_no_individual_nodule_requires_solitary_management === false &&
    outcome.recommendationSourceId === "fleischner" &&
    outcome.state === "OUTSIDE_CURRENT_RULESET_SCOPE"
  );
}

/**
 * issue #15 Candidate A0, renamed for Candidate B1 (issue #28), extended for Candidate C and
 * Candidate D (GR-4-r2's origin = false): pure decision for App.tsx's handleChange -- whether an
 * edit to one of the five pathway-identity fields should clear every GR-4-follow-up-only field
 * (`s3_volume_stability_criterion_met`, `s3_vdt_days`,
 * `s3_general_condition_precludes_further_workup_or_therapy`). All three fields are only ever
 * meaningful for the exact solid/incidental/follow-up/solitary/origin-false pathway shape; any edit
 * that moves one of those five fields away from the value that shape requires invalidates all
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
    (id === "nodule_count" && value !== 1) ||
    // issue #16 Candidate D: GR-4-r2 requires the episode origin to be false.
    (id === "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed" && value !== false)
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
 * - issue #16 Candidate C: leaving the GR-7 shape (any GR-7 pathway fact edited away from its GR-7
 *   value, including all_lt_6mm edited to anything other than false) deletes the governing-nodule
 *   safeguard; leaving the GR-6 shape (including all_lt_6mm edited to anything other than true)
 *   deletes the Candidate-B risk category. A Candidate-B risk value therefore never coexists with
 *   the GR-7 shape, and a Candidate-C safeguard never coexists with the GR-6 shape.
 *
 * Editing nodule_count between two values >= 2, the size-state fact itself, the set-level facts to
 * true, or the source-neutral applicability facts (age/known_malignancy_history/immunocompromised)
 * clears nothing.
 *
 * issue #16 Candidate D (final spec §8; readiness 6614358295 P3-1/P3-2). SG = governing-lesion
 * safeguard, OM = clinician omission decision, RK = Fleischner risk category, OR = episode origin:
 * - leaving GR-8 (`leavesGr8`): timepoint !== follow-up or context !== incidental deletes OR itself
 *   and OM, plus SG/RK if OR was true; OR edited to anything other than true deletes SG, OM, RK.
 * - OR edited to true deletes the current-appearance facts (count, morphology, measurements, set
 *   facts) so the GR-8 branch never carries them. It does NOT delete SG/OM/RK (P3-1): a
 *   re-affirmation of an already-valid GR-8 origin preserves valid downstream state. Freshness of
 *   SG on entry is already guaranteed, since the initial -> follow-up timepoint edit that any GR-7 ->
 *   GR-8 transition requires deletes SG and RK (`leavesGr7`/`leavesGr6`), and that edit is never
 *   exempted (P3-2).
 * - shared-field rule (sign-off C; P3-2): on a resulting GR-8 shape, edits of the count or the
 *   set-level facts (including the all_subsolid/all_solid cascades) never delete SG/RK -- the GR-8
 *   lifecycle of SG/OM/RK is never tied to the current imaging appearance. Timepoint/context edits
 *   are not exempt.
 * - cascade: SG edited away from true deletes OM and RK; OM edited away from false deletes RK. On a
 *   resulting GR-8 shape the same cascade is also enforced as a state invariant, so a stale OM/RK
 *   can never coexist with an SG/OM value that no longer permits it.
 * - re-affirmation (P3-1): when the caller passes the `previous` state and the edited field's value
 *   is unchanged, the edit is a no-op and nothing is deleted. This is the only use of `previous`;
 *   it is what distinguishes re-affirming timepoint = follow-up on an established GR-8 episode
 *   (preserve) from a genuine initial -> follow-up transition (delete SG/RK, P3-2), which are
 *   otherwise the identical (next, id, value). Without `previous`, every edit is treated as a real
 *   change -- the conservative, fail-safe default.
 */
export function applyNoduleCountBranchReset(
  next: ClinicalInputState,
  id: string,
  value: FieldValue,
  previous?: ClinicalInputState,
): ClinicalInputState {
  if (previous !== undefined && previous[id as keyof ClinicalInputState] === value) return next;
  const reset = { ...next };

  // issue #16 Candidate D shared-field rule: only count/set-fact edits on the GR-8 shape are exempt.
  const preservesGr8SharedFields =
    isMultipleSolidGte6mmFirstFollowUpShape(next) && GR8_SHARED_FIELD_EDIT_IDS.has(id);

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
      delete reset.multiple_nodules_all_solid;
      delete reset.multiple_nodules_discrete_circumscribed;
      delete reset.fleischner_multiple_subsolid_any_gte_6mm;
      delete reset.fleischner_multiple_solid_all_lt_6mm;
      if (!preservesGr8SharedFields) {
        delete reset.fleischner_multiple_solid_risk_category;
        delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
      }
    }
    return enforceGr8Cascade(reset);
  }

  applyGr8Lifecycle(reset, id, value);

  const leavesGr5 =
    (id === "assessment_timepoint" && value !== "initial") ||
    (id === "assessment_context" && value !== "incidental") ||
    (id === "multiple_nodules_all_subsolid" && value !== true) ||
    (id === "multiple_nodules_discrete_circumscribed" && value !== true);
  if (leavesGr5) delete reset.fleischner_multiple_subsolid_any_gte_6mm;

  if (id === "multiple_nodules_all_subsolid" && value !== false) {
    delete reset.multiple_nodules_all_solid;
    delete reset.fleischner_multiple_solid_all_lt_6mm;
    if (!preservesGr8SharedFields) {
      delete reset.fleischner_multiple_solid_risk_category;
      delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
    }
  }
  if (id === "multiple_nodules_all_solid" && value !== true) {
    delete reset.fleischner_multiple_solid_all_lt_6mm;
    if (!preservesGr8SharedFields) {
      delete reset.fleischner_multiple_solid_risk_category;
      delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
    }
  }

  const leavesGr6 =
    (id === "assessment_timepoint" && value !== "initial") ||
    (id === "assessment_context" && value !== "incidental") ||
    (id === "multiple_nodules_all_subsolid" && value !== false) ||
    (id === "multiple_nodules_all_solid" && value !== true) ||
    (id === "multiple_nodules_discrete_circumscribed" && value !== true) ||
    (id === "fleischner_multiple_solid_all_lt_6mm" && value !== true);
  if (leavesGr6 && !preservesGr8SharedFields) delete reset.fleischner_multiple_solid_risk_category;

  const leavesGr7 =
    (id === "assessment_timepoint" && value !== "initial") ||
    (id === "assessment_context" && value !== "incidental") ||
    (id === "multiple_nodules_all_subsolid" && value !== false) ||
    (id === "multiple_nodules_all_solid" && value !== true) ||
    (id === "multiple_nodules_discrete_circumscribed" && value !== true) ||
    (id === "fleischner_multiple_solid_all_lt_6mm" && value !== false);
  if (leavesGr7 && !preservesGr8SharedFields) {
    delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
  }

  return enforceGr8Cascade(reset);
}

/** issue #16 Candidate D: the current-appearance edits that never invalidate an established GR-8
 * episode's safeguard/risk (sign-off C shared-field rule, readiness P3-2). Timepoint, context and
 * origin edits are deliberately absent. */
const GR8_SHARED_FIELD_EDIT_IDS: ReadonlySet<string> = new Set([
  "nodule_count",
  "multiple_nodules_all_subsolid",
  "multiple_nodules_all_solid",
  "multiple_nodules_discrete_circumscribed",
  "fleischner_multiple_solid_all_lt_6mm",
]);

/** issue #16 Candidate D: `leavesGr8`, the origin-entry reset, and the SG/OM edit cascade (final
 * spec §8; readiness P3-1). Mutates the already-copied `reset` only. */
function applyGr8Lifecycle(reset: ClinicalInputState, id: string, value: FieldValue): void {
  const leavesFollowUpContext =
    (id === "assessment_timepoint" && value !== "follow-up") ||
    (id === "assessment_context" && value !== "incidental");
  if (leavesFollowUpContext) {
    if (reset.fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed === true) {
      delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
      delete reset.fleischner_multiple_solid_risk_category;
    }
    delete reset.fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed;
    delete reset.clinician_decides_no_further_routine_nodule_surveillance;
  }

  if (id === "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed") {
    if (value !== true) {
      delete reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management;
      delete reset.clinician_decides_no_further_routine_nodule_surveillance;
      delete reset.fleischner_multiple_solid_risk_category;
    } else {
      delete reset.nodule_count;
      delete reset.nodule_morphology;
      delete reset.nodule_size_mm;
      delete reset.nodule_volume_mm3;
      delete reset.nodule_diameter_measurements;
      delete reset.solid_component_diameter_measurements;
      delete reset.multiple_nodules_all_subsolid;
      delete reset.multiple_nodules_all_solid;
      delete reset.multiple_nodules_discrete_circumscribed;
      delete reset.fleischner_multiple_subsolid_any_gte_6mm;
      delete reset.fleischner_multiple_solid_all_lt_6mm;
    }
  }

  if (
    id === "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management" &&
    value !== true
  ) {
    delete reset.clinician_decides_no_further_routine_nodule_surveillance;
    delete reset.fleischner_multiple_solid_risk_category;
  }
  if (id === "clinician_decides_no_further_routine_nodule_surveillance" && value !== false) {
    delete reset.fleischner_multiple_solid_risk_category;
  }
}

/** issue #16 Candidate D: on the GR-8 shape, OM exists only while SG is true, and RK only while
 * SG is true and OM is false -- the §8 cascade as a state invariant, so no edit order can leave a
 * stale downstream answer behind. Off GR-8 nothing is touched. */
function enforceGr8Cascade(reset: ClinicalInputState): ClinicalInputState {
  if (!isMultipleSolidGte6mmFirstFollowUpShape(reset)) return reset;
  if (reset.fleischner_multiple_solid_no_individual_nodule_requires_solitary_management !== true) {
    delete reset.clinician_decides_no_further_routine_nodule_surveillance;
    delete reset.fleischner_multiple_solid_risk_category;
  } else if (reset.clinician_decides_no_further_routine_nodule_surveillance !== false) {
    delete reset.fleischner_multiple_solid_risk_category;
  }
  return reset;
}
