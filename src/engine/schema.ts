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

export const pathwayGateRevisionSchema = ruleRevisionBaseSchema
  .extend({
    kind: z.literal("pathway-gate"),
    clinicalPathwayId: z.string().min(1),
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
const measurementConventionIdSchema = z.enum(["fleischner-2017-average-diameter"]);

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

// issue #20: exactly one canonical recommendation representation per Rule Revision. Each member
// is `.strict()`, so an object carrying keys from BOTH forms fails both branches and the union
// as a whole -- "declares both" and "declares neither" are rejected without a separate refine.
const recommendationContentSchema = z.union([
  legacyRecommendationContentSchema,
  structuredRecommendationContentSchema,
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
  measurementBasis: z.enum(["diameter", "volume-preferred"]),
  diameterConditions: z.array(conditionSchema).optional(),
  volumeConditions: z.array(conditionSchema).optional(),
  measurementConventionId: measurementConventionIdSchema.optional(),
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
    (rule) => rule.kind !== "atomic-clinical-rule" || (rule.diameterConditions?.length ?? 0) > 0,
    "atomic-clinical-rule must define diameterConditions",
  )
  .refine(
    (rule) =>
      rule.kind !== "atomic-clinical-rule" ||
      rule.measurementBasis !== "volume-preferred" ||
      (rule.volumeConditions?.length ?? 0) > 0,
    "volume-preferred atomic-clinical-rule must define volumeConditions",
  )
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
  }, "an atomic-clinical-rule must declare exactly one of provenance (single) or provenanceAnchors (multi-anchor), never both, never neither");

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
