import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendationView } from "../../src/ui/RecommendationView";
import { FleischnerRiskDecisionSupport } from "../../src/ui/FleischnerRiskDecisionSupport";
import * as fleischnerRiskDecisionSupportModule from "../../src/ui/FleischnerRiskDecisionSupport";
import {
  FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE,
  FLEISCHNER_MULTIPLE_SOLID_MEASUREMENT_HELP_TEXT,
  FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT,
} from "../../src/workflow/fields";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../../src/ui/App.tsx"), "utf-8").replace(/\r\n/g, "\n");

/** The Candidate-B step-2 block: from its shape guard up to the measurement block that follows it. */
function candidateBStep2Block(): string {
  const start = appSource.indexOf("{multipleSolidLt6mmShape && (");
  const end = appSource.indexOf("{!isFollowUpTimepoint && !multipleSubsolidShape && !multipleSolidLt6mmShape && (");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

const provenance = {
  sourceDocument: "test",
  version: "test",
  originalLanguage: "English",
  sourceType: "test",
  locator: "test",
};

describe("#16 Candidate B rendering", () => {
  it("renders consider-action as visibly optional and distinct from a mandatory structured action", () => {
    const optional: any = {
      matchedRuleId: "x",
      matchedRevisionId: "x-r1",
      clinicalCriterionUsed: "clinician-attestation",
      considerAction: { label: "CT", timing: { kind: "specified", intervals: ["12 months"] } },
      rationale: "r",
      provenance,
    };
    const html = renderToStaticMarkup(createElement(RecommendationView, { recommendation: optional }));
    expect(html).toContain("CT");
    expect(html).toContain("12 months");
    expect(html).toContain("may be considered (optional; not a mandatory recommendation)");
    expect(html).toContain("clinical-action-optional");

    const mandatory: any = {
      matchedRuleId: "y",
      matchedRevisionId: "y-r1",
      clinicalCriterionUsed: "clinician-attestation",
      actions: [{ label: "CT", timing: { kind: "specified", intervals: ["12 months"] } }],
      rationale: "r",
      provenance,
    };
    const mandatoryHtml = renderToStaticMarkup(
      createElement(RecommendationView, { recommendation: mandatory }),
    );
    expect(mandatoryHtml).not.toContain("may be considered");
    expect(mandatoryHtml).not.toContain("clinical-action-optional");
    expect(mandatoryHtml).not.toBe(html);
  });

  it("the risk decision support carries exactly the approved heading and four items (final spec §4, readiness item 2)", () => {
    expect(FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT).toEqual({
      heading: "Fleischner risk context — decision support only (not scored)",
      items: [
        "Fleischner 2017 defines low risk as an estimated lung-cancer risk below 5%, and high risk as the combined intermediate-risk (5–65%) and high-risk (>65%) categories of the American College of Chest Physicians.",
        "Factors the guideline describes as relevant to this estimate include: age; smoking exposure; nodule size; nodule margins (for example irregular or spiculated); upper-lobe location.",
        "The guideline gives no scoring rule for these factors. This app does not calculate a score, weight any factor, or derive low or high risk from them; no single factor or combination determines the category here.",
        "The risk category you select is your clinical decision.",
      ],
    });
  });

  it("risk decision support renders every item, is static, non-scoring, and has no controls", () => {
    const html = renderToStaticMarkup(createElement(FleischnerRiskDecisionSupport));
    const renderedText = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    expect(renderedText).toContain(FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.heading);
    for (const item of FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.items) {
      expect(renderedText).toContain(item);
    }
    expect(html).toContain('aria-label="Fleischner risk decision support"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
    expect(Object.keys(fleischnerRiskDecisionSupportModule)).toEqual(["FleischnerRiskDecisionSupport"]);
  });

  it("the primary-neoplasm / infection context note is the readiness-approved text verbatim (readiness 5917894328 §5)", () => {
    expect(FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE).toBe(
      "Fleischner notes that this pathway may not apply unchanged when there is a known or suspected primary neoplasm that could be a source of metastatic disease, or when there is clinical evidence of active infection; those contexts may require different individualized management.",
    );
  });

  it("App.tsx renders the decision support, the context note, and the risk select inside the Candidate-B step-2 block", () => {
    const block = candidateBStep2Block();
    expect(block).toContain("<FleischnerRiskDecisionSupport />");
    expect(block).toContain("{FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE}");
    expect(block).toContain("multipleSolidFleischnerRiskFields.map(");
    expect(block.replace(/\s+/g, " ")).toContain(
      "Select the Fleischner risk category you have determined for this patient. The app does not calculate, score, weight, or infer this category from any other input.",
    );
    // Decision support and context note sit immediately above the risk select (final spec §4).
    expect(block.indexOf("<FleischnerRiskDecisionSupport />")).toBeLessThan(block.indexOf("multipleSolidFleischnerRiskFields.map("));
    expect(block.indexOf("{FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE}")).toBeLessThan(block.indexOf("multipleSolidFleischnerRiskFields.map("));
  });

  it("the all-<6 mm help text is the approved text verbatim and App.tsx renders it (final spec §8, case 42c)", () => {
    expect(FLEISCHNER_MULTIPLE_SOLID_MEASUREMENT_HELP_TEXT).toBe(
      "When determining whether all solid nodules are smaller than 6 mm, use the established Fleischner whole-nodule diameter convention: average the long- and short-axis diameters and round to the nearest whole millimeter.",
    );
    expect(appSource).toContain("<p>{FLEISCHNER_MULTIPLE_SOLID_MEASUREMENT_HELP_TEXT}</p>");
  });

  it("App.tsx declares no new useState for risk support -- the seven pre-Candidate-B states only (final spec §9, case 42c)", () => {
    expect(appSource.match(/\buseState[<(]/g)).toHaveLength(7);
    expect(candidateBStep2Block()).not.toMatch(/useState/);
  });
});
