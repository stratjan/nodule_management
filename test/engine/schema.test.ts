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
