// ADR-0012 §5 / R2 (issue #16 Candidate D final spec §5.1, §13 cases 25, 52, 53): bare-`conditions`
// Atomic Clinical Rules are classified three-valued -- a supplied contradiction decides the rule
// (OUTSIDE_CURRENT_RULESET_SCOPE) even if another referenced field is missing. Historical
// neutrality: every bare-`conditions` rule in every historical Release has exactly one condition,
// for which the old binary and the new three-valued mapping coincide. Synthetic fixtures only for
// the multi-condition mechanics.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { classifyConditions, evaluateConditions } from "../../src/engine/interpreter";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { activeRuleSetPointerSchema, ruleRevisionSchema, ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, Condition, RuleRevision, RuleSetRelease } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const releasesDir = join(repoRoot, "clinical/rule-sets/releases");

function rev(raw: unknown): RuleRevision {
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const syntheticProvenance = {
  sourceDocument: "test fixture -- not a real clinical source",
  version: "n/a",
  originalLanguage: "English",
  sourceType: "Synthetic test fixture",
  locator: "test/engine/threeValuedBareConditions.test.ts",
};
const approval = { approvalStatus: "Approved", approvalEvent: { by: "test-fixture", at: "2026-01-01" } };

const syntheticRelease = buildRuleSetRelease([
  rev({
    ruleId: "TEST-R2-GATE",
    revisionId: "TEST-R2-GATE-r1",
    kind: "pathway-gate",
    ...approval,
    provenance: syntheticProvenance,
    clinicalPathwayId: "incidental-solitary-solid-initial",
    conditions: [{ field: "test_only_gate_field", op: "eq", value: "yes" }],
  }),
  rev({
    ruleId: "TEST-R2-SAR",
    revisionId: "TEST-R2-SAR-r1",
    kind: "source-applicability",
    recommendationSourceId: "test-only-r2-source",
    ...approval,
    provenance: syntheticProvenance,
    conditions: [{ field: "test_only_app_field", op: "eq", value: true }],
  }),
  rev({
    ruleId: "TEST-R2-RULE",
    revisionId: "TEST-R2-RULE-r1",
    kind: "atomic-clinical-rule",
    recommendationSourceId: "test-only-r2-source",
    clinicalPathwayId: "incidental-solitary-solid-initial",
    ...approval,
    provenance: syntheticProvenance,
    conditions: [
      { field: "test_only_x", op: "eq", value: true },
      { field: "test_only_y", op: "eq", value: true },
    ],
    recommendation: { noRoutineFollowUp: true, rationale: "Synthetic fixture -- not real clinical content." },
  }),
]);

function outcomeFor(extra: Record<string, boolean>) {
  const input = { test_only_gate_field: "yes", test_only_app_field: true, ...extra } as unknown as ClinicalInputState;
  return evaluate(input, syntheticRelease).sourceEvaluationOutcomes[0];
}

describe("R2: three-valued bare-conditions classification (case 25)", () => {
  it("one contradiction plus one missing value -> OUTSIDE_CURRENT_RULESET_SCOPE, never INSUFFICIENT_INPUT", () => {
    for (const extra of [{ test_only_x: false }, { test_only_y: false }] as Record<string, boolean>[]) {
      const outcome = outcomeFor(extra);
      expect(outcome.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
      expect(outcome.unresolvedRequiredInputs).toBeUndefined();
    }
  });

  it("no contradiction with a missing value -> INSUFFICIENT_INPUT naming only the missing field; both satisfied -> RECOMMENDATION", () => {
    const pending = outcomeFor({ test_only_x: true });
    expect(pending.state).toBe("INSUFFICIENT_INPUT");
    expect(pending.unresolvedRequiredInputs).toEqual([{ kind: "field", field: "test_only_y" }]);
    expect(outcomeFor({ test_only_x: true, test_only_y: true }).state).toBe("RECOMMENDATION");
    expect(outcomeFor({ test_only_x: true, test_only_y: false }).state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("Source Applicability Rules stay binary: a missing applicability field is INSUFFICIENT_INPUT even next to a contradiction elsewhere", () => {
    const input = { test_only_gate_field: "yes", test_only_x: false } as unknown as ClinicalInputState;
    expect(evaluate(input, syntheticRelease).sourceEvaluationOutcomes[0].state).toBe("INSUFFICIENT_INPUT");
  });
});

const activeId = activeRuleSetPointerSchema.parse(
  JSON.parse(readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8")),
).activeReleaseId;
const historicalReleases: RuleSetRelease[] = readdirSync(releasesDir)
  .filter((name) => name.endsWith(".json") && name !== `${activeId}.json`)
  .map((name) => ruleSetReleaseSchema.parse(JSON.parse(readFileSync(join(releasesDir, name), "utf-8"))) as RuleSetRelease);

function historicalBareConditionRules() {
  return historicalReleases.flatMap((release) =>
    release.revisions.flatMap((r) =>
      r.kind === "atomic-clinical-rule" && r.measurementBasis === undefined && r.conditions !== undefined
        ? [{ releaseId: release.releaseId, rule: r }]
        : [],
    ),
  );
}

describe("R2 historical neutrality (cases 52-53)", () => {
  it("case 52: every bare-conditions Atomic Clinical Rule in every historical Release (all 13) has exactly one condition", () => {
    expect(historicalReleases).toHaveLength(13);
    const rules = historicalBareConditionRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const { releaseId, rule } of rules) {
      expect(rule.conditions, `${releaseId} ${rule.revisionId}`).toHaveLength(1);
    }
  });

  function satisfying(c: Condition): string | number | boolean {
    switch (c.op) {
      case "eq":
        return c.value;
      case "gte":
      case "lte":
        return c.value;
      case "gt":
        return (c.value as number) + 1;
      case "lt":
        return (c.value as number) - 1;
    }
  }
  function contradicting(c: Condition): string | number | boolean {
    switch (c.op) {
      case "eq":
        return typeof c.value === "boolean" ? !c.value : typeof c.value === "number" ? c.value + 1 : `${c.value}-other`;
      case "gte":
        return (c.value as number) - 1;
      case "gt":
        return c.value;
      case "lt":
        return c.value;
      case "lte":
        return (c.value as number) + 1;
    }
  }
  const binaryState = (conditions: Condition[], input: ClinicalInputState) => {
    const r = evaluateConditions(conditions, input);
    return !r.allFieldsPresent ? "INSUFFICIENT_INPUT" : r.matched ? "RECOMMENDATION" : "OUTSIDE_CURRENT_RULESET_SCOPE";
  };
  const threeValuedState = (conditions: Condition[], input: ClinicalInputState) => {
    const r = classifyConditions(conditions, input);
    return r.state === "INDETERMINATE" ? "INSUFFICIENT_INPUT" : r.state === "MATCHED" ? "RECOMMENDATION" : "OUTSIDE_CURRENT_RULESET_SCOPE";
  };

  it("case 53: for every historical single-condition rule and values {absent, satisfying, contradicting}, the old binary and new three-valued mappings give identical outcome states and missing fields", () => {
    for (const { rule } of historicalBareConditionRules()) {
      const [condition] = rule.conditions!;
      for (const input of [
        {},
        { [condition.field]: satisfying(condition) },
        { [condition.field]: contradicting(condition) },
      ] as unknown as ClinicalInputState[]) {
        expect(threeValuedState(rule.conditions!, input), rule.revisionId).toBe(binaryState(rule.conditions!, input));
        expect(classifyConditions(rule.conditions!, input).missingFields).toEqual(
          evaluateConditions(rule.conditions!, input).missingFields,
        );
      }
    }
  });
});
