// issue #16 Candidate A (final spec comment 5858670823 §12, acceptance cases 30-31): every
// immutable historical Rule-Set Release artifact still parses under the 1.7.0 schema, its releaseId
// still recomputes from its own content, and none of them contains Candidate-A content; and the
// pre-Candidate-A Release (rel-738021fc80b35115, Candidate C) evaluates representative solitary
// inputs identically to the new Release. Only reads the artifacts -- never rebuilds or rewrites
// them.
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

      it("contains no GR-5 and no incidental-multiple-subsolid-initial content", () => {
        const serialized = readFileSync(join(releasesDir, `${releaseId}.json`), "utf-8");
        expect(serialized).not.toContain("\"GR-5\"");
        expect(serialized).not.toContain("incidental-multiple-subsolid-initial");
      });
    });
  }
});

describe("representative solitary evaluations are identical before and after Candidate A (case 31)", () => {
  const before = loadRelease(PRE_CANDIDATE_A_RELEASE_ID);
  const after = loadTestRelease();

  const applicability = { age: 55, known_malignancy_history: false, immunocompromised: false };
  const cases: { name: string; input: ClinicalInputState }[] = [
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
        nodule_count: 1,
        ...applicability,
        s3_volume_stability_criterion_met: true,
      },
    },
  ];

  for (const { name, input } of cases) {
    it(name, () => {
      const beforeTrace = evaluate(input, before);
      const afterTrace = evaluate(input, after);
      expect(afterTrace.pathwaySelection).toEqual(beforeTrace.pathwaySelection);
      expect(afterTrace.pathwaySelection.state).toBe("MATCHED");
      expect(afterTrace.sourceEvaluationOutcomes).toEqual(beforeTrace.sourceEvaluationOutcomes);
      expect(afterTrace.recommendationSet).toEqual(beforeTrace.recommendationSet);
      expect(afterTrace.recommendationSet.length).toBeGreaterThan(0);
    });
  }
});
