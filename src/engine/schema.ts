// Zod schemas validating canonical clinical rule JSON (ADR-0006: schema/tooling around the
// data, never the source of truth itself). Every schema here mirrors types.ts exactly.
import { z } from "zod";

const approvalStatusSchema = z.enum(["Draft", "Approved", "Superseded", "Rejected"]);

const approvalEventSchema = z.object({
  by: z.string().min(1),
  at: z.string().min(1),
});

const provenanceSchema = z.object({
  sourceDocument: z.string().min(1),
  version: z.string().min(1),
  originalLanguage: z.string().min(1),
  sourceType: z.string().min(1),
  locator: z.string().min(1),
});

export const localSopSnapshotSchema = z.object({
  documentTitle: z.string().min(1),
  sourceFilename: z.string().min(1),
  createdAt: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be a 64-character lowercase hex digest"),
  proceduralStatus: z.string().min(1),
  originalLanguage: z.string().min(1),
});

// ADR-0009/0010's fixed condition vocabulary — nothing beyond eq/gte/gt/lt/lte, no functions,
// no expression strings, no OR/NOT.
const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "gte", "gt", "lt", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const ruleRevisionBaseSchema = z.object({
  ruleId: z.string().min(1),
  revisionId: z.string().min(1),
  approvalStatus: approvalStatusSchema,
  approvalEvent: approvalEventSchema.optional(),
});

// issue #17: closed, machine-readable Clinical Pathway vocabulary -- mirrors ClinicalPathwayId
// in types.ts. Extend both together only when a new Clinical Pathway Gate is actually governed
// and Approved.
const clinicalPathwayIdSchema = z.enum([
  "incidental-solitary-solid-initial",
  "incidental-solitary-pure-ggn-initial",
  "incidental-solitary-part-solid-initial",
  "incidental-solitary-solid-follow-up",
]);

export const pathwayGateRevisionSchema = ruleRevisionBaseSchema
  .extend({
    kind: z.literal("pathway-gate"),
    clinicalPathwayId: clinicalPathwayIdSchema,
    conditions: z.array(conditionSchema).min(1),
    provenance: provenanceSchema,
  })
  .strict();

export const sourceApplicabilityRevisionSchema = ruleRevisionBaseSchema
  .extend({
    kind: z.literal("source-applicability"),
    recommendationSourceId: z.string().min(1),
    conditions: z.array(conditionSchema).min(1),
    provenance: provenanceSchema,
  })
  .strict();

// issue #20: closed, machine-readable measurement-convention vocabulary -- mirrors
// MeasurementConventionId in types.ts. Extend both together only when a rule actually needs a
// second convention.
const measurementConventionIdSchema = z.enum([
  "fleischner-2017-average-diameter",
  "fleischner-2017-solid-component-long-axis",
]);

// issue #20: exactly two timing forms, never a third -- a non-empty stated interval list, or an
// explicit "not specified by source" marker. Discriminated on `kind` since this is a fresh type
// with no legacy shape to stay compatible with.
const clinicalActionTimingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specified"), intervals: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("not-specified-by-source") }).strict(),
]);

const clinicalActionSchema = z
  .object({
    label: z.string().min(1),
    timing: clinicalActionTimingSchema,
  })
  .strict();

const legacyRecommendationContentSchema = z
  .object({
    clinicalEndpoint: z.string().min(1),
    intervals: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
  })
  .strict();

const structuredRecommendationContentSchema = z
  .object({
    actions: z.array(clinicalActionSchema).min(1),
    rationale: z.string().min(1),
  })
  .strict();

// issue #17: a positive closed semantic marker -- noRoutineFollowUp must be the literal `true`,
// never a free-text clinicalEndpoint, and never merely inferred from the absence of
// intervals/actions (which would let an arbitrary endpoint with no timing data pass as this form).
const noRoutineFollowUpRecommendationContentSchema = z
  .object({
    noRoutineFollowUp: z.literal(true),
    rationale: z.string().min(1),
  })
  .strict();

// issue #17: deliberately narrower than clinicalActionTimingSchema -- pinned to the single
// "specified" form with non-empty intervals, since the source is definite about both persistence
// steps' timing; "not-specified-by-source" and an empty intervals array are both explicitly
// rejected here (final architecture review, P2).
const persistenceSurveillanceTimingSchema = z
  .object({ kind: z.literal("specified"), intervals: z.array(z.string().min(1)).min(1) })
  .strict();

const persistenceSurveillanceStepSchema = z
  .object({
    label: z.string().min(1),
    timing: persistenceSurveillanceTimingSchema,
  })
  .strict();

// issue #17: exactly two fixed, named steps -- not a generic steps array or predicate/branching
// language. Kept as its own sibling form specifically so StructuredRecommendationContent.actions
// (issue #20) keeps meaning "a bounded flat list of coequal alternatives" unchanged.
const persistenceSurveillanceRecommendationContentSchema = z
  .object({
    persistenceConfirmation: persistenceSurveillanceStepSchema,
    ifPersistent: persistenceSurveillanceStepSchema,
    rationale: z.string().min(1),
  })
  .strict();

// issue #20/#17: exactly one canonical recommendation representation per Rule Revision. Each
// member is `.strict()`, so an object carrying keys from more than one form fails every other
// branch and the union as a whole -- "declares more than one" and "declares none" are rejected
// without a separate refine.
const recommendationContentSchema = z.union([
  legacyRecommendationContentSchema,
  structuredRecommendationContentSchema,
  noRoutineFollowUpRecommendationContentSchema,
  persistenceSurveillanceRecommendationContentSchema,
]);

const provenanceAnchorSchema = z
  .object({
    role: z.string().min(1),
    provenance: provenanceSchema,
  })
  .strict();

export const atomicClinicalRuleRevisionSchema = ruleRevisionBaseSchema.extend({
  kind: z.literal("atomic-clinical-rule"),
  recommendationSourceId: z.string().min(1),
  // issue #17: optional -- see ClinicalPathwayId's doc comment in types.ts. Historical Rule
  // Revisions authored before this field existed must remain parseable, unmutated; release-time
  // validation (releaseBuilder.ts) enforces it in practice once a Release has more than one
  // Pathway Gate.
  clinicalPathwayId: clinicalPathwayIdSchema.optional(),
  // issue #15 Candidate A0: optional now -- absent on a clinical-condition-shaped rule (see
  // `conditions` below). Present on every measurement-shaped rule exactly as before. Exactly one
  // of measurementBasis/conditions is enforced by the cross-field refines below.
  measurementBasis: z.enum(["diameter", "volume-preferred"]).optional(),
  diameterConditions: z.array(conditionSchema).optional(),
  volumeConditions: z.array(conditionSchema).optional(),
  measurementConventionId: measurementConventionIdSchema.optional(),
  // issue #18: independently-scoped solid-component convention binding -- see the cross-field
  // refine below for the bidirectional invariant against diameterConditions' synthetic
  // "solid_component_size_mm" shadow field.
  solidComponentMeasurementConventionId: measurementConventionIdSchema.optional(),
  // issue #15 Candidate A0: the generic evaluation-condition array for a clinical-condition-
  // shaped rule -- mutually exclusive with measurementBasis/diameterConditions/volumeConditions/
  // measurementConventionId/solidComponentMeasurementConventionId, enforced by the cross-field
  // refines below. Uses the same fixed conditionSchema as every other rule kind (ADR-0009).
  conditions: z.array(conditionSchema).optional(),
  recommendation: recommendationContentSchema,
  // issue #20: exactly one of provenance (single, legacy) / provenanceAnchors (multi-anchor) --
  // both optional here, enforced exactly-one-present by the cross-field refine below, following
  // this file's existing pattern (see the diameterConditions-required refine) rather than a
  // tagged union, so unmodified legacy files need no new tag field to keep validating.
  provenance: provenanceSchema.optional(),
  provenanceAnchors: z.array(provenanceAnchorSchema).min(1).optional(),
});

// discriminatedUnion requires each member to be a plain ZodObject (not a refined ZodEffects),
// so all cross-field checks are applied as refinements on the union itself rather than on its
// member schemas.
export const ruleRevisionSchema = z
  .discriminatedUnion("kind", [
    pathwayGateRevisionSchema,
    sourceApplicabilityRevisionSchema,
    atomicClinicalRuleRevisionSchema,
  ])
  .refine(
    (rule) =>
      rule.kind !== "atomic-clinical-rule" ||
      rule.conditions !== undefined ||
      (rule.diameterConditions?.length ?? 0) > 0,
    "a measurement-shaped atomic-clinical-rule must define diameterConditions",
  )
  .refine(
    (rule) =>
      rule.kind !== "atomic-clinical-rule" ||
      rule.measurementBasis !== "volume-preferred" ||
      (rule.volumeConditions?.length ?? 0) > 0,
    "volume-preferred atomic-clinical-rule must define volumeConditions",
  )
  // issue #15 Candidate A0: an atomic-clinical-rule uses exactly one evaluation shape --
  // measurement-shaped (measurementBasis present) XOR clinical-condition-shaped (conditions
  // present), never both, never neither. This is the shape-selection guard; the two refines below
  // it enforce the rest of each shape's own internal requirements.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule") return true;
    const isMeasurementShaped = rule.measurementBasis !== undefined;
    const isConditionShaped = rule.conditions !== undefined;
    return isMeasurementShaped !== isConditionShaped;
  }, "an atomic-clinical-rule must be either measurement-shaped (measurementBasis) or clinical-condition-shaped (conditions), never both, never neither")
  // issue #15 Candidate A0: a clinical-condition-shaped rule's own conditions array must be
  // non-empty -- mirrors the measurement-shaped diameterConditions-non-empty requirement above.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.conditions === undefined) return true;
    return rule.conditions.length > 0;
  }, "a clinical-condition-shaped atomic-clinical-rule's conditions must be non-empty")
  // issue #15 Candidate A0: a clinical-condition-shaped rule (conditions present) must not also
  // declare any measurement-only field -- a rule cannot be a non-measurement clinician-attested
  // criterion and simultaneously claim a diameter/volume measurement basis for the same match.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.conditions === undefined) return true;
    return (
      rule.diameterConditions === undefined &&
      rule.volumeConditions === undefined &&
      rule.measurementConventionId === undefined &&
      rule.solidComponentMeasurementConventionId === undefined
    );
  }, "a clinical-condition-shaped atomic-clinical-rule (conditions present) must not declare diameterConditions, volumeConditions, measurementConventionId, or solidComponentMeasurementConventionId")
  // ADR-0007: every Approved Rule Revision carries an explicit, recorded approval event (who,
  // when) -- approval is never implied by authorship or by approvalStatus alone. Structurally
  // impossible to parse an Approved revision without one.
  .refine(
    (rule) => rule.approvalStatus !== "Approved" || rule.approvalEvent !== undefined,
    "an Approved Rule Revision must carry an explicit approvalEvent (by, at)",
  )
  // issue #20: exactly one canonical provenance representation on an atomic-clinical-rule --
  // single `provenance` XOR `provenanceAnchors`, never both, never neither. Scoped to
  // atomic-clinical-rule only; pathway-gate/source-applicability keep their own required
  // singular `provenance`, declared directly on their own schemas above, untouched by this check.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule") return true;
    const hasSingle = rule.provenance !== undefined;
    const hasMultiAnchor = rule.provenanceAnchors !== undefined;
    return hasSingle !== hasMultiAnchor;
  }, "an atomic-clinical-rule must declare exactly one of provenance (single) or provenanceAnchors (multi-anchor), never both, never neither")
  // issue #18: bidirectional binding between solidComponentMeasurementConventionId and the
  // synthetic "solid_component_size_mm" diameterConditions shadow field -- neither may be present
  // without the other. "solid_component_size_mm" is not a raw ClinicalInputState field; a rule
  // must never be authorable with a condition on it while omitting the convention-bound resolver
  // that supplies it (declaring the field with no convention binding), and declaring the binding
  // with no condition that actually uses it would be a pointless, unenforceable requirement
  // (final spec review, correction 2). issue #26: this binding is intentionally independent of
  // measurementConventionId (whole-nodule) -- a rule may declare solidComponentMeasurementConventionId
  // alone, with no whole-nodule convention at all, and evaluate.ts resolves it standalone.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule") return true;
    const hasSolidComponentCondition = (rule.diameterConditions ?? []).some(
      (c) => c.field === "solid_component_size_mm",
    );
    const hasSolidComponentConvention = rule.solidComponentMeasurementConventionId !== undefined;
    return hasSolidComponentCondition === hasSolidComponentConvention;
  }, "an atomic-clinical-rule declaring solidComponentMeasurementConventionId must include a diameterConditions entry on field \"solid_component_size_mm\", and vice versa");

export const ruleSetReleaseSchema = z.object({
  releaseId: z.string().min(1),
  createdAt: z.string().min(1),
  revisions: z.array(ruleRevisionSchema).min(1),
});

export const releaseManifestSchema = z.object({
  releaseId: z.string().min(1),
  createdAt: z.string().min(1),
  motivatingLocalSopSnapshot: localSopSnapshotSchema,
  includedRevisions: z
    .array(
      z.object({
        ruleId: z.string().min(1),
        revisionId: z.string().min(1),
        kind: z.enum(["pathway-gate", "source-applicability", "atomic-clinical-rule"]),
        approvalEvent: approvalEventSchema,
      }),
    )
    .min(1),
  sourceQualityFindings: z.array(z.string()),
  notes: z.array(z.string()),
});

export const activeRuleSetPointerSchema = z.object({
  activeReleaseId: z.string().min(1),
});
