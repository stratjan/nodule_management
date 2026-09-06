// Release-time Atomic Clinical Rule -> Pathway Gate binding governance (issue #17, Q8 historical
// Release compatibility): UnknownClinicalPathwayIdError, UnboundAtomicRuleInMultiPathwayReleaseError,
// effective-pathway-scoped overlap validation, and the required historical single-pathway Release
// regression. Synthetic, non-clinical fixtures for the first three (mirroring
// rangeOverlap.test.ts/ruleAmbiguity.test.ts's convention); a real, already-committed historical
// Release artifact for the fourth.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import {
  buildRuleSetRelease,
  OverlappingRuleConditionsError,
  UnboundAtomicRuleInMultiPathwayReleaseError,
  UnknownClinicalPathwayIdError,
} from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema, ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, RuleRevision, RuleSetRelease } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/pathwayBindings.test.ts",
};

function syntheticGate(ruleId: string, clinicalPathwayId: string, field: string) {
  return rev({
    ruleId,
    revisionId: `${ruleId}-r1`,
    kind: "pathway-gate",
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    clinicalPathwayId,
    conditions: [{ field, op: "eq", value: "yes" }],
  });
}

function syntheticAtomicRule(
  ruleId: string,
  recommendationSourceId: string,
  field: string,
  clinicalPathwayId?: string,
) {
  return rev({
    ruleId,
    revisionId: `${ruleId}-r1`,
    kind: "atomic-clinical-rule",
    recommendationSourceId,
    ...(clinicalPathwayId ? { clinicalPathwayId } : {}),
    approvalStatus: "Approved",
    approvalEvent: { by: "test-fixture", at: "2026-01-01" },
    provenance: syntheticProvenance,
    measurementBasis: "diameter",
    diameterConditions: [{ field, op: "gte", value: 5 }],
    recommendation: {
      clinicalEndpoint: "test-only-not-a-real-recommendation",
      intervals: ["n/a"],
      rationale: "Synthetic fixture for pathway-binding governance testing only -- not real clinical content.",
    },
  });
}

describe("UnknownClinicalPathwayIdError (issue #17)", () => {
  it("rejects a bound Atomic Clinical Rule whose clinicalPathwayId matches no Pathway Gate present in the Release", () => {
    const gate = syntheticGate(
      "TEST-BINDING-GATE-SOLID",
      "incidental-solitary-solid-initial",
      "test_only_binding_gate_field",
    );
    // Valid closed-enum value, but no gate in THIS release declares this pathway.
    const rule = syntheticAtomicRule(
      "TEST-BINDING-UNKNOWN-PATHWAY",
      "test-only-binding-source",
      "test_only_binding_numeric_field",
      "incidental-solitary-pure-ggn-initial",
    );

    expect(() => buildRuleSetRelease([gate, rule])).toThrow(UnknownClinicalPathwayIdError);
  });
});

describe("UnboundAtomicRuleInMultiPathwayReleaseError (issue #17)", () => {
  it("rejects an unbound Atomic Clinical Rule once the Release has more than one Pathway Gate", () => {
    const gateA = syntheticGate(
      "TEST-BINDING-MULTI-GATE-A",
      "incidental-solitary-solid-initial",
      "test_only_multi_gate_field_a",
    );
    const gateB = syntheticGate(
      "TEST-BINDING-MULTI-GATE-B",
      "incidental-solitary-pure-ggn-initial",
      "test_only_multi_gate_field_b",
    );
    const unboundRule = syntheticAtomicRule(
      "TEST-BINDING-UNBOUND-IN-MULTI",
      "test-only-binding-source",
      "test_only_multi_numeric_field",
    );

    expect(() => buildRuleSetRelease([gateA, gateB, unboundRule])).toThrow(
      UnboundAtomicRuleInMultiPathwayReleaseError,
    );
  });

  it("does NOT reject the same unbound rule when the Release has only one Pathway Gate (historical-compatibility case)", () => {
    const gate = syntheticGate(
      "TEST-BINDING-SINGLE-GATE",
      "incidental-solitary-solid-initial",
      "test_only_single_gate_field",
    );
    const unboundRule = syntheticAtomicRule(
      "TEST-BINDING-UNBOUND-SINGLE-GATE",
      "test-only-binding-source",
      "test_only_single_numeric_field",
    );

    expect(() => buildRuleSetRelease([gate, unboundRule])).not.toThrow();
  });
});

describe("effective-pathway-scoped overlap validation (issue #17 final architecture review, P1)", () => {
  it("a legacy-unbound Atomic Clinical Rule and an explicitly-bound rule of the very same sole pathway, same source, overlapping ranges, are still rejected as overlapping", () => {
    const gate = syntheticGate(
      "TEST-EFFECTIVE-OVERLAP-GATE",
      "incidental-solitary-solid-initial",
      "test_only_effective_gate_field",
    );
    const legacyUnbound = syntheticAtomicRule(
      "TEST-EFFECTIVE-OVERLAP-UNBOUND",
      "test-only-effective-overlap-source",
      "test_only_effective_numeric_field",
      // no clinicalPathwayId -- legacy/unbound
    );
    const explicitlyBound = syntheticAtomicRule(
      "TEST-EFFECTIVE-OVERLAP-BOUND",
      "test-only-effective-overlap-source",
      "test_only_effective_numeric_field",
      "incidental-solitary-solid-initial",
    );

    expect(() => buildRuleSetRelease([gate, legacyUnbound, explicitlyBound])).toThrow(
      OverlappingRuleConditionsError,
    );
  });
});

describe("historical single-pathway Release JSON still parses and executes unchanged (issue #17, Q8 regression)", () => {
  // Real, already-committed historical Release artifact built before this slice existed: single
  // Pathway Gate (GR-1), Atomic Clinical Rules with no clinicalPathwayId at all.
  const historicalReleasePath = join(
    repoRoot,
    "clinical/rule-sets/releases/rel-2564f51cfca6012a.json",
  );
  const historicalReleaseRaw = JSON.parse(readFileSync(historicalReleasePath, "utf-8"));

  it("parses under the evolved (post-#17) ruleSetReleaseSchema with no data changes", () => {
    expect(() => ruleSetReleaseSchema.parse(historicalReleaseRaw)).not.toThrow();
    const parsed = ruleSetReleaseSchema.parse(historicalReleaseRaw) as RuleSetRelease;
    expect(
      parsed.revisions.every(
        (r) => r.kind !== "atomic-clinical-rule" || r.clinicalPathwayId === undefined,
      ),
    ).toBe(true);
  });

  it("evaluates the existing Golden Clinical Case (7mm/180mm3) identically to before this slice", () => {
    const historicalRelease = ruleSetReleaseSchema.parse(historicalReleaseRaw) as RuleSetRelease;
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      nodule_size_mm: 7,
      nodule_volume_mm3: 180,
      nodule_diameter_measurements: [
        { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      ],
      age: 55,
      known_malignancy_history: false,
      immunocompromised: false,
    };
    const trace = evaluate(input, historicalRelease);

    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-solid-initial",
    });
    expect(trace.clinicalPathwayGates).toHaveLength(1);

    const s3 = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3");
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(s3?.state).toBe("RECOMMENDATION");
    expect((s3?.recommendation as any)?.intervals).toEqual([
      "3 months",
      "6-12 months",
      "18-24 months",
    ]);
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect((fleischner?.recommendation as any)?.intervals).toEqual(["6-12 months"]);
    expect(trace.recommendationSet).toHaveLength(2);
  });

  it("evaluates the existing >8mm Golden Clinical Case (15mm) identically to before this slice", () => {
    const historicalRelease = ruleSetReleaseSchema.parse(historicalReleaseRaw) as RuleSetRelease;
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      nodule_size_mm: 15,
      nodule_diameter_measurements: [
        { valueMm: 15, conventionId: "fleischner-2017-average-diameter" },
      ],
      age: 55,
      known_malignancy_history: false,
      immunocompromised: false,
    };
    const trace = evaluate(input, historicalRelease);
    const fleischner = trace.sourceEvaluationOutcomes.find(
      (o) => o.recommendationSourceId === "fleischner",
    );
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GT8TO30MM");
    const labels = (fleischner?.recommendation as any).actions.map((a: any) => a.label);
    expect(labels).toHaveLength(3);
  });
});
