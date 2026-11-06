// issue #16 Candidate D (final spec 6411027075/6411027421 §4, §13 cases 15-16, 32-34; ADR-0012
// §3/§4): the clinical-disposition Rule Revision kind and the pre-source disposition stage as
// generic engine/release mechanics. The ambiguity and binding cases use synthetic, non-clinical
// fixtures under test/fixtures/ only.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import * as engineBarrel from "../../src/engine/index";
import {
  buildRuleSetRelease,
  NonApprovedRevisionError,
  UnknownClinicalDispositionPathwayIdError,
} from "../../src/engine/releaseBuilder";
import { activeRuleSetPointerSchema, releaseManifestSchema, ruleRevisionSchema, ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision, RuleSetRelease } from "../../src/engine/types";
import { loadApprovedPhase1Revisions, loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const loadRaw = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), "utf-8"));
const loadFixture = (name: string) => ruleRevisionSchema.parse(loadRaw(`test/fixtures/${name}`)) as RuleRevision;

const CDR_PATH =
  "clinical/rules/disposition/cdr-1-incidental-multiple-solid-gte-6mm-first-follow-up-no-further-routine-surveillance.json";
const PATHWAY_ID = "incidental-multiple-solid-gte-6mm-first-follow-up";
const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const OM = "clinician_decides_no_further_routine_nodule_surveillance";

const D: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: true,
  age: 60,
  known_malignancy_history: false,
  immunocompromised: false,
};

describe("disposition stage: ambiguity is an authoring defect, never an outcome (case 15)", () => {
  const release = buildRuleSetRelease([
    ...loadApprovedPhase1Revisions(),
    loadFixture("synthetic-disposition-a.json"),
    loadFixture("synthetic-disposition-b.json"),
  ]);
  const withFlag = { ...D, test_only_disposition_flag: true } as unknown as ClinicalInputState;

  it("two bound disposition rules both MATCHED -> throws AmbiguousClinicalDispositionMatchError naming both", () => {
    expect(() => evaluate(withFlag, release)).toThrow(engineBarrel.AmbiguousClinicalDispositionMatchError);
    try {
      evaluate(withFlag, release);
    } catch (error) {
      const matched = (error as InstanceType<typeof engineBarrel.AmbiguousClinicalDispositionMatchError>).matchedRules;
      expect(matched.map((r) => r.ruleId).sort()).toEqual(["TEST-SYNTHETIC-DISPOSITION-A", "TEST-SYNTHETIC-DISPOSITION-B"]);
    }
  });

  it("exactly one MATCHED among several bound rules -> that one disposition; every bound rule is listed (evaluate-all)", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("DISPOSITION");
    expect(trace.clinicalDispositionEvaluation?.disposition?.ruleId).toBe("CDR-1");
    expect(trace.clinicalDispositionEvaluation?.rules.map((r) => [r.ruleId, r.state])).toEqual([
      ["CDR-1", "MATCHED"],
      ["TEST-SYNTHETIC-DISPOSITION-A", "INDETERMINATE"],
      ["TEST-SYNTHETIC-DISPOSITION-B", "INDETERMINATE"],
    ]);
  });

  it("zero MATCHED with any INDETERMINATE -> INSUFFICIENT_INPUT, unresolved = union of the INDETERMINATE rules' missing fields (first appearance, deduplicated)", () => {
    const trace = evaluate(D, release);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("INSUFFICIENT_INPUT");
    expect(trace.clinicalDispositionEvaluation?.unresolvedRequiredInputs).toEqual([
      { kind: "field", field: SG },
      { kind: "field", field: OM },
      { kind: "field", field: "test_only_disposition_flag" },
    ]);
    expect(trace.sourceEvaluationOutcomes).toEqual([]);
  });

  it("all bound rules NOT_MATCHED -> NONE_MATCHED and sources are evaluated", () => {
    const trace = evaluate(
      { ...D, [SG]: false, test_only_disposition_flag: false } as unknown as ClinicalInputState,
      release,
    );
    expect(trace.clinicalDispositionEvaluation?.state).toBe("NONE_MATCHED");
    expect(trace.sourceEvaluationOutcomes.map((o) => o.recommendationSourceId)).toEqual(["fleischner"]);
  });

  it("AmbiguousClinicalDispositionMatchError is exported from the browser-safe engine barrel", () => {
    expect(typeof engineBarrel.AmbiguousClinicalDispositionMatchError).toBe("function");
  });
});

describe("pathways without bound disposition rules skip the stage (case 16)", () => {
  const release = loadTestRelease();
  const applicability = { age: 55, known_malignancy_history: false, immunocompromised: false };
  const existingInputs: ClinicalInputState[] = [
    { nodule_morphology: "solid", assessment_context: "incidental", assessment_timepoint: "initial", nodule_count: 1, nodule_size_mm: 7, ...applicability },
    {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "follow-up",
      nodule_count: 1,
      fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false,
      s3_volume_stability_criterion_met: true,
      ...applicability,
    },
    {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: false,
      multiple_nodules_all_solid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_solid_all_lt_6mm: false,
      [SG]: true,
      ...applicability,
    },
  ];

  it("every existing pathway: clinicalDispositionEvaluation absent", () => {
    for (const input of existingInputs) {
      const trace = evaluate(input, release);
      expect(trace.pathwaySelection.state).toBe("MATCHED");
      expect(trace).not.toHaveProperty("clinicalDispositionEvaluation");
    }
  });

  it("every historical Release: clinicalDispositionEvaluation absent, even for a GR-8-shaped input", () => {
    const releasesDir = join(repoRoot, "clinical/rule-sets/releases");
    const activeId = activeRuleSetPointerSchema.parse(loadRaw("clinical/rule-sets/active-release.json")).activeReleaseId;
    const historical = readdirSync(releasesDir).filter((name) => name !== `${activeId}.json`);
    expect(historical).toHaveLength(13);
    for (const name of historical) {
      const historicalRelease = ruleSetReleaseSchema.parse(
        JSON.parse(readFileSync(join(releasesDir, name), "utf-8")),
      ) as RuleSetRelease;
      expect(historicalRelease.revisions.some((r) => r.kind === "clinical-disposition")).toBe(false);
      for (const input of [...existingInputs, { ...D, [SG]: true, [OM]: true }]) {
        expect(evaluate(input, historicalRelease)).not.toHaveProperty("clinicalDispositionEvaluation");
      }
    }
  });
});

describe("clinical-disposition schema (case 32)", () => {
  const cdr = loadRaw(CDR_PATH);

  it("CDR-1 parses", () => {
    expect(() => ruleRevisionSchema.parse(cdr)).not.toThrow();
  });

  it("rejects a missing clinicalPathwayId, an unknown dispositionKind, extra keys, empty conditions, and Approved without approvalEvent", () => {
    const { clinicalPathwayId: _p, ...noPathway } = cdr;
    const { approvalEvent: _e, ...noApprovalEvent } = cdr;
    for (const variant of [
      noPathway,
      { ...cdr, clinicalPathwayId: "not-a-pathway" },
      { ...cdr, disposition: { ...cdr.disposition, dispositionKind: "clinician-directed-something-else" } },
      { ...cdr, disposition: { ...cdr.disposition, reason: "free text" } },
      { ...cdr, recommendationSourceId: "fleischner" },
      { ...cdr, recommendation: { noRoutineFollowUp: true, rationale: "x" } },
      { ...cdr, conditions: [] },
      noApprovalEvent,
      { ...cdr, disposition: { ...cdr.disposition, statement: "" } },
    ]) {
      expect(() => ruleRevisionSchema.parse(variant)).toThrow();
    }
  });
});

describe("clinical-disposition release assembly (case 33)", () => {
  it("a disposition rule bound to a pathway with no gate in the Release -> UnknownClinicalDispositionPathwayIdError", () => {
    const withoutGr8 = loadApprovedPhase1Revisions().filter(
      (r) => r.ruleId !== "GR-8" && !(r.kind === "atomic-clinical-rule" && r.clinicalPathwayId === PATHWAY_ID),
    );
    expect(withoutGr8.some((r) => r.ruleId === "CDR-1")).toBe(true);
    expect(() => buildRuleSetRelease(withoutGr8)).toThrow(UnknownClinicalDispositionPathwayIdError);
  });

  it("a Draft disposition rule -> NonApprovedRevisionError", () => {
    const draft = { ...loadFixture("synthetic-disposition-a.json"), approvalStatus: "Draft" } as RuleRevision;
    expect(() => buildRuleSetRelease([...loadApprovedPhase1Revisions(), draft])).toThrow(NonApprovedRevisionError);
  });
});

describe("active Release Manifest (case 34)", () => {
  it("lists CDR-1 as kind clinical-disposition and GR-4 at GR-4-r2; parses under the 1.10.0 manifest schema", () => {
    const activeId = activeRuleSetPointerSchema.parse(loadRaw("clinical/rule-sets/active-release.json")).activeReleaseId;
    const manifest = releaseManifestSchema.parse(loadRaw(`clinical/rule-sets/manifests/${activeId}.json`));
    expect(manifest.includedRevisions).toContainEqual({
      ruleId: "CDR-1",
      revisionId: "CDR-1-r1",
      kind: "clinical-disposition",
      approvalEvent: { by: "stratjan", at: "2026-11-03" },
    });
    expect(manifest.includedRevisions.find((r) => r.ruleId === "GR-4")?.revisionId).toBe("GR-4-r2");
    expect(manifest.includedRevisions).toHaveLength(27);
    const release = ruleSetReleaseSchema.parse(loadRaw(`clinical/rule-sets/releases/${activeId}.json`));
    expect(release.releaseId).toBe(activeId);
    expect(release.revisions).toEqual(loadTestRelease().revisions);
  });
});
