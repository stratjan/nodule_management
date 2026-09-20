// Schema/JSON validation for the Clinical Pathway Gate, Source Applicability Rules, and
// Atomic Clinical Rules against the Zod schema (ADR-0006), plus the assembled Release,
// Release Manifest, and Active Rule-Set pointer.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ruleRevisionSchema,
  ruleSetReleaseSchema,
  releaseManifestSchema,
  activeRuleSetPointerSchema,
} from "../../src/engine/schema";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { loadApprovedPhase1Revisions } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const RULE_FILES = [
  "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json",
  "clinical/rules/applicability/s3-applicability.json",
  "clinical/rules/applicability/fleischner-applicability.json",
  "clinical/rules/recommendations/s3-5to8mm.json",
  "clinical/rules/recommendations/fleischner-6to8mm.json",
  "clinical/rules/recommendations/fleischner-gt8to30mm.json",
  "clinical/rules/pathway/gr-3-incidental-solitary-part-solid-initial.json",
  "clinical/rules/recommendations/fleischner-partsolid-lt6mm.json",
  "clinical/rules/recommendations/fleischner-partsolid-gte6mm-solidlt6mm.json",
  "clinical/rules/recommendations/fleischner-partsolid-solidgt8mm.json",
  "clinical/rules/pathway/gr-4-incidental-solitary-solid-follow-up.json",
  "clinical/rules/recommendations/s3-followup-volume-stable.json",
  "clinical/rules/recommendations/s3-followup-discharge-volume-or-vdt.json",
];

describe("clinical rule JSON validates against the schema", () => {
  for (const relativePath of RULE_FILES) {
    it(relativePath, () => {
      const raw = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
      expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
    });
  }
});

describe("ADR-0007 approval-event invariant", () => {
  it("rejects an Approved revision with no approvalEvent at all", () => {
    const raw = JSON.parse(
      readFileSync(
        join(repoRoot, "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json"),
        "utf-8",
      ),
    );
    delete raw.approvalEvent;
    expect(raw.approvalStatus).toBe("Approved");
    expect(() => ruleRevisionSchema.parse(raw)).toThrow(/approvalEvent/);
  });

  it("rejects an Approved revision with a partial approvalEvent (missing 'at')", () => {
    const raw = JSON.parse(
      readFileSync(
        join(repoRoot, "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json"),
        "utf-8",
      ),
    );
    raw.approvalEvent = { by: "stratjan" };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("still accepts a Draft revision with no approvalEvent", () => {
    const raw = JSON.parse(
      readFileSync(
        join(repoRoot, "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json"),
        "utf-8",
      ),
    );
    raw.approvalStatus = "Draft";
    delete raw.approvalEvent;
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });
});

describe("issue #20: gt operator, structured recommendation, measurement convention, multi-anchor provenance", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const GT8MM_PATH = "clinical/rules/recommendations/fleischner-gt8to30mm.json";
  const GATE_PATH = "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json";
  const APPLICABILITY_PATH = "clinical/rules/applicability/fleischner-applicability.json";

  it("accepts the `gt` operator", () => {
    const raw = loadRaw(GT8MM_PATH);
    expect(raw.diameterConditions.some((c: any) => c.op === "gt")).toBe(true);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects an unrecognized operator string", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.diameterConditions[0].op = "gte-or-something";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts the structured recommendation form with a non-empty actions array, including the not-specified-by-source timing form", () => {
    const raw = loadRaw(GT8MM_PATH);
    expect(raw.recommendation.actions.length).toBeGreaterThan(0);
    expect(raw.recommendation.actions.some((a: any) => a.timing.kind === "not-specified-by-source")).toBe(
      true,
    );
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects a structured recommendation with an empty actions array", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.recommendation.actions = [];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a timing value that is neither of the two valid forms", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.recommendation.actions[0].timing = { kind: "sometimes" };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a recommendation declaring both the legacy and structured forms at once", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.recommendation.clinicalEndpoint = "test-only";
    raw.recommendation.intervals = ["test-only"];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a recommendation declaring neither the legacy nor the structured form", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.recommendation = { rationale: raw.recommendation.rationale };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects an unrecognized MeasurementConventionId value", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.measurementConventionId = "some-other-unrecognized-convention";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts the multi-anchor provenance form on an Atomic Clinical Rule", () => {
    const raw = loadRaw(GT8MM_PATH);
    expect(raw.provenanceAnchors.length).toBeGreaterThanOrEqual(3);
    expect(raw.provenance).toBeUndefined();
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects an Atomic Clinical Rule declaring both provenance and provenanceAnchors at once", () => {
    const raw = loadRaw(GT8MM_PATH);
    raw.provenance = raw.provenanceAnchors[0].provenance;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects an Atomic Clinical Rule declaring neither provenance nor provenanceAnchors", () => {
    const raw = loadRaw(GT8MM_PATH);
    delete raw.provenanceAnchors;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a provenance anchor missing a required semantic role", () => {
    const raw = loadRaw(GT8MM_PATH);
    delete raw.provenanceAnchors[0].role;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("pathwayGateRevisionSchema/sourceApplicabilityRevisionSchema reject a provenanceAnchors field -- multi-anchor provenance is not available outside Atomic Clinical Rules", () => {
    const gateRaw = loadRaw(GATE_PATH);
    gateRaw.provenanceAnchors = [{ role: "test-only", provenance: gateRaw.provenance }];
    expect(() => ruleRevisionSchema.parse(gateRaw)).toThrow();

    const applicabilityRaw = loadRaw(APPLICABILITY_PATH);
    applicabilityRaw.provenanceAnchors = [{ role: "test-only", provenance: applicabilityRaw.provenance }];
    expect(() => ruleRevisionSchema.parse(applicabilityRaw)).toThrow();
  });

  it("the unmodified Phase-1 fleischner-6to8mm.json and s3-5to8mm.json fixtures still parse under the evolved schema (backward compatibility)", () => {
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/fleischner-6to8mm.json")),
    ).not.toThrow();
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/s3-5to8mm.json")),
    ).not.toThrow();
    // S3 declares none of the new fields.
    const s3Raw = loadRaw("clinical/rules/recommendations/s3-5to8mm.json");
    expect(s3Raw.measurementConventionId).toBeUndefined();
    expect(s3Raw.provenanceAnchors).toBeUndefined();
    expect(s3Raw.recommendation.actions).toBeUndefined();
  });
});

describe("issue #17: closed clinicalPathwayId, no-routine-follow-up, persistence-surveillance", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const GGN_LT6_PATH = "clinical/rules/recommendations/fleischner-ggn-lt6mm.json";
  const GGN_GTE6_PATH = "clinical/rules/recommendations/fleischner-ggn-gte6mm.json";
  const GATE_PATH = "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json";
  const GGN_GATE_PATH = "clinical/rules/pathway/gr-2-incidental-solitary-pure-ggn-initial.json";

  it("accepts both governed clinicalPathwayId values on a Pathway Gate", () => {
    expect(() => ruleRevisionSchema.parse(loadRaw(GATE_PATH))).not.toThrow();
    expect(() => ruleRevisionSchema.parse(loadRaw(GGN_GATE_PATH))).not.toThrow();
  });

  it("rejects an unrecognized clinicalPathwayId on a Pathway Gate", () => {
    const raw = loadRaw(GGN_GATE_PATH);
    raw.clinicalPathwayId = "some-other-unrecognized-pathway";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts an Atomic Clinical Rule without clinicalPathwayId (optional, for historical Release compatibility)", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    delete raw.clinicalPathwayId;
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects an Atomic Clinical Rule's clinicalPathwayId when not in the closed enum", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    raw.clinicalPathwayId = "some-other-unrecognized-pathway";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts the no-routine-follow-up form with the literal noRoutineFollowUp: true", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    expect(raw.recommendation.noRoutineFollowUp).toBe(true);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects a no-routine-follow-up form with noRoutineFollowUp: false", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    raw.recommendation.noRoutineFollowUp = false;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a no-routine-follow-up-shaped object missing the noRoutineFollowUp literal (only rationale present)", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    raw.recommendation = { rationale: raw.recommendation.rationale };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a no-routine-follow-up form also carrying intervals or actions", () => {
    const withIntervals = loadRaw(GGN_LT6_PATH);
    withIntervals.recommendation.intervals = ["test-only"];
    expect(() => ruleRevisionSchema.parse(withIntervals)).toThrow();

    const withActions = loadRaw(GGN_LT6_PATH);
    withActions.recommendation.actions = [];
    expect(() => ruleRevisionSchema.parse(withActions)).toThrow();
  });

  it("accepts the persistence-surveillance form with exactly persistenceConfirmation, ifPersistent, and rationale", () => {
    const raw = loadRaw(GGN_GTE6_PATH);
    expect(raw.recommendation.persistenceConfirmation).toBeDefined();
    expect(raw.recommendation.ifPersistent).toBeDefined();
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects a persistence-surveillance form missing ifPersistent", () => {
    const raw = loadRaw(GGN_GTE6_PATH);
    delete raw.recommendation.ifPersistent;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a persistence-surveillance form missing persistenceConfirmation", () => {
    const raw = loadRaw(GGN_GTE6_PATH);
    delete raw.recommendation.persistenceConfirmation;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects not-specified-by-source timing on either persistence-surveillance step (final architecture review, P2)", () => {
    const onConfirmation = loadRaw(GGN_GTE6_PATH);
    onConfirmation.recommendation.persistenceConfirmation.timing = { kind: "not-specified-by-source" };
    expect(() => ruleRevisionSchema.parse(onConfirmation)).toThrow();

    const onIfPersistent = loadRaw(GGN_GTE6_PATH);
    onIfPersistent.recommendation.ifPersistent.timing = { kind: "not-specified-by-source" };
    expect(() => ruleRevisionSchema.parse(onIfPersistent)).toThrow();
  });

  it("rejects an empty intervals array on either persistence-surveillance step (final architecture review, P2)", () => {
    const onConfirmation = loadRaw(GGN_GTE6_PATH);
    onConfirmation.recommendation.persistenceConfirmation.timing.intervals = [];
    expect(() => ruleRevisionSchema.parse(onConfirmation)).toThrow();

    const onIfPersistent = loadRaw(GGN_GTE6_PATH);
    onIfPersistent.recommendation.ifPersistent.timing.intervals = [];
    expect(() => ruleRevisionSchema.parse(onIfPersistent)).toThrow();
  });

  it("a RecommendationContent declaring none of the four forms is rejected", () => {
    const raw = loadRaw(GGN_LT6_PATH);
    raw.recommendation = {};
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("the unmodified real fleischner-6to8mm.json, fleischner-gt8to30mm.json, and s3-5to8mm.json (now with clinicalPathwayId) still parse under the evolved schema", () => {
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/fleischner-6to8mm.json")),
    ).not.toThrow();
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/fleischner-gt8to30mm.json")),
    ).not.toThrow();
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/s3-5to8mm.json")),
    ).not.toThrow();
  });
});

describe("issue #18: part-solid pathway, dual-measurement rule, bidirectional solid-component refine", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const PARTSOLID_GATE_PATH = "clinical/rules/pathway/gr-3-incidental-solitary-part-solid-initial.json";
  const PARTSOLID_LT6_PATH = "clinical/rules/recommendations/fleischner-partsolid-lt6mm.json";
  const PARTSOLID_GTE6_PATH = "clinical/rules/recommendations/fleischner-partsolid-gte6mm-solidlt6mm.json";

  it("accepts incidental-solitary-part-solid-initial as a Pathway Gate clinicalPathwayId", () => {
    expect(() => ruleRevisionSchema.parse(loadRaw(PARTSOLID_GATE_PATH))).not.toThrow();
  });

  it("accepts the dual-measurement rule: solidComponentMeasurementConventionId present with a matching solid_component_size_mm condition", () => {
    const raw = loadRaw(PARTSOLID_GTE6_PATH);
    expect(raw.solidComponentMeasurementConventionId).toBe("fleischner-2017-solid-component-long-axis");
    expect(raw.diameterConditions.some((c: any) => c.field === "solid_component_size_mm")).toBe(true);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("accepts a rule without solidComponentMeasurementConventionId and without a solid_component_size_mm condition (Rule 1, State A)", () => {
    const raw = loadRaw(PARTSOLID_LT6_PATH);
    expect(raw.solidComponentMeasurementConventionId).toBeUndefined();
    expect(raw.diameterConditions.some((c: any) => c.field === "solid_component_size_mm")).toBe(false);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects solidComponentMeasurementConventionId present without a matching solid_component_size_mm condition (final spec review, correction 2, forward direction)", () => {
    const raw = loadRaw(PARTSOLID_LT6_PATH);
    raw.solidComponentMeasurementConventionId = "fleischner-2017-solid-component-long-axis";
    // diameterConditions still has no solid_component_size_mm entry.
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects a solid_component_size_mm condition present without solidComponentMeasurementConventionId (final spec review, correction 2, inverse direction)", () => {
    const raw = loadRaw(PARTSOLID_GTE6_PATH);
    delete raw.solidComponentMeasurementConventionId;
    // diameterConditions still has the solid_component_size_mm entry.
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects an unrecognized solidComponentMeasurementConventionId value", () => {
    const raw = loadRaw(PARTSOLID_GTE6_PATH);
    raw.solidComponentMeasurementConventionId = "some-other-unrecognized-convention";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("the unmodified real GR-1/GR-2 and existing Fleischner/S3 rule files still parse under the evolved schema (backward compatibility)", () => {
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json")),
    ).not.toThrow();
    expect(() =>
      ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/fleischner-ggn-gte6mm.json")),
    ).not.toThrow();
  });
});

describe("issue #26: operandInapplicabilityPreconditions (architecture-review correction, generic missing-operand exception)", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const SOLIDGT8_PATH = "clinical/rules/recommendations/fleischner-partsolid-solidgt8mm.json";

  it("accepts the real governed rule, with its operandInapplicabilityPreconditions entry intact", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    expect(raw.operandInapplicabilityPreconditions).toHaveLength(1);
    expect(raw.operandInapplicabilityPreconditions[0]).toMatchObject({
      operand: "solidComponent",
      whenOperand: "wholeNodule",
      whenConventionId: "fleischner-2017-average-diameter",
    });
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects operand === whenOperand (a precondition cannot excuse itself)", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.operandInapplicabilityPreconditions[0].whenOperand = "solidComponent";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects an operand: \"solidComponent\" precondition on a rule with no solidComponentMeasurementConventionId", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    delete raw.solidComponentMeasurementConventionId;
    // diameterConditions still references solid_component_size_mm, which independently makes
    // this an invalid rule too (bidirectional refine, issue #18) -- remove that as well so this
    // test isolates the operandInapplicabilityPreconditions refine specifically.
    raw.diameterConditions = [{ field: "solid_component_size_mm", op: "gt", value: 8 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects an operand: \"wholeNodule\" precondition on a rule with no measurementConventionId", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.operandInapplicabilityPreconditions[0].operand = "wholeNodule";
    raw.operandInapplicabilityPreconditions[0].whenOperand = "solidComponent";
    // measurementConventionId is not declared on this rule at all -- "wholeNodule" is not one of
    // its own declared operands.
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts an operand: \"wholeNodule\" precondition once the rule also declares measurementConventionId", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.measurementConventionId = "fleischner-2017-average-diameter";
    raw.operandInapplicabilityPreconditions[0].operand = "wholeNodule";
    raw.operandInapplicabilityPreconditions[0].whenOperand = "solidComponent";
    raw.operandInapplicabilityPreconditions[0].whenConventionId = "fleischner-2017-solid-component-long-axis";
    raw.operandInapplicabilityPreconditions[0].whenConditions = [
      { field: "solid_component_size_mm", op: "gt", value: 8 },
    ];
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("rejects operandInapplicabilityPreconditions on a volume-preferred rule (only diameter-basis is supported by this first contract version)", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.measurementBasis = "volume-preferred";
    raw.volumeConditions = [{ field: "nodule_volume_mm3", op: "gt", value: 500 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects operandInapplicabilityPreconditions on a clinical-condition-shaped rule", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    delete raw.measurementBasis;
    delete raw.diameterConditions;
    delete raw.solidComponentMeasurementConventionId;
    raw.conditions = [{ field: "some_clinician_attested_fact", op: "eq", value: true }];
    // operandInapplicabilityPreconditions is left in place -- still invalid on its own, since a
    // conditions-shaped rule may declare no measurement-only field at all.
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects whenConditions referencing a field other than the synthetic shadow field whenOperand resolves to", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.operandInapplicabilityPreconditions[0].whenConditions = [{ field: "age", op: "gte", value: 35 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("rejects whenConditions referencing the opposite operand's shadow field (wholeNodule's own field on a whenOperand: wholeNodule entry expects nodule_size_mm, not solid_component_size_mm)", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.operandInapplicabilityPreconditions[0].whenConditions = [
      { field: "solid_component_size_mm", op: "lt", value: 6 },
    ];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("accepts more than one precondition entry for the same operand (OR semantics documented, not tested here -- see test/engine/operandInapplicability.test.ts for the evaluate()-level OR behavior)", () => {
    const raw = loadRaw(SOLIDGT8_PATH);
    raw.operandInapplicabilityPreconditions.push({
      operand: "solidComponent",
      whenOperand: "wholeNodule",
      whenConventionId: "fleischner-2017-average-diameter",
      whenConditions: [{ field: "nodule_size_mm", op: "eq", value: 0 }],
      provenance: raw.operandInapplicabilityPreconditions[0].provenance,
    });
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });
});

describe("issue #15 Candidate A0: clinical-condition-shaped Atomic Clinical Rule (measurementBasis optional, new conditions field)", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const FOLLOWUP_GATE_PATH = "clinical/rules/pathway/gr-4-incidental-solitary-solid-follow-up.json";
  const FOLLOWUP_RULE_PATH = "clinical/rules/recommendations/s3-followup-volume-stable.json";
  const MEASUREMENT_RULE_PATH = "clinical/rules/recommendations/s3-5to8mm.json";
  const VOLUME_PREFERRED_RULE_PATH = "clinical/rules/recommendations/s3-5to8mm.json";
  const DUAL_MEASUREMENT_RULE_PATH =
    "clinical/rules/recommendations/fleischner-partsolid-gte6mm-solidlt6mm.json";

  it("accepts incidental-solitary-solid-follow-up as a Pathway Gate clinicalPathwayId", () => {
    expect(() => ruleRevisionSchema.parse(loadRaw(FOLLOWUP_GATE_PATH))).not.toThrow();
  });

  it("VALID: the new clinical-condition-shaped rule (conditions present, no measurementBasis) parses", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    expect(raw.measurementBasis).toBeUndefined();
    expect(raw.diameterConditions).toBeUndefined();
    expect(raw.conditions).toEqual([
      { field: "s3_volume_stability_criterion_met", op: "eq", value: true },
    ]);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("VALID: every existing measurement-shaped Atomic Clinical Rule still parses unchanged (regression)", () => {
    const measurementFiles = [
      "clinical/rules/recommendations/s3-5to8mm.json",
      "clinical/rules/recommendations/fleischner-6to8mm.json",
      "clinical/rules/recommendations/fleischner-gt8to30mm.json",
      "clinical/rules/recommendations/fleischner-ggn-lt6mm.json",
      "clinical/rules/recommendations/fleischner-ggn-gte6mm.json",
      "clinical/rules/recommendations/fleischner-partsolid-lt6mm.json",
      "clinical/rules/recommendations/fleischner-partsolid-gte6mm-solidlt6mm.json",
    ];
    for (const file of measurementFiles) {
      const raw = loadRaw(file);
      expect(raw.measurementBasis).toBeDefined();
      expect(raw.conditions).toBeUndefined();
      expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
    }
  });

  it("INVALID: both evaluation shapes present (conditions + measurementBasis/diameterConditions)", () => {
    const raw = loadRaw(MEASUREMENT_RULE_PATH);
    raw.conditions = [{ field: "s3_volume_stability_criterion_met", op: "eq", value: true }];
    // raw still carries its original measurementBasis + diameterConditions.
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: conditions + diameterConditions, with no measurementBasis", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    raw.diameterConditions = [{ field: "nodule_size_mm", op: "gte", value: 5 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: conditions + volumeConditions, with no measurementBasis", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    raw.volumeConditions = [{ field: "nodule_volume_mm3", op: "gte", value: 80 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: conditions + measurementConventionId, with no measurementBasis", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    raw.measurementConventionId = "fleischner-2017-average-diameter";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: conditions + solidComponentMeasurementConventionId, with no measurementBasis", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    raw.solidComponentMeasurementConventionId = "fleischner-2017-solid-component-long-axis";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: neither evaluation shape present (no measurementBasis, no conditions)", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    delete raw.conditions;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: a clinical-condition-shaped rule's conditions array is empty", () => {
    const raw = loadRaw(FOLLOWUP_RULE_PATH);
    raw.conditions = [];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: a measurement-shaped rule missing required diameterConditions", () => {
    const raw = loadRaw(MEASUREMENT_RULE_PATH);
    delete raw.diameterConditions;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("INVALID: a volume-preferred rule missing required volumeConditions", () => {
    const raw = loadRaw(VOLUME_PREFERRED_RULE_PATH);
    expect(raw.measurementBasis).toBe("volume-preferred");
    delete raw.volumeConditions;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("the dual-measurement part-solid rule (measurementConventionId + solidComponentMeasurementConventionId) is unaffected by the new refines", () => {
    const raw = loadRaw(DUAL_MEASUREMENT_RULE_PATH);
    expect(raw.conditions).toBeUndefined();
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });
});

describe("assembled Release / Manifest / Active pointer", () => {
  it("a Release built from the Approved revisions validates against ruleSetReleaseSchema", () => {
    const release = buildRuleSetRelease(loadApprovedPhase1Revisions());
    expect(() => ruleSetReleaseSchema.parse(release)).not.toThrow();
  });

  it("the committed Active Rule-Set pointer validates and resolves to a committed release artifact", () => {
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);

    const releaseRaw = JSON.parse(
      readFileSync(
        join(repoRoot, `clinical/rule-sets/releases/${pointer.activeReleaseId}.json`),
        "utf-8",
      ),
    );
    expect(() => ruleSetReleaseSchema.parse(releaseRaw)).not.toThrow();
  });

  it("the committed Release Manifest for the active release validates", () => {
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);

    const manifestRaw = JSON.parse(
      readFileSync(
        join(repoRoot, `clinical/rule-sets/manifests/${pointer.activeReleaseId}.json`),
        "utf-8",
      ),
    );
    expect(() => releaseManifestSchema.parse(manifestRaw)).not.toThrow();
  });

  it("the committed active release matches what the builder produces from current source rule files (no drift)", () => {
    const rebuilt = buildRuleSetRelease(loadApprovedPhase1Revisions());
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);
    expect(rebuilt.releaseId).toBe(pointer.activeReleaseId);
  });
});

// issue #28/#15 Candidate B1: focused negative test per refine -- no test covers more than one
// refine's failure mode, per the required schema-test matrix. One fully valid grouped-rule parse
// test plus the historical-shape regression close out the matrix.
describe("issue #28/#15 Candidate B1: sufficientConditionGroups schema constraints", () => {
  const B1_PATH = "clinical/rules/recommendations/s3-followup-discharge-volume-or-vdt.json";

  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  it("1. the actual Candidate B1 governed JSON parses successfully (fully valid grouped-rule parse test)", () => {
    const raw = loadRaw(B1_PATH);
    expect(raw.sufficientConditionGroups.length).toBe(2);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("2. rejects a rule declaring both conditions and sufficientConditionGroups", () => {
    const raw = loadRaw(B1_PATH);
    raw.conditions = [{ field: "s3_volume_stability_criterion_met", op: "eq", value: true }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("3. rejects sufficientConditionGroups with exactly one group", () => {
    const raw = loadRaw(B1_PATH);
    raw.sufficientConditionGroups = [raw.sufficientConditionGroups[0]];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("4. rejects a group with empty conditions", () => {
    const raw = loadRaw(B1_PATH);
    raw.sufficientConditionGroups[0].conditions = [];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("5. rejects duplicate groupId values within one rule", () => {
    const raw = loadRaw(B1_PATH);
    raw.sufficientConditionGroups[1].groupId = raw.sufficientConditionGroups[0].groupId;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("6. rejects a grouped rule declaring singular provenance instead of provenanceAnchors", () => {
    const raw = loadRaw(B1_PATH);
    raw.provenance = raw.provenanceAnchors[0].provenance;
    delete raw.provenanceAnchors;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("7. rejects a group provenanceRole with no matching provenanceAnchors[].role", () => {
    const raw = loadRaw(B1_PATH);
    raw.sufficientConditionGroups[0].provenanceRole = "no-such-role";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("8. rejects duplicate provenanceAnchors[].role values on a grouped rule", () => {
    const raw = loadRaw(B1_PATH);
    raw.provenanceAnchors[1].role = raw.provenanceAnchors[0].role;
    // keep every group's provenanceRole resolvable (existence check, refine #7) so this test
    // isolates only the uniqueness refine (#8), not a combination of the two.
    raw.sufficientConditionGroups[1].provenanceRole = raw.provenanceAnchors[0].role;
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9a. rejects a grouped rule also declaring measurementBasis", () => {
    const raw = loadRaw(B1_PATH);
    raw.measurementBasis = "diameter";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9b. rejects a grouped rule also declaring diameterConditions", () => {
    const raw = loadRaw(B1_PATH);
    raw.diameterConditions = [{ field: "nodule_size_mm", op: "gte", value: 6 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9c. rejects a grouped rule also declaring volumeConditions", () => {
    const raw = loadRaw(B1_PATH);
    raw.volumeConditions = [{ field: "nodule_volume_mm3", op: "gte", value: 80 }];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9d. rejects a grouped rule also declaring measurementConventionId", () => {
    const raw = loadRaw(B1_PATH);
    raw.measurementConventionId = "fleischner-2017-average-diameter";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9e. rejects a grouped rule also declaring solidComponentMeasurementConventionId", () => {
    const raw = loadRaw(B1_PATH);
    raw.solidComponentMeasurementConventionId = "fleischner-2017-solid-component-long-axis";
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9f. rejects a grouped rule also declaring operandInapplicabilityPreconditions", () => {
    const raw = loadRaw(B1_PATH);
    raw.operandInapplicabilityPreconditions = [
      {
        operand: "solidComponent",
        whenOperand: "wholeNodule",
        whenConventionId: "fleischner-2017-average-diameter",
        whenConditions: [{ field: "nodule_size_mm", op: "lt", value: 6 }],
        provenance: raw.provenanceAnchors[0].provenance,
      },
    ];
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("historical shapes still parse unchanged: the unmodified A0 fixture and every other currently-Approved rule file", () => {
    expect(() => ruleRevisionSchema.parse(loadRaw("clinical/rules/recommendations/s3-followup-volume-stable.json"))).not.toThrow();
    for (const relativePath of RULE_FILES) {
      expect(() => ruleRevisionSchema.parse(loadRaw(relativePath))).not.toThrow();
    }
  });
});

// issue #30 (ADR-0011): source-agnostic synthetic fixtures only -- never real S3 B1/B2 content,
// per the same discipline as the sufficientConditionGroups schema block above. One focused
// negative test per refine/constraint; a fully-valid parse plus the three-shape/no-leak checks
// close out the matrix.
describe("issue #30: nonBlockingUnresolvedSiblings schema constraints", () => {
  function loadRaw(relativePath: string): any {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  }

  const syntheticProvenance = {
    sourceDocument: "test fixture -- not a real clinical source",
    version: "n/a",
    originalLanguage: "English",
    sourceType: "Synthetic test fixture",
    locator: "test/engine/schema.test.ts",
  };

  function conditionShapedRule(overrides: Record<string, unknown> = {}) {
    return {
      ruleId: "TEST-NBUS-SCHEMA-RULE",
      revisionId: "TEST-NBUS-SCHEMA-RULE-r1",
      kind: "atomic-clinical-rule",
      recommendationSourceId: "test-only-nbus-schema-source",
      approvalStatus: "Approved",
      approvalEvent: { by: "test-fixture", at: "2026-01-01" },
      provenance: syntheticProvenance,
      conditions: [{ field: "test_only_field", op: "eq", value: true }],
      recommendation: {
        clinicalEndpoint: "test-only-not-a-real-recommendation",
        intervals: ["n/a"],
        rationale: "Synthetic fixture for issue #30 schema testing only -- not real clinical content.",
      },
      ...overrides,
    };
  }

  const validRelation = {
    siblingRuleId: "TEST-NBUS-SCHEMA-SIBLING",
    siblingRevisionId: "TEST-NBUS-SCHEMA-SIBLING-r1",
    provenance: syntheticProvenance,
  };

  it("1. accepts a valid single relation with full provenance", () => {
    const raw = conditionShapedRule({ nonBlockingUnresolvedSiblings: [validRelation] });
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("2. rejects a relation missing provenance", () => {
    const { provenance, ...withoutProvenance } = validRelation;
    const raw = conditionShapedRule({ nonBlockingUnresolvedSiblings: [withoutProvenance] });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("3a. rejects a relation with an empty siblingRuleId", () => {
    const raw = conditionShapedRule({
      nonBlockingUnresolvedSiblings: [{ ...validRelation, siblingRuleId: "" }],
    });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("3b. rejects a relation with an empty siblingRevisionId", () => {
    const raw = conditionShapedRule({
      nonBlockingUnresolvedSiblings: [{ ...validRelation, siblingRevisionId: "" }],
    });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("4. rejects an unrecognized key on the relation object (.strict())", () => {
    const raw = conditionShapedRule({
      nonBlockingUnresolvedSiblings: [{ ...validRelation, priority: 1 }],
    });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("5. rejects a self-reference (siblingRuleId === the rule's own ruleId)", () => {
    const raw = conditionShapedRule({
      nonBlockingUnresolvedSiblings: [
        { ...validRelation, siblingRuleId: "TEST-NBUS-SCHEMA-RULE" },
      ],
    });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("6. rejects two entries with the same (siblingRuleId, siblingRevisionId) pair", () => {
    const raw = conditionShapedRule({
      nonBlockingUnresolvedSiblings: [validRelation, { ...validRelation }],
    });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("7. rejects an empty nonBlockingUnresolvedSiblings array (.min(1))", () => {
    const raw = conditionShapedRule({ nonBlockingUnresolvedSiblings: [] });
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("8a. accepts the field alongside the clinical-condition shape (conditions)", () => {
    const raw = conditionShapedRule({ nonBlockingUnresolvedSiblings: [validRelation] });
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("8b. accepts the field alongside the measurement shape (measurementBasis/diameterConditions)", () => {
    const { conditions, ...base } = conditionShapedRule();
    const raw = {
      ...base,
      measurementBasis: "diameter",
      diameterConditions: [{ field: "nodule_size_mm", op: "gte", value: 6 }],
      nonBlockingUnresolvedSiblings: [validRelation],
    };
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("8c. accepts the field alongside the sufficientConditionGroups shape", () => {
    const { conditions, provenance, ...base } = conditionShapedRule();
    const raw = {
      ...base,
      provenanceAnchors: [{ role: "test-only-role", provenance: syntheticProvenance }],
      sufficientConditionGroups: [
        {
          groupId: "group-a",
          conditions: [{ field: "test_only_field_a", op: "eq", value: true }],
          provenanceRole: "test-only-role",
        },
        {
          groupId: "group-b",
          conditions: [{ field: "test_only_field_b", op: "gt", value: 100 }],
          provenanceRole: "test-only-role",
        },
      ],
      nonBlockingUnresolvedSiblings: [validRelation],
    };
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
  });

  it("9a. no accidental availability on a Pathway Gate revision (.strict() rejects the unrecognized key)", () => {
    const raw = {
      ruleId: "TEST-NBUS-SCHEMA-GATE",
      revisionId: "TEST-NBUS-SCHEMA-GATE-r1",
      kind: "pathway-gate",
      approvalStatus: "Approved",
      approvalEvent: { by: "test-fixture", at: "2026-01-01" },
      provenance: syntheticProvenance,
      clinicalPathwayId: "incidental-solitary-solid-initial",
      conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
      nonBlockingUnresolvedSiblings: [validRelation],
    };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("9b. no accidental availability on a Source Applicability revision (.strict() rejects the unrecognized key)", () => {
    const raw = {
      ruleId: "TEST-NBUS-SCHEMA-SAR",
      revisionId: "TEST-NBUS-SCHEMA-SAR-r1",
      kind: "source-applicability",
      recommendationSourceId: "test-only-nbus-schema-source",
      approvalStatus: "Approved",
      approvalEvent: { by: "test-fixture", at: "2026-01-01" },
      provenance: syntheticProvenance,
      conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
      nonBlockingUnresolvedSiblings: [validRelation],
    };
    expect(() => ruleRevisionSchema.parse(raw)).toThrow();
  });

  it("historical shapes still parse unchanged: every currently-Approved real rule file (none declares nonBlockingUnresolvedSiblings)", () => {
    for (const relativePath of RULE_FILES) {
      expect(() => ruleRevisionSchema.parse(loadRaw(relativePath))).not.toThrow();
    }
  });
});
