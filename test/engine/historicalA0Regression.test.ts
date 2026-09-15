// issue #15 Candidate B1: proves historical Candidate A0 remains reproducible after B1's
// implementation, using the actual immutable historical Rule-Set Release artifact
// (rel-fb4eb398cb3ae65d) -- never by reconstructing it from current source rule files (which now
// build the B1 successor instead), and never by mutating ACR-S3-FOLLOWUP-VOLUME-STABLE-r1 into the
// new semantics. rel-fb4eb398cb3ae65d itself must stay byte-for-byte unchanged; this test only
// reads it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleSetRelease } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const HISTORICAL_RELEASE_ID = "rel-fb4eb398cb3ae65d";

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

describe("historical Candidate A0 regression against the immutable rel-fb4eb398cb3ae65d artifact", () => {
  const release = loadHistoricalRelease();

  it("the historical release still embeds ACR-S3-FOLLOWUP-VOLUME-STABLE-r1, not the B1 successor", () => {
    const ruleIds = release.revisions.map((r) => r.ruleId);
    expect(ruleIds).toContain("ACR-S3-FOLLOWUP-VOLUME-STABLE");
    expect(ruleIds).not.toContain("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT");
  });

  it("criterion true -> RECOMMENDATION", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-VOLUME-STABLE");
  });

  it("criterion false -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: false }, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("criterion missing -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate(followUpBaseInput, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
  });
});
