// Approved-only release-assembly invariant (ADR-0007). Uses a synthetic, clearly-non-clinical
// Draft test fixture kept under test/fixtures/ only -- never BTS or any other real clinical
// content, and never committed to clinical/rules/.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRuleSetRelease, NonApprovedRevisionError } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { RuleRevision } from "../../src/engine/types";
import { loadApprovedPhase1Revisions } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSyntheticDraftFixture(): RuleRevision {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "../fixtures/synthetic-draft-fixture.json"), "utf-8"),
  );
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

describe("Rule-Set Release assembly", () => {
  it("includes exactly the 5 Approved Phase 1 revisions, nothing else, no BTS content", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);

    expect(release.revisions).toHaveLength(5);
    expect(release.revisions.every((r) => r.approvalStatus === "Approved")).toBe(true);
    expect(
      release.revisions.some(
        (r) => "recommendationSourceId" in r && r.recommendationSourceId === "bts",
      ),
    ).toBe(false);

    const ruleIds = release.revisions.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual([
      "ACR-FLEISCHNER-6TO8MM",
      "ACR-S3-5TO8MM",
      "GR-1",
      "SAR-FLEISCHNER",
      "SAR-S3",
    ]);
  });

  it("is deterministic and content-addressable: rebuilding the same revisions yields the same releaseId", () => {
    const revisions = loadApprovedPhase1Revisions();
    const releaseA = buildRuleSetRelease(revisions);
    const releaseB = buildRuleSetRelease(revisions);
    expect(releaseA.releaseId).toBe(releaseB.releaseId);
  });

  it("rejects a synthetic, clearly-non-clinical Draft Rule Revision", () => {
    const revisions = [...loadApprovedPhase1Revisions(), loadSyntheticDraftFixture()];
    expect(() => buildRuleSetRelease(revisions)).toThrow(NonApprovedRevisionError);
  });
});
