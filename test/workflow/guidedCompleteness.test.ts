// ADR-0012 §6 (issue #16 Candidate D final spec §7.3, §9, §13 cases 45, 46, 60; readiness
// 6614358295 P3-5): guided completeness is read from structured Decision Execution Trace data
// only, over real traces from the assembled Release. The exhaustive GR-8 sweep (case 46) is the
// executable form of ADR-0012 §6's obligation for this pathway.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AmbiguousClinicalDispositionMatchError, evaluate } from "../../src/engine/evaluate";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { ClinicalInputState, DecisionExecutionTrace, RuleRevision } from "../../src/engine/types";
import { guidedCompleteness, unresolvedFieldIds } from "../../src/workflow/guidedCompleteness";
import { applyGr4FollowUpReset, applyNoduleCountBranchReset } from "../../src/workflow/pathwayNavigation";
import { loadApprovedPhase1Revisions, loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const release = loadTestRelease();

const OR = "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed";
const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const OM = "clinician_decides_no_further_routine_nodule_surveillance";
const RK = "fleischner_multiple_solid_risk_category";

const D: ClinicalInputState = { assessment_context: "incidental", assessment_timepoint: "follow-up", [OR]: true };
const applicability = { age: 60, known_malignancy_history: false, immunocompromised: false };

describe("guidedCompleteness over real traces (case 45)", () => {
  it("a terminal disposition, a Fleischner RECOMMENDATION, NOT_APPLICABLE or OUTSIDE_CURRENT_RULESET_SCOPE -> complete", () => {
    for (const input of [
      { ...D, [SG]: true, [OM]: true },
      { ...D, ...applicability, [SG]: true, [OM]: false, [RK]: "low" },
      { ...D, ...applicability, [SG]: true, [OM]: false, [RK]: "high" },
      { ...D, ...applicability, age: 30, [SG]: true, [OM]: false },
      { ...D, ...applicability, [SG]: false },
    ] satisfies ClinicalInputState[]) {
      expect(guidedCompleteness(evaluate(input, release))).toEqual({ state: "complete" });
    }
  });

  it("disposition-stage INSUFFICIENT_INPUT -> incomplete with its structured items", () => {
    expect(guidedCompleteness(evaluate(D, release))).toEqual({
      state: "incomplete",
      unresolved: [
        { kind: "field", field: SG },
        { kind: "field", field: OM },
      ],
    });
  });

  it("a Source Evaluation Outcome INSUFFICIENT_INPUT -> incomplete with the outcome's structured items", () => {
    expect(guidedCompleteness(evaluate({ ...D, ...applicability, [SG]: true, [OM]: false }, release))).toEqual({
      state: "incomplete",
      unresolved: [{ kind: "field", field: RK }],
    });
    expect(guidedCompleteness(evaluate({ ...D, [SG]: false }, release))).toEqual({
      state: "incomplete",
      unresolved: [
        { kind: "field", field: "age" },
        { kind: "field", field: "known_malignancy_history" },
        { kind: "field", field: "immunocompromised" },
      ],
    });
  });

  it("pathway INSUFFICIENT_INPUT -> incomplete from the INDETERMINATE gates' missingFields (deduplicated); NO_PATHWAY_MATCHED -> unclassified", () => {
    const pending = evaluate({ assessment_context: "incidental", assessment_timepoint: "follow-up", nodule_count: 3 }, release);
    expect(guidedCompleteness(pending)).toEqual({ state: "incomplete", unresolved: [{ kind: "field", field: OR }] });
    const none = evaluate({ assessment_context: "incidental", assessment_timepoint: "follow-up", nodule_count: 3, [OR]: false }, release);
    expect(guidedCompleteness(none)).toEqual({ state: "unclassified" });
  });

  it("an INSUFFICIENT_INPUT outcome lacking structured data stays incomplete, never complete (engine-defect guard)", () => {
    const trace = evaluate({ ...D, ...applicability, [SG]: true, [OM]: false }, release);
    const stripped: DecisionExecutionTrace = {
      ...trace,
      sourceEvaluationOutcomes: trace.sourceEvaluationOutcomes.map(({ unresolvedRequiredInputs: _u, ...outcome }) => outcome),
    };
    expect(guidedCompleteness(stripped)).toEqual({ state: "incomplete", unresolved: [] });
  });

  it("unresolvedFieldIds names plain fields and any-of fields, never measurement-convention items", () => {
    expect(
      unresolvedFieldIds([
        { kind: "field", field: "age" },
        { kind: "any-of-fields", fields: ["nodule_size_mm", "nodule_volume_mm3"] },
        { kind: "convention-bound-measurement", container: "nodule_diameter_measurements", conventionId: "fleischner-2017-average-diameter", problem: "missing" },
        { kind: "field", field: "age" },
      ]),
    ).toEqual(["age", "nodule_size_mm", "nodule_volume_mm3"]);
  });
});

/** Mirrors App.tsx handleChange: every edit goes through the two reset functions. */
function edit(state: ClinicalInputState, id: string, value: string | number | boolean | undefined): ClinicalInputState {
  const next = { ...state, [id]: value } as ClinicalInputState;
  if (value === undefined) delete (next as Record<string, unknown>)[id];
  return applyNoduleCountBranchReset(applyGr4FollowUpReset(next, id, value), id, value, state);
}

/** The GR-8 step-2 questions App.tsx renders for a state (final spec §7.4 progressive disclosure). */
function renderedQuestions(state: ClinicalInputState): string[] {
  return [
    SG,
    ...(state[SG] === true ? [OM] : []),
    ...(state[SG] === true && state[OM] === false ? [RK] : []),
    "age",
    "known_malignancy_history",
    "immunocompromised",
  ];
}

describe("exhaustive GR-8 sweep over UI-reachable answers (case 46)", () => {
  it("(a) every rendered question answered definitely => complete, terminal never INSUFFICIENT_INPUT; (b) incomplete => some reported field is rendered and unanswered; (c) the disposition path needs no applicability answer", () => {
    const tri = [undefined, true, false] as const;
    let combinations = 0;
    let completeCount = 0;
    for (const sg of tri)
      for (const om of tri)
        for (const rk of [undefined, "low", "high"] as const)
          for (const age of [undefined, 30, 60])
            for (const malignancy of tri)
              for (const immuno of tri) {
                let state = D;
                for (const [id, value] of [
                  ["age", age],
                  ["known_malignancy_history", malignancy],
                  ["immunocompromised", immuno],
                  [SG, sg],
                  [OM, om],
                  [RK, rk],
                ] as const) {
                  if (value !== undefined) state = edit(state, id, value);
                }
                const trace = evaluate(state, release);
                const completeness = guidedCompleteness(trace);
                const rendered = renderedQuestions(state);
                const unanswered = rendered.filter((id) => state[id as keyof ClinicalInputState] === undefined);

                if (unanswered.length === 0) {
                  expect(completeness).toEqual({ state: "complete" });
                  const disposition = trace.clinicalDispositionEvaluation;
                  expect(disposition?.state === "DISPOSITION" || trace.sourceEvaluationOutcomes.length === 1).toBe(true);
                  for (const outcome of trace.sourceEvaluationOutcomes) {
                    expect(outcome.state).not.toBe("INSUFFICIENT_INPUT");
                  }
                }
                if (completeness.state === "incomplete") {
                  const reported = unresolvedFieldIds(completeness.unresolved);
                  expect(reported.some((id) => unanswered.includes(id))).toBe(true);
                }
                expect(completeness.state).not.toBe("unclassified");
                if (state[SG] === true && state[OM] === true) {
                  expect(completeness).toEqual({ state: "complete" });
                  expect(trace.clinicalDispositionEvaluation?.state).toBe("DISPOSITION");
                }
                if (completeness.state === "complete") completeCount++;
                combinations++;
              }
    expect(combinations).toBe(3 * 3 * 3 * 3 * 3 * 3);
    expect(completeCount).toBeGreaterThan(0);
  });
});

describe("dry-run authoring defects propagate; they are never incompleteness (readiness P3-5)", () => {
  const syntheticDisposition = (suffix: string) =>
    ruleRevisionSchema.parse(
      JSON.parse(readFileSync(join(repoRoot, `test/fixtures/synthetic-disposition-${suffix}.json`), "utf-8")),
    ) as RuleRevision;
  const ambiguousRelease = buildRuleSetRelease([
    ...loadApprovedPhase1Revisions(),
    syntheticDisposition("a"),
    syntheticDisposition("b"),
  ]);

  it("the App.tsx dry-run expression (evaluate, then guidedCompleteness) throws the typed error instead of returning a completeness value", () => {
    const input = { ...D, test_only_disposition_flag: true } as unknown as ClinicalInputState;
    expect(() => guidedCompleteness(evaluate(input, ambiguousRelease))).toThrow(AmbiguousClinicalDispositionMatchError);
  });

  it("neither guidedCompleteness.ts nor the App.tsx dry run catches anything", () => {
    const moduleSource = readFileSync(join(repoRoot, "src/workflow/guidedCompleteness.ts"), "utf-8");
    expect(moduleSource).not.toMatch(/\btry\s*\{|\bcatch\s*[({]/);
    const app = readFileSync(join(repoRoot, "src/ui/App.tsx"), "utf-8").replace(/\r\n/g, "\n");
    const dryRun = app.slice(app.indexOf("const dryRunTrace = useMemo("), app.indexOf("const canEvaluate ="));
    expect(dryRun.length).toBeGreaterThan(0);
    expect(dryRun).not.toMatch(/\btry\s*\{|\bcatch\s*[({]/);
  });
});

describe("no reason parsing (case 60)", () => {
  it("guidedCompleteness.ts and the GR-8 parts of App.tsx never read .reason", () => {
    const moduleSource = readFileSync(join(repoRoot, "src/workflow/guidedCompleteness.ts"), "utf-8");
    expect(moduleSource).not.toMatch(/\.reason\b|\["reason"\]/);
    const app = readFileSync(join(repoRoot, "src/ui/App.tsx"), "utf-8").replace(/\r\n/g, "\n");
    const gr8Logic = app.slice(app.indexOf("const gr8Shape ="), app.indexOf("const handleConfirmPathway"));
    const gr8Block = app.slice(app.indexOf("{gr8Shape && ("), app.indexOf("{showFollowUpCriterionInput && ("));
    for (const part of [gr8Logic, gr8Block]) {
      expect(part.length).toBeGreaterThan(0);
      expect(part).not.toMatch(/\.reason\b/);
    }
  });
});
