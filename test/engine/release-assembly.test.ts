// Approved-only release-assembly invariant (ADR-0007). Uses a synthetic, clearly-non-clinical
// Draft test fixture kept under test/fixtures/ only -- never BTS or any other real clinical
// content, and never committed to clinical/rules/.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRuleSetRelease,
  NonApprovedRevisionError,
  MissingApprovalEventError,
  OverlappingRuleConditionsError,
} from "../../src/engine/releaseBuilder";
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

function loadSyntheticOverlappingRules(): RuleRevision[] {
  return ["synthetic-overlapping-rule-a.json", "synthetic-overlapping-rule-b.json"].map((name) => {
    const raw = JSON.parse(readFileSync(join(__dirname, `../fixtures/${name}`), "utf-8"));
    return ruleRevisionSchema.parse(raw) as RuleRevision;
  });
}

describe("Rule-Set Release assembly", () => {
  it("includes exactly the 12 Approved revisions (Phase 1 + issue #20's Fleischner >8mm rule + issue #17's pure-GGN pathway + issue #18's part-solid pathway), nothing else, no BTS content", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);

    expect(release.revisions).toHaveLength(12);
    expect(release.revisions.every((r) => r.approvalStatus === "Approved")).toBe(true);
    expect(
      release.revisions.some(
        (r) => "recommendationSourceId" in r && r.recommendationSourceId === "bts",
      ),
    ).toBe(false);

    const ruleIds = release.revisions.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual([
      "ACR-FLEISCHNER-6TO8MM",
      "ACR-FLEISCHNER-GGN-GTE6MM",
      "ACR-FLEISCHNER-GGN-LT6MM",
      "ACR-FLEISCHNER-GT8TO30MM",
      "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
      "ACR-FLEISCHNER-PARTSOLID-LT6MM",
      "ACR-S3-5TO8MM",
      "GR-1",
      "GR-2",
      "GR-3",
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

  it("rejects an Approved revision that carries no explicit approval event (ADR-0007)", () => {
    // Constructed directly (not through ruleRevisionSchema.parse, which already rejects this
    // shape) to independently exercise buildRuleSetRelease's own enforcement -- release
    // assembly must not rely solely on schema validation having run first.
    const [gate, ...rest] = loadApprovedPhase1Revisions();
    const gateWithoutApprovalEvent: RuleRevision = { ...gate, approvalEvent: undefined };

    expect(() => buildRuleSetRelease([gateWithoutApprovalEvent, ...rest])).toThrow(
      MissingApprovalEventError,
    );
  });

  it("rejects two Approved Atomic Clinical Rules for the same source with deterministically overlapping conditions (issue #20)", () => {
    const revisions = [...loadApprovedPhase1Revisions(), ...loadSyntheticOverlappingRules()];
    expect(() => buildRuleSetRelease(revisions)).toThrow(OverlappingRuleConditionsError);
  });

  it("the real Approved set builds successfully (no false-positive overlap between the 6-8mm, >8mm, pure-GGN, and part-solid rules across pathways)", () => {
    const revisions = loadApprovedPhase1Revisions();
    expect(() => buildRuleSetRelease(revisions)).not.toThrow();
    expect(buildRuleSetRelease(revisions).revisions).toHaveLength(12);
  });

  it("issue #18: the mixed-field diameterConditions on ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM does not cause a false-positive overlap against ACR-FLEISCHNER-PARTSOLID-LT6MM (extractNumericRange returns null for a mixed-field array, so this pair is release-time-undecidable -- an accepted residual, not a defect; see the runtime-never-ambiguous regression in boundary.test.ts)", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);
    const partSolidRuleIds = release.revisions
      .filter((r) => r.kind === "atomic-clinical-rule" && r.recommendationSourceId === "fleischner")
      .map((r) => r.ruleId);
    expect(partSolidRuleIds).toEqual(
      expect.arrayContaining([
        "ACR-FLEISCHNER-PARTSOLID-LT6MM",
        "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
      ]),
    );
  });
});
