// issue #16 Candidate A (final spec comment 5858670823 §12, acceptance cases 30-31): every
// immutable historical Rule-Set Release artifact still parses under the current (1.10.0) schema, its releaseId
// still recomputes from its own content, and none of them contains Candidate-A content; and the
// pre-Candidate-A Release (rel-738021fc80b35115, Candidate C) evaluates representative solitary
// inputs identically to the new Release. Only reads the artifacts -- never rebuilds or rewrites
// them.
// issue #16 Candidate C (final spec 6264850117 §11 cases 35-37): rel-1d516b878ab19653 (Candidate
// B) is now historical too; no historical artifact contains GR-7 / Candidate-C content, and the
// Candidate-B Release evaluates solitary, Candidate-A and Candidate-B inputs identically to the
// new Release.
// issue #16 Candidate D (final spec 6411027075/6411027421 §12, cases 54-56): rel-9fc9fb43257d89fb
// (Candidate C) is now historical too; no historical artifact contains Candidate-D content, and the
// Candidate-C Release evaluates solitary, #15 follow-up (with the origin answered false), and
// Candidate A/B/C inputs with the same clinical semantics as the new Release. Both sides run on the
// current engine, so additive unresolvedRequiredInputs metadata appears identically on both.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { computeReleaseId } from "../../src/engine/releaseBuilder";
import { activeRuleSetPointerSchema, ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleSetRelease } from "../../src/engine/types";
import { loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const releasesDir = join(repoRoot, "clinical/rule-sets/releases");

const PRE_CANDIDATE_A_RELEASE_ID = "rel-738021fc80b35115";
const PRE_CANDIDATE_B_RELEASE_ID = "rel-254d3d698cda65c1";
const PRE_CANDIDATE_C_RELEASE_ID = "rel-1d516b878ab19653";
const PRE_CANDIDATE_D_RELEASE_ID = "rel-9fc9fb43257d89fb";

function loadRelease(releaseId: string): RuleSetRelease {
  const raw = JSON.parse(readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8"));
  return ruleSetReleaseSchema.parse(raw) as RuleSetRelease;
}

const activeReleaseId = activeRuleSetPointerSchema.parse(
  JSON.parse(readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8")),
).activeReleaseId;

const historicalReleaseIds = readdirSync(releasesDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .filter((id) => id !== activeReleaseId)
  .sort();

describe("historical Rule-Set Releases (case 30)", () => {
  it("there are at least the 10 pre-Candidate-A historical artifacts, including rel-738021fc80b35115", () => {
    expect(historicalReleaseIds.length).toBeGreaterThanOrEqual(10);
    expect(historicalReleaseIds).toContain(PRE_CANDIDATE_A_RELEASE_ID);
  });

  it("the Candidate-C Release rel-9fc9fb43257d89fb is now historical too (13 historical artifacts)", () => {
    expect(activeReleaseId).not.toBe(PRE_CANDIDATE_D_RELEASE_ID);
    expect(historicalReleaseIds).toContain(PRE_CANDIDATE_D_RELEASE_ID);
    expect(historicalReleaseIds).toContain(PRE_CANDIDATE_C_RELEASE_ID);
    expect(historicalReleaseIds).toContain(PRE_CANDIDATE_B_RELEASE_ID);
    expect(historicalReleaseIds).toHaveLength(13);
  });

  for (const releaseId of historicalReleaseIds) {
    describe(releaseId, () => {
      it("parses under the current schema", () => {
        expect(() => loadRelease(releaseId)).not.toThrow();
      });

      it("its releaseId recomputes from its own revisions (content integrity)", () => {
        const release = loadRelease(releaseId);
        expect(release.releaseId).toBe(releaseId);
        expect(computeReleaseId(release.revisions)).toBe(releaseId);
      });

      it("contains no Candidate-D GR-8 / GR-4-r2 / clinical-disposition / CDR-1 / first-follow-up content (Candidate D case 55)", () => {
        const serialized = readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8");
        for (const forbidden of [
          "\"GR-8\"",
          "GR-4-r2",
          "clinical-disposition",
          "CDR-1",
          "incidental-multiple-solid-gte-6mm-first-follow-up",
          "ACR-FLEISCHNER-MULTIPLE-SOLID-GTE6MM-FIRST-FOLLOW-UP",
          "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed",
          "clinician_decides_no_further_routine_nodule_surveillance",
        ]) {
          expect(serialized).not.toContain(forbidden);
        }
      });

      if (releaseId !== PRE_CANDIDATE_D_RELEASE_ID) {
        it("pre-Candidate-C artifacts contain no Candidate-C GR-7 / multiple-solid >=6 mm pathway / safeguard content (case 36)", () => {
          const serialized = readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8");
          expect(serialized).not.toContain("\"GR-7\"");
          expect(serialized).not.toContain("incidental-multiple-solid-gte-6mm-initial");
          expect(serialized).not.toContain("ACR-FLEISCHNER-MULTIPLE-SOLID-GTE6MM-INITIAL");
          expect(serialized).not.toContain(
            "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management",
          );
        });
      }

      if (releaseId !== PRE_CANDIDATE_C_RELEASE_ID && releaseId !== PRE_CANDIDATE_D_RELEASE_ID) {
        it("pre-Candidate-B artifacts contain no Candidate-B GR-6 / multiple-solid pathway / considerAction content", () => {
          const serialized = readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8");
          expect(serialized).not.toContain("\"GR-6\"");
          expect(serialized).not.toContain("incidental-multiple-solid-lt-6mm-initial");
          expect(serialized).not.toContain("\"considerAction\"");
        });
      }

      if (
        releaseId !== PRE_CANDIDATE_B_RELEASE_ID &&
        releaseId !== PRE_CANDIDATE_C_RELEASE_ID &&
        releaseId !== PRE_CANDIDATE_D_RELEASE_ID
      ) {
        it("pre-Candidate-A artifacts contain no GR-5 / multiple-subsolid pathway", () => {
          const serialized = readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8");
          expect(serialized).not.toContain("\"GR-5\"");
          expect(serialized).not.toContain("incidental-multiple-subsolid-initial");
        });
      }
    });
  }
});

const applicability = { age: 55, known_malignancy_history: false, immunocompromised: false };
const candidateBBase: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: false,
  multiple_nodules_all_solid: true,
  multiple_nodules_discrete_circumscribed: true,
  fleischner_multiple_solid_all_lt_6mm: true,
  ...applicability,
};
const candidateCBase: ClinicalInputState = { ...candidateBBase, fleischner_multiple_solid_all_lt_6mm: false };
const candidateCCases: { name: string; input: ClinicalInputState }[] = [
  {
    name: "GR-7 multiple-solid >=6 mm safeguard confirmed",
    input: { ...candidateCBase, fleischner_multiple_solid_no_individual_nodule_requires_solitary_management: true },
  },
  { name: "GR-7 multiple-solid >=6 mm safeguard absent", input: candidateCBase },
];
const candidateBCases: { name: string; input: ClinicalInputState }[] = [
  { name: "GR-6 multiple-solid <6 mm low risk", input: { ...candidateBBase, fleischner_multiple_solid_risk_category: "low" } },
  { name: "GR-6 multiple-solid <6 mm high risk", input: { ...candidateBBase, fleischner_multiple_solid_risk_category: "high" } },
  { name: "GR-6 multiple-solid <6 mm risk absent", input: candidateBBase },
];

function representativeCases(): { name: string; input: ClinicalInputState }[] {
  return [
    {
      name: "GR-5 multiple-subsolid State B",
      input: {
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 3,
        multiple_nodules_all_subsolid: true,
        multiple_nodules_discrete_circumscribed: true,
        fleischner_multiple_subsolid_any_gte_6mm: true,
        ...applicability,
      },
    },
    {
      name: "GR-5 multiple-subsolid State A",
      input: {
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 3,
        multiple_nodules_all_subsolid: true,
        multiple_nodules_discrete_circumscribed: true,
        fleischner_multiple_subsolid_any_gte_6mm: false,
        ...applicability,
      },
    },
    {
      name: "GR-5 multiple-subsolid F4 absent",
      input: {
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 3,
        multiple_nodules_all_subsolid: true,
        multiple_nodules_discrete_circumscribed: true,
        ...applicability,
      },
    },
    {
      name: "GR-1 solid 5-8mm (S3 + Fleischner)",
      input: {
        nodule_morphology: "solid",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        ...applicability,
        nodule_size_mm: 7,
        nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
      },
    },
    {
      name: "GR-2 pure GGN >=6mm",
      input: {
        nodule_morphology: "pure-ground-glass",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        ...applicability,
        nodule_size_mm: 7,
        nodule_diameter_measurements: [{ valueMm: 7, conventionId: "fleischner-2017-average-diameter" }],
      },
    },
    {
      name: "GR-3 part-solid >=6mm / solid <6mm",
      input: {
        nodule_morphology: "part-solid",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        ...applicability,
        nodule_size_mm: 8,
        nodule_diameter_measurements: [{ valueMm: 8, conventionId: "fleischner-2017-average-diameter" }],
        solid_component_diameter_measurements: [
          { valueMm: 4, conventionId: "fleischner-2017-solid-component-long-axis" },
        ],
      },
    },
    {
      name: "GR-4 volume-stability true",
      input: {
        nodule_morphology: "solid",
        assessment_context: "incidental",
        assessment_timepoint: "follow-up",
        fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed: false,
        nodule_count: 1,
        ...applicability,
        s3_volume_stability_criterion_met: true,
      },
    },
  ];
}

for (const { label, baselineId, cases } of [
  { label: "Candidate B", baselineId: PRE_CANDIDATE_B_RELEASE_ID, cases: representativeCases() },
  {
    label: "Candidate C (case 37)",
    baselineId: PRE_CANDIDATE_C_RELEASE_ID,
    cases: [...representativeCases(), ...candidateBCases],
  },
  {
    label: "Candidate D (case 56)",
    baselineId: PRE_CANDIDATE_D_RELEASE_ID,
    cases: [...representativeCases(), ...candidateBCases, ...candidateCCases],
  },
]) describe(`representative existing evaluations are identical before and after ${label}`, () => {
  const before = loadRelease(baselineId);
  const after = loadTestRelease();

  for (const { name, input } of cases) {
    it(name, () => {
      const beforeTrace = evaluate(input, before);
      const afterTrace = evaluate(input, after);
      expect(afterTrace.pathwaySelection).toEqual(beforeTrace.pathwaySelection);
      expect(afterTrace.pathwaySelection.state).toBe("MATCHED");
      expect(afterTrace.sourceEvaluationOutcomes).toEqual(beforeTrace.sourceEvaluationOutcomes);
      expect(afterTrace.recommendationSet).toEqual(beforeTrace.recommendationSet);
      if (
        name === "GR-5 multiple-subsolid F4 absent" ||
        name === "GR-6 multiple-solid <6 mm risk absent" ||
        name === "GR-7 multiple-solid >=6 mm safeguard absent"
      ) {
        expect(afterTrace.recommendationSet).toHaveLength(0);
        expect(afterTrace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner")?.state)
          .toBe("INSUFFICIENT_INPUT");
      } else {
        expect(afterTrace.recommendationSet.length).toBeGreaterThan(0);
      }
    });
  }
});
