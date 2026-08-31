// Mechanical boundary tests explicitly authorized by issue #7 -- these test engine mechanics
// against already-approved rule and Source Applicability Rule definitions, not new clinical
// judgments. Do not add scenarios beyond this list without human clinical review.
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { loadTestRelease } from "../helpers/loadTestRelease";
import type { ClinicalInputState } from "../../src/engine/types";

const release = loadTestRelease();

const basePathway = {
  nodule_morphology: "solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
} as const;

const baseApplicability = {
  age: 55,
  known_malignancy_history: false,
  immunocompromised: false,
} as const;

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

describe("size boundaries", () => {
  it("5.0mm: S3 RECOMMENDATION, Fleischner OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const input: ClinicalInputState = { ...basePathway, ...baseApplicability, nodule_size_mm: 5.0 };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("5.9mm -> 6.0mm: Fleischner flips OUTSIDE_CURRENT_RULESET_SCOPE -> RECOMMENDATION", () => {
    const at59 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_size_mm: 5.9 },
      release,
    );
    const at60 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_size_mm: 6.0 },
      release,
    );
    expect(outcomeFor(at59, "fleischner")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(outcomeFor(at60, "fleischner")?.state).toBe("RECOMMENDATION");
  });

  it("7.9mm -> 8.0mm: S3 flips RECOMMENDATION -> OUTSIDE_CURRENT_RULESET_SCOPE; Fleischner stays RECOMMENDATION at 8.0mm", () => {
    const at79 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_size_mm: 7.9 },
      release,
    );
    const at80 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_size_mm: 8.0 },
      release,
    );
    expect(outcomeFor(at79, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(at80, "s3")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(outcomeFor(at80, "fleischner")?.state).toBe("RECOMMENDATION");
  });

  it("volume-mirrored boundaries for S3: 80mm3 matches, 300mm3 does not", () => {
    const at80 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_volume_mm3: 80 },
      release,
    );
    const at300 = evaluate(
      { ...basePathway, ...baseApplicability, nodule_volume_mm3: 300 },
      release,
    );
    expect(outcomeFor(at80, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(at300, "s3")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });
});

describe("per-source applicability", () => {
  it("age 20: S3 proceeds (RECOMMENDATION), Fleischner NOT_APPLICABLE", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      age: 20,
      known_malignancy_history: false,
      immunocompromised: false,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("NOT_APPLICABLE");
  });

  it("known malignancy history = true: both S3 and Fleischner NOT_APPLICABLE", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      age: 55,
      known_malignancy_history: true,
      immunocompromised: false,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("NOT_APPLICABLE");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("NOT_APPLICABLE");
  });

  it("immunocompromised = true: both S3 and Fleischner NOT_APPLICABLE", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      age: 55,
      known_malignancy_history: false,
      immunocompromised: true,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("NOT_APPLICABLE");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("NOT_APPLICABLE");
  });
});

describe("missing input", () => {
  it("both diameter and volume missing: both sources INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = { ...basePathway, ...baseApplicability };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("volume present, diameter absent: S3 evaluates normally, Fleischner INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = { ...basePathway, ...baseApplicability, nodule_volume_mm3: 180 };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("missing age individually: both sources INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      known_malignancy_history: false,
      immunocompromised: false,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("missing known_malignancy_history individually: both sources INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      age: 55,
      immunocompromised: false,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("missing immunocompromised individually: both sources INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      age: 55,
      known_malignancy_history: false,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });
});

describe("Clinical Pathway Gate", () => {
  it("missing a pathway-gate field (morphology): evaluation blocked entirely, no outcomes produced", () => {
    const input: ClinicalInputState = {
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.clinicalPathwayGate.passed).toBe(false);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
    expect(trace.recommendationSet).toHaveLength(0);
  });

  it("missing a pathway-gate field (assessment_context): evaluation blocked entirely", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_timepoint: "initial",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.clinicalPathwayGate.passed).toBe(false);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("missing a pathway-gate field (assessment_timepoint): evaluation blocked entirely", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      nodule_count: 1,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.clinicalPathwayGate.passed).toBe(false);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("missing a pathway-gate field (nodule_count): evaluation blocked entirely", () => {
    const input: ClinicalInputState = {
      nodule_morphology: "solid",
      assessment_context: "incidental",
      assessment_timepoint: "initial",
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.clinicalPathwayGate.passed).toBe(false);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });

  it("nodule_count = 2: evaluation blocked entirely (pathway gate fails)", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      nodule_count: 2,
      ...baseApplicability,
      nodule_size_mm: 7,
    };
    const trace = evaluate(input, release);
    expect(trace.clinicalPathwayGate.passed).toBe(false);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(0);
  });
});

describe("measurement discordance", () => {
  it("discordant diameter/volume classification for S3: measurement_discordance = true, volume-based outcome used", () => {
    // 4mm is outside S3's diameter bucket [5, 8); 180mm3 is inside S3's volume bucket [80, 300).
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 4,
      nodule_volume_mm3: 180,
    };
    const trace = evaluate(input, release);
    const s3 = outcomeFor(trace, "s3");
    expect(s3?.measurementDiscordance).toBe(true);
    expect(s3?.state).toBe("RECOMMENDATION");
    expect(s3?.recommendation?.measurementBasisUsed).toBe("volume");
    expect(s3?.measurementValues).toEqual({ diameter: 4, volume: 180 });
  });
});
