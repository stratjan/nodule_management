// The single pure evaluation entry point (ADR-0010's orchestration pipeline):
//   Clinical Input State
//     -> Clinical Pathway Gating Rule(s)
//     -> applicable Clinical Pathway
//     -> per-source Source Applicability Rule
//     -> per-source Atomic Clinical Rule evaluation (evaluate-all-then-classify, issue #20)
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
  RecommendationPayload,
  RuleSetRelease,
  SourceApplicabilityRevision,
  SourceEvaluationOutcome,
} from "./types";
import { hasMultiAnchorProvenance, isStructuredRecommendation } from "./types";

export const ENGINE_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1.0.0";

/**
 * issue #20: more than one Approved Atomic Clinical Rule matching the same Clinical Input State
 * for one Recommendation Source is an invalid/ambiguous Rule-Set condition, not a clinical
 * outcome a source can produce -- it is a distinct, typed engine error `evaluate()` raises,
 * never a new SourceEvaluationOutcomeState. Release-time validation (releaseBuilder.ts) already
 * rejects the deterministically-provable cases; this is the runtime backstop for whatever
 * residual case release-time validation could not prove ahead of time.
 */
export class AmbiguousRuleMatchError extends Error {
  constructor(
    public readonly recommendationSourceId: string,
    public readonly matchedRules: AtomicClinicalRuleRevision[],
  ) {
    super(
      `Ambiguous Rule-Set: ${matchedRules.length} Approved Atomic Clinical Rules for ` +
        `Recommendation Source "${recommendationSourceId}" all matched the same Clinical Input ` +
        `State: ${matchedRules.map((r) => `${r.ruleId}@${r.revisionId}`).join(", ")}. The engine ` +
        `refuses to select a winner; this indicates a Rule-Set authoring defect that release-time ` +
        `validation should have caught.`,
    );
    this.name = "AmbiguousRuleMatchError";
  }
}

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

/** issue #20: carries whichever recommendation form and provenance form the rule declared,
 * through to the trace/Recommendation Set -- never synthesizing the other form. */
function buildRecommendationPayload(
  rule: AtomicClinicalRuleRevision,
  basisUsed: "diameter" | "volume",
): RecommendationPayload {
  const content = isStructuredRecommendation(rule.recommendation)
    ? { actions: rule.recommendation.actions, rationale: rule.recommendation.rationale }
    : {
        clinicalEndpoint: rule.recommendation.clinicalEndpoint,
        intervals: rule.recommendation.intervals,
        rationale: rule.recommendation.rationale,
      };

  const provenanceCarrier = hasMultiAnchorProvenance(rule)
    ? { provenanceAnchors: rule.provenanceAnchors }
    : { provenance: rule.provenance };

  return {
    matchedRuleId: rule.ruleId,
    matchedRevisionId: rule.revisionId,
    measurementBasisUsed: basisUsed,
    ...content,
    ...provenanceCarrier,
  } as RecommendationPayload;
}

/** One rule's own evaluation result, fully built regardless of which state it lands in --
 * classification (matched / not-matched / insufficient-input) is read off `outcome.state`. */
interface SingleRuleResult {
  rule: AtomicClinicalRuleRevision;
  outcome: SourceEvaluationOutcome;
}

function evaluateSingleAtomicRule(
  rule: AtomicClinicalRuleRevision,
  input: ClinicalInputState,
): SingleRuleResult {
  const sourceId = rule.recommendationSourceId;

  const buildRecommendation = (basisUsed: "diameter" | "volume"): SourceEvaluationOutcome => ({
    recommendationSourceId: sourceId,
    state: "RECOMMENDATION",
    recommendation: buildRecommendationPayload(rule, basisUsed),
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
    // issue #20: a rule that requires a specific measurement convention bypasses the plain
    // nodule_size_mm presence check entirely and instead looks up a convention-bound measurement
    // -- a plain lookup-then-equality operation, never a rounding/normalization/derivation step.
    if (rule.measurementConventionId !== undefined) {
      const requiredId = rule.measurementConventionId;
      const matched = input.nodule_diameter_measurements?.find((m) => m.conventionId === requiredId);
      if (!matched) {
        const suppliedIds = input.nodule_diameter_measurements?.map((m) => m.conventionId) ?? [];
        const reason =
          `Measurement convention required by this rule ("${requiredId}") was not confirmed by ` +
          `the Clinical Input State: ` +
          (suppliedIds.length === 0
            ? "no convention-bound diameter measurements were supplied."
            : `supplied convention id(s): ${suppliedIds.join(", ")}.`);
        return { rule, outcome: { recommendationSourceId: sourceId, state: "INSUFFICIENT_INPUT", reason } };
      }
      const shadowedInput: ClinicalInputState = { ...input, nodule_size_mm: matched.valueMm };
      const result = evaluateConditions(rule.diameterConditions!, shadowedInput);
      if (!result.allFieldsPresent) {
        return { rule, outcome: insufficientInput(result.missingFields) };
      }
      return { rule, outcome: result.matched ? buildRecommendation("diameter") : outOfScope("diameter") };
    }

    if (input.nodule_size_mm === undefined) {
      return {
        rule,
        outcome: {
          recommendationSourceId: sourceId,
          state: "INSUFFICIENT_INPUT",
          reason: "Diameter is required for this source and was not supplied.",
        },
      };
    }
    const result = evaluateConditions(rule.diameterConditions!, input);
    if (!result.allFieldsPresent) {
      return { rule, outcome: insufficientInput(result.missingFields) };
    }
    return { rule, outcome: result.matched ? buildRecommendation("diameter") : outOfScope("diameter") };
  }

  // volume-preferred (issue #20: untouched -- measurement-convention gating applies only to the
  // diameter basis in this slice)
  const hasVolume = input.nodule_volume_mm3 !== undefined;
  const hasDiameter = input.nodule_size_mm !== undefined;

  if (!hasVolume && !hasDiameter) {
    return {
      rule,
      outcome: {
        recommendationSourceId: sourceId,
        state: "INSUFFICIENT_INPUT",
        reason: "Neither diameter nor volume was supplied.",
      },
    };
  }

  const volumeEval = hasVolume ? evaluateConditions(rule.volumeConditions!, input) : undefined;
  const diameterEval = hasDiameter ? evaluateConditions(rule.diameterConditions!, input) : undefined;

  const basisUsed: "diameter" | "volume" = hasVolume ? "volume" : "diameter";
  const basisEval = hasVolume ? volumeEval! : diameterEval!;

  if (!basisEval.allFieldsPresent) {
    return { rule, outcome: insufficientInput(basisEval.missingFields) };
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

  return { rule, outcome };
}

/**
 * issue #20: evaluate-all-then-classify across every Atomic Clinical Rule for one source. Zero
 * matches with sufficient input -> OUTSIDE_CURRENT_RULESET_SCOPE (unchanged meaning); exactly
 * one match -> today's RECOMMENDATION dispatch, unchanged; more than one match -> throws
 * AmbiguousRuleMatchError rather than guessing. Any rule reporting INSUFFICIENT_INPUT takes
 * precedence, since its own match/no-match status could not even be determined.
 */
function evaluateAtomicRulesForSource(
  rules: AtomicClinicalRuleRevision[],
  input: ClinicalInputState,
): SourceEvaluationOutcome {
  const results = rules.map((rule) => evaluateSingleAtomicRule(rule, input));

  const insufficient = results.find((r) => r.outcome.state === "INSUFFICIENT_INPUT");
  if (insufficient) return insufficient.outcome;

  const matched = results.filter((r) => r.outcome.state === "RECOMMENDATION");
  if (matched.length > 1) {
    throw new AmbiguousRuleMatchError(
      rules[0].recommendationSourceId,
      matched.map((r) => r.rule),
    );
  }
  if (matched.length === 1) return matched[0].outcome;

  // Zero matches, none insufficient: every rule individually reported
  // OUTSIDE_CURRENT_RULESET_SCOPE. Any one of them (deterministically, the first) is the
  // representative final outcome -- their reason text does not depend on which specific rule.
  return results[0].outcome;
}

function evaluateSource(
  applicability: SourceApplicabilityRevision,
  atomicRules: AtomicClinicalRuleRevision[],
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

  return evaluateAtomicRulesForSource(atomicRules, input);
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

  // Only sources with BOTH an Approved Source Applicability Rule and at least one Approved
  // Atomic Clinical Rule in the Active Release are evaluated at all. BTS, having neither, is
  // simply absent from the Active Release and produces no Source Evaluation Outcome.
  const sourceIds = [...new Set(applicabilityRules.map((r) => r.recommendationSourceId))];

  for (const sourceId of sourceIds) {
    const applicability = applicabilityRules.find(
      (r) => r.recommendationSourceId === sourceId,
    )!;
    const sourceAtomicRules = atomicRules.filter((r) => r.recommendationSourceId === sourceId);
    if (sourceAtomicRules.length === 0) continue;

    const outcome = evaluateSource(applicability, sourceAtomicRules, input);
    trace.sourceEvaluationOutcomes.push(outcome);

    if (outcome.state === "RECOMMENDATION" && outcome.recommendation) {
      trace.recommendationSet.push({
        recommendationSourceId: outcome.recommendationSourceId,
        ...outcome.recommendation,
      });
    }
  }

  return trace;
}
