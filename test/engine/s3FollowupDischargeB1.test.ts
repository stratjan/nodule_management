// issue #15 Candidate B1 (architecture: issue #28; revision bumped to -r2 by issue #15 Candidate
// B2/#30, ADR-0011 -- see the case-by-case note below): exact clinical regression matrix for the
// governed successor rule ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2 -- two independently
// sufficient S3 discharge criteria (volume-stability, VDT>600) inside one sufficientConditionGroups
// -shaped Atomic Clinical Rule. -r1's own conditions, groups, and recommendation content are
// byte-for-byte unchanged in -r2; only revisionId, approvalEvent, and one new
// nonBlockingUnresolvedSiblings entry were added. The generic reduction mechanism itself is proven
// separately and source-agnostically in sufficientConditionGroups.test.ts; this file exercises
// only the real, governed clinical content and its exact boundary.
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousRuleMatchError } from "../../src/engine/evaluate";
import { loadTestRelease } from "../helpers/loadTestRelease";
import type { ClinicalInputState } from "../../src/engine/types";

const release = loadTestRelease();

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
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

describe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2 clinical regression matrix (issue #15 Candidate B1)", () => {
  it("case 1: volume-stability true, VDT absent -> RECOMMENDATION, matchedSufficientConditionGroupIds = [volume-stability]", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["volume-stability"]);
  });

  it("case 2: volume-stability false, VDT absent -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: false }, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("case 3: volume-stability true, VDT 700 -> RECOMMENDATION, both groupIds reported, no AmbiguousRuleMatchError", () => {
    const input = {
      ...followUpBaseInput,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 700,
    };
    let trace: ReturnType<typeof evaluate> | undefined;
    expect(() => {
      trace = evaluate(input, release);
    }).not.toThrow();
    const s3 = outcomeFor(trace!, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["volume-stability", "vdt-over-600"]);
  });

  it("case 4: volume-stability false, VDT 700 -> RECOMMENDATION, matchedSufficientConditionGroupIds = [vdt-over-600]", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 700 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["vdt-over-600"]);
  });

  it("case 5: volume-stability absent, VDT 700 -> RECOMMENDATION, matchedSufficientConditionGroupIds = [vdt-over-600]", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 700 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["vdt-over-600"]);
  });

  it("case 6: volume-stability false, VDT exactly 600 (boundary, not >600) -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 600 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(s3?.recommendation).toBeUndefined();
  });

  it("case 7: volume-stability false, VDT 601 (one day over boundary) -> RECOMMENDATION, matchedSufficientConditionGroupIds = [vdt-over-600]", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 601 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["vdt-over-600"]);
  });

  // Updated per issue #15 Candidate B2 (post-#30, ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2 /
  // ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1): this input now falls inside B2's own <400 trigger as
  // well as B1's volume-stability criterion -- a genuine simultaneous definite match on two
  // independent Atomic Clinical Rules for the same source, not a case either rule's declared
  // nonBlockingUnresolvedSiblings relation ever applies to (ADR-0011: AmbiguousRuleMatchError is
  // checked first and unconditionally, before any relation is consulted). Previously (pre-B2) this
  // input produced RECOMMENDATION via volume-stability alone, since no VDT<400 rule existed yet.
  it("volume-stability true, VDT 250 (inside B2's own <400 threshold) -> AmbiguousRuleMatchError, unconditionally, unweakened by either rule's declared non-blocking relation toward the other", () => {
    const input = {
      ...followUpBaseInput,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 250,
    };
    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });

  it("the grouped rule declares provenanceAnchors, not singular provenance, with one anchor per criterion", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.recommendation && "provenanceAnchors" in s3.recommendation).toBe(true);
    expect(s3?.recommendation && "provenance" in s3.recommendation).toBe(false);
  });
});
