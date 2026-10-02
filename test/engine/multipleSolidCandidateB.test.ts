import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, ENGINE_VERSION, SCHEMA_VERSION } from "../../src/engine/evaluate";
import {
  isConsiderActionRecommendation,
  isNoRoutineFollowUpRecommendation,
  type ClinicalInputState,
} from "../../src/engine/types";
import { loadTestRelease } from "../helpers/loadTestRelease";

const release = loadTestRelease();
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const loadRaw = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), "utf-8"));
const base: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: false,
  multiple_nodules_all_solid: true,
  multiple_nodules_discrete_circumscribed: true,
  fleischner_multiple_solid_all_lt_6mm: true,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

function fleischner(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner");
}

describe("#16 Candidate B — multiple solid nodules, all <6 mm", () => {
  it("GR-6 matches counts >=2 and existing gates do not co-match", () => {
    for (const nodule_count of [2, 3, 7]) {
      const trace = evaluate({ ...base, nodule_count }, release);
      expect(trace.pathwaySelection).toEqual({
        state: "MATCHED",
        clinicalPathwayId: "incidental-multiple-solid-lt-6mm-initial",
      });
      expect(trace.clinicalPathwayGates.filter((g) => g.state === "MATCHED").map((g) => g.ruleId)).toEqual(["GR-6"]);
    }
  });

  it("all_subsolid=false alone is INSUFFICIENT_INPUT because Candidate B remains possible", () => {
    const trace = evaluate({
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 3,
      multiple_nodules_all_subsolid: false,
      multiple_nodules_discrete_circumscribed: true,
    }, release);
    expect(trace.pathwaySelection.state).toBe("INSUFFICIENT_INPUT");
    expect(trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-6")?.state).toBe("INDETERMINATE");
  });

  it("mixed, disseminated, >=6, screening and follow-up states fail closed", () => {
    for (const override of [
      { multiple_nodules_all_solid: false },
      { multiple_nodules_discrete_circumscribed: false },
      { fleischner_multiple_solid_all_lt_6mm: false },
      { assessment_context: "screening" },
      { assessment_timepoint: "follow-up" },
    ]) {
      expect(evaluate({ ...base, ...override }, release).pathwaySelection.state).toBe("NO_PATHWAY_MATCHED");
    }
  });

  it("case 5: >=6 mm with a supplied high risk -> zero Source Evaluation Outcomes (risk never consulted)", () => {
    const trace = evaluate(
      { ...base, fleischner_multiple_solid_all_lt_6mm: false, fleischner_multiple_solid_risk_category: "high" },
      release,
    );
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
    expect(trace.recommendationSet).toEqual([]);
  });

  it("case 3b: contradictory stale input (all_subsolid and all_solid both true) -> GR-5 alone governs; GR-6 NOT_MATCHED", () => {
    const trace = evaluate({
      ...base,
      multiple_nodules_all_subsolid: true,
      fleischner_multiple_subsolid_any_gte_6mm: true,
      fleischner_multiple_solid_risk_category: "high",
    }, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-multiple-subsolid-initial",
    });
    expect(trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-6")?.state).toBe("NOT_MATCHED");
    expect(trace.recommendationSet.map((r) => r.matchedRuleId)).toEqual(["ACR-FLEISCHNER-MULTIPLE-SUBSOLID-INITIAL"]);
  });

  it("each required GR-6 fact absent is INSUFFICIENT_INPUT unless another supplied fact already contradicts", () => {
    for (const field of [
      "multiple_nodules_all_subsolid",
      "multiple_nodules_all_solid",
      "multiple_nodules_discrete_circumscribed",
      "fleischner_multiple_solid_all_lt_6mm",
    ] as const) {
      const input: ClinicalInputState = { ...base };
      delete input[field];
      const trace = evaluate(input, release);
      expect(trace.pathwaySelection.state).toBe("INSUFFICIENT_INPUT");
      const gate = trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-6");
      expect(gate?.state).toBe("INDETERMINATE");
      expect(gate?.missingFields).toEqual([field]);
    }

    const contradicted: ClinicalInputState = { ...base };
    delete contradicted.multiple_nodules_all_solid;
    contradicted.fleischner_multiple_solid_all_lt_6mm = false;
    expect(evaluate(contradicted, release).pathwaySelection.state).toBe("NO_PATHWAY_MATCHED");
  });

  it("exhaustive GR-1..GR-6 sweep never produces more than one matched pathway", () => {
    const tri = [true, false, undefined] as const;
    const counts = [1, 2, 3];
    const timepoints = ["initial", "follow-up", undefined] as const;
    const morphologies = [undefined, "solid"] as const;
    let combinations = 0;
    for (const nodule_count of counts)
      for (const assessment_timepoint of timepoints)
        for (const allSubsolid of tri)
          for (const allSolid of tri)
            for (const discrete of tri)
              for (const allLt6 of tri)
                for (const nodule_morphology of morphologies) {
                  const input: ClinicalInputState = {
                    assessment_context: "incidental",
                    nodule_count,
                    ...(assessment_timepoint === undefined ? {} : { assessment_timepoint }),
                    ...(allSubsolid === undefined ? {} : { multiple_nodules_all_subsolid: allSubsolid }),
                    ...(allSolid === undefined ? {} : { multiple_nodules_all_solid: allSolid }),
                    ...(discrete === undefined ? {} : { multiple_nodules_discrete_circumscribed: discrete }),
                    ...(allLt6 === undefined ? {} : { fleischner_multiple_solid_all_lt_6mm: allLt6 }),
                    ...(nodule_morphology === undefined ? {} : { nodule_morphology }),
                  };
                  const trace = evaluate(input, release);
                  expect(
                    trace.clinicalPathwayGates.filter((g) => g.state === "MATCHED").length,
                  ).toBeLessThanOrEqual(1);
                  combinations++;
                }
    expect(combinations).toBe(1458);
  });

  it("risk absent -> Fleischner INSUFFICIENT_INPUT", () => {
    const trace = evaluate(base, release);
    expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner(trace)?.reason).toContain("fleischner_multiple_solid_risk_category");
    expect(trace.recommendationSet).toEqual([]);
  });

  it("low risk -> exactly no routine follow-up", () => {
    const trace = evaluate({ ...base, fleischner_multiple_solid_risk_category: "low" }, release);
    const rec = fleischner(trace)?.recommendation!;
    expect(fleischner(trace)?.state).toBe("RECOMMENDATION");
    expect(rec.matchedRuleId).toBe("ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-LOW-RISK");
    expect(isNoRoutineFollowUpRecommendation(rec)).toBe(true);
    expect(rec.clinicalCriterionUsed).toBe("clinician-attestation");
    expect(fleischner(trace)).not.toHaveProperty("toleratedUnresolvedSiblings");
    for (const key of ["considerAction", "actions", "clinicalEndpoint", "intervals", "persistenceConfirmation", "ifPersistent"]) {
      expect(rec).not.toHaveProperty(key);
    }
  });

  it("high risk -> exactly one optional CT at 12 months", () => {
    const trace = evaluate({ ...base, fleischner_multiple_solid_risk_category: "high" }, release);
    const rec = fleischner(trace)?.recommendation!;
    expect(fleischner(trace)?.state).toBe("RECOMMENDATION");
    expect(rec.matchedRuleId).toBe("ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-HIGH-RISK");
    expect(isConsiderActionRecommendation(rec)).toBe(true);
    if (!isConsiderActionRecommendation(rec)) throw new Error("expected consider-action form");
    expect(rec.considerAction).toEqual({
      label: "CT",
      timing: { kind: "specified", intervals: ["12 months"] },
    });
    expect(rec.clinicalCriterionUsed).toBe("clinician-attestation");
    expect(fleischner(trace)).not.toHaveProperty("toleratedUnresolvedSiblings");
    for (const key of ["actions", "noRoutineFollowUp", "clinicalEndpoint", "intervals", "persistenceConfirmation", "ifPersistent"]) {
      expect(rec).not.toHaveProperty(key);
    }
  });

  it("case 15: the public input contract rejects a non-member risk category at type level", () => {
    // @ts-expect-error -- FleischnerRiskCategory is closed to "low" | "high".
    const invalid: ClinicalInputState = { fleischner_multiple_solid_risk_category: "medium" };
    expect(invalid.fleischner_multiple_solid_risk_category).toBe("medium");
  });

  it("a forcibly injected invalid risk category never recommends", () => {
    const trace = evaluate(
      { ...base, fleischner_multiple_solid_risk_category: "medium" as any },
      release,
    );
    expect(fleischner(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(trace.recommendationSet).toEqual([]);
  });

  it("SAR failure remains NOT_APPLICABLE; S3/BTS have no outcomes on GR-6", () => {
    const trace = evaluate({ ...base, fleischner_multiple_solid_risk_category: "high" }, release);
    expect(trace.sourceEvaluationOutcomes.map((o) => o.recommendationSourceId)).toEqual(["fleischner"]);
    for (const override of [{ age: 30 }, { known_malignancy_history: true }, { immunocompromised: true }]) {
      expect(fleischner(evaluate({
        ...base,
        fleischner_multiple_solid_risk_category: "high",
        ...override,
      }, release))?.state).toBe("NOT_APPLICABLE");
    }
  });

  it("no executable >=6 / 3-6m / 18-24m / PET / biopsy / surgery branch is added", () => {
    const bound = release.revisions.filter(
      (r) => r.kind === "atomic-clinical-rule" &&
        r.clinicalPathwayId === "incidental-multiple-solid-lt-6mm-initial",
    );
    expect(bound.map((r) => r.ruleId).sort()).toEqual([
      "ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-HIGH-RISK",
      "ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-LOW-RISK",
    ]);
    // Negative assertions inspect executable recommendation keys only. The governed rationale
    // intentionally names excluded downstream options, so it is not part of this assertion.
    const executable = JSON.stringify(
      bound.map((r: any) => ({
        noRoutineFollowUp: r.recommendation.noRoutineFollowUp,
        considerAction: r.recommendation.considerAction,
        actions: r.recommendation.actions,
        clinicalEndpoint: r.recommendation.clinicalEndpoint,
        intervals: r.recommendation.intervals,
      })),
    );
    expect(executable).not.toMatch(/3-6 months|18-24 months|PET|biops|resection|surgery|surgical/i);
  });

  it("age within Fleischner applicability never substitutes for the clinician risk attestation", () => {
    for (const age of [40, 60, 80]) {
      const trace = evaluate({ ...base, age }, release);
      expect(fleischner(trace)?.state).toBe("INSUFFICIENT_INPUT");
      expect(trace.recommendationSet).toEqual([]);
    }
  });

  it("case 26: low/high outcomes are identical across ages -- only the attested category drives matching", () => {
    for (const risk of ["low", "high"] as const) {
      const [young, old] = [40, 80].map((age) =>
        fleischner(evaluate({ ...base, age, fleischner_multiple_solid_risk_category: risk }, release)),
      );
      expect(young?.state).toBe("RECOMMENDATION");
      expect(old).toEqual(young);
    }
  });

  it("case 26: ClinicalInputState gains no smoking, margin, location, or score field", () => {
    const types = readFileSync(join(repoRoot, "src/engine/types.ts"), "utf-8");
    const start = types.indexOf("export interface ClinicalInputState {");
    const inputState = types.slice(start, types.indexOf("\n}", start));
    const fieldNames = [...inputState.matchAll(/^  (\w+)\?:/gm)].map((m) => m[1]);
    expect(fieldNames).toContain("fleischner_multiple_solid_risk_category");
    expect(fieldNames.filter((name) => /smok|margin|spicul|lobe|location|score|weight|pack_year/i.test(name))).toEqual([]);
  });

  it("governed GR-6 and both ACRs have the exact approved identities, conditions, anchors, and rationales", () => {
    const gate = loadRaw("clinical/rules/pathway/gr-6-incidental-multiple-solid-lt-6mm-initial.json");
    expect(gate.ruleId).toBe("GR-6");
    expect(gate.revisionId).toBe("GR-6-r1");
    expect(gate.conditions).toEqual([
      { field: "assessment_context", op: "eq", value: "incidental" },
      { field: "assessment_timepoint", op: "eq", value: "initial" },
      { field: "nodule_count", op: "gte", value: 2 },
      { field: "multiple_nodules_all_subsolid", op: "eq", value: false },
      { field: "multiple_nodules_all_solid", op: "eq", value: true },
      { field: "multiple_nodules_discrete_circumscribed", op: "eq", value: true },
      { field: "fleischner_multiple_solid_all_lt_6mm", op: "eq", value: true },
    ]);

    const low = loadRaw("clinical/rules/recommendations/fleischner-multiple-solid-lt6mm-low-risk.json");
    const high = loadRaw("clinical/rules/recommendations/fleischner-multiple-solid-lt6mm-high-risk.json");
    expect(low.conditions).toEqual([
      { field: "fleischner_multiple_solid_risk_category", op: "eq", value: "low" },
    ]);
    expect(high.conditions).toEqual([
      { field: "fleischner_multiple_solid_risk_category", op: "eq", value: "high" },
    ]);
    for (const rule of [low, high]) {
      expect(rule.provenanceAnchors.map((a: any) => a.role)).toEqual([
        "primary-management",
        "risk-category",
        "whole-nodule-measurement",
      ]);
      expect(JSON.stringify(rule.provenanceAnchors)).not.toMatch(/Local SOP|\bS3\b|\bBTS\b/);
      for (const key of [
        "measurementBasis",
        "diameterConditions",
        "volumeConditions",
        "sufficientConditionGroups",
        "operandInapplicabilityPreconditions",
        "nonBlockingUnresolvedSiblings",
      ]) expect(rule).not.toHaveProperty(key);
    }

    expect(low.recommendation.rationale).toBe(
      "Fleischner (2017) Recommendation 2 and Table 1A recommend no routine follow-up for multiple solid noncalcified pulmonary nodules found incidentally that are all smaller than 6 mm, in a patient at low risk — in a patient >=35 years old with no known malignancy history and not immunocompromised. This rule applies only to multiple discrete/circumscribed nodules whose set is solid-only, at initial assessment, with all nodules smaller than 6 mm by the Fleischner whole-nodule average-diameter convention. The low-risk category is the clinician's explicit Fleischner risk decision (Fleischner low risk: estimated cancer risk below 5%); this application does not calculate, score, weight, or infer it from age, smoking exposure, nodule size or margins, location, or any other input. No index, largest, dominant, or most-suspicious nodule is selected by this application. Multiple solid nodules with any nodule 6 mm or larger, CT follow-up at 3-6 or 18-24 months, PET/CT, biopsy, and resection are outside this Rule-Set Release and must not be inferred from this recommendation."
    );
    expect(high.recommendation.rationale).toBe(
      "Fleischner (2017) Recommendation 2 and Table 1A state that, for multiple solid noncalcified pulmonary nodules found incidentally that are all smaller than 6 mm, CT at 12 months may be considered in a patient at high risk — in a patient >=35 years old with no known malignancy history and not immunocompromised. The source presents this CT as optional, not as a mandatory follow-up; whether to perform it remains the clinician's decision. This rule applies only to multiple discrete/circumscribed nodules whose set is solid-only, at initial assessment, with all nodules smaller than 6 mm by the Fleischner whole-nodule average-diameter convention. The high-risk category is the clinician's explicit Fleischner risk decision (Fleischner high risk: the combined intermediate- and high-risk categories, estimated cancer risk 5% or more); this application does not calculate, score, weight, or infer it from age, smoking exposure, nodule size or margins, location, or any other input. No index, largest, dominant, or most-suspicious nodule is selected by this application. Multiple solid nodules with any nodule 6 mm or larger, CT follow-up at 3-6 or 18-24 months, PET/CT, biopsy, and resection are outside this Rule-Set Release and must not be inferred from this recommendation."
    );
  });

  it("SAR-FLEISCHNER-r1 remains unchanged in shape and references no Candidate-B field", () => {
    const sar = loadRaw("clinical/rules/applicability/fleischner-applicability.json");
    expect(sar.ruleId).toBe("SAR-FLEISCHNER");
    expect(sar.revisionId).toBe("SAR-FLEISCHNER-r1");
    expect(JSON.stringify(sar.conditions)).not.toMatch(/multiple_nodules_all_solid|fleischner_multiple_solid/);
  });

  it("uses versions 1.8.0 and assembles exactly 21 revisions", () => {
    expect(ENGINE_VERSION).toBe("1.8.0");
    expect(SCHEMA_VERSION).toBe("1.8.0");
    expect(release.revisions).toHaveLength(21);
  });
});
