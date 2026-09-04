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
  it("includes exactly the 6 Approved revisions (Phase 1 + issue #20's new Fleischner >8mm rule), nothing else, no BTS content", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);

    expect(release.revisions).toHaveLength(6);
    expect(release.revisions.every((r) => r.approvalStatus === "Approved")).toBe(true);
    expect(
      release.revisions.some(
        (r) => "recommendationSourceId" in r && r.recommendationSourceId === "bts",
      ),
    ).toBe(false);

    const ruleIds = release.revisions.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual([
      "ACR-FLEISCHNER-6TO8MM",
      "ACR-FLEISCHNER-GT8TO30MM",
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

  it("the real Approved Phase-1 set plus the new Fleischner >8mm rule builds successfully (no false-positive overlap between the 6-8mm and >8mm rules)", () => {
    const revisions = loadApprovedPhase1Revisions();
    expect(() => buildRuleSetRelease(revisions)).not.toThrow();
    expect(buildRuleSetRelease(revisions).revisions).toHaveLength(6);
  });
});
