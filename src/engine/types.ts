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

export interface PathwayGateRevision extends RuleRevisionBase {
  kind: "pathway-gate";
  clinicalPathwayId: string;
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
export type MeasurementConventionId = "fleischner-2017-average-diameter";

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
 * Exactly one canonical representation per Rule Revision (issue #20) -- legacy XOR structured,
 * never both, never neither. Distinguished structurally (by which keys are present), not by a
 * tag field, so the unmodified Phase-1 legacy shape needs no edit to keep validating.
 */
export type RecommendationContent = LegacyRecommendationContent | StructuredRecommendationContent;

export function isStructuredRecommendation(
  content: RecommendationContent,
): content is StructuredRecommendationContent {
  return "actions" in content;
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

export type AtomicClinicalRuleRevision = RuleRevisionBase & {
  kind: "atomic-clinical-rule";
  recommendationSourceId: string;
  measurementBasis: MeasurementBasis;
  diameterConditions?: Condition[];
  volumeConditions?: Condition[];
  /** issue #20: which measurement convention this rule's diameterConditions require. Optional --
   * absent for S3/BTS and any rule with no verified convention requirement; when present,
   * evaluate() looks the value up in ClinicalInputState.nodule_diameter_measurements instead of
   * reading the generic nodule_size_mm directly. */
  measurementConventionId?: MeasurementConventionId;
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
  age?: number;
  known_malignancy_history?: boolean;
  immunocompromised?: boolean;
}

// --- Source Evaluation Outcome (CONTEXT.md; ADR-0010) ---

export type SourceEvaluationOutcomeState =
  | "RECOMMENDATION"
  | "NOT_APPLICABLE"
  | "OUTSIDE_CURRENT_RULESET_SCOPE"
  | "INSUFFICIENT_INPUT";

/**
 * Carries whichever recommendation form and provenance form the matched Atomic Clinical Rule
 * declared (issue #20) -- never both, never a legacy/structured or single/multi-anchor blend
 * synthesized by the engine.
 */
export type RecommendationPayload = RecommendationContent &
  ProvenanceCarrier & {
    matchedRuleId: string;
    matchedRevisionId: string;
    measurementBasisUsed: "diameter" | "volume";
  };

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

export interface DecisionExecutionTrace {
  activeRuleSetReleaseId: string;
  engineVersion: string;
  schemaVersion: string;
  normalizedClinicalInputState: ClinicalInputState;
  clinicalPathwayGate: {
    ruleId: string;
    revisionId: string;
    passed: boolean;
    missingFields: string[];
  };
  clinicalPathwayId?: string;
  sourceEvaluationOutcomes: SourceEvaluationOutcome[];
  recommendationSet: RecommendationSet;
}
