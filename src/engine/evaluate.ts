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
import { classifyConditions, evaluateConditions } from "./interpreter";
import type {
  AtomicClinicalRuleRevision,
  ClinicalCriterionBasis,
  ClinicalInputState,
  ClinicalPathwayGateResult,
  DecisionExecutionTrace,
  DiameterMeasurement,
  MeasurementConventionId,
  MeasurementOperandTarget,
  PathwayGateRevision,
  PathwaySelection,
  RecommendationContent,
  RecommendationPayload,
  RuleSetRelease,
  SourceApplicabilityRevision,
  SourceEvaluationOutcome,
  SufficientConditionGroup,
} from "./types";
import {
  hasMultiAnchorProvenance,
  isNoRoutineFollowUpRecommendation,
  isPersistenceSurveillanceRecommendation,
  isStructuredRecommendation,
  OPERAND_CONTAINER,
  OPERAND_SHADOW_FIELD,
} from "./types";

export const ENGINE_VERSION = "1.6.0";
export const SCHEMA_VERSION = "1.6.0";

/**
 * issue #17: more than one governed Clinical Pathway Gate matching the same Clinical Input State
 * is an invalid/ambiguous Rule-Set condition, not a clinical outcome -- mirrors
 * AmbiguousRuleMatchError's precedent exactly. Thrown, never encoded as a PathwaySelection value.
 */
export class AmbiguousPathwayMatchError extends Error {
  constructor(public readonly matchedGates: PathwayGateRevision[]) {
    super(
      `Ambiguous Rule-Set: ${matchedGates.length} Clinical Pathway Gates matched the same ` +
        `Clinical Input State: ${matchedGates
          .map((g) => `${g.ruleId}@${g.revisionId} (${g.clinicalPathwayId})`)
          .join(", ")}. The engine refuses to select a pathway; this indicates a Rule-Set ` +
        `authoring defect.`,
    );
    this.name = "AmbiguousPathwayMatchError";
  }
}

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

/**
 * issue #18: the outcome of resolving one convention-bound measurement operand. "ambiguous"
 * (more than one entry sharing the required conventionId) is distinguished from "missing" (no
 * matching entry at all) -- both are Clinical-Input-State data-quality problems, never a
 * Rule-Set authoring defect, so neither is thrown as an engine error; both surface as
 * INSUFFICIENT_INPUT via insufficientInputForMeasurement() below.
 */
type MeasurementResolution =
  | { state: "resolved"; valueMm: number }
  | { state: "missing"; suppliedIds: MeasurementConventionId[] }
  | { state: "ambiguous"; count: number };

/**
 * A deterministic lookup-then-equality resolver, shared by every convention-bound measurement
 * operand (whole-nodule and solid-component alike -- issue #18). Replaces the previous bare
 * `.find()`, which silently returned the first match and left duplicate same-convention entries
 * unresolved/order-dependent (noted after #20/#21 review). No rounding, normalization, or
 * derivation -- unchanged invariant.
 */
function resolveConventionBoundMeasurement(
  measurements: DiameterMeasurement[] | undefined,
  requiredId: MeasurementConventionId,
): MeasurementResolution {
  const matches = (measurements ?? []).filter((m) => m.conventionId === requiredId);
  if (matches.length === 0) {
    return { state: "missing", suppliedIds: (measurements ?? []).map((m) => m.conventionId) };
  }
  if (matches.length > 1) {
    return { state: "ambiguous", count: matches.length };
  }
  return { state: "resolved", valueMm: matches[0].valueMm };
}

/** issue #18: builds a target-aware INSUFFICIENT_INPUT outcome so the reason text never conflates
 * which operand (whole-nodule vs solid-component) was missing or ambiguous. */
function insufficientInputForMeasurement(
  resolution: Extract<MeasurementResolution, { state: "missing" | "ambiguous" }>,
  target: "whole-nodule" | "solid-component",
  requiredId: MeasurementConventionId,
  sourceId: string,
): SourceEvaluationOutcome {
  if (resolution.state === "ambiguous") {
    return {
      recommendationSourceId: sourceId,
      state: "INSUFFICIENT_INPUT",
      reason:
        `Multiple (${resolution.count}) ${target} diameter measurements were supplied under the ` +
        `same required convention ("${requiredId}") -- cannot determine which value to use.`,
    };
  }
  const reason =
    `Measurement convention required by this rule for the ${target} ("${requiredId}") was not ` +
    `confirmed by the Clinical Input State: ` +
    (resolution.suppliedIds.length === 0
      ? `no convention-bound ${target} diameter measurements were supplied.`
      : `supplied convention id(s): ${resolution.suppliedIds.join(", ")}.`);
  return { recommendationSourceId: sourceId, state: "INSUFFICIENT_INPUT", reason };
}

/**
 * issue #26: generic, source-agnostic check for whether a rule's own `operandInapplicabilityPreconditions`
 * excuse a MISSING `operand` measurement. Every concrete threshold, convention id, and rationale
 * lives in `rule.operandInapplicabilityPreconditions` (governed JSON, ADR-0006) -- this function
 * contains no Fleischner-specific, Recommendation-4-specific, or any other source-specific
 * literal. `OPERAND_CONTAINER`/`OPERAND_SHADOW_FIELD` are purely structural facts about the
 * ClinicalInputState shape itself (issue #18's own two measurement containers), not clinical
 * policy (ADR-0009). Multiple entries combine as OR -- any one matching entry is sufficient;
 * within one entry, `whenConditions` combine as AND via the existing, unmodified
 * evaluateConditions() interpreter. Must only ever be called when the `operand` measurement has
 * already been found "missing" (never "resolved", never "ambiguous") -- callers enforce this.
 */
function operandExcusedByInapplicabilityPrecondition(
  rule: AtomicClinicalRuleRevision,
  operand: MeasurementOperandTarget,
  input: ClinicalInputState,
): boolean {
  const preconditions = (rule.operandInapplicabilityPreconditions ?? []).filter(
    (p) => p.operand === operand,
  );
  return preconditions.some((p) => {
    const resolution = resolveConventionBoundMeasurement(input[OPERAND_CONTAINER[p.whenOperand]], p.whenConventionId);
    if (resolution.state !== "resolved") return false;
    const shadowed = {
      ...input,
      [OPERAND_SHADOW_FIELD[p.whenOperand]]: resolution.valueMm,
    } as unknown as ClinicalInputState;
    const result = evaluateConditions(p.whenConditions, shadowed);
    return result.allFieldsPresent && result.matched;
  });
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

/** issue #20/#17: carries whichever of the four recommendation forms the rule declared, through
 * to the trace/Recommendation Set -- never synthesizing another form. */
function buildRecommendationContentPayload(recommendation: RecommendationContent) {
  if (isStructuredRecommendation(recommendation)) {
    return { actions: recommendation.actions, rationale: recommendation.rationale };
  }
  if (isNoRoutineFollowUpRecommendation(recommendation)) {
    return { noRoutineFollowUp: recommendation.noRoutineFollowUp, rationale: recommendation.rationale };
  }
  if (isPersistenceSurveillanceRecommendation(recommendation)) {
    return {
      persistenceConfirmation: recommendation.persistenceConfirmation,
      ifPersistent: recommendation.ifPersistent,
      rationale: recommendation.rationale,
    };
  }
  return {
    clinicalEndpoint: recommendation.clinicalEndpoint,
    intervals: recommendation.intervals,
    rationale: recommendation.rationale,
  };
}

/** issue #18: which specific convention-bound value(s) were actually resolved and consumed for
 * this match -- see RecommendationPayload.measurementsUsed's own doc comment for why
 * measurementBasisUsed alone cannot convey this. */
interface MeasurementsUsed {
  wholeNodule?: { valueMm: number; conventionId: MeasurementConventionId };
  solidComponent?: { valueMm: number; conventionId: MeasurementConventionId };
}

/**
 * issue #15 Candidate A0, final review #5605350412: the engine's own construction-time
 * evaluation-basis choice, XOR-safe at compile time -- deliberately narrower than the public,
 * intentionally flat/optional RecommendationPayload shape (types.ts). A measurement-shaped match
 * can never carry clinicalCriterionUsed; a clinical-condition-shaped match can never carry
 * measurementBasisUsed/measurementsUsed; neither arm can construct an empty basis; the two arms
 * can never be combined. This type exists purely to keep evaluate.ts's own construction honest --
 * it is never exported, never part of the public engine surface.
 */
type RecommendationEvaluationBasis =
  | {
      measurementBasisUsed: "diameter" | "volume";
      measurementsUsed?: MeasurementsUsed;
      clinicalCriterionUsed?: never;
      matchedSufficientConditionGroupIds?: never;
    }
  | {
      clinicalCriterionUsed: ClinicalCriterionBasis;
      measurementBasisUsed?: never;
      measurementsUsed?: never;
      matchedSufficientConditionGroupIds?: never;
    }
  | {
      /** issue #28/#15 Candidate B1: present only for a sufficientConditionGroups-shaped match --
       * every groupId that independently classified MATCHED, in authored declaration order. Never
       * reuses clinicalCriterionUsed's own closed "clinician-attestation" vocabulary: that label is
       * specific to the bare-`conditions` shape and would misdescribe a match reached via a
       * numeric (VDT) group, so this shape gets its own, honest evidence field instead. */
      matchedSufficientConditionGroupIds: string[];
      measurementBasisUsed?: never;
      measurementsUsed?: never;
      clinicalCriterionUsed?: never;
    };

function buildRecommendationPayload(
  rule: AtomicClinicalRuleRevision,
  evaluationBasis: RecommendationEvaluationBasis,
): RecommendationPayload {
  const content = buildRecommendationContentPayload(rule.recommendation);

  const provenanceCarrier = hasMultiAnchorProvenance(rule)
    ? { provenanceAnchors: rule.provenanceAnchors }
    : { provenance: rule.provenance };

  return {
    matchedRuleId: rule.ruleId,
    matchedRevisionId: rule.revisionId,
    ...evaluationBasis,
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

/**
 * issue #28/#15 Candidate B1: three-valued reduction across a sufficientConditionGroups-shaped
 * rule's own groups. Each group is classified independently via the existing, unmodified
 * classifyConditions() (issue #17's own per-condition three-valued semantics) -- AND within the
 * group. Across groups, standard three-valued (Kleene) OR: any MATCHED wins outright regardless of
 * another group's indeterminacy or contradiction; failing that, any INDETERMINATE means the
 * overall verdict cannot yet be ruled out as false; only when every group is definitively
 * NOT_MATCHED does the rule as a whole fail to match. Generic and source-agnostic -- contains no
 * rule-specific, source-specific, or threshold-specific literal of any kind; reusable by any
 * future sufficientConditionGroups-shaped rule on any source.
 */
function reduceSufficientConditionGroups(
  groups: SufficientConditionGroup[],
  input: ClinicalInputState,
): { state: "MATCHED" | "NOT_MATCHED" | "INDETERMINATE"; matchedGroupIds: string[]; missingFields: string[] } {
  const classifications = groups.map((group) => ({
    group,
    result: classifyConditions(group.conditions, input),
  }));

  const matchedGroupIds = classifications
    .filter((c) => c.result.state === "MATCHED")
    .map((c) => c.group.groupId);
  if (matchedGroupIds.length > 0) {
    return { state: "MATCHED", matchedGroupIds, missingFields: [] };
  }

  const indeterminate = classifications.filter((c) => c.result.state === "INDETERMINATE");
  if (indeterminate.length > 0) {
    return {
      state: "INDETERMINATE",
      matchedGroupIds: [],
      missingFields: [...new Set(indeterminate.flatMap((c) => c.result.missingFields))],
    };
  }

  return { state: "NOT_MATCHED", matchedGroupIds: [], missingFields: [] };
}

function evaluateSingleAtomicRule(
  rule: AtomicClinicalRuleRevision,
  input: ClinicalInputState,
): SingleRuleResult {
  const sourceId = rule.recommendationSourceId;

  const buildRecommendation = (evaluationBasis: RecommendationEvaluationBasis): SourceEvaluationOutcome => ({
    recommendationSourceId: sourceId,
    state: "RECOMMENDATION",
    recommendation: buildRecommendationPayload(rule, evaluationBasis),
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

  // issue #15 Candidate A0: clinical-condition-shaped rules (no measurementBasis) are evaluated
  // directly against their own `conditions` via the existing generic interpreter. No diameter/
  // volume presence pre-check applies -- no physical measurement is involved in this rule kind,
  // and none of the measurement-specific dispatch below (convention lookups, dual-measurement
  // resolution, volume/diameter discordance) is reachable for it.
  if (rule.measurementBasis === undefined) {
    // issue #28/#15 Candidate B1: a sufficientConditionGroups-shaped rule is a nested dispatch off
    // the same "no measurementBasis" branch -- schema.ts's three-way XOR guarantees `conditions`
    // and `sufficientConditionGroups` are never both present, so this check is exhaustive with the
    // unchanged bare-`conditions` path below.
    if (rule.sufficientConditionGroups !== undefined) {
      const reduction = reduceSufficientConditionGroups(rule.sufficientConditionGroups, input);
      if (reduction.state === "INDETERMINATE") {
        return { rule, outcome: insufficientInput(reduction.missingFields) };
      }
      if (reduction.state === "MATCHED") {
        return {
          rule,
          outcome: buildRecommendation({ matchedSufficientConditionGroupIds: reduction.matchedGroupIds }),
        };
      }
      return {
        rule,
        outcome: {
          recommendationSourceId: sourceId,
          state: "OUTSIDE_CURRENT_RULESET_SCOPE",
          reason:
            "Source applies and sufficient input was given, but none of this rule's independently " +
            "sufficient condition groups was met, and no Approved Atomic Clinical Rule in the " +
            "Active Rule-Set Release covers this state.",
        },
      };
    }

    const result = evaluateConditions(rule.conditions!, input);
    if (!result.allFieldsPresent) {
      return { rule, outcome: insufficientInput(result.missingFields) };
    }
    if (result.matched) {
      return { rule, outcome: buildRecommendation({ clinicalCriterionUsed: "clinician-attestation" }) };
    }
    return {
      rule,
      outcome: {
        recommendationSourceId: sourceId,
        state: "OUTSIDE_CURRENT_RULESET_SCOPE",
        reason:
          "Source applies and sufficient input was given, but the required clinical criterion " +
          "was not met, and no Approved Atomic Clinical Rule in the Active Rule-Set Release " +
          "covers this state.",
      },
    };
  }

  if (rule.measurementBasis === "diameter") {
    // issue #20/#18: a rule that requires a specific measurement convention bypasses the plain
    // nodule_size_mm presence check entirely and instead looks up a convention-bound measurement
    // -- a plain lookup-then-equality operation, never a rounding/normalization/derivation step.
    // issue #18: a rule may additionally require an independently-scoped solid-component
    // measurement (solidComponentMeasurementConventionId). Resolution order is deterministic:
    // whole-nodule first, short-circuiting on missing/ambiguous before the solid-component operand
    // is ever attempted (final spec review requirement).
    if (rule.measurementConventionId !== undefined) {
      const requiredId = rule.measurementConventionId;
      const wholeNoduleResolution = resolveConventionBoundMeasurement(
        input.nodule_diameter_measurements,
        requiredId,
      );
      // issue #26: symmetric with the solidComponent-operand check below -- no currently-governed
      // rule declares a "wholeNodule"-targeted precondition (every diameter-basis rule so far
      // requires its own whole-nodule measurement unconditionally), so this is a no-op for every
      // existing rule, kept generic for the next rule/source that might need it.
      if (
        wholeNoduleResolution.state === "missing" &&
        operandExcusedByInapplicabilityPrecondition(rule, "wholeNodule", input)
      ) {
        return {
          rule,
          outcome: {
            recommendationSourceId: sourceId,
            state: "OUTSIDE_CURRENT_RULESET_SCOPE",
            reason:
              "This rule's required whole-nodule measurement was not supplied, but a governed " +
              "operandInapplicabilityPreconditions entry on this rule determined the operand is " +
              "not expected for this Clinical Input State.",
          },
        };
      }
      if (wholeNoduleResolution.state !== "resolved") {
        return {
          rule,
          outcome: insufficientInputForMeasurement(wholeNoduleResolution, "whole-nodule", requiredId, sourceId),
        };
      }

      // issue #18: "solid_component_size_mm" is a synthetic evaluation-time shadow key, not a
      // real ClinicalInputState field (there is no generic, untagged solid-component scalar --
      // every consumer of the solid component is convention-bound). Built as a plain record and
      // cast at the evaluateConditions() call site, mirroring interpreter.ts's own internal
      // Record<string, ...> treatment of ClinicalInputState.
      const shadowedRecord: Record<string, unknown> = {
        ...input,
        nodule_size_mm: wholeNoduleResolution.valueMm,
      };
      const measurementsUsed: MeasurementsUsed = {
        wholeNodule: { valueMm: wholeNoduleResolution.valueMm, conventionId: requiredId },
      };

      if (rule.solidComponentMeasurementConventionId !== undefined) {
        // issue #18: before ever attempting to resolve the solid-component operand, check
        // whether the conditions already decidable from the whole-nodule value alone already
        // exclude this rule. AND-only semantics mean a definitive whole-nodule contradiction
        // makes the whole conjunction false regardless of what the (still-unresolved)
        // solid-component operand turns out to be -- mirrors #17's Clinical Pathway Gate
        // three-valued principle ("a known contradiction is never masked by another missing
        // field"), now applied at the Atomic Clinical Rule level. Without this, a whole-nodule
        // <6mm input would incorrectly report INSUFFICIENT_INPUT for the >=6mm-and-solid-<6mm
        // rule's unresolved solid-component operand, which then masks the <6mm rule's own valid
        // RECOMMENDATION via evaluateAtomicRulesForSource's "any INSUFFICIENT_INPUT takes
        // precedence" rule.
        const wholeNoduleOnlyConditions = rule.diameterConditions!.filter(
          (c) => c.field !== "solid_component_size_mm",
        );
        const wholeNoduleOnlyResult = evaluateConditions(
          wholeNoduleOnlyConditions,
          shadowedRecord as unknown as ClinicalInputState,
        );
        if (!wholeNoduleOnlyResult.matched) {
          return { rule, outcome: outOfScope("diameter") };
        }

        const requiredSolidComponentId = rule.solidComponentMeasurementConventionId;
        const solidComponentResolution = resolveConventionBoundMeasurement(
          input.solid_component_diameter_measurements,
          requiredSolidComponentId,
        );
        if (solidComponentResolution.state !== "resolved") {
          return {
            rule,
            outcome: insufficientInputForMeasurement(
              solidComponentResolution,
              "solid-component",
              requiredSolidComponentId,
              sourceId,
            ),
          };
        }
        shadowedRecord.solid_component_size_mm = solidComponentResolution.valueMm;
        measurementsUsed.solidComponent = {
          valueMm: solidComponentResolution.valueMm,
          conventionId: requiredSolidComponentId,
        };
      }

      const shadowedInput = shadowedRecord as unknown as ClinicalInputState;
      const result = evaluateConditions(rule.diameterConditions!, shadowedInput);
      if (!result.allFieldsPresent) {
        return { rule, outcome: insufficientInput(result.missingFields) };
      }
      return {
        rule,
        outcome: result.matched
          ? buildRecommendation({ measurementBasisUsed: "diameter", measurementsUsed })
          : outOfScope("diameter"),
      };
    }

    // issue #26: a diameter-basis rule may declare solidComponentMeasurementConventionId alone,
    // with no measurementConventionId at all -- schema.ts permits this shape independently of any
    // rule's own clinical content. The solid-component operand is then resolved on its own,
    // without requiring a whole-nodule measurement merely to reach it; this branch is reachable
    // only when the rule declares no measurementConventionId, so a whole-nodule measurement
    // present in the Clinical Input State is never read here and cannot affect this rule's match.
    // Generic engine plumbing for this schema-valid rule shape -- carries no rule-specific
    // clinical content of its own; every threshold/condition still comes only from
    // rule.diameterConditions, governed JSON.
    if (rule.solidComponentMeasurementConventionId !== undefined) {
      const requiredSolidComponentId = rule.solidComponentMeasurementConventionId;
      const solidComponentResolution = resolveConventionBoundMeasurement(
        input.solid_component_diameter_measurements,
        requiredSolidComponentId,
      );
      // issue #26 (architecture-review correction): a rule declaring no independent whole-nodule
      // condition has nothing of its own to pre-check with, unlike Candidate B's
      // wholeNoduleOnlyConditions short-circuit above. Without some check here, a rule whose
      // required operand is missing entirely would unconditionally report INSUFFICIENT_INPUT and,
      // via evaluateAtomicRulesForSource's INSUFFICIENT_INPUT precedence, could silently mask a
      // different rule's own valid match for the same input. Delegated entirely to the rule's own
      // governed operandInapplicabilityPreconditions (ADR-0006/ADR-0009) -- this call contains no
      // source-specific literal of any kind; it does not change whether or what this rule matches
      // for any input where the operand IS supplied.
      if (
        solidComponentResolution.state === "missing" &&
        operandExcusedByInapplicabilityPrecondition(rule, "solidComponent", input)
      ) {
        return {
          rule,
          outcome: {
            recommendationSourceId: sourceId,
            state: "OUTSIDE_CURRENT_RULESET_SCOPE",
            reason:
              "This rule's required solid-component measurement was not supplied, but a governed " +
              "operandInapplicabilityPreconditions entry on this rule determined the operand is " +
              "not expected for this Clinical Input State.",
          },
        };
      }
      if (solidComponentResolution.state !== "resolved") {
        return {
          rule,
          outcome: insufficientInputForMeasurement(
            solidComponentResolution,
            "solid-component",
            requiredSolidComponentId,
            sourceId,
          ),
        };
      }

      const shadowedRecord: Record<string, unknown> = {
        ...input,
        solid_component_size_mm: solidComponentResolution.valueMm,
      };
      const measurementsUsed: MeasurementsUsed = {
        solidComponent: {
          valueMm: solidComponentResolution.valueMm,
          conventionId: requiredSolidComponentId,
        },
      };

      const shadowedInput = shadowedRecord as unknown as ClinicalInputState;
      const result = evaluateConditions(rule.diameterConditions!, shadowedInput);
      if (!result.allFieldsPresent) {
        return { rule, outcome: insufficientInput(result.missingFields) };
      }
      return {
        rule,
        outcome: result.matched
          ? buildRecommendation({ measurementBasisUsed: "diameter", measurementsUsed })
          : outOfScope("diameter"),
      };
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
    return {
      rule,
      outcome: result.matched ? buildRecommendation({ measurementBasisUsed: "diameter" }) : outOfScope("diameter"),
    };
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

  const outcome = matched ? buildRecommendation({ measurementBasisUsed: basisUsed }) : outOfScope(basisUsed);

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
 * issue #20/#30 (ADR-0011): evaluate-all-then-classify across every Atomic Clinical Rule for one
 * source -- no short-circuit, no first-match/file-order semantics anywhere in this function.
 *
 * Step 1 (unconditional, checked first, never suppressed or bypassed by any non-blocking
 * relation): more than one definite RECOMMENDATION match throws AmbiguousRuleMatchError, exactly
 * as before issue #30.
 *
 * Step 2: with exactly one definite match and one or more unresolved (INSUFFICIENT_INPUT)
 * siblings, only the matched rule's own declared `nonBlockingUnresolvedSiblings` is consulted --
 * never the sibling's, never inferred from conditions/thresholds/recommendation content/rule
 * identity strings/provenance similarity. Unresolved siblings are partitioned into
 * `toleratedUnresolved` (covered by an exact (ruleId, revisionId) match) and `blockingUnresolved`
 * (everything else). Zero blocking siblings -> the recommendation is released, annotated with
 * `toleratedUnresolvedSiblings`. One or more blocking siblings remain -> INSUFFICIENT_INPUT,
 * whose reason must come only from a genuinely blocking sibling, never a tolerated one --
 * `blockingUnresolved` is stable-sorted by `(ruleId, revisionId)` before its first element is
 * read, so the representative is deterministic and independent of array/file/release order.
 *
 * Step 3 (unchanged from before issue #30): zero definite matches with any unresolved sibling ->
 * INSUFFICIENT_INPUT; zero definite matches and zero unresolved siblings -> every rule
 * individually reported OUTSIDE_CURRENT_RULESET_SCOPE, and any one of them (deterministically,
 * the first) is the representative final outcome.
 */
function evaluateAtomicRulesForSource(
  rules: AtomicClinicalRuleRevision[],
  input: ClinicalInputState,
): SourceEvaluationOutcome {
  const results = rules.map((rule) => evaluateSingleAtomicRule(rule, input));

  const recommended = results.filter((r) => r.outcome.state === "RECOMMENDATION");

  if (recommended.length > 1) {
    throw new AmbiguousRuleMatchError(
      rules[0].recommendationSourceId,
      recommended.map((r) => r.rule),
    );
  }

  const unresolved = results.filter((r) => r.outcome.state === "INSUFFICIENT_INPUT");

  if (recommended.length === 1) {
    if (unresolved.length === 0) {
      return recommended[0].outcome;
    }

    const matchedRule = recommended[0].rule;
    const declared = matchedRule.nonBlockingUnresolvedSiblings ?? [];
    const covers = (siblingRule: AtomicClinicalRuleRevision) =>
      declared.some(
        (d) => d.siblingRuleId === siblingRule.ruleId && d.siblingRevisionId === siblingRule.revisionId,
      );

    const toleratedUnresolved = unresolved.filter((u) => covers(u.rule));
    const blockingUnresolved = unresolved
      .filter((u) => !covers(u.rule))
      .sort((a, b) =>
        `${a.rule.ruleId}\0${a.rule.revisionId}`.localeCompare(`${b.rule.ruleId}\0${b.rule.revisionId}`),
      );

    if (blockingUnresolved.length === 0) {
      return {
        ...recommended[0].outcome,
        toleratedUnresolvedSiblings: toleratedUnresolved.map((u) => ({
          ruleId: u.rule.ruleId,
          revisionId: u.rule.revisionId,
        })),
      };
    }

    // Deterministic, order-independent: the smallest (ruleId, revisionId) among the genuinely
    // blocking siblings, never the tolerated ones and never mere array/file/release position.
    return blockingUnresolved[0].outcome;
  }

  // Zero definite recommendations.
  if (unresolved.length > 0) return unresolved[0].outcome;

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
  const gates = release.revisions.filter(isPathwayGate);
  if (gates.length === 0) {
    throw new Error("Active Rule-Set Release contains no Clinical Pathway Gate revision.");
  }

  // issue #17: evaluate-all, never first-match/file-order. Each governed gate is classified
  // independently via three-valued partial-input semantics (classifyConditions) -- a supplied
  // value that already excludes a pathway is definitive (NOT_MATCHED) even if another pathway's
  // identity field is still unanswered.
  const gateClassifications = gates.map((gate) => classifyConditions(gate.conditions, input));

  const clinicalPathwayGates: ClinicalPathwayGateResult[] = gates.map((gate, i) => ({
    ruleId: gate.ruleId,
    revisionId: gate.revisionId,
    clinicalPathwayId: gate.clinicalPathwayId,
    state: gateClassifications[i].state,
    missingFields: gateClassifications[i].missingFields,
  }));

  const matchedGates = gates.filter((_, i) => gateClassifications[i].state === "MATCHED");

  if (matchedGates.length > 1) {
    throw new AmbiguousPathwayMatchError(matchedGates);
  }

  let pathwaySelection: PathwaySelection;
  if (matchedGates.length === 1) {
    pathwaySelection = { state: "MATCHED", clinicalPathwayId: matchedGates[0].clinicalPathwayId };
  } else if (gateClassifications.some((c) => c.state === "INDETERMINATE")) {
    pathwaySelection = { state: "INSUFFICIENT_INPUT" };
  } else {
    pathwaySelection = { state: "NO_PATHWAY_MATCHED" };
  }

  const trace: DecisionExecutionTrace = {
    activeRuleSetReleaseId: release.releaseId,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    normalizedClinicalInputState: input,
    clinicalPathwayGates,
    pathwaySelection,
    sourceEvaluationOutcomes: [],
    recommendationSet: [],
  };

  if (pathwaySelection.state !== "MATCHED") {
    // Evaluation stops entirely: no Source Evaluation Outcome for any Recommendation Source.
    return trace;
  }

  const matchedPathwayId = pathwaySelection.clinicalPathwayId;

  const applicabilityRules = release.revisions.filter(isSourceApplicability);
  // issue #17: scoped to the matched pathway only. A legacy, unbound Atomic Clinical Rule
  // (clinicalPathwayId absent) is treated as belonging to the sole pathway of a single-gate
  // Release -- the fallback that keeps historical Release artifacts executing unchanged. It can
  // never misroute in a multi-gate Release: buildRuleSetRelease() already refuses to assemble
  // one that contains an unbound Atomic rule (releaseBuilder.ts).
  const atomicRules = release.revisions
    .filter(isAtomicClinicalRule)
    .filter((r) => (r.clinicalPathwayId ? r.clinicalPathwayId === matchedPathwayId : gates.length === 1));

  // Only sources with BOTH an Approved Source Applicability Rule and at least one Approved
  // Atomic Clinical Rule bound to the matched pathway are evaluated at all. BTS, having neither,
  // is simply absent and produces no Source Evaluation Outcome; the same is true for S3/BTS on
  // the pure-GGN pathway, which has no Atomic Clinical Rule for either source.
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
