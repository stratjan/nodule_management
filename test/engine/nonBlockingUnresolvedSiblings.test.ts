// issue #30 (ADR-0011): source-agnostic, synthetic-fixture coverage for the generic governed
// directional non-blocking unresolved-sibling aggregation mechanism -- mirrors
// sufficientConditionGroups.test.ts/ruleAmbiguity.test.ts's own discipline of proving a general
// engine mechanism with non-clinical fixtures, never using the real S3 B1/B2 rules as the
// architecture's own proof. No real governed clinical JSON is read or modified by this file.
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousRuleMatchError } from "../../src/engine/evaluate";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision } from "../../src/engine/types";

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/nonBlockingUnresolvedSiblings.test.ts",
};

const gate = rev({
  ruleId: "TEST-NBUS-GATE",
  revisionId: "TEST-NBUS-GATE-r1",
  kind: "pathway-gate",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  // clinicalPathwayId must be one of the real closed-enum values (issue #17); this release is
  // built standalone in this test, never combined with the real Release, so reuse is inert.
  clinicalPathwayId: "incidental-solitary-solid-initial",
  conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
});

const applicability = rev({
  ruleId: "TEST-NBUS-SAR",
  revisionId: "TEST-NBUS-SAR-r1",
  kind: "source-applicability",
  recommendationSourceId: "test-only-nbus-source",
  approvalStatus: "Approved",
  approvalEvent: { by: "test-fixture", at: "2026-01-01" },
  provenance: syntheticProvenance,
  conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
});

type SiblingRef = { siblingRuleId: string; siblingRevisionId: string };

/** Each synthetic rule is `conditions`-shaped on its own disjoint field, so it can independently
 * be driven to RECOMMENDATION (field === true), OUTSIDE_CURRENT_RULESET_SCOPE (field === false),
 * or INSUFFICIENT_INPUT (field absent) by the test's own input, entirely independent of the other
 * rules' fields. */
function makeRule(ruleId: string, field: string, nonBlockingUnresolvedSiblings?: SiblingRef[]) {
  return rev({
    ruleId,
    revisionId: `${ruleId}-r1`,
    kind: "atomic-clinical-rule",
    recommendationSourceId: "test-only-nbus-source",
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
      rationale: "Synthetic fixture for nonBlockingUnresolvedSiblings testing only -- not real clinical content.",
    },
  });
}

const baseInput = {
  test_only_gate_field: "yes",
  test_only_app_field: true,
} as unknown as ClinicalInputState;

function outcomeFor(trace: ReturnType<typeof evaluate>) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "test-only-nbus-source");
}

describe("nonBlockingUnresolvedSiblings generic aggregation semantics (issue #30/ADR-0011)", () => {
  it("1. recommendation + outside sibling -> recommendation; toleratedUnresolvedSiblings absent", () => {
    const ruleA = makeRule("TEST-NBUS-A1", "field_a");
    const ruleB = makeRule("TEST-NBUS-B1", "field_b");
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate(
      { ...baseInput, field_a: true, field_b: false } as unknown as ClinicalInputState,
      release,
    );
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.toleratedUnresolvedSiblings).toBeUndefined();
  });

  it("2. recommendation + one unresolved sibling with a declared directional relation -> recommendation; audit contains exact sibling {ruleId, revisionId}", () => {
    const ruleB = makeRule("TEST-NBUS-B2", "field_b");
    const ruleA = makeRule("TEST-NBUS-A2", "field_a", [
      { siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId },
    ]);
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate({ ...baseInput, field_a: true } as unknown as ClinicalInputState, release);
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.toleratedUnresolvedSiblings).toEqual([
      { ruleId: ruleB.ruleId, revisionId: ruleB.revisionId },
    ]);
  });

  it("3. recommendation + unresolved sibling without any declared relation -> INSUFFICIENT_INPUT", () => {
    const ruleA = makeRule("TEST-NBUS-A3", "field_a");
    const ruleB = makeRule("TEST-NBUS-B3", "field_b");
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate({ ...baseInput, field_a: true } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("4. recommendation + two unresolved siblings, both covered -> recommendation; audit includes both, order-independently", () => {
    const ruleB = makeRule("TEST-NBUS-B4", "field_b");
    const ruleC = makeRule("TEST-NBUS-C4", "field_c");
    const ruleA = makeRule("TEST-NBUS-A4", "field_a", [
      { siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId },
      { siblingRuleId: ruleC.ruleId, siblingRevisionId: ruleC.revisionId },
    ]);
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB, ruleC]);

    const trace = evaluate({ ...baseInput, field_a: true } as unknown as ClinicalInputState, release);
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome?.toleratedUnresolvedSiblings?.map((s) => s.ruleId).sort()).toEqual(
      [ruleB.ruleId, ruleC.ruleId].sort(),
    );
    expect(outcome?.toleratedUnresolvedSiblings).toHaveLength(2);
  });

  it("5. recommendation A matches; B covered/non-blocking, C not covered/blocking -> INSUFFICIENT_INPUT, reason from C only, never B; reversing B/C authored order yields a byte-identical outcome", () => {
    const ruleB = makeRule("TEST-NBUS-B5", "field_b");
    const ruleC = makeRule("TEST-NBUS-C5", "field_c");
    const ruleA = makeRule("TEST-NBUS-A5", "field_a", [
      { siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId },
    ]);
    const input = { ...baseInput, field_a: true } as unknown as ClinicalInputState;

    const releaseForward = buildRuleSetRelease([gate, applicability, ruleA, ruleB, ruleC]);
    const outcomeForward = outcomeFor(evaluate(input, releaseForward));

    const releaseReversed = buildRuleSetRelease([gate, applicability, ruleA, ruleC, ruleB]);
    const outcomeReversed = outcomeFor(evaluate(input, releaseReversed));

    expect(outcomeForward?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeForward?.reason).toContain("field_c");
    expect(outcomeForward?.reason).not.toContain("field_b");

    expect(outcomeReversed).toEqual(outcomeForward);
  });

  it("6. zero recommendations + one unresolved + one outside -> INSUFFICIENT_INPUT", () => {
    const ruleA = makeRule("TEST-NBUS-A6", "field_a");
    const ruleB = makeRule("TEST-NBUS-B6", "field_b");
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate({ ...baseInput, field_b: false } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("7. zero recommendations + two unresolved -> INSUFFICIENT_INPUT", () => {
    const ruleA = makeRule("TEST-NBUS-A7", "field_a");
    const ruleB = makeRule("TEST-NBUS-B7", "field_b");
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate({ ...baseInput } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("8. all siblings outside -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const ruleA = makeRule("TEST-NBUS-A8", "field_a");
    const ruleB = makeRule("TEST-NBUS-B8", "field_b");
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = evaluate(
      { ...baseInput, field_a: false, field_b: false } as unknown as ClinicalInputState,
      release,
    );
    expect(outcomeFor(trace)?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("9. two definite recommendations still throw AmbiguousRuleMatchError even where one declares a non-blocking relation toward the other -- the relation is never consulted before this check", () => {
    const ruleB = makeRule("TEST-NBUS-B9", "field_b");
    const ruleA = makeRule("TEST-NBUS-A9", "field_a", [
      { siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId },
    ]);
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    const trace = () =>
      evaluate({ ...baseInput, field_a: true, field_b: true } as unknown as ClinicalInputState, release);
    expect(trace).toThrow(AmbiguousRuleMatchError);
  });

  it("10. A declares A->B non-blocking, but B does NOT declare B->A -- when B is matched and A is the unresolved sibling, the reverse direction is never inferred -> INSUFFICIENT_INPUT", () => {
    const ruleB = makeRule("TEST-NBUS-B10", "field_b");
    const ruleA = makeRule("TEST-NBUS-A10", "field_a", [
      { siblingRuleId: ruleB.ruleId, siblingRevisionId: ruleB.revisionId },
    ]);
    const release = buildRuleSetRelease([gate, applicability, ruleA, ruleB]);

    // field_a absent (A -> INSUFFICIENT_INPUT), field_b true (B -> RECOMMENDATION). B's own
    // matchedRule.nonBlockingUnresolvedSiblings is undefined, so A's unresolved status blocks.
    const trace = evaluate({ ...baseInput, field_b: true } as unknown as ClinicalInputState, release);
    expect(outcomeFor(trace)?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("an ordinary recommendation with no unresolved sibling at all has no fabricated toleratedUnresolvedSiblings field", () => {
    const ruleA = makeRule("TEST-NBUS-A11", "field_a");
    const release = buildRuleSetRelease([gate, applicability, ruleA]);

    const trace = evaluate({ ...baseInput, field_a: true } as unknown as ClinicalInputState, release);
    const outcome = outcomeFor(trace);
    expect(outcome?.state).toBe("RECOMMENDATION");
    expect(outcome).not.toHaveProperty("toleratedUnresolvedSiblings");
  });
});
