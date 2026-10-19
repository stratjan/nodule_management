// issue #16 Candidate C (final spec 6264850117 §11; readiness 6268250838): Fleischner multiple
// solid nodules with at least one >=6 mm, initial assessment. Engine/clinical behaviour over the
// assembled Release (cases 1-19, 32-34, 40). The exhaustive GR-1..GR-7 sweep (case 5) lives in
// multipleSolidCandidateB.test.ts; navigation/reset (cases 20-26) in pathwayNavigation.test.ts;
// UI (cases 27-31 + the Results-page notice) in candidateCRendering.test.ts; history (cases
// 35-38) in historicalReleases.test.ts and releaseArtifacts.test.ts.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, ENGINE_VERSION, SCHEMA_VERSION } from "../../src/engine/evaluate";
import { ruleRevisionSchema } from "../../src/engine/schema";
import { isStructuredRecommendation, type ClinicalInputState } from "../../src/engine/types";
import * as fields from "../../src/workflow/fields";
import { loadTestRelease } from "../helpers/loadTestRelease";

const release = loadTestRelease();
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const loadRaw = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), "utf-8"));

const GATE_PATH = "clinical/rules/pathway/gr-7-incidental-multiple-solid-gte-6mm-initial.json";
const ACR_PATH = "clinical/rules/recommendations/fleischner-multiple-solid-gte6mm-initial.json";
const PATHWAY_ID = "incidental-multiple-solid-gte-6mm-initial";
const ACR_ID = "ACR-FLEISCHNER-MULTIPLE-SOLID-GTE6MM-INITIAL";
const SAFEGUARD = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";

const base: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: false,
  multiple_nodules_all_solid: true,
  multiple_nodules_discrete_circumscribed: true,
  fleischner_multiple_solid_all_lt_6mm: false,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};
const confirmed: ClinicalInputState = { ...base, [SAFEGUARD]: true };
const notConfirmed: ClinicalInputState = { ...base, [SAFEGUARD]: false };

function fleischner(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner");
}

function gateStates(trace: ReturnType<typeof evaluate>): Record<string, string> {
  return Object.fromEntries(trace.clinicalPathwayGates.map((g) => [g.ruleId, g.state]));
}

const EXPECTED_ACTIONS = [
  { label: "CT follow-up", timing: { kind: "specified", intervals: ["3-6 months"] } },
];

const EXPECTED_RATIONALE =
  "Fleischner (2017) Recommendation 2 and Table 1A recommend an initial CT follow-up at 3-6 months for multiple solid noncalcified pulmonary nodules found incidentally when at least one nodule is 6 mm or larger — in both the 6-8 mm and the >8 mm columns and for both low- and high-risk patients — in a patient >=35 years old with no known malignancy history and not immunocompromised. This rule applies only to multiple discrete/circumscribed nodules whose set is solid-only, at initial assessment, with at least one nodule 6 mm or larger by the Fleischner whole-nodule average-diameter convention. Fleischner notes that management may instead be guided by a larger or more suspicious nodule according to its solitary-nodule recommendations, and that the most suspicious nodule is not necessarily the largest; this recommendation applies only because the clinician has confirmed that no individual larger or more suspicious nodule currently requires such management. No index, largest, dominant, or most-suspicious nodule is identified, ranked, or selected by this application, and no Fleischner risk category is collected or used. This recommendation covers only the first follow-up CT: the risk-dependent CT at 18-24 months, solitary-nodule-directed management of any individual nodule, PET/CT, biopsy, and resection are outside this Rule-Set Release and must not be inferred from it.";

describe("#16 Candidate C — GR-7 pathway selection (cases 1-6)", () => {
  it("case 1: base with nodule_count 2, 3, 7 -> MATCHED; only GR-7 MATCHED, GR-1..GR-6 NOT_MATCHED", () => {
    for (const nodule_count of [2, 3, 7]) {
      const trace = evaluate({ ...base, nodule_count }, release);
      expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: PATHWAY_ID });
      expect(gateStates(trace)).toEqual({
        "GR-1": "NOT_MATCHED",
        "GR-2": "NOT_MATCHED",
        "GR-3": "NOT_MATCHED",
        "GR-4": "NOT_MATCHED",
        "GR-5": "NOT_MATCHED",
        "GR-6": "NOT_MATCHED",
        "GR-7": "MATCHED",
      });
    }
  });

  it("case 2: all_lt_6mm=true -> GR-6 governs, GR-7 NOT_MATCHED, Candidate-B outcomes unchanged", () => {
    for (const risk of [undefined, "low", "high"] as const) {
      const input: ClinicalInputState = {
        ...base,
        fleischner_multiple_solid_all_lt_6mm: true,
        ...(risk === undefined ? {} : { fleischner_multiple_solid_risk_category: risk }),
      };
      const trace = evaluate(input, release);
      expect(trace.pathwaySelection).toEqual({
        state: "MATCHED",
        clinicalPathwayId: "incidental-multiple-solid-lt-6mm-initial",
      });
      expect(gateStates(trace)["GR-7"]).toBe("NOT_MATCHED");
      const expected = risk === undefined
        ? "INSUFFICIENT_INPUT"
        : "RECOMMENDATION";
      expect(fleischner(trace)?.state).toBe(expected);
      if (risk !== undefined) {
        expect(fleischner(trace)?.recommendation?.matchedRuleId).toBe(
          `ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-${risk.toUpperCase()}-RISK`,
        );
      }
    }
  });

  it("case 3: mixed / disseminated / screening / follow-up -> GR-7 NOT_MATCHED, NO_PATHWAY_MATCHED", () => {
    for (const override of [
      { multiple_nodules_all_solid: false },
      { multiple_nodules_discrete_circumscribed: false },
      { assessment_context: "screening" },
      { assessment_timepoint: "follow-up" },
    ]) {
      const trace = evaluate({ ...confirmed, ...override }, release);
      expect(gateStates(trace)["GR-7"]).toBe("NOT_MATCHED");
      expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
      expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
      expect(trace.recommendationSet).toEqual([]);
    }
  });

  it("case 3b: contradictory stale all_subsolid=true with all_solid=true -> GR-7 NOT_MATCHED, GR-5 governs by its own conditions", () => {
    const trace = evaluate(
      { ...confirmed, multiple_nodules_all_subsolid: true, fleischner_multiple_subsolid_any_gte_6mm: true },
      release,
    );
    expect(gateStates(trace)["GR-7"]).toBe("NOT_MATCHED");
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-multiple-subsolid-initial",
    });
    expect(trace.recommendationSet.map((r) => r.matchedRuleId)).toEqual([
      "ACR-FLEISCHNER-MULTIPLE-SUBSOLID-INITIAL",
    ]);
  });

  it("case 4: each GR-7 fact absent -> pathway INSUFFICIENT_INPUT with exactly that missing field", () => {
    for (const field of [
      "multiple_nodules_all_subsolid",
      "multiple_nodules_all_solid",
      "multiple_nodules_discrete_circumscribed",
      "fleischner_multiple_solid_all_lt_6mm",
    ] as const) {
      const input: ClinicalInputState = { ...confirmed };
      delete input[field];
      const trace = evaluate(input, release);
      expect(trace.pathwaySelection.state, field).toBe("INSUFFICIENT_INPUT");
      const gr7 = trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-7");
      expect(gr7?.state, field).toBe("INDETERMINATE");
      expect(gr7?.missingFields, field).toEqual([field]);
      if (field === "fleischner_multiple_solid_all_lt_6mm") {
        expect(gateStates(trace)["GR-6"]).toBe("INDETERMINATE");
      }
      expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
    }
  });

  it("case 6: solitary and Candidate-A inputs keep GR-7 NOT_MATCHED; the trace carries 7 gates", () => {
    const applicability = { age: 55, known_malignancy_history: false, immunocompromised: false };
    for (const input of [
      {
        nodule_morphology: "solid",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        nodule_size_mm: 7,
        ...applicability,
      },
      {
        nodule_morphology: "solid",
        assessment_context: "incidental",
        assessment_timepoint: "follow-up",
        nodule_count: 1,
        s3_volume_stability_criterion_met: true,
        ...applicability,
      },
      {
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 3,
        multiple_nodules_all_subsolid: true,
        multiple_nodules_discrete_circumscribed: true,
        fleischner_multiple_subsolid_any_gte_6mm: true,
        ...applicability,
      },
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate(input, release);
      expect(trace.clinicalPathwayGates).toHaveLength(7);
      expect(gateStates(trace)["GR-7"]).toBe("NOT_MATCHED");
      expect(trace.pathwaySelection.state).toBe("MATCHED");
    }
  });
});

describe("#16 Candidate C — governing-nodule safeguard (cases 7-12)", () => {
  it("case 7: safeguard absent -> Fleischner INSUFFICIENT_INPUT naming the safeguard; empty Recommendation Set", () => {
    const trace = evaluate(base, release);
    expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner(trace)?.reason).toContain(SAFEGUARD);
    expect(fleischner(trace)?.recommendation).toBeUndefined();
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 8: safeguard true -> RECOMMENDATION from the Candidate-C ACR via clinician attestation", () => {
    const trace = evaluate(confirmed, release);
    const outcome = fleischner(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.recommendation?.matchedRuleId).toBe(ACR_ID);
    expect(outcome?.recommendation?.matchedRevisionId).toBe(`${ACR_ID}-r1`);
    expect(outcome?.recommendation?.clinicalCriterionUsed).toBe("clinician-attestation");
    expect(outcome?.recommendation).not.toHaveProperty("measurementBasisUsed");
    expect(outcome).not.toHaveProperty("toleratedUnresolvedSiblings");
    expect(trace.recommendationSet.map((r) => [r.recommendationSourceId, r.matchedRuleId])).toEqual([
      ["fleischner", ACR_ID],
    ]);
  });

  it("case 9: the payload is structured with exactly one CT follow-up / 3-6 months action and no other form", () => {
    const rec = fleischner(evaluate(confirmed, release))?.recommendation!;
    expect(isStructuredRecommendation(rec)).toBe(true);
    if (!isStructuredRecommendation(rec)) throw new Error("expected structured form");
    expect(rec.actions).toEqual(EXPECTED_ACTIONS);
    expect(rec.rationale).toBe(EXPECTED_RATIONALE);
    for (const key of [
      "noRoutineFollowUp",
      "considerAction",
      "clinicalEndpoint",
      "intervals",
      "persistenceConfirmation",
      "ifPersistent",
    ]) {
      expect(rec).not.toHaveProperty(key);
    }
  });

  it("case 10: safeguard false -> Fleischner OUTSIDE_CURRENT_RULESET_SCOPE; no recommendation, no substitute, no other pathway", () => {
    const trace = evaluate(notConfirmed, release);
    expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: PATHWAY_ID });
    expect(trace.clinicalPathwayGates.filter((g) => g.state === "MATCHED").map((g) => g.ruleId)).toEqual([
      "GR-7",
    ]);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
    expect(fleischner(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(fleischner(trace)?.reason).toContain("required clinical criterion was not met");
    expect(fleischner(trace)?.recommendation).toBeUndefined();
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 11: a stray Candidate-B risk value is never consulted on GR-7", () => {
    for (const risk of ["low", "high"] as const) {
      for (const input of [base, confirmed, notConfirmed]) {
        const withRisk = evaluate({ ...input, fleischner_multiple_solid_risk_category: risk }, release);
        const without = evaluate(input, release);
        expect(withRisk.pathwaySelection).toEqual(without.pathwaySelection);
        expect(withRisk.sourceEvaluationOutcomes).toEqual(without.sourceEvaluationOutcomes);
        expect(withRisk.recommendationSet).toEqual(without.recommendationSet);
      }
    }
  });

  it("case 12: a stray safeguard is never consulted on GR-6 (Candidate-B outcomes identical)", () => {
    const b: ClinicalInputState = { ...base, fleischner_multiple_solid_all_lt_6mm: true };
    for (const risk of [undefined, "low", "high"] as const) {
      const input: ClinicalInputState = {
        ...b,
        ...(risk === undefined ? {} : { fleischner_multiple_solid_risk_category: risk }),
      };
      const without = evaluate(input, release);
      for (const safeguard of [true, false]) {
        const withSafeguard = evaluate({ ...input, [SAFEGUARD]: safeguard }, release);
        expect(withSafeguard.pathwaySelection).toEqual(without.pathwaySelection);
        expect(withSafeguard.sourceEvaluationOutcomes).toEqual(without.sourceEvaluationOutcomes);
        expect(withSafeguard.recommendationSet).toEqual(without.recommendationSet);
      }
    }
  });
});

describe("#16 Candidate C — applicability (cases 13-14)", () => {
  it("case 13: age <35 / known malignancy / immunocompromised -> Fleischner NOT_APPLICABLE even when confirmed", () => {
    for (const override of [{ age: 30 }, { known_malignancy_history: true }, { immunocompromised: true }]) {
      for (const safeguard of [true, false, undefined]) {
        const input: ClinicalInputState = {
          ...base,
          ...override,
          ...(safeguard === undefined ? {} : { [SAFEGUARD]: safeguard }),
        };
        const trace = evaluate(input, release);
        expect(fleischner(trace)?.state).toBe("NOT_APPLICABLE");
        expect(trace.recommendationSet).toEqual([]);
      }
    }
  });

  it("case 14: any Candidate-C input yields exactly one Source Evaluation Outcome (Fleischner); no S3, no BTS", () => {
    for (const input of [base, confirmed, notConfirmed, { ...confirmed, age: 30 }]) {
      expect(evaluate(input, release).sourceEvaluationOutcomes.map((o) => o.recommendationSourceId)).toEqual([
        "fleischner",
      ]);
    }
  });
});

describe("#16 Candidate C — negative clinical assertions (cases 15-19)", () => {
  const bound = release.revisions.filter(
    (r) => r.kind === "atomic-clinical-rule" && r.clinicalPathwayId === PATHWAY_ID,
  );

  it("case 15: the only rule bound to the new pathway is the Candidate-C ACR", () => {
    expect(bound.map((r) => r.ruleId)).toEqual([ACR_ID]);
  });

  it("case 16: exactly one action; no 18-24 months, PET, biopsy, resection, or surgical executable content", () => {
    // Executable keys of the governed rule and of the evaluated payload only -- the rationale
    // deliberately names these as exclusions and is asserted verbatim in case 9 instead.
    const governed = bound.map((r: any) => ({
      noRoutineFollowUp: r.recommendation.noRoutineFollowUp,
      considerAction: r.recommendation.considerAction,
      actions: r.recommendation.actions,
      clinicalEndpoint: r.recommendation.clinicalEndpoint,
      intervals: r.recommendation.intervals,
    }));
    const rec: any = fleischner(evaluate(confirmed, release))?.recommendation;
    const evaluated = { actions: rec.actions, considerAction: rec.considerAction, intervals: rec.intervals };
    for (const executable of [JSON.stringify(governed), JSON.stringify(evaluated)]) {
      expect(executable).not.toMatch(/18-24 months|PET|biops|resection|surgery|surgical/i);
    }
    expect(rec.actions).toHaveLength(1);
  });

  it("case 17: the ACR's conditions reference only the safeguard -- no risk, size, or lesion field", () => {
    const acr: any = bound[0];
    expect(acr.conditions).toEqual([{ field: SAFEGUARD, op: "eq", value: true }]);
    expect(JSON.stringify(acr.conditions)).not.toMatch(
      /risk_category|all_lt_6mm|size|diameter|volume|lesion|dominant|rank/i,
    );
  });

  it("case 18: ClinicalInputState gains exactly one key over 1.8.0 -- no risk, lesion, rank, or dominant field", () => {
    const types = readFileSync(join(repoRoot, "src/engine/types.ts"), "utf-8").replace(/\r\n/g, "\n");
    const start = types.indexOf("export interface ClinicalInputState {");
    const inputState = types.slice(start, types.indexOf("\n}", start));
    const fieldNames = [...inputState.matchAll(/^  (\w+)\?:/gm)].map((m) => m[1]);
    const v180Keys = [
      "nodule_morphology",
      "assessment_context",
      "assessment_timepoint",
      "nodule_count",
      "nodule_size_mm",
      "nodule_volume_mm3",
      "nodule_diameter_measurements",
      "solid_component_diameter_measurements",
      "age",
      "known_malignancy_history",
      "immunocompromised",
      "s3_volume_stability_criterion_met",
      "s3_vdt_days",
      "s3_general_condition_precludes_further_workup_or_therapy",
      "multiple_nodules_all_subsolid",
      "multiple_nodules_discrete_circumscribed",
      "fleischner_multiple_subsolid_any_gte_6mm",
      "multiple_nodules_all_solid",
      "fleischner_multiple_solid_all_lt_6mm",
      "fleischner_multiple_solid_risk_category",
    ];
    expect(fieldNames).toEqual([...v180Keys, SAFEGUARD]);
    expect(SAFEGUARD).not.toMatch(/risk|lesion|rank|dominant|largest|index/);
  });

  it("case 19: no governed text and no UI constant contains the phrase \"no dominant nodule\"", () => {
    const uiConstants = Object.values(fields)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => JSON.stringify(value));
    const app = readFileSync(join(repoRoot, "src/ui/App.tsx"), "utf-8");
    for (const text of [
      readFileSync(join(repoRoot, GATE_PATH), "utf-8"),
      readFileSync(join(repoRoot, ACR_PATH), "utf-8"),
      ...uiConstants,
      app,
    ]) {
      expect(text.toLowerCase()).not.toContain("no dominant nodule");
    }
  });
});

describe("#16 Candidate C — Release, governed JSON, SAR, versions (cases 32-34, 40)", () => {
  it("case 32: the assembled Release has exactly 23 revisions, including GR-7-r1 and the Candidate-C ACR", () => {
    expect(release.revisions).toHaveLength(23);
    const ids = release.revisions.map((r) => r.revisionId);
    expect(ids).toContain("GR-7-r1");
    expect(ids).toContain(`${ACR_ID}-r1`);
    expect(new Set(ids).size).toBe(23);
  });

  it("case 33: GR-7 has exactly the approved identity and conditions, in order", () => {
    const gate = loadRaw(GATE_PATH);
    expect(() => ruleRevisionSchema.parse(gate)).not.toThrow();
    expect(gate.ruleId).toBe("GR-7");
    expect(gate.revisionId).toBe("GR-7-r1");
    expect(gate.kind).toBe("pathway-gate");
    expect(gate.approvalStatus).toBe("Approved");
    expect(gate.clinicalPathwayId).toBe(PATHWAY_ID);
    expect(gate.conditions).toEqual([
      { field: "assessment_context", op: "eq", value: "incidental" },
      { field: "assessment_timepoint", op: "eq", value: "initial" },
      { field: "nodule_count", op: "gte", value: 2 },
      { field: "multiple_nodules_all_subsolid", op: "eq", value: false },
      { field: "multiple_nodules_all_solid", op: "eq", value: true },
      { field: "multiple_nodules_discrete_circumscribed", op: "eq", value: true },
      { field: "fleischner_multiple_solid_all_lt_6mm", op: "eq", value: false },
    ]);
    // the safeguard is not a gate condition (architecture confirmation 6262113692 item 4)
    expect(JSON.stringify(gate.conditions)).not.toContain(SAFEGUARD);
    // GR-6 and GR-7 differ only in the all_lt_6mm value -- exclusive by construction
    const gr6 = loadRaw("clinical/rules/pathway/gr-6-incidental-multiple-solid-lt-6mm-initial.json");
    expect(gate.conditions.slice(0, 6)).toEqual(gr6.conditions.slice(0, 6));
    expect(gr6.conditions[6]).toEqual({ field: "fleischner_multiple_solid_all_lt_6mm", op: "eq", value: true });
  });

  it("case 33: the ACR has exactly the approved identity, binding, condition, recommendation and three anchors", () => {
    const acr = loadRaw(ACR_PATH);
    expect(() => ruleRevisionSchema.parse(acr)).not.toThrow();
    expect(acr.ruleId).toBe(ACR_ID);
    expect(acr.revisionId).toBe(`${ACR_ID}-r1`);
    expect(acr.kind).toBe("atomic-clinical-rule");
    expect(acr.recommendationSourceId).toBe("fleischner");
    expect(acr.clinicalPathwayId).toBe(PATHWAY_ID);
    expect(acr.approvalStatus).toBe("Approved");
    expect(acr.conditions).toEqual([{ field: SAFEGUARD, op: "eq", value: true }]);
    expect(acr.recommendation).toEqual({ actions: EXPECTED_ACTIONS, rationale: EXPECTED_RATIONALE });
    expect(acr.provenanceAnchors.map((a: any) => a.role)).toEqual([
      "primary-management",
      "governing-nodule-safeguard",
      "whole-nodule-measurement",
    ]);
    for (const anchor of acr.provenanceAnchors) {
      expect(anchor.provenance.sourceType).toBe("Source Guideline");
      expect(anchor.provenance.version).toBe("Radiology. 2017;284(1):228-243. doi:10.1148/radiol.2017161659");
    }
    expect(JSON.stringify(acr.provenanceAnchors)).not.toMatch(/Local SOP|\bS3\b|\bBTS\b/);
    for (const key of [
      "measurementBasis",
      "measurementConventionId",
      "diameterConditions",
      "volumeConditions",
      "sufficientConditionGroups",
      "operandInapplicabilityPreconditions",
      "nonBlockingUnresolvedSiblings",
    ]) {
      expect(acr).not.toHaveProperty(key);
    }
  });

  it("case 34: SAR-FLEISCHNER-r1 is unchanged and references no Candidate-B/C field", () => {
    const sar = loadRaw("clinical/rules/applicability/fleischner-applicability.json");
    expect(sar.ruleId).toBe("SAR-FLEISCHNER");
    expect(sar.revisionId).toBe("SAR-FLEISCHNER-r1");
    expect(JSON.stringify(sar)).not.toMatch(/multiple_nodules_all_solid|fleischner_multiple_solid/);
    expect(release.revisions.filter((r) => r.ruleId === "SAR-FLEISCHNER").map((r) => r.revisionId)).toEqual([
      "SAR-FLEISCHNER-r1",
    ]);
  });

  it("case 40: ENGINE_VERSION, SCHEMA_VERSION and trace versions are 1.9.0", () => {
    expect(ENGINE_VERSION).toBe("1.9.0");
    expect(SCHEMA_VERSION).toBe("1.9.0");
    const trace = evaluate(confirmed, release);
    expect(trace.engineVersion).toBe("1.9.0");
    expect(trace.schemaVersion).toBe("1.9.0");
  });
});
