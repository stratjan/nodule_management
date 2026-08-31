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

/** ADR-0009/0010: the fixed, deterministic, side-effect-free condition vocabulary. AND-only, no OR/NOT. */
export type ConditionOp = "eq" | "gte" | "lt" | "lte";

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
  provenance: Provenance;
}

export interface PathwayGateRevision extends RuleRevisionBase {
  kind: "pathway-gate";
  clinicalPathwayId: string;
  conditions: Condition[];
}

export interface SourceApplicabilityRevision extends RuleRevisionBase {
  kind: "source-applicability";
  recommendationSourceId: string;
  conditions: Condition[];
}

export interface RecommendationContent {
  clinicalEndpoint: string;
  intervals: string[];
  rationale: string;
}

export type MeasurementBasis = "diameter" | "volume-preferred";

export interface AtomicClinicalRuleRevision extends RuleRevisionBase {
  kind: "atomic-clinical-rule";
  recommendationSourceId: string;
  measurementBasis: MeasurementBasis;
  diameterConditions?: Condition[];
  volumeConditions?: Condition[];
  recommendation: RecommendationContent;
}

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
  motivatingLocalSopVersion: string;
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

export interface RecommendationPayload {
  matchedRuleId: string;
  matchedRevisionId: string;
  clinicalEndpoint: string;
  intervals: string[];
  rationale: string;
  provenance: Provenance;
  measurementBasisUsed: "diameter" | "volume";
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

export interface Recommendation {
  recommendationSourceId: string;
  matchedRuleId: string;
  matchedRevisionId: string;
  clinicalEndpoint: string;
  intervals: string[];
  rationale: string;
  provenance: Provenance;
  measurementBasisUsed: "diameter" | "volume";
}

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
