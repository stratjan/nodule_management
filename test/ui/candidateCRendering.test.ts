// issue #16 Candidate C (final spec 6264850117 §11 cases 27-31; readiness 6268250838 binding
// clarification 2): clinician-facing wording, Step-2 placement, and the Results-page
// not-confirmed notice. Same seam as candidateBRendering.test.ts -- renderToStaticMarkup plus
// App.tsx source checks -- with the Results-page condition exercised against real Decision
// Execution Traces from the assembled Release.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import type { ClinicalInputState } from "../../src/engine/types";
import { RecommendationView } from "../../src/ui/RecommendationView";
import {
  FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT,
  FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE,
  multipleSolidGte6mmSafeguardFields,
} from "../../src/workflow/fields";
import { showsSolitarySafeguardNotConfirmedNotice } from "../../src/workflow/pathwayNavigation";
import { loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../../src/ui/App.tsx"), "utf-8").replace(/\r\n/g, "\n");
const release = loadTestRelease();

const SAFEGUARD = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const base: ClinicalInputState = {
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 3,
  multiple_nodules_all_subsolid: false,
  multiple_nodules_all_solid: true,
  multiple_nodules_discrete_circumscribed: true,
  fleischner_multiple_solid_all_lt_6mm: false,
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
};

/** The Candidate-C step-2 block: from its shape guard up to the measurement block that follows it. */
function candidateCStep2Block(): string {
  const start = appSource.indexOf("{multipleSolidGte6mmShape && (");
  const end = appSource.indexOf(
    "{!isFollowUpTimepoint && !multipleSubsolidShape && !multipleSolidLt6mmShape && !multipleSolidGte6mmShape && (",
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

/** The Results section of App.tsx. */
function resultsSection(): string {
  const start = appSource.indexOf('{step === "results" && trace && (');
  expect(start).toBeGreaterThan(-1);
  return appSource.slice(start);
}

describe("#16 Candidate C rendering", () => {
  it("case 27: the safeguard label, help text and not-confirmed notice are the approved text verbatim", () => {
    expect(multipleSolidGte6mmSafeguardFields).toEqual([
      {
        id: SAFEGUARD,
        label:
          "Fleischner: I confirm that no individual larger / more suspicious nodule currently requires management according to the Fleischner solitary-nodule recommendations instead of this bounded multiple-nodule pathway (Yes = confirmed; No = not confirmed)",
        type: "boolean",
      },
    ]);
    expect(FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT).toBe(
      "Fleischner 2017 notes that, when multiple solid nodules are present, management may be guided by a larger or more suspicious nodule according to its solitary-nodule recommendations. The most suspicious nodule is not necessarily the largest. This app does not identify, rank, or select any individual nodule; whether such a nodule requires solitary-nodule management is your clinical judgment.",
    );
    expect(FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE).toBe(
      "Solitary-nodule-directed management is outside this bounded multiple-nodule pathway and is not evaluated here.",
    );
    // HITL 3: neutral -- no enumerated alternative solitary-nodule action
    for (const text of [
      FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT,
      FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE,
    ]) {
      expect(text).not.toMatch(/PET|biops|resection|surg|\bCT\b|months|follow-up/i);
    }
  });

  it("case 28: the Candidate-C step-2 block renders paragraph, help text, context note, safeguard -- in that order -- and the notice only on === false", () => {
    const block = candidateCStep2Block();
    const flat = block.replace(/\s+/g, " ");
    const paragraph =
      "Fleischner recommends an initial CT at 3–6 months for multiple solid nodules when at least one nodule measures 6 mm or larger. The app does not select, rank, or measure an individual nodule, and does not use a Fleischner risk category for this recommendation.";
    const order = [
      flat.indexOf(paragraph),
      flat.indexOf("<p>{FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT}</p>"),
      flat.indexOf('<p className="notice">{FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE}</p>'),
      flat.indexOf("multipleSolidGte6mmSafeguardFields.map("),
      flat.indexOf("{FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE}"),
    ];
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(flat).toContain(
      `{input.${SAFEGUARD} === false && ( <p className="notice notice-block"> {FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE} </p> )}`,
    );
  });

  it("case 29: the Candidate-C block has no risk decision support and no risk field", () => {
    const block = candidateCStep2Block();
    expect(block).not.toContain("FleischnerRiskDecisionSupport");
    expect(block).not.toContain("multipleSolidFleischnerRiskFields");
    expect(block).not.toContain("risk_category");
  });

  it("case 30: still seven useState declarations; no >=6 mm out-of-scope notice; canEvaluate includes the GR-7 shape", () => {
    expect(appSource.match(/\buseState[<(]/g)).toHaveLength(7);
    expect(candidateCStep2Block()).not.toMatch(/useState/);
    const noticesStart = appSource.indexOf("const OUT_OF_SCOPE_NOTICES");
    const notices = appSource.slice(noticesStart, appSource.indexOf("};", noticesStart));
    expect(notices).not.toContain("multiple-solid-gte-6mm");
    expect(appSource).not.toContain("6 mm or larger are not yet covered");
    const canEvaluateStart = appSource.indexOf("const canEvaluate =");
    const canEvaluate = appSource.slice(canEvaluateStart, appSource.indexOf(";", canEvaluateStart));
    expect(canEvaluate).toContain("multipleSolidGte6mmShape");
  });

  it("case 31: RecommendationView renders the case-8 payload as a mandatory CT follow-up at 3-6 months", () => {
    const trace = evaluate({ ...base, [SAFEGUARD]: true }, release);
    const recommendation = trace.sourceEvaluationOutcomes[0].recommendation!;
    const html = renderToStaticMarkup(createElement(RecommendationView, { recommendation }));
    expect(html).toContain("CT follow-up");
    expect(html).toContain("3-6 months");
    expect(html).not.toContain("may be considered");
    expect(html).not.toContain("clinical-action-optional");
  });
});

describe("#16 Candidate C Results-page not-confirmed notice (readiness 6268250838 clarification 2)", () => {
  it("is shown only for GR-7 + safeguard false + Fleischner OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const trace = evaluate({ ...base, [SAFEGUARD]: false }, release);
    const fleischner = trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner")!;
    expect(fleischner.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(showsSolitarySafeguardNotConfirmedNotice(trace, fleischner)).toBe(true);
  });

  it("is not shown for safeguard absent / true, a non-applicable patient, GR-6, or any other pathway", () => {
    const cases: ClinicalInputState[] = [
      base,
      { ...base, [SAFEGUARD]: true },
      { ...base, [SAFEGUARD]: false, age: 30 },
      { ...base, [SAFEGUARD]: false, known_malignancy_history: true },
      // GR-6 with a stray false safeguard and an invalid risk -> Fleischner OUTSIDE on GR-6
      {
        ...base,
        fleischner_multiple_solid_all_lt_6mm: true,
        fleischner_multiple_solid_risk_category: "medium" as any,
        [SAFEGUARD]: false,
      },
      { ...base, [SAFEGUARD]: false, assessment_timepoint: "follow-up" },
      {
        nodule_morphology: "solid",
        assessment_context: "incidental",
        assessment_timepoint: "initial",
        nodule_count: 1,
        nodule_size_mm: 7,
        age: 55,
        known_malignancy_history: false,
        immunocompromised: false,
      },
    ];
    for (const input of cases) {
      const trace = evaluate(input, release);
      for (const outcome of trace.sourceEvaluationOutcomes) {
        expect(showsSolitarySafeguardNotConfirmedNotice(trace, outcome)).toBe(false);
      }
    }
  });

  it("is presentation only: deciding it never alters the Decision Execution Trace or Source Evaluation Outcome", () => {
    const trace = evaluate({ ...base, [SAFEGUARD]: false }, release);
    const before = structuredClone(trace);
    for (const outcome of trace.sourceEvaluationOutcomes) showsSolitarySafeguardNotConfirmedNotice(trace, outcome);
    expect(trace).toEqual(before);
    expect(trace.recommendationSet).toEqual([]);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-multiple-solid-gte-6mm-initial",
    });
  });

  it("App.tsx renders the same neutral notice inside each Results outcome, guarded by the predicate, with no redirect", () => {
    const results = resultsSection();
    const flat = results.replace(/\s+/g, " ");
    expect(flat).toContain(
      '{showsSolitarySafeguardNotConfirmedNotice(trace, outcome) && ( <p className="notice"> {FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE} </p> )}',
    );
    // within the per-outcome list item, after the engine reason
    const outcomeItem = flat.slice(flat.indexOf("trace.sourceEvaluationOutcomes.map("));
    expect(outcomeItem.indexOf("{outcome.reason &&")).toBeLessThan(
      outcomeItem.indexOf("showsSolitarySafeguardNotConfirmedNotice("),
    );
    // explanatory only: the notice block contains no control and triggers no evaluation
    const noticeStart = flat.indexOf("{showsSolitarySafeguardNotConfirmedNotice(");
    const noticeBlock = flat.slice(noticeStart, flat.indexOf(")}", noticeStart) + 2);
    expect(noticeBlock).not.toMatch(/<button|<a |onClick|evaluate\(|setStep|setTrace|setInput/);
  });
});
