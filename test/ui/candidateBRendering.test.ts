import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendationView } from "../../src/ui/RecommendationView";
import { FleischnerRiskDecisionSupport } from "../../src/ui/FleischnerRiskDecisionSupport";
import {
  FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE,
  FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT,
} from "../../src/workflow/fields";

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
  });

  it("risk decision support is static, non-scoring, and has no controls", () => {
    const html = renderToStaticMarkup(createElement(FleischnerRiskDecisionSupport));
    const renderedText = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    expect(renderedText).toContain(FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.heading);
    for (const item of FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.items) {
      expect(renderedText).toContain(item);
    }
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
  });

  it("preserves the readiness-approved static primary-neoplasm / infection context note", () => {
    expect(FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE).toContain("known or suspected primary neoplasm");
    expect(FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE).toContain("active infection");
  });
});
