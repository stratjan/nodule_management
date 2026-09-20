// Zod schemas validating canonical clinical rule JSON (ADR-0006: schema/tooling around the
// data, never the source of truth itself). Every schema here mirrors types.ts exactly.
import { z } from "zod";
import { OPERAND_SHADOW_FIELD } from "./types";

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

// issue #26: closed, machine-readable vocabulary -- mirrors MeasurementOperandTarget in types.ts.
const measurementOperandTargetSchema = z.enum(["wholeNodule", "solidComponent"]);

// issue #26: a governed, source-cited exception to "a missing required operand is
// INSUFFICIENT_INPUT" -- see OperandInapplicabilityPrecondition's doc comment in types.ts for the
// full contract. `whenConditions` combine as AND (the existing evaluateConditions() semantics,
// unchanged); multiple precondition entries on one rule combine as OR (evaluate.ts consults each
// in turn and excuses the operand if any one matches) -- no new boolean/rules language is
// introduced for either combination (ADR-0009).
const operandInapplicabilityPreconditionSchema = z
  .object({
    operand: measurementOperandTargetSchema,
    whenOperand: measurementOperandTargetSchema,
    whenConventionId: measurementConventionIdSchema,
    whenConditions: z.array(conditionSchema).min(1),
    provenance: provenanceSchema,
  })
  .strict()
  .refine(
    (p) => p.operand !== p.whenOperand,
    "operand and whenOperand must differ -- a precondition can never excuse itself",
  )
  // issue #26: a precondition may reason ONLY about the operand it names in whenOperand, via the
  // exact synthetic shadow field that operand resolves to (OPERAND_SHADOW_FIELD, issue #18's own
  // shadowing convention) -- never age, applicability fields, the opposite operand, or any other
  // field. This is deliberately narrower than the generic conditionSchema/Condition[] vocabulary
  // used everywhere else, to keep this a bounded exception mechanism, not a general condition
  // language over the whole Clinical Input State.
  .refine(
    (p) => p.whenConditions.every((c) => c.field === OPERAND_SHADOW_FIELD[p.whenOperand]),
    "whenConditions may only reference the synthetic shadow field whenOperand resolves to (nodule_size_mm for wholeNodule, solid_component_size_mm for solidComponent)",
  );

// issue #28/#15 Candidate B1: one AND-conjoined, independently sufficient alternative inside a
// sufficientConditionGroups-shaped atomic-clinical-rule. `conditions` uses the exact same fixed
// conditionSchema as every other rule kind (ADR-0009); `groupId` is a stable author-assigned
// identifier (uniqueness enforced by the cross-field refine below, never derived from position or
// content); `provenanceRole` must cross-reference exactly one provenanceAnchors[].role on the same
// rule (also enforced below).
const sufficientConditionGroupSchema = z
  .object({
    groupId: z.string().min(1),
    conditions: z.array(conditionSchema).min(1),
    provenanceRole: z.string().min(1),
  })
  .strict();

// issue #30 (ADR-0011): a governed, directional relation naming another Atomic Clinical Rule
// revision whose own unresolved (INSUFFICIENT_INPUT) status does not block THIS rule's match.
// `.strict()` rejects any unrecognized key, matching every other relation object schema in this
// file. Cross-field constraints (unique targets, no self-reference) are enforced on the top-level
// ruleRevisionSchema discriminated union below, mirroring the solidComponentMeasurementConventionId
// bidirectional-binding refine's own placement style.
const nonBlockingUnresolvedSiblingSchema = z
  .object({
    siblingRuleId: z.string().min(1),
    siblingRevisionId: z.string().min(1),
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
  // issue #26: governed, source-cited exceptions to "a missing required operand is
  // INSUFFICIENT_INPUT" -- see operandInapplicabilityPreconditionSchema above and
  // OperandInapplicabilityPrecondition's doc comment in types.ts. Optional; the cross-field
  // refines below enforce (a) mutual exclusivity with clinical-condition-shaped rules, (b)
  // measurementBasis === "diameter" only for this first contract version, (c) each entry's
  // `operand` must correspond to an operand this same rule actually declares.
  operandInapplicabilityPreconditions: z.array(operandInapplicabilityPreconditionSchema).optional(),
  // issue #15 Candidate A0: the generic evaluation-condition array for a clinical-condition-
  // shaped rule -- mutually exclusive with measurementBasis/diameterConditions/volumeConditions/
  // measurementConventionId/solidComponentMeasurementConventionId, enforced by the cross-field
  // refines below. Uses the same fixed conditionSchema as every other rule kind (ADR-0009).
  conditions: z.array(conditionSchema).optional(),
  // issue #28/#15 Candidate B1: the third, mutually exclusive evaluation shape -- a bounded,
  // single-level OR-of-AND. `.min(2)` rejects a pointless single-group array (indistinguishable
  // from bare `conditions`) directly at the array level; the cross-field refines below enforce
  // groupId uniqueness, the provenanceAnchors requirement/cross-reference, and mutual exclusivity
  // with every measurement-only field and with `conditions`.
  sufficientConditionGroups: z.array(sufficientConditionGroupSchema).min(2).optional(),
  // issue #30 (ADR-0011): optional, additive -- undefined means no relations (today's fully
  // conservative default, unchanged). `.min(1)` rejects a pointless empty array, mirroring
  // provenanceAnchors' own `.min(1)`. Not tied to any of the three evaluation shapes above --
  // valid alongside measurementBasis, conditions, or sufficientConditionGroups alike.
  nonBlockingUnresolvedSiblings: z.array(nonBlockingUnresolvedSiblingSchema).min(1).optional(),
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
      rule.sufficientConditionGroups !== undefined ||
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
  // issue #28/#15 Candidate B1: an atomic-clinical-rule uses exactly one of three evaluation
  // shapes -- measurement-shaped (measurementBasis present) XOR clinical-condition-shaped
  // (conditions present) XOR sufficientConditionGroups-shaped, never more than one, never none.
  // This is the shape-selection guard; the refines below it enforce the rest of each shape's own
  // internal requirements.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule") return true;
    const isMeasurementShaped = rule.measurementBasis !== undefined;
    const isConditionShaped = rule.conditions !== undefined;
    const isGroupShaped = rule.sufficientConditionGroups !== undefined;
    return [isMeasurementShaped, isConditionShaped, isGroupShaped].filter(Boolean).length === 1;
  }, "an atomic-clinical-rule must be exactly one of measurement-shaped (measurementBasis), clinical-condition-shaped (conditions), or sufficientConditionGroups-shaped, never more than one, never none")
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
      rule.solidComponentMeasurementConventionId === undefined &&
      rule.operandInapplicabilityPreconditions === undefined
    );
  }, "a clinical-condition-shaped atomic-clinical-rule (conditions present) must not declare diameterConditions, volumeConditions, measurementConventionId, solidComponentMeasurementConventionId, or operandInapplicabilityPreconditions")
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
  }, "an atomic-clinical-rule declaring solidComponentMeasurementConventionId must include a diameterConditions entry on field \"solid_component_size_mm\", and vice versa")
  // issue #26: operandInapplicabilityPreconditions is scoped to this first contract version's
  // only supported operand-resolution shape -- diameter-basis rules. Not a permanent restriction,
  // just the smallest declared scope; extend explicitly (and re-review) before ever using it on a
  // volume-preferred rule.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.operandInapplicabilityPreconditions === undefined) {
      return true;
    }
    return rule.measurementBasis === "diameter";
  }, "operandInapplicabilityPreconditions is only supported when measurementBasis is \"diameter\"")
  // issue #26: each precondition's `operand` must correspond to an operand THIS SAME rule
  // actually declares -- a precondition excusing a missing solidComponent operand is meaningless
  // (and unenforceable) on a rule that never requires solidComponentMeasurementConventionId in
  // the first place, and symmetrically for wholeNodule/measurementConventionId. Mirrors the
  // existing solidComponentMeasurementConventionId <-> diameterConditions bidirectional-binding
  // precedent immediately above.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.operandInapplicabilityPreconditions === undefined) {
      return true;
    }
    return rule.operandInapplicabilityPreconditions.every((p) =>
      p.operand === "solidComponent"
        ? rule.solidComponentMeasurementConventionId !== undefined
        : rule.measurementConventionId !== undefined,
    );
  }, "an operandInapplicabilityPreconditions entry's `operand` must be an operand this same rule actually declares (\"solidComponent\" requires solidComponentMeasurementConventionId; \"wholeNodule\" requires measurementConventionId)")
  // issue #28/#15 Candidate B1: a sufficientConditionGroups-shaped rule must not also declare
  // `conditions` or any measurement-only field -- it is its own, third, mutually exclusive shape,
  // mirroring the existing conditions-shaped rule's own analogous refine above.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.sufficientConditionGroups === undefined) {
      return true;
    }
    return (
      rule.conditions === undefined &&
      rule.measurementBasis === undefined &&
      rule.diameterConditions === undefined &&
      rule.volumeConditions === undefined &&
      rule.measurementConventionId === undefined &&
      rule.solidComponentMeasurementConventionId === undefined &&
      rule.operandInapplicabilityPreconditions === undefined
    );
  }, "a sufficientConditionGroups-shaped atomic-clinical-rule must not also declare conditions, measurementBasis, diameterConditions, volumeConditions, measurementConventionId, solidComponentMeasurementConventionId, or operandInapplicabilityPreconditions")
  // issue #28/#15 Candidate B1: groupId values must be unique within one rule -- they are the
  // stable identifiers reported back in matchedSufficientConditionGroupIds, never a priority key.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.sufficientConditionGroups === undefined) {
      return true;
    }
    const ids = rule.sufficientConditionGroups.map((g) => g.groupId);
    return new Set(ids).size === ids.length;
  }, "sufficientConditionGroups entries must have unique groupId values within one rule")
  // issue #28/#15 Candidate B1: a grouped rule must use the multi-anchor provenanceAnchors form,
  // never singular provenance -- each group needs its own citation to cross-reference by role,
  // which a single Provenance object cannot represent.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.sufficientConditionGroups === undefined) {
      return true;
    }
    return rule.provenanceAnchors !== undefined && rule.provenance === undefined;
  }, "a sufficientConditionGroups-shaped atomic-clinical-rule must declare provenanceAnchors, not singular provenance")
  // issue #28/#15 Candidate B1: every group's provenanceRole must resolve to an anchor actually
  // declared on this same rule -- existence check; uniqueness of the anchor roles themselves is
  // enforced by the next refine.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.sufficientConditionGroups === undefined) {
      return true;
    }
    const anchorRoles = new Set((rule.provenanceAnchors ?? []).map((a) => a.role));
    return rule.sufficientConditionGroups.every((g) => anchorRoles.has(g.provenanceRole));
  }, "every sufficientConditionGroups entry's provenanceRole must match exactly one provenanceAnchors[].role on the same rule")
  // issue #28/#15 Candidate B1: anchor role uniqueness is required only on a rule that declares
  // sufficientConditionGroups (its roles are cross-reference keys here) -- deliberately not
  // imposed retroactively on historical non-grouped rules, which never needed this guarantee.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.sufficientConditionGroups === undefined) {
      return true;
    }
    const roles = (rule.provenanceAnchors ?? []).map((a) => a.role);
    return new Set(roles).size === roles.length;
  }, "provenanceAnchors[].role values must be unique on a sufficientConditionGroups-shaped atomic-clinical-rule")
  // issue #30 (ADR-0011): a rule's own nonBlockingUnresolvedSiblings entries must target unique
  // (siblingRuleId, siblingRevisionId) pairs -- a duplicate target carries no additional meaning
  // and would silently mask an authoring mistake (e.g. two different intended siblings, one
  // typo'd to match the other).
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.nonBlockingUnresolvedSiblings === undefined) {
      return true;
    }
    const keys = rule.nonBlockingUnresolvedSiblings.map((s) => `${s.siblingRuleId}\0${s.siblingRevisionId}`);
    return new Set(keys).size === keys.length;
  }, "nonBlockingUnresolvedSiblings entries must target unique (siblingRuleId, siblingRevisionId) pairs")
  // issue #30 (ADR-0011): a rule can never tolerate any revision of itself -- checked on ruleId
  // alone (not the (ruleId, revisionId) pair), since there is no clinical scenario where a rule's
  // own past/future revision is a "sibling" whose unresolved status this rule should ignore.
  .refine((rule) => {
    if (rule.kind !== "atomic-clinical-rule" || rule.nonBlockingUnresolvedSiblings === undefined) {
      return true;
    }
    return rule.nonBlockingUnresolvedSiblings.every((s) => s.siblingRuleId !== rule.ruleId);
  }, "nonBlockingUnresolvedSiblings must not self-reference this same rule's own ruleId");

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
