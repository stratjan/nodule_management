// issue #16 Candidate D (final spec 6411027075/6411027421 §13; readiness 6614358295): Fleischner
// multiple solid >=6 mm, first follow-up after an initial episode for which CT at 3-6 months was
// intended, with the risk-dependent CT at 18-24 months from baseline CT. Engine/clinical behaviour
// over the assembled Release (cases 1-14, 17-24, 26-31, 35-37, 59). The exhaustive GR-1..GR-8 sweep
// (case 6) lives in multipleSolidCandidateB.test.ts; the disposition-stage mechanics (15-16,
// 32-34) in clinicalDispositionStage.test.ts; R2 (25, 52, 53) in threeValuedBareConditions.test.ts;
// structured unresolved input (47-48) in unresolvedRequiredInputs.test.ts; navigation/reset
// (38-44) in pathwayNavigation.test.ts; completeness (45-46, 60) in guidedCompleteness.test.ts;
// UI (49-51b) in candidateDRendering.test.ts; history (54-58) in historicalReleases.test.ts and
// releaseArtifacts.test.ts.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, ENGINE_VERSION, SCHEMA_VERSION } from "../../src/engine/evaluate";
import { ruleRevisionSchema } from "../../src/engine/schema";
import {
  isConsiderActionRecommendation,
  isStructuredRecommendation,
  type ClinicalInputState,
} from "../../src/engine/types";
import * as fields from "../../src/workflow/fields";
import { loadTestRelease } from "../helpers/loadTestRelease";

const release = loadTestRelease();
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const loadRaw = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), "utf-8"));

const GR8_PATH = "clinical/rules/pathway/gr-8-incidental-multiple-solid-gte-6mm-first-follow-up.json";
const GR4_PATH = "clinical/rules/pathway/gr-4-incidental-solitary-solid-follow-up.json";
const CDR_PATH =
  "clinical/rules/disposition/cdr-1-incidental-multiple-solid-gte-6mm-first-follow-up-no-further-routine-surveillance.json";
const LOW_PATH = "clinical/rules/recommendations/fleischner-multiple-solid-gte6mm-first-follow-up-low-risk.json";
const HIGH_PATH = "clinical/rules/recommendations/fleischner-multiple-solid-gte6mm-first-follow-up-high-risk.json";
const PATHWAY_ID = "incidental-multiple-solid-gte-6mm-first-follow-up";
const LOW_ID = "ACR-FLEISCHNER-MULTIPLE-SOLID-GTE6MM-FIRST-FOLLOW-UP-LOW-RISK";
const HIGH_ID = "ACR-FLEISCHNER-MULTIPLE-SOLID-GTE6MM-FIRST-FOLLOW-UP-HIGH-RISK";

const OR = "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed";
const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const OM = "clinician_decides_no_further_routine_nodule_surveillance";
const RK = "fleischner_multiple_solid_risk_category";

const D: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  [OR]: true,
  age: 60,
  known_malignancy_history: false,
  immunocompromised: false,
};
const proceeds: ClinicalInputState = { ...D, [SG]: true, [OM]: false };

const TIMING = { kind: "specified", intervals: ["18-24 months from baseline CT"] };
const CT_ACTION = { label: "CT follow-up", timing: TIMING };

const STATEMENT =
  "Based on the current interval imaging findings and overall clinical context, I decide that no further routine pulmonary nodule surveillance is planned.";
const RATIONALE =
  "This records the clinician's decision based on the current interval imaging findings and overall clinical context. It is not a guideline recommendation and was not inferred by the application.";

function fleischner(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner");
}

function gateStates(trace: ReturnType<typeof evaluate>): Record<string, string> {
  return Object.fromEntries(trace.clinicalPathwayGates.map((g) => [g.ruleId, g.state]));
}

describe("#16 Candidate D — pathway identity (cases 1-7)", () => {
  it("case 1: D matches GR-8 only, also with a stray current count, morphology, or set facts; the trace carries 8 gates", () => {
    for (const stray of [
      {},
      { nodule_count: 1 },
      { nodule_count: 3 },
      { nodule_morphology: "pure-ground-glass" },
      { nodule_count: 3, multiple_nodules_all_subsolid: true, multiple_nodules_all_solid: false },
      { multiple_nodules_discrete_circumscribed: false, fleischner_multiple_solid_all_lt_6mm: true },
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate({ ...D, ...stray }, release);
      expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: PATHWAY_ID });
      expect(trace.clinicalPathwayGates).toHaveLength(8);
      const states = gateStates(trace);
      expect(states["GR-8"]).toBe("MATCHED");
      expect(Object.entries(states).filter(([, state]) => state === "MATCHED")).toEqual([["GR-8", "MATCHED"]]);
    }
  });

  it("case 1 (episode identity): no current count, no morphology, and complete resolution need no synthetic nodule", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    expect(trace.normalizedClinicalInputState.nodule_count).toBeUndefined();
    expect(trace.normalizedClinicalInputState.nodule_morphology).toBeUndefined();
    expect(trace.clinicalDispositionEvaluation?.state).toBe("DISPOSITION");
  });

  it("case 2: origin false with a solid solitary count of 1 -> GR-4-r2 MATCHED, GR-8 NOT_MATCHED, S3 outcome as before", () => {
    const trace = evaluate(
      {
        ...D,
        [OR]: false,
        nodule_morphology: "solid",
        nodule_count: 1,
        s3_volume_stability_criterion_met: true,
      },
      release,
    );
    expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: "incidental-solitary-solid-follow-up" });
    const gr4 = trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-4");
    expect(gr4?.revisionId).toBe("GR-4-r2");
    expect(gr4?.state).toBe("MATCHED");
    expect(gateStates(trace)["GR-8"]).toBe("NOT_MATCHED");
    expect(trace.sourceEvaluationOutcomes.map((o) => [o.recommendationSourceId, o.state])).toEqual([
      ["s3", "RECOMMENDATION"],
    ]);
    expect(trace.clinicalDispositionEvaluation).toBeUndefined();
  });

  it("case 3: solid solitary follow-up with the origin absent -> pathway INSUFFICIENT_INPUT; GR-4-r2 and GR-8 INDETERMINATE on the origin only", () => {
    const { [OR]: _origin, ...withoutOrigin } = { ...D, nodule_morphology: "solid", nodule_count: 1 };
    const trace = evaluate(withoutOrigin, release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    for (const id of ["GR-4", "GR-8"]) {
      const gate = trace.clinicalPathwayGates.find((g) => g.ruleId === id);
      expect(gate?.state).toBe("INDETERMINATE");
      expect(gate?.missingFields).toEqual([OR]);
    }
    expect(trace.sourceEvaluationOutcomes).toEqual([]);
  });

  it("case 4: count-3 follow-up -> INSUFFICIENT_INPUT with the origin absent (GR-8 INDETERMINATE), NO_PATHWAY_MATCHED with it false", () => {
    const { [OR]: _origin, ...withoutOrigin } = { ...D, nodule_count: 3 };
    const absent = evaluate(withoutOrigin, release);
    expect(absent.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    expect(gateStates(absent)["GR-8"]).toBe("INDETERMINATE");
    const no = evaluate({ ...D, nodule_count: 3, [OR]: false }, release);
    expect(no.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
  });

  it("case 5: D with an initial timepoint or a screening context -> GR-8 NOT_MATCHED", () => {
    for (const override of [{ assessment_timepoint: "initial" }, { assessment_context: "screening" }]) {
      expect(gateStates(evaluate({ ...D, ...override }, release))["GR-8"]).toBe("NOT_MATCHED");
    }
  });

  it("case 7: existing solitary, follow-up, and Candidate A/B/C inputs keep GR-8 NOT_MATCHED and 8 gates", () => {
    const applicability = { age: 55, known_malignancy_history: false, immunocompromised: false };
    const multipleSolid = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: false,
      multiple_nodules_all_solid: true,
      multiple_nodules_discrete_circumscribed: true,
      ...applicability,
    };
    for (const input of [
      { nodule_morphology: "solid", assessment_context: "incidental", assessment_timepoint: "initial", nodule_count: 1, nodule_size_mm: 7, ...applicability },
      { nodule_morphology: "solid", assessment_context: "incidental", assessment_timepoint: "follow-up", nodule_count: 1, [OR]: false, s3_vdt_days: 700, ...applicability },
      { assessment_context: "incidental", assessment_timepoint: "initial", nodule_count: 3, multiple_nodules_all_subsolid: true, multiple_nodules_discrete_circumscribed: true, fleischner_multiple_subsolid_any_gte_6mm: true, ...applicability },
      { ...multipleSolid, fleischner_multiple_solid_all_lt_6mm: true, [RK]: "high" },
      { ...multipleSolid, fleischner_multiple_solid_all_lt_6mm: false, [SG]: true },
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate(input, release);
      expect(trace.clinicalPathwayGates).toHaveLength(8);
      expect(gateStates(trace)["GR-8"]).toBe("NOT_MATCHED");
      expect(trace.pathwaySelection.state).toBe("MATCHED");
      expect(trace.clinicalDispositionEvaluation).toBeUndefined();
    }
  });
});

describe("#16 Candidate D — disposition stage on GR-8 (cases 8-14)", () => {
  it("case 8: safeguard absent -> disposition INSUFFICIENT_INPUT [SG, OM]; no source evaluated", () => {
    const trace = evaluate(D, release);
    expect(trace.clinicalDispositionEvaluation).toMatchObject({
      state: "INSUFFICIENT_INPUT",
      rules: [{ ruleId: "CDR-1", revisionId: "CDR-1-r1", state: "INDETERMINATE", missingFields: [SG, OM] }],
      unresolvedRequiredInputs: [
        { kind: "field", field: SG },
        { kind: "field", field: OM },
      ],
    });
    expect(trace.clinicalDispositionEvaluation?.disposition).toBeUndefined();
    expect(trace.sourceEvaluationOutcomes).toEqual([]);
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 9: safeguard true, omission absent -> disposition INSUFFICIENT_INPUT [OM]; CT is never recommended before OM is answered", () => {
    for (const risk of [undefined, "low", "high"] as const) {
      const trace = evaluate({ ...D, [SG]: true, ...(risk ? { [RK]: risk } : {}) }, release);
      expect(trace.clinicalDispositionEvaluation?.state).toBe("INSUFFICIENT_INPUT");
      expect(trace.clinicalDispositionEvaluation?.unresolvedRequiredInputs).toEqual([{ kind: "field", field: OM }]);
      expect(trace.sourceEvaluationOutcomes).toEqual([]);
      expect(trace.recommendationSet).toEqual([]);
    }
  });

  it("case 10: safeguard true, omission true -> terminal Clinical Disposition from CDR-1; no source outcome, empty Recommendation Set", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    const cdr = loadRaw(CDR_PATH);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("DISPOSITION");
    expect(trace.clinicalDispositionEvaluation?.rules).toEqual([
      { ruleId: "CDR-1", revisionId: "CDR-1-r1", state: "MATCHED", missingFields: [] },
    ]);
    expect(trace.clinicalDispositionEvaluation?.disposition).toEqual({
      ruleId: "CDR-1",
      revisionId: "CDR-1-r1",
      dispositionKind: "clinician-directed-no-further-routine-surveillance",
      statement: STATEMENT,
      rationale: RATIONALE,
      provenance: cdr.provenance,
    });
    expect(trace.clinicalDispositionEvaluation?.unresolvedRequiredInputs).toBeUndefined();
    expect(trace.sourceEvaluationOutcomes).toEqual([]);
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 11: the disposition precedes the SAR -- age <35, malignancy, immunocompromise or absent applicability change nothing (no NOT_APPLICABLE)", () => {
    const reference = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    const { age: _a, known_malignancy_history: _m, immunocompromised: _i, ...noApplicability } = D;
    for (const input of [
      { ...D, age: 30 },
      { ...D, known_malignancy_history: true },
      { ...D, immunocompromised: true },
      noApplicability,
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate({ ...input, [SG]: true, [OM]: true }, release);
      expect(trace.clinicalDispositionEvaluation).toEqual(reference.clinicalDispositionEvaluation);
      expect(trace.sourceEvaluationOutcomes).toEqual([]);
    }
  });

  it("case 12: a stray high risk does not change the disposition", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true, [RK]: "high" }, release);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("DISPOSITION");
    expect(trace.sourceEvaluationOutcomes).toEqual([]);
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 13: safeguard false (omission absent or stale true) -> disposition NONE_MATCHED; Fleischner OUTSIDE_CURRENT_RULESET_SCOPE (R2), no risk needed, no recommendation", () => {
    for (const om of [undefined, true] as const) {
      const trace = evaluate({ ...D, [SG]: false, ...(om === undefined ? {} : { [OM]: om }) }, release);
      expect(trace.clinicalDispositionEvaluation?.state).toBe("NONE_MATCHED");
      expect(trace.clinicalDispositionEvaluation?.rules[0].state).toBe("NOT_MATCHED");
      expect(fleischner(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
      expect(fleischner(trace)?.unresolvedRequiredInputs).toBeUndefined();
      expect(trace.recommendationSet).toEqual([]);
    }
  });

  it("case 14: safeguard true, omission false -> disposition NONE_MATCHED; Fleischner evaluated", () => {
    const trace = evaluate({ ...proceeds, [RK]: "high" }, release);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("NONE_MATCHED");
    expect(trace.clinicalDispositionEvaluation?.disposition).toBeUndefined();
    expect(fleischner(trace)).toBeDefined();
  });
});

describe("#16 Candidate D — Fleischner on GR-8 (cases 17-22)", () => {
  it("case 17: risk absent -> Fleischner INSUFFICIENT_INPUT with structured [RK]; the reason names RK", () => {
    const trace = evaluate(proceeds, release);
    expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner(trace)?.unresolvedRequiredInputs).toEqual([{ kind: "field", field: RK }]);
    expect(fleischner(trace)?.reason).toContain(RK);
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 18: low risk -> optional consider-action CT at 18-24 months from baseline CT via clinician attestation", () => {
    const trace = evaluate({ ...proceeds, [RK]: "low" }, release);
    const outcome = fleischner(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    const rec = outcome!.recommendation!;
    expect(rec.matchedRuleId).toBe(LOW_ID);
    expect(rec.matchedRevisionId).toBe(`${LOW_ID}-r1`);
    expect(isConsiderActionRecommendation(rec)).toBe(true);
    expect(isStructuredRecommendation(rec)).toBe(false);
    expect((rec as { considerAction: unknown }).considerAction).toEqual(CT_ACTION);
    expect(rec.clinicalCriterionUsed).toBe("clinician-attestation");
    expect(trace.recommendationSet).toHaveLength(1);
  });

  it("case 19: high risk -> recommended CT at 18-24 months from baseline CT, exactly one action", () => {
    const trace = evaluate({ ...proceeds, [RK]: "high" }, release);
    const outcome = fleischner(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    const rec = outcome!.recommendation!;
    expect(rec.matchedRuleId).toBe(HIGH_ID);
    expect(isStructuredRecommendation(rec)).toBe(true);
    expect(isConsiderActionRecommendation(rec)).toBe(false);
    expect((rec as { actions: unknown }).actions).toEqual([CT_ACTION]);
    expect(rec.clinicalCriterionUsed).toBe("clinician-attestation");
  });

  it("case 20: low/high risk with age <35, known malignancy, or immunocompromise -> Fleischner NOT_APPLICABLE", () => {
    for (const risk of ["low", "high"] as const)
      for (const override of [{ age: 30 }, { known_malignancy_history: true }, { immunocompromised: true }]) {
        const trace = evaluate({ ...proceeds, [RK]: risk, ...override }, release);
        expect(fleischner(trace)?.state).toBe("NOT_APPLICABLE");
        expect(trace.recommendationSet).toEqual([]);
      }
  });

  it("case 21: omission false with applicability absent -> Fleischner INSUFFICIENT_INPUT (SAR) listing the missing applicability fields", () => {
    const { age: _a, known_malignancy_history: _m, immunocompromised: _i, ...noApplicability } = proceeds;
    const trace = evaluate({ ...noApplicability, [RK]: "high" }, release);
    expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner(trace)?.unresolvedRequiredInputs).toEqual([
      { kind: "field", field: "age" },
      { kind: "field", field: "known_malignancy_history" },
      { kind: "field", field: "immunocompromised" },
    ]);
  });

  it("case 22: any GR-8 input reaching source evaluation yields exactly one outcome (Fleischner); no S3, no BTS", () => {
    for (const input of [
      { ...D, [SG]: false },
      proceeds,
      { ...proceeds, [RK]: "low" },
      { ...proceeds, [RK]: "high", age: 30 },
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate(input, release);
      expect(trace.sourceEvaluationOutcomes.map((o) => o.recommendationSourceId)).toEqual(["fleischner"]);
    }
  });
});

describe("#16 Candidate D — three-valued bare conditions on the GR-8 ACRs (cases 23-24)", () => {
  it("case 23: safeguard false, risk absent -> both ACRs definitively NOT_MATCHED -> OUTSIDE_CURRENT_RULESET_SCOPE, never INSUFFICIENT_INPUT", () => {
    const trace = evaluate({ ...D, [SG]: false }, release);
    expect(fleischner(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("case 24 (raw): safeguard absent with an omission already false and risk low -> disposition NONE_MATCHED, both ACRs INDETERMINATE -> Fleischner INSUFFICIENT_INPUT on the safeguard", () => {
    const trace = evaluate({ ...D, [OM]: false, [RK]: "low" }, release);
    expect(trace.clinicalDispositionEvaluation?.state).toBe("NONE_MATCHED");
    expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner(trace)?.unresolvedRequiredInputs).toEqual([{ kind: "field", field: SG }]);
    expect(trace.recommendationSet).toEqual([]);
  });
});

describe("#16 Candidate D — negative clinical assertions (cases 26-31)", () => {
  const boundRules = release.revisions.filter(
    (r) => (r.kind === "atomic-clinical-rule" || r.kind === "clinical-disposition") && r.clinicalPathwayId === PATHWAY_ID,
  );

  it("case 26: GR-8 binds exactly the two new ACRs and exactly [CDR-1]", () => {
    expect(boundRules.filter((r) => r.kind === "atomic-clinical-rule").map((r) => r.ruleId).sort()).toEqual(
      [HIGH_ID, LOW_ID].sort(),
    );
    expect(boundRules.filter((r) => r.kind === "clinical-disposition").map((r) => r.ruleId)).toEqual(["CDR-1"]);
  });

  it("case 27: every GR-8 interval is the anchored 18-24-month string; no other interval or invasive label; one action per ACR", () => {
    for (const path of [LOW_PATH, HIGH_PATH]) {
      const acr = loadRaw(path);
      const actions = acr.recommendation.actions ?? [acr.recommendation.considerAction];
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual(CT_ACTION);
      const executable = JSON.stringify(actions);
      expect(executable).not.toMatch(/3-6 months|12 months|PET|biops|resection|surg/i);
      expect(executable).not.toMatch(/"18-24 months"/);
    }
  });

  it("case 28: ACR conditions reference only SG and RK; CDR-1 only SG and OM; nothing references count, size, morphology, lesion, stability, or dates", () => {
    expect(loadRaw(LOW_PATH).conditions).toEqual([
      { field: SG, op: "eq", value: true },
      { field: RK, op: "eq", value: "low" },
    ]);
    expect(loadRaw(HIGH_PATH).conditions).toEqual([
      { field: SG, op: "eq", value: true },
      { field: RK, op: "eq", value: "high" },
    ]);
    expect(loadRaw(CDR_PATH).conditions).toEqual([
      { field: SG, op: "eq", value: true },
      { field: OM, op: "eq", value: true },
    ]);
    for (const path of [GR8_PATH, CDR_PATH, LOW_PATH, HIGH_PATH]) {
      expect(JSON.stringify(loadRaw(path).conditions)).not.toMatch(
        /nodule_count|size|diameter|volume|morphology|lesion|stab|persist|date|all_lt_6mm|all_solid/i,
      );
    }
  });

  it("case 29: ClinicalInputState gains exactly the two Candidate-D keys over 1.9.0, appended after the safeguard", () => {
    const types = readFileSync(join(repoRoot, "src/engine/types.ts"), "utf-8").replace(/\r\n/g, "\n");
    const start = types.indexOf("export interface ClinicalInputState {");
    const inputState = types.slice(start, types.indexOf("\n}", start));
    const fieldNames = [...inputState.matchAll(/^  (\w+)\?:/gm)].map((m) => m[1]);
    expect(fieldNames).toHaveLength(23);
    expect(fieldNames.slice(-3)).toEqual([SG, OR, OM]);
    expect(OM).not.toMatch(/fleischner|s3|bts/);
  });

  it("case 30: CDR-1 is never in a Recommendation Set; no noRoutineFollowUp key; the disposition text never names Fleischner", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    expect(trace.recommendationSet).toEqual([]);
    const disposition = trace.clinicalDispositionEvaluation!.disposition!;
    expect(JSON.stringify(disposition)).not.toContain("noRoutineFollowUp\"");
    expect(`${disposition.statement} ${disposition.rationale}`).not.toMatch(/fleischner/i);
    expect(disposition).not.toHaveProperty("recommendationSourceId");
    for (const path of [LOW_PATH, HIGH_PATH]) {
      expect(loadRaw(path).recommendation).not.toHaveProperty("noRoutineFollowUp");
    }
    for (const risk of ["low", "high"] as const) {
      const payload = evaluate({ ...proceeds, [RK]: risk }, release).recommendationSet[0];
      expect(payload).not.toHaveProperty("noRoutineFollowUp");
    }
  });

  it("case 31: no governed text or UI constant says \"no dominant nodule\"; the D1/D2 help texts carry no number, %, or threshold claim", () => {
    const uiConstants = Object.values(fields)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => JSON.stringify(value));
    for (const text of [...[GR8_PATH, GR4_PATH, CDR_PATH, LOW_PATH, HIGH_PATH].map((p) => JSON.stringify(loadRaw(p))), ...uiConstants]) {
      expect(text.toLowerCase()).not.toContain("no dominant nodule");
    }
    for (const help of [fields.CLINICIAN_DISPOSITION_HELP_TEXT, fields.FLEISCHNER_MULTIPLE_SOLID_FOLLOW_UP_SAFEGUARD_HELP_TEXT]) {
      expect(help).not.toMatch(/\d|%/);
      expect(help.replace("they are not criteria or thresholds", "")).not.toMatch(/threshold/i);
      expect(help).not.toMatch(/PET|biops|resection|surg/i);
    }
  });

  it("help-text examples never affect the engine result (they exist only in UI constants, never as inputs)", () => {
    const releaseText = JSON.stringify(release);
    for (const example of ["regression", "resolution", "interval growth", "changed suspicious"]) {
      expect(JSON.stringify(boundRules.map((r) => ("conditions" in r ? r.conditions : [])))).not.toContain(example);
    }
    expect(releaseText).not.toMatch(/"field":"[^"]*(regress|resolution|growth)/);
  });
});

describe("#16 Candidate D — Release, governed JSON, SAR, versions (cases 35-37, 59)", () => {
  it("case 35: the assembled Release has exactly 27 revisions, including GR-4-r2, GR-8-r1, CDR-1-r1 and both ACRs, and no GR-4-r1", () => {
    expect(release.revisions).toHaveLength(27);
    const ids = release.revisions.map((r) => r.revisionId);
    expect(new Set(ids).size).toBe(27);
    for (const id of ["GR-4-r2", "GR-8-r1", "CDR-1-r1", `${LOW_ID}-r1`, `${HIGH_ID}-r1`]) expect(ids).toContain(id);
    expect(ids).not.toContain("GR-4-r1");
  });

  it("case 36: GR-8, GR-4-r2, CDR-1 and both ACRs have exactly the approved governed shape", () => {
    const gr8 = loadRaw(GR8_PATH);
    expect(() => ruleRevisionSchema.parse(gr8)).not.toThrow();
    expect(gr8).toMatchObject({ ruleId: "GR-8", revisionId: "GR-8-r1", kind: "pathway-gate", approvalStatus: "Approved", clinicalPathwayId: PATHWAY_ID });
    expect(gr8.approvalEvent).toEqual({ by: "stratjan", at: "2026-11-03" });
    expect(gr8.conditions).toEqual([
      { field: "assessment_context", op: "eq", value: "incidental" },
      { field: "assessment_timepoint", op: "eq", value: "follow-up" },
      { field: OR, op: "eq", value: true },
    ]);

    const gr4 = loadRaw(GR4_PATH);
    expect(() => ruleRevisionSchema.parse(gr4)).not.toThrow();
    expect(gr4).toMatchObject({ ruleId: "GR-4", revisionId: "GR-4-r2", clinicalPathwayId: "incidental-solitary-solid-follow-up" });
    expect(gr4.conditions).toEqual([
      { field: "nodule_morphology", op: "eq", value: "solid" },
      { field: "assessment_context", op: "eq", value: "incidental" },
      { field: "assessment_timepoint", op: "eq", value: "follow-up" },
      { field: "nodule_count", op: "eq", value: 1 },
      { field: OR, op: "eq", value: false },
    ]);

    const cdr = loadRaw(CDR_PATH);
    expect(() => ruleRevisionSchema.parse(cdr)).not.toThrow();
    expect(cdr).toMatchObject({ ruleId: "CDR-1", revisionId: "CDR-1-r1", kind: "clinical-disposition", clinicalPathwayId: PATHWAY_ID });
    expect(cdr.disposition).toEqual({
      dispositionKind: "clinician-directed-no-further-routine-surveillance",
      statement: STATEMENT,
      rationale: RATIONALE,
    });
    expect(cdr.provenance.sourceType).toBe("Clinically-approved specification");
    expect(Object.keys(cdr).sort()).toEqual(
      ["approvalEvent", "approvalStatus", "clinicalPathwayId", "conditions", "disposition", "kind", "provenance", "revisionId", "ruleId"].sort(),
    );

    for (const path of [LOW_PATH, HIGH_PATH]) {
      const acr = loadRaw(path);
      expect(() => ruleRevisionSchema.parse(acr)).not.toThrow();
      expect(acr).toMatchObject({ kind: "atomic-clinical-rule", recommendationSourceId: "fleischner", clinicalPathwayId: PATHWAY_ID });
      for (const key of [
        "measurementBasis",
        "diameterConditions",
        "volumeConditions",
        "measurementConventionId",
        "solidComponentMeasurementConventionId",
        "operandInapplicabilityPreconditions",
        "sufficientConditionGroups",
        "nonBlockingUnresolvedSiblings",
        "provenance",
      ]) {
        expect(acr).not.toHaveProperty(key);
      }
      const roles = acr.provenanceAnchors.map((a: { role: string }) => a.role);
      expect(roles).toEqual(["primary-management", "timing-anchor-interpretation", "risk-category", "governing-nodule-safeguard"]);
      const timingAnchor = acr.provenanceAnchors[1].provenance;
      expect(timingAnchor.sourceType).toBe("Clinically-approved specification");
      expect(timingAnchor.locator).toContain("not literally state \"from baseline CT\"");
      expect(JSON.stringify(acr.provenanceAnchors)).not.toMatch(/Local SOP|S3|BTS/);
      expect(acr.provenanceAnchors.some((a: { role: string }) => a.role === "whole-nodule-measurement")).toBe(false);
    }
  });

  it("governance references are real: no placeholder survives in any Candidate-D governed file, and each cites the spec and readiness comments", () => {
    for (const path of [GR8_PATH, GR4_PATH, CDR_PATH, LOW_PATH, HIGH_PATH]) {
      const text = readFileSync(join(repoRoot, path), "utf-8");
      expect(text).not.toMatch(/<[^>]*(id|date|comment)[^>]*>/i);
      expect(text).toContain("6411027075");
    }
    for (const path of [GR8_PATH, GR4_PATH, CDR_PATH]) {
      expect(readFileSync(join(repoRoot, path), "utf-8")).toContain("6614358295");
    }
  });

  it("the rationales state the approved low/high wording and the baseline-CT interpretation verbatim", () => {
    const low = loadRaw(LOW_PATH).recommendation.rationale;
    const high = loadRaw(HIGH_PATH).recommendation.rationale;
    expect(low).toContain("for a patient at low risk, this CT at 18-24 months may be considered");
    expect(high).toContain("for a patient at high risk, this CT at 18-24 months is recommended");
    for (const text of [low, high]) {
      expect(text).toContain(
        "Anchoring the 18-24-month interval to the baseline CT is an approved Clinical/Product interpretation of the source's surveillance sequence, not a verbatim source quotation; this application performs no date calculation.",
      );
    }
  });

  it("case 37: SAR-FLEISCHNER-r1 is reused unchanged and no S3 rule is bound to GR-8", () => {
    expect(release.revisions.filter((r) => r.ruleId === "SAR-FLEISCHNER").map((r) => r.revisionId)).toEqual([
      "SAR-FLEISCHNER-r1",
    ]);
    const gr8Acrs = release.revisions.filter(
      (r) => r.kind === "atomic-clinical-rule" && r.clinicalPathwayId === PATHWAY_ID,
    );
    expect(gr8Acrs.map((r) => (r.kind === "atomic-clinical-rule" ? r.recommendationSourceId : ""))).toEqual([
      "fleischner",
      "fleischner",
    ]);
  });

  it("case 59: ENGINE_VERSION, SCHEMA_VERSION and trace versions are 1.10.0", () => {
    expect(ENGINE_VERSION).toBe("1.10.0");
    expect(SCHEMA_VERSION).toBe("1.10.0");
    const trace = evaluate(D, release);
    expect(trace.engineVersion).toBe("1.10.0");
    expect(trace.schemaVersion).toBe("1.10.0");
  });
});
