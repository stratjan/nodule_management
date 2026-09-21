// issue #15 Candidate B1 (architecture: issue #28; revision bumped to -r2 by issue #15 Candidate
// B2/#30, ADR-0011; revision bumped again to -r3 by issue #15 Candidate C -- see the case-by-case
// note below): exact clinical regression matrix for the governed successor rule
// ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r3 -- three independently sufficient S3 discharge
// criteria (volume-stability, VDT>600, general-condition) inside one sufficientConditionGroups
// -shaped Atomic Clinical Rule. -r2's own first two groups, their conditions, and their
// provenance-role bindings are byte-for-byte unchanged in -r3; only the third `general-condition`
// group, its provenance anchor, the B1->B2 relation's sibling target/locator, and the recommendation
// rationale were added/changed. The generic reduction mechanism itself is proven separately and
// source-agnostically in sufficientConditionGroups.test.ts; this file exercises only the real,
// governed clinical content and its exact boundary.
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

describe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r3 clinical regression matrix (issue #15 Candidate B1)", () => {
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

  // issue #15 Candidate C: with the third general-condition group now governed, this input --
  // previously a fully-determined non-match on the first two groups -- now leaves the third group
  // INDETERMINATE (general-condition unsupplied), which outranks the other two groups' definite
  // NOT_MATCHED per the existing Kleene-OR reduction. Correctly INSUFFICIENT_INPUT now, not
  // OUTSIDE_CURRENT_RULESET_SCOPE. See case 6b below for the fully-determined three-criteria case.
  it("case 6: volume-stability false, VDT exactly 600 (boundary, not >600), general-condition not supplied -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 600 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("case 6b: all three criteria explicitly false, VDT exactly 600 (boundary, not >600) -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate(
      {
        ...followUpBaseInput,
        s3_volume_stability_criterion_met: false,
        s3_vdt_days: 600,
        s3_general_condition_precludes_further_workup_or_therapy: false,
      },
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

  // Updated per issue #15 Candidate B2 (post-#30, ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r3 /
  // ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r2 as of Candidate C): this input now falls inside B2's own
  // <400 trigger as well as B1's volume-stability criterion -- a genuine simultaneous definite
  // match on two independent Atomic Clinical Rules for the same source, not a case either rule's
  // declared nonBlockingUnresolvedSiblings relation ever applies to (ADR-0011: AmbiguousRuleMatchError
  // is checked first and unconditionally, before any relation is consulted). Previously (pre-B2) this
  // input produced RECOMMENDATION via volume-stability alone, since no VDT<400 rule existed yet.
  it("volume-stability true, VDT 250 (inside B2's own <400 threshold) -> AmbiguousRuleMatchError, unconditionally, unweakened by either rule's declared non-blocking relation toward the other", () => {
    const input = {
      ...followUpBaseInput,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 250,
    };
    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });

  // issue #15 Candidate C: the third, independently sufficient general-condition group.
  it("case 8: general-condition true, stability/VDT absent -> RECOMMENDATION via the general-condition group alone, B2-r2 tolerated as an unresolved sibling", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_general_condition_precludes_further_workup_or_therapy: true },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual(["general-condition"]);
    expect(s3?.toleratedUnresolvedSiblings).toEqual([
      {
        ruleId: "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
        revisionId: "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r2",
      },
    ]);
  });

  it("case 9: all three B1 criteria explicitly non-matching (general-condition false, stability false, VDT 500) -> OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate(
      {
        ...followUpBaseInput,
        s3_general_condition_precludes_further_workup_or_therapy: false,
        s3_volume_stability_criterion_met: false,
        s3_vdt_days: 500,
      },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(s3?.recommendation).toBeUndefined();
  });

  it("case 10: general-condition absent, stability false, VDT 500 -> INSUFFICIENT_INPUT (the general-condition group is INDETERMINATE on a missing field, which outranks the other two groups' definite NOT_MATCHED, exactly as the existing two-group reduction already behaved)", () => {
    const trace = evaluate(
      { ...followUpBaseInput, s3_volume_stability_criterion_met: false, s3_vdt_days: 500 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("case 11: all three B1 groups match (stability true, VDT 700, general-condition true) -> one B1 RECOMMENDATION, no ambiguity, all three matched group IDs in authored order; B2 is a definite non-match (700 is not <400), not an unresolved sibling", () => {
    const trace = evaluate(
      {
        ...followUpBaseInput,
        s3_volume_stability_criterion_met: true,
        s3_vdt_days: 700,
        s3_general_condition_precludes_further_workup_or_therapy: true,
      },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedSufficientConditionGroupIds).toEqual([
      "volume-stability",
      "vdt-over-600",
      "general-condition",
    ]);
    expect(s3?.toleratedUnresolvedSiblings).toBeUndefined();
  });

  it("case 12 (new B1/B2 conflict, issue #15 Candidate C): general-condition true AND VDT 300 together -> AmbiguousRuleMatchError, unconditionally; no precedence between discharge and pathological clarification is invented", () => {
    const input = {
      ...followUpBaseInput,
      s3_general_condition_precludes_further_workup_or_therapy: true,
      s3_vdt_days: 300,
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
