// The custom minimal interpreter (ADR-0009): evaluates the fixed eq/gte/gt/lt/lte, AND-only
// condition vocabulary against a Clinical Input State. No functions, no expression strings,
// no dynamic eval — every operator is explicit, deterministic, and side-effect free.
import type { Condition, ClinicalInputState } from "./types";

export interface ConditionEvaluation {
  /** false if any referenced field is missing/undefined on the input. */
  allFieldsPresent: boolean;
  /** Only meaningful when allFieldsPresent is true. */
  matched: boolean;
  missingFields: string[];
}

function evaluateOne(condition: Condition, actual: string | number | boolean): boolean {
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "gte":
      return (actual as number) >= (condition.value as number);
    case "gt":
      return (actual as number) > (condition.value as number);
    case "lt":
      return (actual as number) < (condition.value as number);
    case "lte":
      return (actual as number) <= (condition.value as number);
  }
}

export function evaluateConditions(
  conditions: Condition[],
  input: ClinicalInputState,
): ConditionEvaluation {
  const record = input as unknown as Record<string, string | number | boolean | undefined>;
  const missingFields = conditions
    .map((c) => c.field)
    .filter((field) => record[field] === undefined);

  if (missingFields.length > 0) {
    return { allFieldsPresent: false, matched: false, missingFields };
  }

  const matched = conditions.every((c) => evaluateOne(c, record[c.field]!));
  return { allFieldsPresent: true, matched, missingFields: [] };
}

export type ConditionClassificationState = "MATCHED" | "NOT_MATCHED" | "INDETERMINATE";

export interface ConditionClassification {
  state: ConditionClassificationState;
  missingFields: string[];
}

/**
 * Three-valued classification used for Clinical Pathway Gate selection (issue #17), distinct
 * from evaluateConditions' binary allFieldsPresent/matched shape used everywhere else (Source
 * Applicability Rules, Atomic Clinical Rules): a supplied value that already contradicts a
 * condition makes the whole AND-conjunction NOT_MATCHED even if another referenced field is
 * still missing -- a missing field must never mask an already-definitive mismatch, since that
 * would force INSUFFICIENT_INPUT/INDETERMINATE for a pathway already excluded by known data.
 * INDETERMINATE only when nothing supplied contradicts yet at least one referenced field is
 * still missing. Same fixed AND-only operator vocabulary as evaluateConditions -- no new
 * operators, no second rule language (ADR-0009).
 */
export function classifyConditions(
  conditions: Condition[],
  input: ClinicalInputState,
): ConditionClassification {
  const record = input as unknown as Record<string, string | number | boolean | undefined>;
  const missingFields: string[] = [];
  let contradicted = false;

  for (const c of conditions) {
    const actual = record[c.field];
    if (actual === undefined) {
      missingFields.push(c.field);
      continue;
    }
    if (!evaluateOne(c, actual)) {
      contradicted = true;
    }
  }

  if (contradicted) return { state: "NOT_MATCHED", missingFields };
  if (missingFields.length > 0) return { state: "INDETERMINATE", missingFields };
  return { state: "MATCHED", missingFields: [] };
}
