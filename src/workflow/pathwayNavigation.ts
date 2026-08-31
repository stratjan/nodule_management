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
