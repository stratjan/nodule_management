// Deterministic clinical engine types. Zero dependency on React or any UI code (ADR-0005).
// Canonical rule content is inert JSON (ADR-0006); these types describe that data's shape.

export type ApprovalStatus = "Draft" | "Approved" | "Superseded" | "Rejected";

export interface ApprovalEvent {
  by: string;
  at: string;
}

export interface Provenance {
  sourceDocument: string;
  version: string;
  originalLanguage: string;
  sourceType: string;
  locator: string;
}

/**
 * Identifies a specific local, gitignored Local SOP source file by content, not by an invented
 * formal version label -- the Local SOP source document itself appears procedurally unreleased
 * (no effective/release-date fields, unsigned), so it has no formal version to cite. The file's
 * bytes are never committed; this metadata (including the content hash) is.
 */
export interface LocalSopSnapshot {
  documentTitle: string;
  sourceFilename: string;
  createdAt: string;
  sha256: string;
  proceduralStatus: string;
  originalLanguage: string;
}

/** ADR-0009/0010: the fixed, deterministic, side-effect-free condition vocabulary. AND-only, no OR/NOT. */
export type ConditionOp = "eq" | "gte" | "gt" | "lt" | "lte";

export interface Condition {
  field: string;
  op: ConditionOp;
  value: string | number | boolean;
}

interface RuleRevisionBase {
  ruleId: string;
  revisionId: string;
  approvalStatus: ApprovalStatus;
  approvalEvent?: ApprovalEvent;
}

/**
 * A closed, machine-readable Clinical Pathway vocabulary (issue #17) -- deliberately not an
 * unconstrained string, mirroring the MeasurementConventionId precedent (issue #20). Extend this
 * union (and the matching Zod enum in schema.ts) only when a new Clinical Pathway Gate is
 * actually governed and Approved.
 */
export type ClinicalPathwayId =
  | "incidental-solitary-solid-initial"
  | "incidental-solitary-pure-ggn-initial"
  | "incidental-solitary-part-solid-initial"
  | "incidental-solitary-solid-follow-up";

export interface PathwayGateRevision extends RuleRevisionBase {
  kind: "pathway-gate";
  clinicalPathwayId: ClinicalPathwayId;
  conditions: Condition[];
  provenance: Provenance;
}

export interface SourceApplicabilityRevision extends RuleRevisionBase {
  kind: "source-applicability";
  recommendationSourceId: string;
  conditions: Condition[];
  provenance: Provenance;
}

/**
 * A closed, machine-readable measurement-convention vocabulary (issue #20) -- deliberately not
 * an unconstrained string. Extend this union (and the matching Zod enum in schema.ts) only when
 * a rule actually needs a second convention; nothing today does.
 */
export type MeasurementConventionId =
  | "fleischner-2017-average-diameter"
  | "fleischner-2017-solid-component-long-axis";

/**
 * One measured diameter value bound to exactly one MeasurementConventionId (issue #20). Kept
 * separate from the generic, untagged ClinicalInputState.nodule_size_mm -- tagging that shared
 * scalar with a source-specific convention would make every other consumer of it (S3, BTS)
 * implicitly inherit a convention claim nothing verified for them.
 */
export interface DiameterMeasurement {
  valueMm: number;
  conventionId: MeasurementConventionId;
}

/** issue #26: the two measurement operands an Atomic Clinical Rule can independently declare --
 * already the implicit shape of MeasurementsUsed (evaluate.ts), named explicitly so
 * OperandInapplicabilityPrecondition can reference either one generically. Purely structural:
 * naming an operand here carries no source-specific meaning by itself. */
export type MeasurementOperandTarget = "wholeNodule" | "solidComponent";

/** issue #26: the fixed, structural mapping from a MeasurementOperandTarget to the synthetic
 * shadow field its resolved value is written under (evaluate.ts's own shadowing convention,
 * issue #18). This is a fact about the ClinicalInputState/evaluate.ts shape itself -- not a
 * clinical/source-specific fact -- so it is the one thing schema.ts's OperandInapplicability-
 * Precondition field-restriction refine and evaluate.ts's precondition resolver are both allowed
 * to hard-code; every concrete threshold, convention id, and rationale still lives only in
 * governed rule JSON, never here. Single source of truth, imported by both engine/schema.ts and
 * engine/evaluate.ts rather than duplicated. */
export const OPERAND_SHADOW_FIELD: Record<MeasurementOperandTarget, "nodule_size_mm" | "solid_component_size_mm"> = {
  wholeNodule: "nodule_size_mm",
  solidComponent: "solid_component_size_mm",
};

/** issue #26: the fixed, structural mapping from a MeasurementOperandTarget to the
 * ClinicalInputState array field its convention-bound measurements are supplied in (issue #18/
 * #20's DiameterMeasurement[] containers). Same non-clinical, structural status as
 * OPERAND_SHADOW_FIELD above. */
export const OPERAND_CONTAINER: Record<
  MeasurementOperandTarget,
  "nodule_diameter_measurements" | "solid_component_diameter_measurements"
> = {
  wholeNodule: "nodule_diameter_measurements",
  solidComponent: "solid_component_diameter_measurements",
};

/**
 * issue #26: a governed, source-cited fact that a rule's own required measurement operand is not
 * merely missing but source-defined as not applicable/not expected, when a DIFFERENT operand's
 * convention-bound measurement satisfies a stated condition. Every concrete threshold, convention
 * id, and clinical rationale lives in this data -- evaluate.ts contains none of it (ADR-0006/
 * ADR-0009). Consulted only when the `operand` measurement is genuinely missing (never when it is
 * present, and never when it is merely ambiguous/duplicated) -- it excuses an absent operand, it
 * never participates in this rule's own match/no-match determination (diameterConditions is
 * unaffected by this mechanism, always). If a rule declares more than one entry, they combine as
 * OR (any one matching entry excuses the missing operand); a single entry's own `whenConditions`
 * combine as AND, exactly like every other Condition[] array in this schema (ADR-0009 -- no new
 * boolean/rules language, the existing evaluateConditions() AND-only interpreter is reused
 * unchanged).
 */
export interface OperandInapplicabilityPrecondition {
  /** Which of THIS rule's own declared operands a missing measurement is excused for. */
  operand: MeasurementOperandTarget;
  /** Which OTHER operand's convention-bound measurement this precondition checks. Must differ
   * from `operand` -- a precondition can never reference the same operand it excuses. */
  whenOperand: MeasurementOperandTarget;
  /** The already-governed convention the `whenOperand` measurement must resolve under. */
  whenConventionId: MeasurementConventionId;
  /** Conditions on the resolved `whenOperand` value that, if all matched (AND, same as every
   * other Condition[] in this schema), excuse the missing `operand` measurement. Every condition
   * must reference exactly the synthetic shadow field `whenOperand` resolves to
   * ("nodule_size_mm" for "wholeNodule", "solid_component_size_mm" for "solidComponent") --
   * enforced by schema.ts, not by this type. */
  whenConditions: Condition[];
  /** Source citation for why this operand becomes inapplicable under whenConditions -- the only
   * place source-specific (e.g. Recommendation-4-specific) language may appear. */
  provenance: Provenance;
}

/** issue #20: exactly two forms -- a stated, non-empty interval list, or an explicit marker that
 * the source states no timing. Never a third form, never an empty/omitted value standing in for
 * "not specified". */
export type ClinicalActionTiming =
  | { kind: "specified"; intervals: string[] }
  | { kind: "not-specified-by-source" };

export interface ClinicalAction {
  label: string;
  timing: ClinicalActionTiming;
}

export interface LegacyRecommendationContent {
  clinicalEndpoint: string;
  intervals: string[];
  rationale: string;
}

/** issue #20: a bounded, flat list of named alternatives -- not a decision tree. `actions` is
 * non-empty; no primary/secondary ordering unless a source text states one. */
export interface StructuredRecommendationContent {
  actions: ClinicalAction[];
  rationale: string;
}

/**
 * Exactly one canonical representation per Rule Revision -- legacy XOR structured XOR
 * no-routine-follow-up XOR persistence-surveillance (the latter two added by issue #17), never
 * more than one. Distinguished structurally (by which keys are present), not by a tag field, so
 * the unmodified Phase-1 legacy shape needs no edit to keep validating.
 */
export type RecommendationContent =
  | LegacyRecommendationContent
  | StructuredRecommendationContent
  | NoRoutineFollowUpRecommendationContent
  | PersistenceSurveillanceRecommendationContent;

/**
 * issue #17: a positive, closed semantic marker for "the source states a management decision of
 * no routine follow-up" -- never a free-text clinicalEndpoint, and never represented by the mere
 * absence of intervals/actions (which would let any arbitrary endpoint with no timing data pass
 * as this form). `noRoutineFollowUp` is always the literal `true`.
 */
export interface NoRoutineFollowUpRecommendationContent {
  noRoutineFollowUp: true;
  rationale: string;
}

/** issue #17: one named step of a PersistenceSurveillanceRecommendationContent. Timing is pinned
 * to the single `"specified"` form with non-empty intervals -- deliberately narrower than the
 * generic ClinicalActionTiming union, since the source is definite about both steps' timing;
 * `"not-specified-by-source"` would misrepresent that. */
export interface PersistenceSurveillanceStep {
  label: string;
  timing: { kind: "specified"; intervals: string[] };
}

/**
 * issue #17: a small, closed, bounded sibling form for exactly one clinical fact pattern -- an
 * unconditional persistence-confirmation step followed by a second step performed only if
 * persistence is confirmed. Deliberately NOT represented via generic ClinicalAction[] (which
 * would silently change StructuredRecommendationContent.actions' existing meaning from "coequal
 * alternatives" to "sometimes a sequence") and NOT a generic steps array or predicate/branching
 * language -- exactly these two named steps, never a third, never added to without a new,
 * equally-scoped review.
 */
export interface PersistenceSurveillanceRecommendationContent {
  persistenceConfirmation: PersistenceSurveillanceStep;
  ifPersistent: PersistenceSurveillanceStep;
  rationale: string;
}

export function isStructuredRecommendation(
  content: RecommendationContent,
): content is StructuredRecommendationContent {
  return "actions" in content;
}

export function isNoRoutineFollowUpRecommendation(
  content: RecommendationContent,
): content is NoRoutineFollowUpRecommendationContent {
  return "noRoutineFollowUp" in content;
}

export function isPersistenceSurveillanceRecommendation(
  content: RecommendationContent,
): content is PersistenceSurveillanceRecommendationContent {
  return "persistenceConfirmation" in content;
}

export interface ProvenanceAnchor {
  role: string;
  provenance: Provenance;
}

/**
 * Exactly one canonical provenance representation per Atomic Clinical Rule Revision (issue #20)
 * -- single XOR multi-anchor, never both, never neither. Scoped to Atomic Clinical Rules only;
 * PathwayGateRevision and SourceApplicabilityRevision keep their own required singular
 * `provenance`, untouched by this union.
 */
export type ProvenanceCarrier = { provenance: Provenance } | { provenanceAnchors: ProvenanceAnchor[] };

export function hasMultiAnchorProvenance(
  carrier: ProvenanceCarrier,
): carrier is { provenanceAnchors: ProvenanceAnchor[] } {
  return "provenanceAnchors" in carrier;
}

export type MeasurementBasis = "diameter" | "volume-preferred";

/**
 * issue #28/#15 Candidate B1: one AND-conjoined, independently sufficient alternative inside a
 * sufficientConditionGroups-shaped Atomic Clinical Rule. `conditions` combine as AND (the exact
 * same fixed vocabulary and evaluateConditions()/classifyConditions() interpreter as every other
 * rule kind, ADR-0009) -- across groups on the same rule, any one group matching is sufficient
 * (OR), evaluated entirely inside evaluateSingleAtomicRule(), never as two separate Atomic Rules.
 * `groupId` is a stable, author-assigned identifier -- never derived from array position,
 * condition content, or rationale text -- used only to report which group(s) actually matched
 * (RecommendationPayload.matchedSufficientConditionGroupIds) and to cross-reference this group's
 * own citation (`provenanceRole`, which must match exactly one `ProvenanceAnchor.role` on the
 * same rule's required `provenanceAnchors[]` -- schema.ts enforces both the existence and the
 * uniqueness of that cross-reference for a grouped rule). No nesting, no NOT, no OR-of-OR -- this
 * is a single, fixed level of grouping, not a general Boolean expression language.
 */
export interface SufficientConditionGroup {
  groupId: string;
  conditions: Condition[];
  provenanceRole: string;
}

export type AtomicClinicalRuleRevision = RuleRevisionBase & {
  kind: "atomic-clinical-rule";
  recommendationSourceId: string;
  /** issue #17: which Clinical Pathway this rule belongs to. Optional at the schema level so
   * immutable historical single-pathway Release artifacts (authored before this field existed)
   * remain parseable, unmutated -- see releaseBuilder.ts's effective-pathway-id/historical-
   * compatibility contract. Required in practice once a Release has more than one Pathway Gate,
   * enforced at release-build time, not via the type system. */
  clinicalPathwayId?: ClinicalPathwayId;
  /** Optional now (issue #15 Candidate A0) -- present on every measurement-shaped rule exactly as
   * before (every existing revision already declares it, so this widening changes nothing about
   * how they parse or evaluate); absent on a clinical-condition-shaped rule, which uses
   * `conditions` below instead. Exactly one of measurementBasis/conditions is ever present,
   * enforced by schema.ts's cross-field refine -- never both, never neither. */
  measurementBasis?: MeasurementBasis;
  diameterConditions?: Condition[];
  volumeConditions?: Condition[];
  /** issue #20: which measurement convention this rule's diameterConditions require. Optional --
   * absent for S3/BTS and any rule with no verified convention requirement; when present,
   * evaluate() looks the value up in ClinicalInputState.nodule_diameter_measurements instead of
   * reading the generic nodule_size_mm directly. */
  measurementConventionId?: MeasurementConventionId;
  /** issue #18: which measurement convention this rule's solid-component condition(s) require --
   * independently scoped from measurementConventionId (whole-nodule). Optional; only rules that
   * genuinely condition on the solid component declare it. When present, the rule's
   * diameterConditions must include at least one condition on the synthetic shadow field
   * "solid_component_size_mm" (enforced by schema.ts's cross-field refine), and evaluate() looks
   * the value up in ClinicalInputState.solid_component_diameter_measurements independently of the
   * whole-nodule lookup. */
  solidComponentMeasurementConventionId?: MeasurementConventionId;
  /** issue #26: governed, source-cited exceptions to "a missing required operand is
   * INSUFFICIENT_INPUT" -- see OperandInapplicabilityPrecondition's own doc comment. Optional;
   * only measurement-shaped rules with an operand that can become source-defined-as-inapplicable
   * declare it. Multiple entries combine as OR (schema.ts enforces the rest). */
  operandInapplicabilityPreconditions?: OperandInapplicabilityPrecondition[];
  /** issue #15 Candidate A0: the evaluation-condition array for a clinical-condition-shaped rule
   * -- a rule whose match condition is a clinician-attested fact, not a physical nodule
   * measurement (e.g. `s3_volume_stability_criterion_met`). Mutually exclusive with
   * measurementBasis/diameterConditions/volumeConditions/measurementConventionId/
   * solidComponentMeasurementConventionId, enforced by schema.ts's cross-field refine (never
   * both, never neither). Uses the exact same fixed Condition vocabulary and the exact same
   * evaluateConditions() interpreter as every other rule kind (ADR-0009) -- no new operator, no
   * new evaluation model, no OR/NOT. */
  conditions?: Condition[];
  /** issue #28/#15 Candidate B1: the third, mutually exclusive Atomic Clinical Rule evaluation
   * shape -- a bounded OR-of-AND over `SufficientConditionGroup[]`. Mutually exclusive with
   * measurementBasis/diameterConditions/volumeConditions/measurementConventionId/
   * solidComponentMeasurementConventionId/operandInapplicabilityPreconditions AND with `conditions`
   * above (schema.ts's cross-field refines) -- never combined with either other shape. A rule
   * declaring this must use the multi-anchor `provenanceAnchors` form of ProvenanceCarrier (never
   * singular `provenance`), since each group cross-references its own anchor by role. */
  sufficientConditionGroups?: SufficientConditionGroup[];
  recommendation: RecommendationContent;
} & ProvenanceCarrier;

export type RuleRevision =
  | PathwayGateRevision
  | SourceApplicabilityRevision
  | AtomicClinicalRuleRevision;

export interface RuleSetRelease {
  releaseId: string;
  createdAt: string;
  revisions: RuleRevision[];
}

export interface ReleaseManifestEntry {
  ruleId: string;
  revisionId: string;
  kind: RuleRevision["kind"];
  approvalEvent: ApprovalEvent;
}

export interface ReleaseManifest {
  releaseId: string;
  createdAt: string;
  motivatingLocalSopSnapshot: LocalSopSnapshot;
  includedRevisions: ReleaseManifestEntry[];
  sourceQualityFindings: string[];
  notes: string[];
}

export interface ActiveRuleSetPointer {
  activeReleaseId: string;
}

// --- Clinical Input State (ADR-0002: transient wizard input, never a patient record) ---

export interface ClinicalInputState {
  nodule_morphology?: string;
  assessment_context?: string;
  assessment_timepoint?: string;
  nodule_count?: number;
  nodule_size_mm?: number;
  nodule_volume_mm3?: number;
  /** issue #20: convention-bound diameter measurements, kept separate from the generic, untagged
   * nodule_size_mm above -- see DiameterMeasurement. Populated only when a clinician has
   * explicitly provided or affirmed a value under a specific measurement convention; never a
   * blind copy of nodule_size_mm. */
  nodule_diameter_measurements?: DiameterMeasurement[];
  /** issue #18: solid-component diameter measurements, structurally separate (Option C) from
   * nodule_diameter_measurements above -- the solid component is a distinct anatomical
   * measurement target (Bankier et al. 2017, Figure 4), never the same value as the whole
   * nodule and never silently substituted for or copied from it. Reuses DiameterMeasurement
   * unchanged; the container field itself is what distinguishes the anatomical target, not a
   * discriminator inside the type. */
  solid_component_diameter_measurements?: DiameterMeasurement[];
  age?: number;
  known_malignancy_history?: boolean;
  immunocompromised?: boolean;
  /** issue #15 Candidate A0: explicit clinician attestation that S3's own <25% volume-increase-
   * over-approximately-one-year discharge criterion is met -- never computed from prior/current
   * volumes or an elapsed interval, and never a generic stability/growth flag. `true` = explicitly
   * confirmed met; `false` = explicitly confirmed not met (never turned into an inferred growth/
   * work-up outcome by complement -- HITL comment #5603995097); absent = not yet supplied. This
   * name deliberately encodes source + measurement type + exact criterion so a future VDT/
   * Fleischner/BTS/>=25%-growth rule cannot silently reuse it. */
  s3_volume_stability_criterion_met?: boolean;
  /** issue #15 Candidate B1: explicit clinician-entered volume-doubling time in days for the
   * currently followed nodule -- never computed by the app from prior/current volumes and an
   * elapsed interval (no VDT formula exists in the Local SOP; #15 grilling §6). Absent = not yet
   * supplied. Deliberately not scoped to one threshold in its own name (unlike
   * s3_volume_stability_criterion_met above) since this is a raw measurement value a future,
   * separately-approved rule could reuse under a different threshold, not a single pre-evaluated
   * criterion. */
  s3_vdt_days?: number;
}

// --- Source Evaluation Outcome (CONTEXT.md; ADR-0010) ---

export type SourceEvaluationOutcomeState =
  | "RECOMMENDATION"
  | "NOT_APPLICABLE"
  | "OUTSIDE_CURRENT_RULESET_SCOPE"
  | "INSUFFICIENT_INPUT";

/**
 * issue #15 Candidate A0: closed vocabulary for a clinical-condition-shaped rule's evaluation
 * basis, mirroring the ClinicalPathwayId/MeasurementConventionId closed-vocabulary precedent.
 * Extend only when a second, genuinely distinct clinical-condition rule needs its own label.
 */
export type ClinicalCriterionBasis = "clinician-attestation";

/**
 * Carries whichever recommendation form and provenance form the matched Atomic Clinical Rule
 * declared (issue #20) -- never both, never a legacy/structured or single/multi-anchor blend
 * synthesized by the engine.
 */
export type RecommendationPayload = RecommendationContent &
  ProvenanceCarrier & {
    matchedRuleId: string;
    matchedRevisionId: string;
    /** Present only for a measurement-shaped Atomic Clinical Rule match (issue #20). Optional
     * now (was required) -- absent, never fabricated, for a clinical-condition-shaped match
     * (issue #15 Candidate A0). Mutually exclusive with clinicalCriterionUsed below; enforced by
     * construction in evaluate.ts's buildRecommendationPayload() via an internal XOR union, not
     * by this public type -- kept flat here so every existing measurement-based call site and
     * test (`recommendation.measurementBasisUsed`) keeps compiling and passing unchanged. */
    measurementBasisUsed?: "diameter" | "volume";
    /** issue #18: which specific convention-bound value(s) the matched rule actually consumed --
     * added because measurementBasisUsed answers "diameter vs volume" only, and cannot by itself
     * convey that a rule (e.g. the part-solid >=6mm rule) resolved two independent, differently-
     * targeted diameter measurements. Optional and purely additive; populated only for rules that
     * declare measurementConventionId and/or solidComponentMeasurementConventionId. */
    measurementsUsed?: {
      wholeNodule?: { valueMm: number; conventionId: MeasurementConventionId };
      solidComponent?: { valueMm: number; conventionId: MeasurementConventionId };
    };
    /** issue #15 Candidate A0: present only for a clinical-condition-shaped Atomic Clinical Rule
     * match -- the non-measurement evaluation basis. Mutually exclusive with measurementBasisUsed
     * above; never both set for the same match. */
    clinicalCriterionUsed?: ClinicalCriterionBasis;
    /** issue #28/#15 Candidate B1: present only when the matched Atomic Clinical Rule was
     * sufficientConditionGroups-shaped -- every groupId that independently classified MATCHED,
     * in the rule's own authored declaration order (never just the first, never sorted by
     * clinical meaning, never used as a priority mechanism). Absent for every other rule shape;
     * never fabricated. matchedRuleId/matchedRevisionId stay singular regardless -- exactly one
     * Atomic Clinical Rule always matched, by construction. */
    matchedSufficientConditionGroupIds?: string[];
  };

/** Narrows a RecommendationPayload to its measurement-shaped arm, for callers (e.g.
 * RecommendationView) that need to branch between the two evaluation bases safely. */
export function hasMeasurementBasis(
  payload: RecommendationPayload,
): payload is RecommendationPayload & { measurementBasisUsed: "diameter" | "volume" } {
  return payload.measurementBasisUsed !== undefined;
}

export interface SourceEvaluationOutcome {
  recommendationSourceId: string;
  state: SourceEvaluationOutcomeState;
  reason?: string;
  recommendation?: RecommendationPayload;
  measurementDiscordance?: boolean;
  measurementValues?: { diameter?: number; volume?: number };
}

// --- Recommendation Set (CONTEXT.md: RECOMMENDATION-state entries only) ---

export type Recommendation = RecommendationPayload & { recommendationSourceId: string };

export type RecommendationSet = Recommendation[];

// --- Decision Execution Trace ---

/** issue #17: three-valued Clinical Pathway Gate classification. A supplied value that already
 * contradicts a gate's own conditions makes it NOT_MATCHED even if another referenced field is
 * still missing -- a missing field must never mask an already-definitive mismatch. INDETERMINATE
 * only when nothing supplied contradicts yet at least one referenced field is still missing. */
export type ClinicalPathwayGateState = "MATCHED" | "NOT_MATCHED" | "INDETERMINATE";

export interface ClinicalPathwayGateResult {
  ruleId: string;
  revisionId: string;
  clinicalPathwayId: ClinicalPathwayId;
  state: ClinicalPathwayGateState;
  missingFields: string[];
}

/**
 * issue #17: the pathway-selection summary computed from every governed gate's own result.
 * "More than one gate matched" is deliberately not a value here -- like AmbiguousRuleMatchError,
 * it is thrown as AmbiguousPathwayMatchError, never encoded as a clinical outcome.
 */
export type PathwaySelection =
  | { state: "MATCHED"; clinicalPathwayId: ClinicalPathwayId }
  | { state: "INSUFFICIENT_INPUT" }
  | { state: "NO_PATHWAY_MATCHED" };

export interface DecisionExecutionTrace {
  activeRuleSetReleaseId: string;
  engineVersion: string;
  schemaVersion: string;
  normalizedClinicalInputState: ClinicalInputState;
  /** One entry per governed PathwayGateRevision in the Active Rule-Set Release, always all of
   * them -- nothing is discarded regardless of which pathway (if any) matched (issue #17). */
  clinicalPathwayGates: ClinicalPathwayGateResult[];
  pathwaySelection: PathwaySelection;
  sourceEvaluationOutcomes: SourceEvaluationOutcome[];
  recommendationSet: RecommendationSet;
}
