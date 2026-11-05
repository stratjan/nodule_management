// issue #16 Candidate D (final spec 6411027075 §7, §13 cases 49-51b): clinician-facing wording,
// Step-1 order, the GR-8 Step-2 progressive disclosure, the dry-run-gated Evaluate, and the
// Results-page disposition panel. Same seam as candidateB/CRendering.test.ts -- renderToStaticMarkup
// plus App.tsx source checks -- with real Decision Execution Traces from the assembled Release.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import type { ClinicalInputState } from "../../src/engine/types";
import { ClinicalDispositionView } from "../../src/ui/ClinicalDispositionView";
import { RecommendationView } from "../../src/ui/RecommendationView";
import {
  CLINICAL_DISPOSITION_HEADINGS,
  CLINICIAN_DISPOSITION_HELP_TEXT,
  clinicianDispositionFields,
  FIRST_FOLLOW_UP_ORIGIN_HELP_TEXT,
  firstFollowUpOriginField,
  FLEISCHNER_MULTIPLE_SOLID_FOLLOW_UP_SAFEGUARD_HELP_TEXT,
} from "../../src/workflow/fields";
import { guidedCompleteness, unresolvedFieldIds } from "../../src/workflow/guidedCompleteness";
import { gr8RenderedFields, showsSolitarySafeguardNotConfirmedNotice } from "../../src/workflow/pathwayNavigation";
import { loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../../src/ui/App.tsx"), "utf-8").replace(/\r\n/g, "\n");
const flat = appSource.replace(/\s+/g, " ");
const release = loadTestRelease();

const OR = "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed";
const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const OM = "clinician_decides_no_further_routine_nodule_surveillance";
const RK = "fleischner_multiple_solid_risk_category";
const D: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "follow-up",
  [OR]: true,
  age: 60,
  known_malignancy_history: false,
  immunocompromised: false,
};

/** The GR-8 step-2 block: from its shape guard up to the GR-4 S3 criterion block that follows it. */
function gr8Block(): string {
  const start = flat.indexOf("{gr8Shape && (");
  const end = flat.indexOf("{showFollowUpCriterionInput && (");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return flat.slice(start, end);
}

describe("#16 Candidate D rendering", () => {
  it("case 49: every new label, help text, heading and notice equals the approved text verbatim", () => {
    expect(firstFollowUpOriginField).toEqual({
      id: OR,
      label:
        "First follow-up after an initial Fleischner multiple solid nodule assessment with at least one nodule ≥6 mm, for which CT at 3–6 months was intended (Yes / No)",
      type: "boolean",
    });
    expect(FIRST_FOLLOW_UP_ORIGIN_HELP_TEXT).toBe(
      "Answer about how this episode started. \"Yes\" does not state that the nodules are still multiple, solid, 6 mm or larger, stable, or persistent at this examination.",
    );
    expect(clinicianDispositionFields).toEqual([
      {
        id: OM,
        label:
          "Clinician-directed decision: based on the current interval imaging findings and overall clinical context, I decide that no further routine pulmonary nodule surveillance is planned (Yes = no further routine surveillance planned; No = continue to the Fleischner 18–24-month guidance)",
        type: "boolean",
      },
    ]);
    expect(CLINICIAN_DISPOSITION_HELP_TEXT).toBe(
      "Examples of interval findings that may inform this decision include clear regression or radiographic resolution of the nodules. These are examples only: they are not criteria or thresholds, they are not Fleischner stop rules, the app calculates no change, and your decision is not limited to them.",
    );
    expect(FLEISCHNER_MULTIPLE_SOLID_FOLLOW_UP_SAFEGUARD_HELP_TEXT).toBe(
      "At follow-up, examples of what may make an individual nodule more suspicious include interval growth or new or changed suspicious features. These are examples only, not criteria; this app does not identify any such nodule, list alternative management, or redirect to another pathway.",
    );
    expect(CLINICAL_DISPOSITION_HEADINGS).toEqual({
      "clinician-directed-no-further-routine-surveillance":
        "Clinician-directed disposition: No further routine nodule surveillance planned.",
    });
    expect(appSource).toContain(
      "\"Follow-up assessment of multiple nodules is covered by this Rule-Set Release only as the first follow-up after an initial Fleischner multiple solid nodule assessment with at least one nodule ≥6 mm.\"",
    );
  });

  it("Step 1 order: context and timepoint first, then the origin (incidental follow-up only), then the count unless the GR-8 shape holds; no count or branch fields on GR-8", () => {
    const step1 = flat.slice(flat.indexOf('aria-label="Pathway identification"'), flat.indexOf('aria-label="Clinical details"'));
    const order = [
      "...commonPathwayFields,",
      "...(requiresFirstFollowUpOriginAnswer(input) ? [firstFollowUpOriginField] : []),",
      "...(gr8Shape ? [] : [noduleCountField]),",
      "...(gr8Shape ? [] : input.nodule_count === 1 ? solitaryPathwayFields",
    ].map((marker) => step1.indexOf(marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(step1).toContain("{requiresFirstFollowUpOriginAnswer(input) && <p>{FIRST_FOLLOW_UP_ORIGIN_HELP_TEXT}</p>}");
  });

  it("case 50: the GR-8 block renders the approved elements in order with progressive disclosure; canEvaluate uses guidedCompleteness on GR-8; still seven useState", () => {
    const block = gr8Block();
    const markers = [
      "This is the first follow-up after an initial Fleischner multiple solid nodule assessment with at least one nodule 6 mm or larger.",
      "<p>{FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT}</p>",
      "<p>{FLEISCHNER_MULTIPLE_SOLID_FOLLOW_UP_SAFEGUARD_HELP_TEXT}</p>",
      '<p className="notice">{FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE}</p>',
      "multipleSolidGte6mmSafeguardFields.map(",
      `{input.${SG} === false && (`,
      "{FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE}",
      "{showsGr8ClinicianDisposition(input) && (",
      "<p>{CLINICIAN_DISPOSITION_HELP_TEXT}</p>",
      "clinicianDispositionFields.map(",
      "{showsGr8FleischnerRisk(input) && (",
      "Low risk: CT at 18–24 months from baseline CT may be considered. High risk: CT at 18–24 months from baseline CT is recommended.",
      "<FleischnerRiskDecisionSupport />",
      "multipleSolidFleischnerRiskFields.map(",
    ].map((marker) => block.indexOf(marker));
    expect(markers.every((index) => index > -1)).toBe(true);
    expect([...markers].sort((a, b) => a - b)).toEqual(markers);
    // risk is rendered exactly once and only inside the safeguard-true + omission-false branch
    expect(block.split("multipleSolidFleischnerRiskFields.map(")).toHaveLength(2);
    expect(block.indexOf("multipleSolidFleischnerRiskFields.map(")).toBeGreaterThan(
      block.indexOf("{showsGr8FleischnerRisk(input) && ("),
    );
    expect(block).not.toMatch(/useState/);

    const canEvaluate = flat.slice(flat.indexOf("const canEvaluate ="), flat.indexOf(";", flat.indexOf("const canEvaluate =")));
    expect(canEvaluate).toContain('gr8Shape ? dryRunCompleteness?.state === "complete"');
    expect(canEvaluate).toContain("multipleSolidGte6mmShape");
    expect(flat).toContain("const dryRunCompleteness = dryRunTrace ? guidedCompleteness(dryRunTrace) : null;");
    expect(flat).toContain("gr8Shape ? evaluate(buildEvaluationInput(), activeRelease) : null");
    expect(flat).toContain("const result = evaluate(buildEvaluationInput(), activeRelease);");
    expect(appSource.match(/\buseState[<(]/g)).toHaveLength(7);
    expect(flat).toContain("Answer the remaining required question(s) to evaluate:");
  });

  it("case 51: ClinicalDispositionView renders the heading, statement, rationale and provenance -- never a source outcome, Fleischner label, or no-routine-follow-up text", () => {
    const trace = evaluate({ ...D, [SG]: true, [OM]: true }, release);
    const disposition = trace.clinicalDispositionEvaluation!.disposition!;
    const html = renderToStaticMarkup(createElement(ClinicalDispositionView, { disposition }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
    expect(text).toContain("Clinician-directed disposition: No further routine nodule surveillance planned.");
    expect(text).toContain(disposition.statement);
    expect(text).toContain(disposition.rationale);
    expect(text).toContain(`Provenance: ${disposition.provenance.sourceDocument}`);
    for (const forbidden of ["Recommendation available", "Fleischner Society", "No routine follow-up", "British Thoracic Society", "Not in this Rule-Set Release"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("the Results page shows the disposition panel instead of the outcome list and the BTS line, under a neutral heading", () => {
    const results = flat.slice(flat.indexOf('{step === "results" && trace && ('));
    expect(results).toContain('trace.clinicalDispositionEvaluation?.state === "DISPOSITION" ? "3. Result" : "3. Source Evaluation Outcomes"');
    expect(results).toContain("<ClinicalDispositionView disposition={trace.clinicalDispositionEvaluation.disposition} />");
    const listGuard = results.indexOf('trace.clinicalDispositionEvaluation.state === "NONE_MATCHED")');
    expect(listGuard).toBeGreaterThan(-1);
    expect(listGuard).toBeLessThan(results.indexOf("British Thoracic Society (BTS)"));
    expect(listGuard).toBeLessThan(results.indexOf("trace.sourceEvaluationOutcomes.map("));
    expect(results).toContain("The clinician-directed disposition question is unresolved. No guideline was evaluated.");
  });

  it("case 51b: RecommendationView renders low risk as optional 'may be considered' and high risk without the optional qualifier, both at 18-24 months from baseline CT", () => {
    const render = (risk: "low" | "high") => {
      const trace = evaluate({ ...D, [SG]: true, [OM]: false, [RK]: risk }, release);
      return renderToStaticMarkup(createElement(RecommendationView, { recommendation: trace.recommendationSet[0] }));
    };
    const low = render("low");
    const high = render("high");
    expect(low).toContain("clinical-action-optional");
    expect(low).toContain("may be considered");
    expect(high).not.toContain("clinical-action-optional");
    expect(high).not.toContain("may be considered");
    for (const html of [low, high]) expect(html).toContain("18-24 months from baseline CT");
  });

  it("HITL Q6: the not-confirmed safeguard notice appears on GR-8 exactly when the safeguard is false and Fleischner is OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const notConfirmed = evaluate({ ...D, [SG]: false }, release);
    expect(showsSolitarySafeguardNotConfirmedNotice(notConfirmed, notConfirmed.sourceEvaluationOutcomes[0])).toBe(true);
    for (const input of [
      { ...D, [SG]: true, [OM]: false, [RK]: "high" },
      { ...D, [SG]: false, age: 30 },
    ] satisfies ClinicalInputState[]) {
      const trace = evaluate(input, release);
      for (const outcome of trace.sourceEvaluationOutcomes) {
        expect(showsSolitarySafeguardNotConfirmedNotice(trace, outcome)).toBe(false);
      }
    }
  });

  it("the GR-8 applicability wording no longer claims a blank only affects the guidelines that need it (readiness P3-6)", () => {
    const applicabilityText = flat.slice(flat.indexOf("{gr8Shape ? ( <p> Age, malignancy history"), flat.indexOf("applicabilityFields.map("));
    expect(applicabilityText).toContain("On this pathway, Evaluate becomes available once every question the evaluation still needs has been answered.");
  });

  // Pre-commit review P3-A (spec §7.4 item 9): the remaining-question labels come from the fields
  // rendered at the current state, never from a static list of every GR-8 question.
  it("P3-A: remaining-question labels list only the unresolved questions rendered at the current state", () => {
    expect(flat).toContain("const gr8Fields = gr8RenderedFields(input);");
    expect(flat).toContain(".map((id) => gr8Fields.find((field) => field.id === id)?.label)");
    const labelledIds = (input: ClinicalInputState) => {
      const completeness = guidedCompleteness(evaluate(input, release));
      if (completeness.state !== "incomplete") return [];
      const rendered: string[] = gr8RenderedFields(input).map((field) => field.id);
      return unresolvedFieldIds(completeness.unresolved).filter((id) => rendered.includes(id));
    };
    const applicability = ["age", "known_malignancy_history", "immunocompromised"];
    const noApplicability = { assessment_context: "incidental", assessment_timepoint: "follow-up", [OR]: true } as ClinicalInputState;

    // safeguard unanswered: the dry run also reports the omission, but it is not rendered yet
    const safeguardPending = guidedCompleteness(evaluate(D, release));
    expect(safeguardPending.state === "incomplete" && unresolvedFieldIds(safeguardPending.unresolved)).toContain(OM);
    expect(labelledIds(D)).toEqual([SG]);
    // safeguard false: neither omission nor risk is rendered or listed
    expect(labelledIds({ ...noApplicability, [SG]: false })).toEqual(applicability);
    expect(gr8RenderedFields({ ...D, [SG]: false }).map((field) => field.id)).not.toContain(OM);
    expect(gr8RenderedFields({ ...D, [SG]: false }).map((field) => field.id)).not.toContain(RK);
    // safeguard true, omission unanswered: the omission is listed
    expect(labelledIds({ ...D, [SG]: true })).toEqual([OM]);
    // omission true: complete, and risk is not rendered
    expect(labelledIds({ ...D, [SG]: true, [OM]: true })).toEqual([]);
    expect(gr8RenderedFields({ ...D, [SG]: true, [OM]: true }).map((field) => field.id)).not.toContain(RK);
    // omission false: applicability, then risk, as each becomes relevant
    expect(labelledIds({ ...noApplicability, [SG]: true, [OM]: false })).toEqual(applicability);
    expect(labelledIds({ ...D, [SG]: true, [OM]: false })).toEqual([RK]);
    expect(labelledIds({ ...D, [SG]: true, [OM]: false, [RK]: "low" })).toEqual([]);
  });
});
