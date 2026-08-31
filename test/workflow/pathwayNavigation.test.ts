// Pure predicate test -- no UI testing dependency needed. Confirms the wizard's Continue
// button is gated correctly on nodule_count, per issue #7 user story 2 ("if I enter more than
// one discrete nodule, I want the tool to tell me this pathway is scoped to a solitary nodule
// and stop there"). The engine's Clinical Pathway Gate remains the actual clinical authority;
// this only governs UI navigation.
import { describe, expect, it } from "vitest";
import {
  canContinuePastPathwayStep,
  isNoduleCountOutOfScope,
} from "../../src/workflow/pathwayNavigation";
import type { ClinicalInputState } from "../../src/engine/types";

const completePathway: ClinicalInputState = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
};

describe("canContinuePastPathwayStep", () => {
  it("allows continuing once all pathway fields are answered and nodule_count = 1", () => {
    expect(canContinuePastPathwayStep(completePathway)).toBe(true);
  });

  it("blocks continuing when nodule_count > 1, even though all fields are answered", () => {
    expect(canContinuePastPathwayStep({ ...completePathway, nodule_count: 2 })).toBe(false);
  });

  it("blocks continuing when any pathway field is still unanswered", () => {
    const { nodule_morphology, ...incomplete } = completePathway;
    expect(canContinuePastPathwayStep(incomplete)).toBe(false);
  });

  it("blocks continuing on an empty input", () => {
    expect(canContinuePastPathwayStep({})).toBe(false);
  });
});

describe("isNoduleCountOutOfScope", () => {
  it("is false when nodule_count is unanswered", () => {
    expect(isNoduleCountOutOfScope({})).toBe(false);
  });

  it("is false when nodule_count = 1", () => {
    expect(isNoduleCountOutOfScope({ nodule_count: 1 })).toBe(false);
  });

  it("is true when nodule_count > 1", () => {
    expect(isNoduleCountOutOfScope({ nodule_count: 2 })).toBe(true);
  });
});
