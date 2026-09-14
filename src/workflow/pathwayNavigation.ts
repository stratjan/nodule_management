// Pure wizard navigation predicates (ADR-0006 repo layout: workflow = question sequencing/
// navigation only, no clinical logic). These decide whether the UI may advance past pathway
// identification -- they mirror GR-1's structural nodule_count = 1 requirement at the
// navigation level ONLY. The engine's Clinical Pathway Gate (src/engine/evaluate.ts) remains
// the sole clinical authority on whether the pathway actually matched; this predicate never
// substitutes for that evaluation, it only decides when to show the "Continue" step.
import type { ClinicalInputState } from "../engine/types";
import { pathwayFields } from "./fields";

export function isNoduleCountOutOfScope(input: Partial<ClinicalInputState>): boolean {
  return input.nodule_count !== undefined && input.nodule_count !== 1;
}

export function canContinuePastPathwayStep(input: Partial<ClinicalInputState>): boolean {
  const allPathwayFieldsAnswered = pathwayFields.every(
    (field) => input[field.id as keyof ClinicalInputState] !== undefined,
  );
  return allPathwayFieldsAnswered && !isNoduleCountOutOfScope(input);
}

/**
 * issue #15 Candidate A0, renamed for Candidate B1 (issue #28): pure decision for App.tsx's
 * handleChange -- whether an edit to one of the four pathway-identity fields should clear every
 * GR-4-follow-up-only field (`s3_volume_stability_criterion_met`, `s3_vdt_days`). Both fields are
 * only ever meaningful for the exact solid/incidental/follow-up/solitary pathway shape; any edit
 * that moves one of those four fields away from the value that shape requires invalidates both,
 * so neither must ever silently carry over onto a Clinical Input State it was never given for.
 * Extracted as its own pure predicate (mirroring canContinuePastPathwayStep/isNoduleCountOutOfScope
 * above) so this reset rule is unit-testable without a React component harness. Editing any OTHER
 * field (including the S3 applicability facts age/known_malignancy_history/immunocompromised, and
 * the two GR-4 follow-up fields themselves) must never clear either. The predicate itself is
 * field-agnostic -- it only answers "did this edit leave the GR-4 pathway shape?" -- so it governs
 * both fields identically with no duplicated pathway-identity logic anywhere else.
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
 * issue #15 Candidate B1: the actual GR-4 follow-up field reset shouldClearGr4FollowUpFields
 * decides, applied to a Clinical Input State -- the one authoritative implementation App.tsx's
 * handleChange calls, so there is no second, separately-maintained copy of "delete both fields"
 * anywhere in the UI layer, and so the full reset (not merely the boolean decision) is
 * unit-testable without a React component harness.
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
  return reset;
}
