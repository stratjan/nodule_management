// The single pure evaluation entry point (ADR-0010's orchestration pipeline):
//   Clinical Input State
//     -> Clinical Pathway Gating Rule(s)
//     -> applicable Clinical Pathway
//     -> per-source Source Applicability Rule
//     -> per-source Atomic Clinical Rule evaluation
//     -> Source Evaluation Outcome (RECOMMENDATION | NOT_APPLICABLE
//                                    | OUTSIDE_CURRENT_RULESET_SCOPE | INSUFFICIENT_INPUT)
//     -> Recommendation Set (RECOMMENDATION-state entries only)
//     -> Decision Execution Trace
// Zero dependency on React or any UI code (ADR-0005).
import { evaluateConditions } from "./interpreter";
import type {
  AtomicClinicalRuleRevision,
  ClinicalInputState,
  DecisionExecutionTrace,
  PathwayGateRevision,
  RuleSetRelease,
  SourceApplicabilityRevision,
  SourceEvaluationOutcome,
} from "./types";

export const ENGINE_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1.0.0";

function isPathwayGate(r: RuleSetRelease["revisions"][number]): r is PathwayGateRevision {
  return r.kind === "pathway-gate";
}
function isSourceApplicability(
  r: RuleSetRelease["revisions"][number],
): r is SourceApplicabilityRevision {
  return r.kind === "source-applicability";
}
function isAtomicClinicalRule(
  r: RuleSetRelease["revisions"][number],
): r is AtomicClinicalRuleRevision {
  return r.kind === "atomic-clinical-rule";
}

function evaluateAtomicRule(
  rule: AtomicClinicalRuleRevision,
  input: ClinicalInputState,
): SourceEvaluationOutcome {
  const sourceId = rule.recommendationSourceId;

  const buildRecommendation = (basisUsed: "diameter" | "volume"): SourceEvaluationOutcome => ({
    recommendationSourceId: sourceId,
    state: "RECOMMENDATION",
    recommendation: {
      matchedRuleId: rule.ruleId,
      matchedRevisionId: rule.revisionId,
      clinicalEndpoint: rule.recommendation.clinicalEndpoint,
      intervals: rule.recommendation.intervals,
      rationale: rule.recommendation.rationale,
      provenance: rule.provenance,
      measurementBasisUsed: basisUsed,
    },
  });

  const outOfScope = (basisUsed: "diameter" | "volume"): SourceEvaluationOutcome => ({
    recommendationSourceId: sourceId,
    state: "OUTSIDE_CURRENT_RULESET_SCOPE",
    reason: `Source applies and sufficient ${basisUsed} input was given, but no Approved Atomic Clinical Rule in the Active Rule-Set Release covers this ${basisUsed}.`,
  });

  const insufficientInput = (missingFields: string[]): SourceEvaluationOutcome => ({
    recommendationSourceId: sourceId,
    state: "INSUFFICIENT_INPUT",
    reason: `Missing required input for rule-matching: ${missingFields.join(", ")}.`,
  });

  if (rule.measurementBasis === "diameter") {
    if (input.nodule_size_mm === undefined) {
      return {
        recommendationSourceId: sourceId,
        state: "INSUFFICIENT_INPUT",
        reason: "Diameter is required for this source and was not supplied.",
      };
    }
    const result = evaluateConditions(rule.diameterConditions!, input);
    if (!result.allFieldsPresent) {
      return insufficientInput(result.missingFields);
    }
    return result.matched ? buildRecommendation("diameter") : outOfScope("diameter");
  }

  // volume-preferred
  const hasVolume = input.nodule_volume_mm3 !== undefined;
  const hasDiameter = input.nodule_size_mm !== undefined;

  if (!hasVolume && !hasDiameter) {
    return {
      recommendationSourceId: sourceId,
      state: "INSUFFICIENT_INPUT",
      reason: "Neither diameter nor volume was supplied.",
    };
  }

  const volumeEval = hasVolume ? evaluateConditions(rule.volumeConditions!, input) : undefined;
  const diameterEval = hasDiameter ? evaluateConditions(rule.diameterConditions!, input) : undefined;

  const basisUsed: "diameter" | "volume" = hasVolume ? "volume" : "diameter";
  const basisEval = hasVolume ? volumeEval! : diameterEval!;

  if (!basisEval.allFieldsPresent) {
    return insufficientInput(basisEval.missingFields);
  }

  const matched = basisEval.matched;

  const discordant =
    hasVolume &&
    hasDiameter &&
    volumeEval!.allFieldsPresent &&
    diameterEval!.allFieldsPresent &&
    volumeEval!.matched !== diameterEval!.matched;

  const outcome = matched ? buildRecommendation(basisUsed) : outOfScope(basisUsed);

  if (discordant) {
    outcome.measurementDiscordance = true;
    outcome.measurementValues = {
      diameter: input.nodule_size_mm,
      volume: input.nodule_volume_mm3,
    };
  }

  return outcome;
}

function evaluateSource(
  applicability: SourceApplicabilityRevision,
  atomicRule: AtomicClinicalRuleRevision,
  input: ClinicalInputState,
): SourceEvaluationOutcome {
  const appResult = evaluateConditions(applicability.conditions, input);

  if (!appResult.allFieldsPresent) {
    return {
      recommendationSourceId: applicability.recommendationSourceId,
      state: "INSUFFICIENT_INPUT",
      reason: `Missing required applicability input: ${appResult.missingFields.join(", ")}.`,
    };
  }

  if (!appResult.matched) {
    return {
      recommendationSourceId: applicability.recommendationSourceId,
      state: "NOT_APPLICABLE",
      reason: "This source's own Source Applicability Rule did not match this Clinical Input State.",
    };
  }

  return evaluateAtomicRule(atomicRule, input);
}

/**
 * The one pure evaluation entry point: Clinical Input State + Active Rule-Set Release in,
 * Decision Execution Trace (carrying a Source Evaluation Outcome per Recommendation Source
 * present in the Release, plus the resulting Recommendation Set) out.
 */
export function evaluate(
  input: ClinicalInputState,
  release: RuleSetRelease,
): DecisionExecutionTrace {
  const gate = release.revisions.find(isPathwayGate);
  if (!gate) {
    throw new Error("Active Rule-Set Release contains no Clinical Pathway Gate revision.");
  }

  const gateResult = evaluateConditions(gate.conditions, input);
  const gatePassed = gateResult.allFieldsPresent && gateResult.matched;

  const trace: DecisionExecutionTrace = {
    activeRuleSetReleaseId: release.releaseId,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    normalizedClinicalInputState: input,
    clinicalPathwayGate: {
      ruleId: gate.ruleId,
      revisionId: gate.revisionId,
      passed: gatePassed,
      missingFields: gateResult.missingFields,
    },
    sourceEvaluationOutcomes: [],
    recommendationSet: [],
  };

  if (!gatePassed) {
    // Evaluation stops entirely: no Source Evaluation Outcome for any Recommendation Source.
    return trace;
  }

  trace.clinicalPathwayId = gate.clinicalPathwayId;

  const applicabilityRules = release.revisions.filter(isSourceApplicability);
  const atomicRules = release.revisions.filter(isAtomicClinicalRule);

  // Only sources with BOTH an Approved Source Applicability Rule and an Approved Atomic
  // Clinical Rule in the Active Release are evaluated at all. BTS, having neither, is
  // simply absent from the Active Release and produces no Source Evaluation Outcome.
  const sourceIds = [...new Set(applicabilityRules.map((r) => r.recommendationSourceId))];

  for (const sourceId of sourceIds) {
    const applicability = applicabilityRules.find(
      (r) => r.recommendationSourceId === sourceId,
    )!;
    const atomicRule = atomicRules.find((r) => r.recommendationSourceId === sourceId);
    if (!atomicRule) continue;

    const outcome = evaluateSource(applicability, atomicRule, input);
    trace.sourceEvaluationOutcomes.push(outcome);

    if (outcome.state === "RECOMMENDATION" && outcome.recommendation) {
      trace.recommendationSet.push({
        recommendationSourceId: outcome.recommendationSourceId,
        matchedRuleId: outcome.recommendation.matchedRuleId,
        matchedRevisionId: outcome.recommendation.matchedRevisionId,
        clinicalEndpoint: outcome.recommendation.clinicalEndpoint,
        intervals: outcome.recommendation.intervals,
        rationale: outcome.recommendation.rationale,
        provenance: outcome.recommendation.provenance,
        measurementBasisUsed: outcome.recommendation.measurementBasisUsed,
      });
    }
  }

  return trace;
}
