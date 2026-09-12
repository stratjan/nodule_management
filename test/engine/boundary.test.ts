// Mechanical boundary tests explicitly authorized by issue #7 -- these test engine mechanics
// against already-approved rule and Source Applicability Rule definitions, not new clinical
// judgments. Do not add scenarios beyond this list without human clinical review.
import { describe, expect, it } from "vitest";
import { evaluate, AmbiguousRuleMatchError } from "../../src/engine/evaluate";
import { loadTestRelease } from "../helpers/loadTestRelease";
import type { ClinicalInputState } from "../../src/engine/types";
import {
  isNoRoutineFollowUpRecommendation,
  isPersistenceSurveillanceRecommendation,
  isStructuredRecommendation,
} from "../../src/engine/types";

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

/** issue #20: the corrected Fleischner 6-8mm rule and the new >8mm rule both require this
 * convention-bound diameter measurement -- kept separate from the legacy, untagged
 * nodule_size_mm the boundary fixtures below already set.
 *
 * Only ever call this with a whole-mm value. Fleischner's average-diameter convention itself
 * resolves to a whole mm before a clinician would ever enter it (long-axis + perpendicular
 * short-axis average, rounded to the nearest whole mm) -- a fractional value such as 5.9 or 7.9
 * can never legitimately carry this convention's tag. Phase 1's original 5.9mm/7.9mm boundary
 * fixtures predate that requirement; per PR #21 review, they are NOT given a (fabricated)
 * convention-bound measurement below -- the Fleischner rules correctly report INSUFFICIENT_INPUT
 * for them instead, since no such measurement could ever exist for a fractional-mm value. */
function fleischnerMeasurement(valueMm: number) {
  return [{ valueMm, conventionId: "fleischner-2017-average-diameter" as const }];
}

/** issue #18: solid-component diameter, independently convention-bound from the whole-nodule
 * measurement above -- never the same array, never copied between the two. */
function solidComponentMeasurement(valueMm: number) {
  return [{ valueMm, conventionId: "fleischner-2017-solid-component-long-axis" as const }];
}

function outcomeFor(trace: ReturnType<typeof evaluate>, sourceId: string) {
  return trace.sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === sourceId);
}

describe("size boundaries", () => {
  it("5.0mm: S3 RECOMMENDATION, Fleischner OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 5.0,
      nodule_diameter_measurements: fleischnerMeasurement(5.0),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(trace, "fleischner")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("5.9mm: Fleischner reports INSUFFICIENT_INPUT (no valid whole-mm convention-bound measurement is possible); 6.0mm (whole mm, convention affirmed): RECOMMENDATION", () => {
    const at59 = evaluate(
      {
        ...basePathway,
        ...baseApplicability,
        nodule_size_mm: 5.9,
      },
      release,
    );
    const at60 = evaluate(
      {
        ...basePathway,
        ...baseApplicability,
        nodule_size_mm: 6.0,
        nodule_diameter_measurements: fleischnerMeasurement(6.0),
      },
      release,
    );
    expect(outcomeFor(at59, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(at60, "fleischner")?.state).toBe("RECOMMENDATION");
  });

  it("7.9mm: S3 RECOMMENDATION (unaffected -- reads raw nodule_size_mm), Fleischner INSUFFICIENT_INPUT (no valid whole-mm convention-bound measurement is possible); 8.0mm (whole mm, convention affirmed): S3 flips OUTSIDE_CURRENT_RULESET_SCOPE, Fleischner RECOMMENDATION", () => {
    const at79 = evaluate(
      {
        ...basePathway,
        ...baseApplicability,
        nodule_size_mm: 7.9,
      },
      release,
    );
    const at80 = evaluate(
      {
        ...basePathway,
        ...baseApplicability,
        nodule_size_mm: 8.0,
        nodule_diameter_measurements: fleischnerMeasurement(8.0),
      },
      release,
    );
    expect(outcomeFor(at79, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(at79, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
    expect(outcomeFor(at80, "s3")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(outcomeFor(at80, "fleischner")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(at80, "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-6TO8MM",
    );
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
    expect(trace.pathwaySelection.state).not.toBe("MATCHED");
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
    expect(trace.pathwaySelection.state).not.toBe("MATCHED");
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
    expect(trace.pathwaySelection.state).not.toBe("MATCHED");
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
    expect(trace.pathwaySelection.state).not.toBe("MATCHED");
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
    expect(trace.pathwaySelection.state).not.toBe("MATCHED");
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

describe("Fleischner >8mm rule (issue #20)", () => {
  it("8mm-exactly: existing 6-8mm rule still applies, unchanged", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 8,
      nodule_diameter_measurements: fleischnerMeasurement(8),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-6TO8MM");
  });

  it("9mm: new >8mm rule applies (smallest normalized whole-mm value above 8)", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 9,
      nodule_diameter_measurements: fleischnerMeasurement(9),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GT8TO30MM");
  });

  it("30mm-exactly: new >8mm rule still applies (inclusive)", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 30,
      nodule_diameter_measurements: fleischnerMeasurement(30),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GT8TO30MM");
  });

  it("31mm: OUTSIDE_CURRENT_RULESET_SCOPE (no longer a 'nodule' by Fleischner's own terminology)", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 31,
      nodule_diameter_measurements: fleischnerMeasurement(31),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });
});

describe("measurement-convention enforcement (issue #20)", () => {
  it("Fleischner-eligible input with no nodule_diameter_measurements: INSUFFICIENT_INPUT naming the required convention", () => {
    const input: ClinicalInputState = { ...basePathway, ...baseApplicability, nodule_size_mm: 9 };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("fleischner-2017-average-diameter");
  });

  it("Fleischner-eligible input with an empty nodule_diameter_measurements array: INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 9,
      nodule_diameter_measurements: [],
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });

  it("Fleischner-eligible input with a differently-tagged measurement: INSUFFICIENT_INPUT naming what was supplied", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 9,
      nodule_diameter_measurements: [{ valueMm: 9, conventionId: "some-other-convention" as any }],
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("some-other-convention");
  });

  it("a matching convention-bound entry produces RECOMMENDATION exactly as it would without this check", () => {
    const input: ClinicalInputState = {
      ...basePathway,
      ...baseApplicability,
      nodule_size_mm: 9,
      nodule_diameter_measurements: fleischnerMeasurement(9),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("RECOMMENDATION");
  });

  it("S3 is unaffected by nodule_diameter_measurements presence, absence, or contents -- continues reading nodule_size_mm directly", () => {
    const withMeasurement = evaluate(
      {
        ...basePathway,
        ...baseApplicability,
        nodule_size_mm: 7,
        nodule_diameter_measurements: fleischnerMeasurement(7),
      },
      release,
    );
    const without = evaluate(
      { ...basePathway, ...baseApplicability, nodule_size_mm: 7 },
      release,
    );
    expect(outcomeFor(withMeasurement, "s3")?.state).toBe("RECOMMENDATION");
    expect(outcomeFor(without, "s3")?.state).toBe("RECOMMENDATION");
    expect((outcomeFor(withMeasurement, "s3")?.recommendation as any)?.clinicalEndpoint).toBe(
      (outcomeFor(without, "s3")?.recommendation as any)?.clinicalEndpoint,
    );
  });
});

// issue #17: pure ground-glass / non-solid pathway (GR-2), Fleischner-only.
const ggnBasePathway = {
  nodule_morphology: "pure-ground-glass",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
} as const;

describe("pure ground-glass pathway (issue #17)", () => {
  it("5mm: ACR-FLEISCHNER-GGN-LT6MM matches, explicit no-routine-follow-up semantics", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-pure-ggn-initial",
    });
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GGN-LT6MM");

    const recommendation = fleischner?.recommendation;
    expect(recommendation && isNoRoutineFollowUpRecommendation(recommendation)).toBe(true);
    expect((recommendation as any).noRoutineFollowUp).toBe(true);
    expect((recommendation as any).intervals).toBeUndefined();
    expect((recommendation as any).actions).toBeUndefined();
    expect((recommendation as any).clinicalEndpoint).toBeUndefined();
  });

  it("6mm exactly: ACR-FLEISCHNER-GGN-GTE6MM matches (surveillance bucket, per HITL)", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 6,
      nodule_diameter_measurements: fleischnerMeasurement(6),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GGN-GTE6MM");
  });

  it("10mm (representative >6mm case): same ACR-FLEISCHNER-GGN-GTE6MM rule applies", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-GGN-GTE6MM");
  });

  it("the persistence-surveillance form carries exactly the two named, non-empty, specified-only steps", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 6,
      nodule_diameter_measurements: fleischnerMeasurement(6),
    };
    const trace = evaluate(input, release);
    const recommendation = outcomeFor(trace, "fleischner")?.recommendation;
    expect(recommendation && isPersistenceSurveillanceRecommendation(recommendation)).toBe(true);
    const rec = recommendation as any;
    expect(rec.persistenceConfirmation.timing).toEqual({
      kind: "specified",
      intervals: ["6-12 months"],
    });
    expect(rec.ifPersistent.timing).toEqual({
      kind: "specified",
      intervals: ["every 2 years until 5 years"],
    });
    expect(rec.actions).toBeUndefined();
  });

  it("S3 and BTS produce no Source Evaluation Outcome for this pathway (no Atomic Clinical Rule bound to it)", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
    };
    const trace = evaluate(input, release);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
    expect(trace.sourceEvaluationOutcomes[0].recommendationSourceId).toBe("fleischner");
  });

  it("a diameter that would also fall inside Solid's Fleischner 6-8mm range never triggers the Solid rule on the GGN pathway", () => {
    const input: ClinicalInputState = {
      ...ggnBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-GGN-GTE6MM",
    );
  });

  it("measurement-convention enforcement applies identically on the GGN pathway: no matching convention -> INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = { ...ggnBasePathway, ...baseApplicability, nodule_size_mm: 5 };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("INSUFFICIENT_INPUT");
  });
});

// issue #18: part-solid pathway (GR-3), Fleischner-only, Candidate B (State A + State B).
const partSolidBasePathway = {
  nodule_morphology: "part-solid",
  assessment_context: "incidental",
  assessment_timepoint: "initial",
  nodule_count: 1,
} as const;

describe("part-solid pathway (issue #18)", () => {
  it("State A -- whole 5mm: no routine follow-up, no solid-component input required", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
    };
    const trace = evaluate(input, release);
    expect(trace.pathwaySelection).toEqual({
      state: "MATCHED",
      clinicalPathwayId: "incidental-solitary-part-solid-initial",
    });
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-LT6MM");

    const recommendation = fleischner?.recommendation;
    expect(recommendation && isNoRoutineFollowUpRecommendation(recommendation)).toBe(true);
    expect((recommendation as any).noRoutineFollowUp).toBe(true);
    expect(recommendation?.measurementsUsed).toEqual({
      wholeNodule: { valueMm: 5, conventionId: "fleischner-2017-average-diameter" },
    });
  });

  it("issue #26: engineVersion and schemaVersion both report 1.4.0 -- the solid-component-only dispatch extension (Candidate C) is a real runtime-semantics change, and operandInapplicabilityPreconditions (architecture-review correction) is a genuine, additive schema extension, not merely an evaluate.ts-internal change; every trace produced by the current engine/schema, including this unrelated State-A case, must not silently claim the prior 1.3.0 contract for either", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
    };
    const trace = evaluate(input, release);
    expect(trace.engineVersion).toBe("1.4.0");
    expect(trace.schemaVersion).toBe("1.4.0");
  });

  it("boundary -- whole 6mm exactly + solid 5mm: State-B recommendation (>=6mm is the active branch, not >6mm)", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 6,
      nodule_diameter_measurements: fleischnerMeasurement(6),
      solid_component_diameter_measurements: solidComponentMeasurement(5),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
    );
  });

  it("State B -- whole 7mm + solid 5mm: persistence-confirmation CT 3-6mo, then annual CT until 5y if persistent", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
      solid_component_diameter_measurements: solidComponentMeasurement(5),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    const recommendation = fleischner?.recommendation;
    expect(recommendation && isPersistenceSurveillanceRecommendation(recommendation)).toBe(true);
    const rec = recommendation as any;
    expect(rec.persistenceConfirmation.timing).toEqual({ kind: "specified", intervals: ["3-6 months"] });
    expect(rec.ifPersistent.timing).toEqual({ kind: "specified", intervals: ["annually until 5 years"] });
    expect(recommendation?.measurementsUsed).toEqual({
      wholeNodule: { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      solidComponent: { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
    });
  });

  it("State B -- whole 10mm + solid 5mm: same rule applies, no additional upper scope limit in this slice", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
      solid_component_diameter_measurements: solidComponentMeasurement(5),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
    );
  });

  it("excluded state -- whole 7mm + solid 6mm: OUTSIDE_CURRENT_RULESET_SCOPE, never the <6mm-solid recommendation", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
      solid_component_diameter_measurements: solidComponentMeasurement(6),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(fleischner?.recommendation).toBeUndefined();
  });

  it("excluded state -- whole 10mm + solid 8mm: OUTSIDE_CURRENT_RULESET_SCOPE", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
      solid_component_diameter_measurements: solidComponentMeasurement(8),
    };
    const trace = evaluate(input, release);
    expect(outcomeFor(trace, "fleischner")?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
  });

  it("missing input -- whole 7mm, no solid-component measurement supplied at all: INSUFFICIENT_INPUT naming the solid-component convention", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("fleischner-2017-solid-component-long-axis");
    expect(fleischner?.reason).toContain("solid-component");
  });

  it("missing input -- whole-nodule convention missing entirely (whole <6mm, so no solid-component question is even reached): INSUFFICIENT_INPUT", () => {
    const input: ClinicalInputState = { ...partSolidBasePathway, ...baseApplicability, nodule_size_mm: 5 };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("whole-nodule");
  });

  it("ambiguous whole-nodule measurement -- two entries under the same convention: INSUFFICIENT_INPUT, never silently picks the first", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: [
        { valueMm: 5, conventionId: "fleischner-2017-average-diameter" },
        { valueMm: 7, conventionId: "fleischner-2017-average-diameter" },
      ],
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("Multiple");
  });

  it("ambiguous solid-component measurement -- two entries under the same convention: INSUFFICIENT_INPUT, never silently picks the first", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 7,
      nodule_diameter_measurements: fleischnerMeasurement(7),
      solid_component_diameter_measurements: [
        { valueMm: 5, conventionId: "fleischner-2017-solid-component-long-axis" },
        { valueMm: 6, conventionId: "fleischner-2017-solid-component-long-axis" },
      ],
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("Multiple");
  });

  it("S3 and BTS produce no Source Evaluation Outcome for this pathway (no Atomic Clinical Rule bound to it)", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
    };
    const trace = evaluate(input, release);
    expect(trace.sourceEvaluationOutcomes).toHaveLength(1);
    expect(trace.sourceEvaluationOutcomes[0].recommendationSourceId).toBe("fleischner");
  });

  it("Rule 1 and Rule 2 are mutually exclusive on the shared whole-nodule condition -- evaluate() never throws AmbiguousRuleMatchError across the boundary, even though release-time overlap validation cannot prove this pair non-overlapping (mixed-field diameterConditions)", () => {
    const belowBoundary: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
      solid_component_diameter_measurements: solidComponentMeasurement(5),
    };
    const atBoundary: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 6,
      nodule_diameter_measurements: fleischnerMeasurement(6),
      solid_component_diameter_measurements: solidComponentMeasurement(5),
    };
    expect(() => evaluate(belowBoundary, release)).not.toThrow();
    expect(() => evaluate(atBoundary, release)).not.toThrow();
    expect(outcomeFor(evaluate(belowBoundary, release), "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-LT6MM",
    );
    expect(outcomeFor(evaluate(atBoundary, release), "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM",
    );
  });
});

describe("part-solid State D -- solid component >8mm (issue #26, Candidate C)", () => {
  it("whole 10mm + solid 9mm: RECOMMENDATION via the solid-component->8mm rule, coequal PET/CT/biopsy/resection actions", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
      solid_component_diameter_measurements: solidComponentMeasurement(9),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("RECOMMENDATION");
    expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM");
    const recommendation = fleischner?.recommendation;
    expect(recommendation && isStructuredRecommendation(recommendation)).toBe(true);
    expect((recommendation as any).actions).toEqual([
      { label: "PET/CT", timing: { kind: "not-specified-by-source" } },
      { label: "Biopsy/tissue sampling", timing: { kind: "not-specified-by-source" } },
      { label: "Resection", timing: { kind: "not-specified-by-source" } },
    ]);
    expect(recommendation?.measurementsUsed).toEqual({
      solidComponent: { valueMm: 9, conventionId: "fleischner-2017-solid-component-long-axis" },
    });
  });

  it("solid component exactly 8mm: OUTSIDE_CURRENT_RULESET_SCOPE, strict >8mm boundary not met (whole-nodule value present and unrelated)", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
      solid_component_diameter_measurements: solidComponentMeasurement(8),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("OUTSIDE_CURRENT_RULESET_SCOPE");
    expect(fleischner?.recommendation).toBeUndefined();
  });

  it("missing solid-component measurement entirely, whole-nodule present: INSUFFICIENT_INPUT naming the solid-component convention", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 10,
      nodule_diameter_measurements: fleischnerMeasurement(10),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.reason).toContain("fleischner-2017-solid-component-long-axis");
    expect(fleischner?.reason).toContain("solid-component");
  });

  it("corrected golden case (was previously mis-specified as RECOMMENDATION): whole-nodule measurement missing entirely, solid component 9mm supplied -- overall Fleischner outcome is INSUFFICIENT_INPUT, not a Candidate-C recommendation. ACR-FLEISCHNER-PARTSOLID-LT6MM cannot determine its own match/no-match status without a whole-nodule measurement, and evaluateAtomicRulesForSource gives any rule-level INSUFFICIENT_INPUT precedence over another rule's own match -- Candidate C's independent, successful resolution does not override this existing, already-Approved precedence rule", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      solid_component_diameter_measurements: solidComponentMeasurement(9),
    };
    const trace = evaluate(input, release);
    const fleischner = outcomeFor(trace, "fleischner");
    expect(fleischner?.state).toBe("INSUFFICIENT_INPUT");
    expect(fleischner?.recommendation).toBeUndefined();
  });

  it("whole-nodule value, once present and >=6mm, does not affect Candidate C's match or its content -- 6mm, 10mm, and 30mm all produce the identical recommendation for the same 9mm solid component", () => {
    const wholeValues = [6, 10, 30];
    const recommendations = wholeValues.map((whole) => {
      const input: ClinicalInputState = {
        ...partSolidBasePathway,
        ...baseApplicability,
        nodule_size_mm: whole,
        nodule_diameter_measurements: fleischnerMeasurement(whole),
        solid_component_diameter_measurements: solidComponentMeasurement(9),
      };
      return outcomeFor(evaluate(input, release), "fleischner");
    });
    for (const fleischner of recommendations) {
      expect(fleischner?.state).toBe("RECOMMENDATION");
      expect(fleischner?.recommendation?.matchedRuleId).toBe("ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM");
    }
    expect(recommendations[0]?.recommendation).toEqual(recommendations[1]?.recommendation);
    expect(recommendations[1]?.recommendation).toEqual(recommendations[2]?.recommendation);
  });

  it("real State-A x State-D ambiguity (issue #26 re-opened grilling, resolved as a source-incompatible/not-reliably-definable cross-state input, not resolved by rule ordering): whole-nodule <6mm + solid component >8mm, both convention-affirmed, throws AmbiguousRuleMatchError naming both ACR-FLEISCHNER-PARTSOLID-LT6MM and ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM -- intentional, fail-closed, never resolved by giving either rule precedence", () => {
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 5,
      nodule_diameter_measurements: fleischnerMeasurement(5),
      solid_component_diameter_measurements: solidComponentMeasurement(9),
    };
    let caught: unknown;
    try {
      evaluate(input, release);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AmbiguousRuleMatchError);
    const matchedRuleIds = (caught as AmbiguousRuleMatchError).matchedRules.map((r) => r.ruleId).sort();
    expect(matchedRuleIds).toEqual(
      ["ACR-FLEISCHNER-PARTSOLID-LT6MM", "ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM"].sort(),
    );
  });

  it("Rule 1 (whole <6mm) and Candidate C (solid >8mm) are NOT mutually exclusive by field construction -- unlike every other rule pair on this pathway, they condition on different fields, so release-time overlap validation is blind to this pair by design, not merely by omission; only the runtime guard above catches it", () => {
    // This test intentionally documents the negative: no release-time check is exercised here.
    // See release-assembly.test.ts / rangeOverlap.test.ts for confirmation that the real combined
    // Release still builds successfully despite this pair -- assertNoOverlappingAtomicRules never
    // claims to prove non-overlap across different fields, for any rule pair, and does not throw
    // for this one either.
    const input: ClinicalInputState = {
      ...partSolidBasePathway,
      ...baseApplicability,
      nodule_size_mm: 20,
      nodule_diameter_measurements: fleischnerMeasurement(20),
      solid_component_diameter_measurements: solidComponentMeasurement(9),
    };
    expect(() => evaluate(input, release)).not.toThrow();
    expect(outcomeFor(evaluate(input, release), "fleischner")?.recommendation?.matchedRuleId).toBe(
      "ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM",
    );
  });
});
