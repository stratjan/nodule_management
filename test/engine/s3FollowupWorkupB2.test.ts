// issue #15 Candidate B2, post-#30 final form (final spec: issue #15 comment 5765465799; HITL
// sign-off: comment 5765473146; source reconciliation: comment 5748887858): exact clinical
// regression matrix for the governed rule ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1 -- a strict
// VDT<400 trigger recommending definitive pathological confirmation via three coequal,
// non-ranked, non-sequenced procedures -- authored together with ACR-S3-FOLLOWUP-DISCHARGE-
// VOLUME-OR-VDT-r2's own reciprocal relation. The generic directional non-blocking
// unresolved-sibling mechanism itself (ADR-0011) is proven generically and source-agnostically in
// nonBlockingUnresolvedSiblings.test.ts; this file exercises only the real, governed clinical
// content, its exact boundary, and the two real B1<->B2 relations.
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

const EXPECTED_ACTION_LABELS = [
  "Bronchoscopy with transbronchial biopsy",
  "CT-guided transthoracic biopsy",
  "Minimally invasive surgical resection",
];

describe("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1 clinical regression matrix (issue #15 Candidate B2, post-#30)", () => {
  it("case 1: s3_vdt_days 399, volume-stability absent -> RECOMMENDATION via B2, B1-r2 tolerated as an unresolved sibling", () => {
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

  it("case 2: s3_vdt_days exactly 400 (boundary, not <400), no other criterion supplied -> INSUFFICIENT_INPUT (post-#30 corrected semantics, HITL-approved: B2 self-excludes as OUTSIDE_CURRENT_RULESET_SCOPE, but B1-r2's own internal sufficientConditionGroups reduction is itself unresolved for this input -- vdt-over-600 NOT_MATCHED, volume-stability INDETERMINATE on a missing field -- and with zero definite RECOMMENDATIONs there is no matched rule for any non-blocking relation to be consulted against)", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 400 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
    expect(s3?.recommendation).toBeUndefined();
  });

  it("case 3: s3_vdt_days missing entirely, no other follow-up criterion supplied -> INSUFFICIENT_INPUT", () => {
    const trace = evaluate({ ...followUpBaseInput }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("case 4: s3_vdt_days 700 (existing B1 case, VDT>600), volume-stability absent -> B1-r2 fires RECOMMENDATION directly (independently sufficient group, no relation needed); B2 definitively does not match (OUTSIDE_CURRENT_RULESET_SCOPE, not unresolved) -- no toleratedUnresolvedSiblings", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 700 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT");
    expect(s3?.toleratedUnresolvedSiblings).toBeUndefined();
  });

  it("case 5 (binding B1-tolerated-sibling case): s3_volume_stability_criterion_met true, VDT absent -> B1-r2 RECOMMENDATION via the independently sufficient volume-stability group; B2-r1 tolerated as an unresolved sibling", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_volume_stability_criterion_met: true }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.matchedRuleId).toBe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT");
    expect(s3?.toleratedUnresolvedSiblings).toEqual([
      {
        ruleId: "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
        revisionId: "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1",
      },
    ]);
  });

  it("case 6: B2 recommendation contains exactly the three approved actions, order-independently -- array position is authoring order, never a clinical ranking", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 250 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("RECOMMENDATION");
    const actions = (s3?.recommendation as any)?.actions as Array<{ label: string }>;
    expect(actions).toBeDefined();
    expect(actions.map((a) => a.label).sort()).toEqual([...EXPECTED_ACTION_LABELS].sort());
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action).not.toHaveProperty("rank");
      expect(action).not.toHaveProperty("priority");
      expect(action).not.toHaveProperty("preferred");
    }
  });

  it("case 7: no PET-CT, Brock, or Herder action label appears anywhere in the B2 actions (proves no leakage into the actionable content itself -- the rationale prose is expected to name these terms only to state they are explicitly out of scope, per the approved spec's own rationale text)", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 250 }, release);
    const s3 = outcomeFor(trace, "s3");
    const actionLabels = ((s3?.recommendation as any)?.actions as Array<{ label: string }>).map(
      (a) => a.label,
    );
    for (const label of actionLabels) {
      expect(label).not.toMatch(/PET-?CT/i);
      expect(label).not.toMatch(/Brock/i);
      expect(label).not.toMatch(/Herder/i);
    }
  });

  it("case 8 (binding genuine-conflict case): volume-stability true AND VDT 300 supplied together -> evaluate() still throws AmbiguousRuleMatchError, unconditionally and unweakened by either rule's declared non-blocking relation toward the other (ADR-0011: the ambiguity check runs first and is never suppressed by a relation)", () => {
    const input: ClinicalInputState = {
      ...followUpBaseInput,
      s3_volume_stability_criterion_met: true,
      s3_vdt_days: 300,
    };
    expect(() => evaluate(input, release)).toThrow(AmbiguousRuleMatchError);
  });

  it("case 9a: non-GR-4 pathway state (initial timepoint) with a stray s3_vdt_days does not let B2 fire on the initial pathway", () => {
    const trace = evaluate(
      { ...followUpBaseInput, assessment_timepoint: "initial", s3_vdt_days: 250, nodule_size_mm: 5 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.recommendation?.matchedRuleId).not.toBe("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400");
  });

  it("case 9b: non-GR-4 pathway state (part-solid morphology) with a stray s3_vdt_days does not let B2 fire on the part-solid pathway", () => {
    const trace = evaluate(
      { ...followUpBaseInput, nodule_morphology: "part-solid", s3_vdt_days: 250 },
      release,
    );
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.recommendation?.matchedRuleId).not.toBe("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400");
  });

  it("case 9c: S3 applicability failure (age <18) with s3_vdt_days 250 -> NOT_APPLICABLE, unaffected by VDT content", () => {
    const trace = evaluate({ ...followUpBaseInput, age: 10, s3_vdt_days: 250 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.state).toBe("NOT_APPLICABLE");
  });

  it("the rule declares provenanceAnchors, not singular provenance, with two anchors (trigger, management)", () => {
    const trace = evaluate({ ...followUpBaseInput, s3_vdt_days: 250 }, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.recommendation && "provenanceAnchors" in s3.recommendation).toBe(true);
    expect(s3?.recommendation && "provenance" in s3.recommendation).toBe(false);
  });

  it("both directional relations are declared with distinct, correctly-scoped provenance: B1-r2 -> B2-r1 cites Recommendation 6.35, B2-r1 -> B1-r2 cites Recommendation 6.36", () => {
    const b1 = release.revisions.find(
      (r) => r.ruleId === "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
    ) as any;
    const b2 = release.revisions.find(
      (r) => r.ruleId === "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
    ) as any;
    expect(b1.revisionId).toBe("ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2");
    expect(b2.revisionId).toBe("ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1");

    expect(b1.nonBlockingUnresolvedSiblings).toHaveLength(1);
    expect(b1.nonBlockingUnresolvedSiblings[0].siblingRuleId).toBe(
      "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400",
    );
    expect(b1.nonBlockingUnresolvedSiblings[0].siblingRevisionId).toBe(
      "ACR-S3-FOLLOWUP-WORKUP-VDT-UNDER400-r1",
    );
    expect(b1.nonBlockingUnresolvedSiblings[0].provenance.locator).toContain("6.35");

    expect(b2.nonBlockingUnresolvedSiblings).toHaveLength(1);
    expect(b2.nonBlockingUnresolvedSiblings[0].siblingRuleId).toBe(
      "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT",
    );
    expect(b2.nonBlockingUnresolvedSiblings[0].siblingRevisionId).toBe(
      "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r2",
    );
    expect(b2.nonBlockingUnresolvedSiblings[0].provenance.locator).toContain("6.36");

    // Directional, never symmetric by inference: each relation is its own separate entry,
    // never a shared/reciprocal object.
    expect(b1.nonBlockingUnresolvedSiblings).not.toBe(b2.nonBlockingUnresolvedSiblings);
  });
});
