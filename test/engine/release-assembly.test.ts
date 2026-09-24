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
  UnknownNonBlockingSiblingReferenceError,
  MismatchedNonBlockingSiblingScopeError,
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
  it("includes exactly the 16 Approved revisions (Phase 1 + issue #20's Fleischner >8mm rule + issue #17's pure-GGN pathway + issue #18's part-solid pathway + issue #15/#28's solid follow-up pathway (Candidate B1 successor, now -r3 with Candidate C's general-condition group) + issue #26's part-solid solid-component >8mm rule + issue #15/#30's Candidate B2 VDT<400 work-up rule, now -r2 revision-maintenance-only), nothing else, no BTS content", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);

    expect(release.revisions).toHaveLength(16);
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
      "ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM",
      "ACR-S3-5TO8MM",
      "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
      "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
      "GR-1",
      "GR-2",
      "GR-3",
      "GR-4",
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

  it("the real Approved set builds successfully (no false-positive overlap between the 6-8mm, >8mm, pure-GGN, part-solid, part-solid solid-component >8mm, and follow-up rules across pathways -- including the Rule-1/Candidate-C pair that release-time overlap validation is blind to by field construction, per issue #26)", () => {
    const revisions = loadApprovedPhase1Revisions();
    expect(() => buildRuleSetRelease(revisions)).not.toThrow();
    expect(buildRuleSetRelease(revisions).revisions).toHaveLength(16);
  });

  it("issue #15/#28: ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT's sufficientConditionGroups conditions never trigger the overlap guard -- extractNumericRange/rangesOverlap only ever inspect diameterConditions/volumeConditions, both undefined on this rule, so it can never be reported as overlapping with anything (S3 has only one Atomic Clinical Rule per pathway anyway)", () => {
    const revisions = loadApprovedPhase1Revisions();
    const release = buildRuleSetRelease(revisions);
    const s3RuleIds = release.revisions
      .filter((r) => r.kind === "atomic-clinical-rule" && r.recommendationSourceId === "s3")
      .map((r) => r.ruleId);
    expect(s3RuleIds).toEqual(
      expect.arrayContaining([
        "ACR-S3-5TO8MM",
        "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
        "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
      ]),
    );
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

// issue #30 (ADR-0011): release-time validation of declared nonBlockingUnresolvedSiblings
// relations. Source-agnostic synthetic fixtures only, built standalone (never combined with the
// real Approved set) -- mirrors sufficientConditionGroups.test.ts/ruleAmbiguity.test.ts's own
// discipline. #30 introduces no new real governed rule file, so the existing 15-revision/exact-
// ruleId-list assertions above are left entirely untouched.
describe("issue #30: nonBlockingUnresolvedSiblings release-time validation", () => {
  const syntheticProvenance = {
    sourceDocument: "test fixture -- not a real clinical source",
    version: "n/a",
    originalLanguage: "English",
    sourceType: "Synthetic test fixture",
    locator: "test/engine/release-assembly.test.ts",
  };

  function rev(raw: unknown): RuleRevision {
    return ruleRevisionSchema.parse(raw) as RuleRevision;
  }

  function gateFor(pathwayId: string, ruleId: string) {
    return rev({
      ruleId,
      revisionId: `${ruleId}-r1`,
      kind: "pathway-gate",
      approvalStatus: "Approved",
      approvalEvent: { by: "test-fixture", at: "2026-01-01" },
      provenance: syntheticProvenance,
      clinicalPathwayId: pathwayId,
      conditions: [{ field: `test_only_gate_field_${ruleId}`, op: "eq", value: "yes" }],
    });
  }

  function atomicRuleFor(
    ruleId: string,
    recommendationSourceId: string,
    clinicalPathwayId: string,
    field: string,
    nonBlockingUnresolvedSiblings?: { siblingRuleId: string; siblingRevisionId: string }[],
  ) {
    return rev({
      ruleId,
      revisionId: `${ruleId}-r1`,
      kind: "atomic-clinical-rule",
      recommendationSourceId,
      clinicalPathwayId,
      approvalStatus: "Approved",
      approvalEvent: { by: "test-fixture", at: "2026-01-01" },
      provenance: syntheticProvenance,
      conditions: [{ field, op: "eq", value: true }],
      ...(nonBlockingUnresolvedSiblings
        ? {
            nonBlockingUnresolvedSiblings: nonBlockingUnresolvedSiblings.map((s) => ({
              ...s,
              provenance: syntheticProvenance,
            })),
          }
        : {}),
      recommendation: {
        clinicalEndpoint: "test-only-not-a-real-recommendation",
        intervals: ["n/a"],
        rationale: "Synthetic fixture for issue #30 release-assembly testing only -- not real clinical content.",
      },
    });
  }

  const gateX = gateFor("incidental-solitary-solid-initial", "TEST-NBUS-RA-GATE-X");
  const gateY = gateFor("incidental-solitary-pure-ggn-initial", "TEST-NBUS-RA-GATE-Y");

  it("1. exact sibling (ruleId, revisionId), same source and same effective pathway -> accepted", () => {
    const ruleB = atomicRuleFor(
      "TEST-NBUS-RA-B1",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_b",
    );
    const ruleA = atomicRuleFor(
      "TEST-NBUS-RA-A1",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_a",
      [{ siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId }],
    );
    expect(() => buildRuleSetRelease([gateX, ruleA, ruleB])).not.toThrow();
  });

  it("2. missing target (no such ruleId at all) -> UnknownNonBlockingSiblingReferenceError", () => {
    const ruleA = atomicRuleFor(
      "TEST-NBUS-RA-A2",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_a",
      [{ siblingRuleId: "TEST-NBUS-RA-NO-SUCH-RULE", siblingRevisionId: "TEST-NBUS-RA-NO-SUCH-RULE-r1" }],
    );
    expect(() => buildRuleSetRelease([gateX, ruleA])).toThrow(UnknownNonBlockingSiblingReferenceError);
  });

  it("3. target ruleId exists but only under a different (stale) revisionId -> UnknownNonBlockingSiblingReferenceError", () => {
    const ruleB = atomicRuleFor(
      "TEST-NBUS-RA-B3",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_b",
    );
    const ruleA = atomicRuleFor(
      "TEST-NBUS-RA-A3",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_a",
      [{ siblingRuleId: ruleB.ruleId, siblingRevisionId: "TEST-NBUS-RA-B3-r2" }],
    );
    expect(() => buildRuleSetRelease([gateX, ruleA, ruleB])).toThrow(UnknownNonBlockingSiblingReferenceError);
  });

  it("4. sibling exists but with a different recommendationSourceId -> MismatchedNonBlockingSiblingScopeError", () => {
    const ruleB = atomicRuleFor(
      "TEST-NBUS-RA-B4",
      "test-only-nbus-ra-OTHER-source",
      "incidental-solitary-solid-initial",
      "field_b",
    );
    const ruleA = atomicRuleFor(
      "TEST-NBUS-RA-A4",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_a",
      [{ siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId }],
    );
    expect(() => buildRuleSetRelease([gateX, ruleA, ruleB])).toThrow(MismatchedNonBlockingSiblingScopeError);
  });

  it("5. sibling exists, same source, but a different effective Clinical Pathway -> MismatchedNonBlockingSiblingScopeError", () => {
    const ruleY = atomicRuleFor(
      "TEST-NBUS-RA-Y5",
      "test-only-nbus-ra-source",
      "incidental-solitary-pure-ggn-initial",
      "field_y",
    );
    const ruleX = atomicRuleFor(
      "TEST-NBUS-RA-X5",
      "test-only-nbus-ra-source",
      "incidental-solitary-solid-initial",
      "field_x",
      [{ siblingRuleId: ruleY.ruleId, siblingRevisionId: ruleY.revisionId }],
    );
    expect(() => buildRuleSetRelease([gateX, gateY, ruleX, ruleY])).toThrow(
      MismatchedNonBlockingSiblingScopeError,
    );
  });

  it("does not weaken or otherwise interact with the existing overlap/pathway validation invariants -- the real Approved set builds successfully, now including issue #15 Candidate B1-r3/B2-r2's own real, mutually-referencing nonBlockingUnresolvedSiblings relations (ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r3 <-> ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r2, both same source/pathway, validated by assertNonBlockingSiblingRelationsValid exactly as the synthetic cases above prove generically)", () => {
    expect(() => buildRuleSetRelease(loadApprovedPhase1Revisions())).not.toThrow();
  });
});
