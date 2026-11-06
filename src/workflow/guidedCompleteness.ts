// ADR-0012 §6 (issue #16 Candidate D): guided-path completeness read from structured Decision
// Execution Trace data only. The deterministic engine is the sole clinical oracle -- this module
// never decides which inputs a rule needs or whether it matches, and never reads human-readable
// `reason` text. Pure: trace in, classification out.
//
// It does not catch anything either: evaluate() throwing an authoring-defect error (for example
// AmbiguousClinicalDispositionMatchError) happens before a trace exists, so such an error always
// propagates through the caller's existing error path and is never turned into "incomplete".
import type { DecisionExecutionTrace, UnresolvedRequiredInput } from "../engine/types";

export type GuidedCompleteness =
  /** An explicit terminal state (ADR-0012 §1). */
  | { state: "complete" }
  | { state: "incomplete"; unresolved: UnresolvedRequiredInput[] }
  /** NO_PATHWAY_MATCHED: deliberately not classified here (ADR-0012 §6; issue #40). */
  | { state: "unclassified" };

function unresolvedKey(item: UnresolvedRequiredInput): string {
  switch (item.kind) {
    case "field":
      return `field:${item.field}`;
    case "any-of-fields":
      return `any-of-fields:${item.fields.join(",")}`;
    case "convention-bound-measurement":
      return `convention-bound-measurement:${item.container}:${item.conventionId}:${item.problem}`;
  }
}

function dedupe(items: UnresolvedRequiredInput[]): UnresolvedRequiredInput[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = unresolvedKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function guidedCompleteness(trace: DecisionExecutionTrace): GuidedCompleteness {
  const selection = trace.pathwaySelection;
  if (selection.state === "INSUFFICIENT_INPUT") {
    return {
      state: "incomplete",
      unresolved: dedupe(
        trace.clinicalPathwayGates
          .filter((gate) => gate.state === "INDETERMINATE")
          .flatMap((gate) => gate.missingFields.map((field): UnresolvedRequiredInput => ({ kind: "field", field }))),
      ),
    };
  }
  if (selection.state === "NO_PATHWAY_MATCHED") return { state: "unclassified" };

  const disposition = trace.clinicalDispositionEvaluation;
  if (disposition?.state === "INSUFFICIENT_INPUT") {
    return { state: "incomplete", unresolved: dedupe(disposition.unresolvedRequiredInputs ?? []) };
  }
  if (disposition?.state === "DISPOSITION") return { state: "complete" };

  const unresolvedOutcomes = trace.sourceEvaluationOutcomes.filter(
    (outcome) => outcome.state === "INSUFFICIENT_INPUT",
  );
  if (unresolvedOutcomes.length > 0) {
    // An INSUFFICIENT_INPUT outcome without structured data would be an engine defect; it still
    // stays incomplete, never complete.
    return {
      state: "incomplete",
      unresolved: dedupe(unresolvedOutcomes.flatMap((outcome) => outcome.unresolvedRequiredInputs ?? [])),
    };
  }

  return { state: "complete" };
}

/** The plain field ids named by unresolved inputs, in order and deduplicated -- for presentation
 * only (mapping to rendered question labels). Measurement-convention items name no field. */
export function unresolvedFieldIds(unresolved: UnresolvedRequiredInput[]): string[] {
  const ids = unresolved.flatMap((item) =>
    item.kind === "field" ? [item.field] : item.kind === "any-of-fields" ? item.fields : [],
  );
  return [...new Set(ids)];
}
