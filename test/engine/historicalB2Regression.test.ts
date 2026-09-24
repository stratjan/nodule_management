// issue #15 Candidate C (final spec comment 5767460353 §11 case 11): proves the pre-Candidate-C
// Release (rel-36e978b3efb56429, B1-r2 + B2-r1) still parses and evaluates exactly as it did,
// using the actual immutable historical Rule-Set Release artifact -- never by reconstructing it
// from current source rule files (which now build B1-r3/B2-r2 instead). rel-36e978b3efb56429
// itself must stay byte-for-byte unchanged; this test only reads it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleSetRelease } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const HISTORICAL_RELEASE_ID = "rel-36e978b3efb56429";

function loadHistoricalRelease() {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, `clinical/rule-sets/releases/${HISTORICAL_RELEASE_ID}.json`), "utf-8"),
  );
  return ruleSetReleaseSchema.parse(raw) as RuleSetRelease;
}

const followUpBaseInput: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  nodule_count: 1,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

describe("historical Candidate B2 regression against the immutable rel-36e978b3efb56429 artifact", () => {
  const release = loadHistoricalRelease();

  it("parses under the current schema and still embeds B1-r2/B2-r1 (16 revisions), not the Candidate-C revisions", () => {
    expect(release.releaseId).toBe(HISTORICAL_RELEASE_ID);
    expect(release.revisions).toHaveLength(16);
    const revisionIds = release.revisions.map((r) => r.revisionId);
    expect(revisionIds).toContain("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2");
    expect(revisionIds).toContain("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1");
    expect(revisionIds).not.toContain("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r3");
    expect(revisionIds).not.toContain("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r2");
  });

  it("volume-stability false, VDT 600 -> OUTSIDE_CURRENT_RULESET_SCOPE (historical two-group B1-r2 outcome, Golden Case G2b as approved for that Release)", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 600 },
      release,
    );
    expect(outcomeFor(trace, "s3")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("VDT 399 -> B2-r1 RECOMMENDATION with B1-r2 tolerated as an unresolved sibling", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 399 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400");
    expect(s3?.toleratedUnresolvedSiblings).toEqual([
      {
        ruleId: "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
        revisionId: "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2",
      },
    ]);
  });

  it("the Candidate-C general-condition field is inert against this Release -> INSUFFICIENT_INPUT, no discharge recommendation", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_general_condition_precludes_further_workup_or_therapy: true },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
    expect(s3?.recommendation).toBeUndefined();
  });
});
