// issue #16 Candidate A (final spec comment 5858670823 §13; implementation-readiness sign-off
// comment 5858952610): acceptance matrix for GR-5 / incidental-multiple-subsolid-initial and the
// governed rule ACR-FLEISCHNER-MULTIPLE-SUBSOLID-INITIAL-r1 -- a set-level, Fleischner-only
// initial CT follow-up at 3-6 months for multiple discrete/circumscribed subsolid nodules. Cases
// 1-23 and 32-33 live here; workflow cases 24-28 in test/workflow/pathwayNavigation.test.ts;
// release/historical cases 29-31 in release-assembly.test.ts and historicalReleases.test.ts.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousPathwayMatchError } from "../../src/engine/evaluate";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState } from "../../src/engine/types";
import { loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const release = loadTestRelease();

const RULE_ID = "ACR-FLEISCHNER-MULTIPLE-SUBSOLID-INITIAL";
const RULE_PATH = "clinical/rules/recommendations/fleischner-multiple-subsolid-initial.json";
const GATE_PATH = "clinical/rules/pathway/gr-5-incidental-multiple-subsolid-initial.json";

function loadRaw(relativePath: string): any {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
}

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

function gateStates(trace: ReturnType<typeof evaluate>) {
  return Object.fromEntries(trace.clinicalPathwayGates.map((g) => [g.ruleId, g.state]));
}

const base: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: true,
  multiple_nodules_discrete_circumscribed: true,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

const without = <K extends keyof ClinicalInputState>(input: ClinicalInputState, key: K): ClinicalInputState => {
  const copy = { ...input };
  delete copy[key];
  return copy;
};

describe("GR-5 pathway selection (cases 1-10)", () => {
  it("case 1: base with nodule_count 2 -> MATCHED incidental-multiple-subsolid-initial; GR-1..GR-4 NOT_MATCHED", () => {
    const trace = evaluate({ ...base, nodule_count: 2 }, release);
    expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: "incidental-multiple-subsolid-initial" });
    expect(gateStates(trace)).toEqual({
      "GR-1": "NOT_MATCHED",
      "GR-2": "NOT_MATCHED",
      "GR-3": "NOT_MATCHED",
      "GR-4": "NOT_MATCHED",
      "GR-5": "MATCHED",
      "GR-6": "NOT_MATCHED",
    });
  });

  it("case 2: base (nodule_count 3) -> same as case 1", () => {
    const trace = evaluate(base, release);
    expect(trace.pathwaySelection).toEqual({ state: "MATCHED", clinicalPathwayId: "incidental-multiple-subsolid-initial" });
    expect(gateStates(trace)).toEqual({
      "GR-1": "NOT_MATCHED",
      "GR-2": "NOT_MATCHED",
      "GR-3": "NOT_MATCHED",
      "GR-4": "NOT_MATCHED",
      "GR-5": "MATCHED",
      "GR-6": "NOT_MATCHED",
    });
  });

  it("case 3: F2 false alone -> INSUFFICIENT_INPUT because the new all-solid branch remains possible; an explicitly mixed set remains NO_PATHWAY_MATCHED", () => {
    const pending = evaluate({ ...base, multiple_nodules_all_subsolid: false }, release);
    expect(pending.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    expect(pending.clinicalPathwayGates.find((g) => g.ruleId === "GR-5")?.state).toBe("NOT_MATCHED");
    expect(pending.clinicalPathwayGates.find((g) => g.ruleId === "GR-6")?.state).toBe("INDETERMINATE");

    const mixed = evaluate(
      { ...base, multiple_nodules_all_subsolid: false, multiple_nodules_all_solid: false },
      release,
    );
    expect(mixed.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
    expect(mixed.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("case 4: F3 false (disseminated presentation) -> NO_PATHWAY_MATCHED", () => {
    const trace = evaluate({ ...base, multiple_nodules_discrete_circumscribed: false }, release);
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("case 5: F2 absent -> pathway INSUFFICIENT_INPUT (GR-5 INDETERMINATE, missing F2)", () => {
    const trace = evaluate(without(base, "multiple_nodules_all_subsolid"), release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    const gr5 = trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-5");
    expect(gr5?.state).toBe("INDETERMINATE");
    expect(gr5?.missingFields).toEqual(["multiple_nodules_all_subsolid"]);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("case 6: F3 absent -> pathway INSUFFICIENT_INPUT (GR-5 INDETERMINATE, missing F3)", () => {
    const trace = evaluate(without(base, "multiple_nodules_discrete_circumscribed"), release);
    expect(trace.pathwaySelection).toEqual({ state: "INSUFFICIENT_INPUT" });
    const gr5 = trace.clinicalPathwayGates.find((g) => g.ruleId === "GR-5");
    expect(gr5?.state).toBe("INDETERMINATE");
    expect(gr5?.missingFields).toEqual(["multiple_nodules_discrete_circumscribed"]);
  });

  describe("case 7: nodule_count 1 cases are unchanged; stray F2/F3/F4 on a solitary input are ignored", () => {
    const stray = {
      multiple_nodules_all_subsolid: true,
      multiple_nodules_discrete_circumscribed: true,
      fleischner_multiple_subsolid_any_gte_6mm: true,
    };
    const solitaryCases: { name: string; input: ClinicalInputState }[] = [
      {
        name: "GR-1 solid 7mm",
        input: {
          nodule_morphology: "solid",
          assessment_context: "incidental",
          assessment_timepoint: "initial",
          nodule_count: 1,
          age: 55,
          known_malignancy_history: false,
          immunocompromised: false,
          nodule_size_mm: 7,
          nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
        },
      },
      {
        name: "GR-2 pure-GGN 7mm",
        input: {
          nodule_morphology: "pure-ground-glass",
          assessment_context: "incidental",
          assessment_timepoint: "initial",
          nodule_count: 1,
          age: 55,
          known_malignancy_history: false,
          immunocompromised: false,
          nodule_size_mm: 7,
          nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
        },
      },
      {
        name: "GR-3 part-solid 5mm",
        input: {
          nodule_morphology: "part-solid",
          assessment_context: "incidental",
          assessment_timepoint: "initial",
          nodule_count: 1,
          age: 55,
          known_malignancy_history: false,
          immunocompromised: false,
          nodule_size_mm: 5,
          nodule_diameter_measurements: [{ valueMm: 5, conventionId: "fleischner-2017-average-diameter" }],
        },
      },
      {
        name: "GR-4 volume stability",
        input: {
          nodule_morphology: "solid",
          assessment_context: "incidental",
          assessment_timepoint: "follow-up",
          nodule_count: 1,
          age: 55,
          known_malignancy_history: false,
          immunocompromised: false,
          s3_volume_stability_criterion_met: true,
        },
      },
    ];
    for (const { name, input } of solitaryCases) {
      it(name, () => {
        const clean = evaluate(input, release);
        const withStray = evaluate({ ...input, ...stray }, release);
        expect(withStray.pathwaySelection).toEqual(clean.pathwaySelection);
        expect(withStray.sourceEvaluationOutcomes).toEqual(clean.sourceEvaluationOutcomes);
        expect(withStray.recommendationSet).toEqual(clean.recommendationSet);
        expect(clean.clinicalPathwayGates.find((g) => g.ruleId === "GR-5")?.state).toBe("NOT_MATCHED");
        expect(
          withStray.recommendationSet.some((r) => r.matchedRuleId === RULE_ID),
        ).toBe(false);
      });
    }
  });

  it("case 8: base with follow-up timepoint -> NO_PATHWAY_MATCHED", () => {
    const trace = evaluate({ ...base, assessment_timepoint: "follow-up" }, release);
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
  });

  it("case 9: base with screening context -> NO_PATHWAY_MATCHED", () => {
    const trace = evaluate({ ...base, assessment_context: "screening" }, release);
    expect(trace.pathwaySelection).toEqual({ state: "NO_PATHWAY_MATCHED" });
  });

  it("case 10: exhaustive count {1,2,3} x timepoint x F2/F3 {true,false,absent} x morphology {absent, each value} never throws AmbiguousPathwayMatchError", () => {
    const counts = [1, 2, 3];
    const timepoints = ["initial", "follow-up", undefined];
    const tri = [true, false, undefined];
    const morphologies = [undefined, "solid", "pure-ground-glass", "part-solid"];
    let combinations = 0;
    for (const nodule_count of counts)
      for (const assessment_timepoint of timepoints)
        for (const f2 of tri)
          for (const f3 of tri)
            for (const nodule_morphology of morphologies) {
              const input: ClinicalInputState = {
                assessment_context: "incidental",
                nodule_count,
                ...(assessment_timepoint !== undefined ? { assessment_timepoint } : {}),
                ...(f2 !== undefined ? { multiple_nodules_all_subsolid: f2 } : {}),
                ...(f3 !== undefined ? { multiple_nodules_discrete_circumscribed: f3 } : {}),
                ...(nodule_morphology !== undefined ? { nodule_morphology } : {}),
              };
              let matched = 0;
              expect(() => {
                const trace = evaluate(input, release);
                matched = trace.clinicalPathwayGates.filter((g) => g.state === "MATCHED").length;
              }).not.toThrow(AmbiguousPathwayMatchError);
              expect(matched).toBeLessThanOrEqual(1);
              combinations++;
            }
    expect(combinations).toBe(3 * 3 * 3 * 3 * 4);
  });
});

describe("ACR-FLEISCHNER-MULTIPLE-SUBSOLID-INITIAL evaluation (cases 11-16)", () => {
  it("case 11: F4 false -> Fleischner RECOMMENDATION via group all-subsolid-lt-6mm, one action CT follow-up at 3-6 months", () => {
    const trace = evaluate({ ...base, fleischner_multiple_subsolid_any_gte_6mm: false }, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    const rec = fleischner?.recommendation as any;
    expect(rec.matchedRuleId).toBe(RULE_ID);
    expect(rec.matchedRevisionId).toBe(`${RULE_ID}-r1`);
    expect(rec.matchedSufficientConditionGroupIds).toEqual(["all-subsolid-lt-6mm"]);
    expect(rec.actions).toEqual([{ label: "CT follow-up", timing: { kind: "specified", intervals: ["3-6 months"] } }]);
    expect(trace.recommendationSet).toHaveLength(1);
  });

  it("case 12: F4 true -> Fleischner RECOMMENDATION via group any-subsolid-gte-6mm, identical single action", () => {
    const trace = evaluate({ ...base, fleischner_multiple_subsolid_any_gte_6mm: true }, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    const rec = fleischner?.recommendation as any;
    expect(rec.matchedRuleId).toBe(RULE_ID);
    expect(rec.matchedSufficientConditionGroupIds).toEqual(["any-subsolid-gte-6mm"]);
    expect(rec.actions).toEqual([{ label: "CT follow-up", timing: { kind: "specified", intervals: ["3-6 months"] } }]);
  });

  it("case 13: F4 absent -> Fleischner INSUFFICIENT_INPUT naming the missing field; empty Recommendation Set", () => {
    const trace = evaluate(base, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("fleischner_multiple_subsolid_any_gte_6mm");
    expect(fleischner?.recommendation).toBeUndefined();
    expect(trace.recommendationSet).toEqual([]);
  });

  it.each([
    ["age 30", { age: 30 }],
    ["known malignancy history", { known_malignancy_history: true }],
    ["immunocompromised", { immunocompromised: true }],
  ])("case 14: F4 true with %s -> Fleischner NOT_APPLICABLE (SAR-FLEISCHNER-r1 reused unchanged)", (_, override) => {
    const trace = evaluate({ ...base, fleischner_multiple_subsolid_any_gte_6mm: true, ...override }, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("NOT_APPLICABLE");
    expect(trace.recommendationSet).toEqual([]);
  });

  it.each([true, false, undefined])("cases 15/16: F4 %s -> exactly one Source Evaluation Outcome (Fleischner); no S3 and no BTS outcome", (f4) => {
    const input = f4 === undefined ? base : { ...base, fleischner_multiple_subsolid_any_gte_6mm: f4 };
    const trace = evaluate(input, release);
    expect(trace.sourceEvaluationOutcomes.map((o) => o.recommendationSourceId)).toEqual(["fleischner"]);
    expect(outcomeFor(trace, "s3")).toBeUndefined();
    expect(outcomeFor(trace, "bts")).toBeUndefined();
  });

  it("the Release binds only the Fleischner ACR to the new pathway -- no S3 or BTS rule", () => {
    const bound = release.revisions.filter(
      (r) => r.kind === "atomic-clinical-rule" && r.clinicalPathwayId === "incidental-multiple-subsolid-initial",
    );
    expect(bound.map((r) => r.ruleId)).toEqual([RULE_ID]);
  });
});

describe("negative recommendation content (cases 17-23): payload and governed JSON", () => {
  const governed = loadRaw(RULE_PATH);
  const payloads = [true, false].map(
    (f4) => outcomeFor(evaluate({ ...base, fleischner_multiple_subsolid_any_gte_6mm: f4 }, release), "fleischner")!
      .recommendation as any,
  );
  const subjects: [string, any][] = [
    ["governed JSON recommendation", governed.recommendation],
    ["payload (F4 true)", payloads[0]],
    ["payload (F4 false)", payloads[1]],
  ];

  for (const [name, subject] of subjects) {
    describe(name, () => {
      const labels: string[] = subject.actions.map((a: any) => a.label);
      const intervals: string[] = subject.actions.flatMap((a: any) => a.timing.intervals ?? []);

      it("contains exactly one action, and no interval other than 3-6 months", () => {
        expect(subject.actions).toHaveLength(1);
        expect(intervals).toEqual(["3-6 months"]);
      });

      it("case 17: no 2-year CT", () => {
        expect([...labels, ...intervals].join(" | ")).not.toMatch(/2[ -]?years?/i);
      });

      it("case 18: no 4-year CT", () => {
        expect([...labels, ...intervals].join(" | ")).not.toMatch(/4[ -]?years?/i);
      });

      it("case 19: no persistence/stability step (no persistenceConfirmation/ifPersistent keys, no noRoutineFollowUp, no persistence/stability action)", () => {
        expect(subject).not.toHaveProperty("persistenceConfirmation");
        expect(subject).not.toHaveProperty("ifPersistent");
        expect(subject).not.toHaveProperty("noRoutineFollowUp");
        expect(labels.join(" | ")).not.toMatch(/persist|stabil|surveillance/i);
      });

      it("case 20: no most-suspicious-nodule reference as an action", () => {
        expect(labels.join(" | ")).not.toMatch(/suspicious|dominant|index|largest/i);
      });

      it("case 21: no PET/CT", () => {
        expect(labels.join(" | ")).not.toMatch(/PET/i);
      });

      it("case 22: no biopsy", () => {
        expect(labels.join(" | ")).not.toMatch(/biops/i);
      });

      it("case 23: no resection/surgery", () => {
        expect(labels.join(" | ")).not.toMatch(/resection|surgery|surgical/i);
      });
    });
  }

  it("the rationale is the exact approved text (spec §5)", () => {
    expect(governed.recommendation.rationale).toBe(
      "Fleischner (2017) Recommendation 5 and Table B recommend, for multiple subsolid pulmonary nodules found incidentally, an initial CT follow-up at 3-6 months — both when all subsolid nodules are smaller than 6 mm and when at least one subsolid nodule is 6 mm or larger — in a patient >=35 years old with no known malignancy history and not immunocompromised. This rule applies only to multiple discrete/circumscribed nodules whose set is subsolid-only (pure ground-glass and/or part-solid, no fully solid nodule), at initial assessment. The size state is a clinician-attested set-level fact; no index, largest, dominant, or most-suspicious nodule is selected by this application. For multiple subsolid nodules all smaller than 6 mm, the source's narrative discusses early follow-up in the context of possible infectious/nonneoplastic causes and diagnostic uncertainty; Table B together with Recommendation 5 was accepted as sufficient support for this initial CT recommendation (Clinical/Product HITL, issue #16). This recommendation covers only the first follow-up CT: later CT at 2 and 4 years, persistence/stability assessment, management based on the most suspicious nodule, and any PET/CT, biopsy, or surgical implication are outside this Rule-Set Release and must not be inferred from it.",
    );
  });
});

describe("governed JSON shape (case 32)", () => {
  it("the ACR parses and has exactly the approved identity, binding, two groups, and three uniquely-roled Fleischner/Local-SOP anchors", () => {
    const raw = loadRaw(RULE_PATH);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
    expect(raw.ruleId).toBe(RULE_ID);
    expect(raw.revisionId).toBe(`${RULE_ID}-r1`);
    expect(raw.recommendationSourceId).toBe("fleischner");
    expect(raw.clinicalPathwayId).toBe("incidental-multiple-subsolid-initial");
    expect(raw.approvalStatus).toBe("Approved");
    expect(raw.sufficientConditionGroups).toEqual([
      {
        groupId: "all-subsolid-lt-6mm",
        conditions: [{ field: "fleischner_multiple_subsolid_any_gte_6mm", op: "eq", value: false }],
        provenanceRole: "criterion-all-subsolid-lt-6mm",
      },
      {
        groupId: "any-subsolid-gte-6mm",
        conditions: [{ field: "fleischner_multiple_subsolid_any_gte_6mm", op: "eq", value: true }],
        provenanceRole: "criterion-any-subsolid-gte-6mm",
      },
    ]);
    const roles = raw.provenanceAnchors.map((a: any) => a.role);
    expect(roles).toEqual(["criterion-all-subsolid-lt-6mm", "criterion-any-subsolid-gte-6mm", "local-management"]);
    expect(new Set(roles).size).toBe(roles.length);
    // No S3 or BTS attribution anywhere in the provenance.
    expect(JSON.stringify(raw.provenanceAnchors)).not.toMatch(/S3-Leitlinie|British Thoracic|\bBTS\b guideline/);
    // Exactly one evaluation shape; no measurement fields, no sibling relations.
    for (const key of [
      "conditions",
      "measurementBasis",
      "diameterConditions",
      "volumeConditions",
      "measurementConventionId",
      "solidComponentMeasurementConventionId",
      "operandInapplicabilityPreconditions",
      "nonBlockingUnresolvedSiblings",
      "provenance",
    ]) {
      expect(raw).not.toHaveProperty(key);
    }
  });

  it("GR-5-r1 parses with exactly the approved five AND-conditions in order", () => {
    const raw = loadRaw(GATE_PATH);
    expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
    expect(raw.ruleId).toBe("GR-5");
    expect(raw.revisionId).toBe("GR-5-r1");
    expect(raw.clinicalPathwayId).toBe("incidental-multiple-subsolid-initial");
    expect(raw.conditions).toEqual([
      { field: "assessment_context", op: "eq", value: "incidental" },
      { field: "assessment_timepoint", op: "eq", value: "initial" },
      { field: "nodule_count", op: "gte", value: 2 },
      { field: "multiple_nodules_all_subsolid", op: "eq", value: true },
      { field: "multiple_nodules_discrete_circumscribed", op: "eq", value: true },
    ]);
  });

  it("SAR-FLEISCHNER is not extended with any Candidate-A field", () => {
    const sar = loadRaw("clinical/rules/applicability/fleischner-applicability.json");
    expect(sar.revisionId).toBe("SAR-FLEISCHNER-r1");
    expect(JSON.stringify(sar.conditions)).not.toMatch(/multiple_nodules|fleischner_multiple_subsolid/);
  });
});

describe("versions (case 33)", () => {
  it("a Candidate-A trace reports engineVersion and schemaVersion 1.7.0", () => {
    const trace = evaluate({ ...base, fleischner_multiple_subsolid_any_gte_6mm: true }, release);
    expect(trace.engineVersion).toBe("1.8.0");
    expect(trace.schemaVersion).toBe("1.8.0");
  });
});
