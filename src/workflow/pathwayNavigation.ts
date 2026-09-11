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
 * issue #15 Candidate A0: pure decision for App.tsx's handleChange -- whether an edit to one of
 * the four pathway-identity fields should clear a previously-answered S3 follow-up attestation
 * (`s3_volume_stability_criterion_met`). The attestation is only ever meaningful for the exact
 * solid/incidental/follow-up/solitary pathway shape; any edit that moves one of those four fields
 * away from the value that shape requires invalidates a prior attestation, so it must never
 * silently carry over onto a Clinical Input State it was never given for. Extracted as its own
 * pure predicate (mirroring canContinuePastPathwayStep/isNoduleCountOutOfScope above) so this
 * reset rule is unit-testable without a React component harness. Editing any OTHER field
 * (including the S3 applicability facts age/known_malignancy_history/immunocompromised, and the
 * attestation field itself) must never clear it.
 */
export function shouldClearS3FollowUpCriterion(
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
