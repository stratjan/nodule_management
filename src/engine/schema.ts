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

// ADR-0009/0010's fixed condition vocabulary — nothing beyond eq/gte/lt/lte, no functions,
// no expression strings, no OR/NOT.
const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const ruleRevisionBaseSchema = z.object({
  ruleId: z.string().min(1),
  revisionId: z.string().min(1),
  approvalStatus: approvalStatusSchema,
  approvalEvent: approvalEventSchema.optional(),
  provenance: provenanceSchema,
});

export const pathwayGateRevisionSchema = ruleRevisionBaseSchema.extend({
  kind: z.literal("pathway-gate"),
  clinicalPathwayId: z.string().min(1),
  conditions: z.array(conditionSchema).min(1),
});

export const sourceApplicabilityRevisionSchema = ruleRevisionBaseSchema.extend({
  kind: z.literal("source-applicability"),
  recommendationSourceId: z.string().min(1),
  conditions: z.array(conditionSchema).min(1),
});

const recommendationContentSchema = z.object({
  clinicalEndpoint: z.string().min(1),
  intervals: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
});

export const atomicClinicalRuleRevisionSchema = ruleRevisionBaseSchema.extend({
  kind: z.literal("atomic-clinical-rule"),
  recommendationSourceId: z.string().min(1),
  measurementBasis: z.enum(["diameter", "volume-preferred"]),
  diameterConditions: z.array(conditionSchema).optional(),
  volumeConditions: z.array(conditionSchema).optional(),
  recommendation: recommendationContentSchema,
});

// discriminatedUnion requires each member to be a plain ZodObject (not a refined ZodEffects),
// so the atomic-clinical-rule cross-field checks are applied as a refinement on the union
// itself rather than on its member schema.
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
  );

export const ruleSetReleaseSchema = z.object({
  releaseId: z.string().min(1),
  createdAt: z.string().min(1),
  revisions: z.array(ruleRevisionSchema).min(1),
});

export const releaseManifestSchema = z.object({
  releaseId: z.string().min(1),
  createdAt: z.string().min(1),
  motivatingLocalSopVersion: z.string().min(1),
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
