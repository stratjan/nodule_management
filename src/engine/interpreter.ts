// The custom minimal interpreter (ADR-0009): evaluates the fixed eq/gte/lt/lte, AND-only
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
