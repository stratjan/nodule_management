// ADR-0012 §6 (issue #16 Candidate D final spec §5.2, §13 cases 47-48): every INSUFFICIENT_INPUT
// Source Evaluation Outcome -- on every pathway, and for every Release executed by this engine --
// carries a non-empty, machine-readable unresolvedRequiredInputs list; no other outcome carries the
// key; the disposition stage carries its own. Human-readable reason strings are unchanged.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { ruleSetReleaseSchema } from "../../src/engine/schema";
import type { ClinicalInputState, DiameterMeasurement, RuleSetRelease } from "../../src/engine/types";
import { loadTestRelease } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const releasesDir = join(repoRoot, "clinical/rule-sets/releases");
const activeRelease = loadTestRelease();
const allReleases: RuleSetRelease[] = [
  activeRelease,
  ...readdirSync(releasesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ruleSetReleaseSchema.parse(JSON.parse(readFileSync(join(releasesDir, name), "utf-8"))) as RuleSetRelease),
];

const OR = "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed";
const SG = "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management";
const OM = "clinician_decides_no_further_routine_nodule_surveillance";
const RK = "fleischner_multiple_solid_risk_category";
const AVG = "fleischner-2017-average-diameter" as const;
const SOLID = "fleischner-2017-solid-component-long-axis" as const;

function sweepInputs(): ClinicalInputState[] {
  const inputs: ClinicalInputState[] = [];
  const applicabilities = [
    { age: 55, known_malignancy_history: false, immunocompromised: false },
    { known_malignancy_history: false, immunocompromised: false },
    {},
    { age: 30, known_malignancy_history: false, immunocompromised: false },
  ];
  // Solitary initial pathways: measurement presence, convention binding (missing / resolved /
  // ambiguous), solid component, volume.
  for (const nodule_morphology of ["solid", "pure-ground-glass", "part-solid"])
    for (const size of [undefined, 4, 7, 10])
      for (const convention of ["none", "one", "two"] as const)
        for (const solid of [undefined, 3, 9])
          for (const volume of [undefined, 150])
            for (const applicability of applicabilities) {
              const whole: DiameterMeasurement[] | undefined =
                size === undefined || convention === "none"
                  ? undefined
                  : convention === "one"
                    ? [{ valueMm: size, conventionId: AVG }]
                    : [{ valueMm: size, conventionId: AVG }, { valueMm: size + 1, conventionId: AVG }];
              inputs.push({
                nodule_morphology,
                assessment_context: "incidental",
                assessment_timepoint: "initial",
                nodule_count: 1,
                ...applicability,
                ...(size === undefined ? {} : { nodule_size_mm: size }),
                ...(volume === undefined ? {} : { nodule_volume_mm3: volume }),
                ...(whole === undefined ? {} : { nodule_diameter_measurements: whole }),
                ...(solid === undefined ? {} : { solid_component_diameter_measurements: [{ valueMm: solid, conventionId: SOLID }] }),
              });
            }
  // #15 follow-up (origin false) with partial S3 criteria.
  for (const stability of [undefined, true, false])
    for (const vdt of [undefined, 300, 500, 700])
      for (const general of [undefined, false])
        for (const applicability of applicabilities)
          inputs.push({
            nodule_morphology: "solid",
            assessment_context: "incidental",
            assessment_timepoint: "follow-up",
            nodule_count: 1,
            [OR]: false,
            ...applicability,
            ...(stability === undefined ? {} : { s3_volume_stability_criterion_met: stability }),
            ...(vdt === undefined ? {} : { s3_vdt_days: vdt }),
            ...(general === undefined ? {} : { s3_general_condition_precludes_further_workup_or_therapy: general }),
          });
  // Candidate A/B/C set-level inputs.
  for (const shape of [
    { multiple_nodules_all_subsolid: true, multiple_nodules_discrete_circumscribed: true },
    { multiple_nodules_all_subsolid: false, multiple_nodules_all_solid: true, multiple_nodules_discrete_circumscribed: true, fleischner_multiple_solid_all_lt_6mm: true },
    { multiple_nodules_all_subsolid: false, multiple_nodules_all_solid: true, multiple_nodules_discrete_circumscribed: true, fleischner_multiple_solid_all_lt_6mm: false },
  ])
    for (const fact of [{}, { fleischner_multiple_subsolid_any_gte_6mm: true }, { [RK]: "low" }, { [SG]: true }, { [SG]: false }])
      for (const applicability of applicabilities)
        inputs.push({ assessment_context: "incidental", assessment_timepoint: "initial", nodule_count: 3, ...shape, ...fact, ...applicability } as ClinicalInputState);
  // Candidate D.
  for (const sg of [undefined, true, false])
    for (const om of [undefined, true, false])
      for (const rk of [undefined, "low", "high"] as const)
        for (const applicability of applicabilities)
          inputs.push({
            assessment_context: "incidental",
            assessment_timepoint: "follow-up",
            [OR]: true,
            ...applicability,
            ...(sg === undefined ? {} : { [SG]: sg }),
            ...(om === undefined ? {} : { [OM]: om }),
            ...(rk === undefined ? {} : { [RK]: rk }),
          });
  return inputs;
}

describe("structured unresolved required input: presence invariant (case 47)", () => {
  it("across every Release (active and all historical) and a broad input sweep: every INSUFFICIENT_INPUT outcome has a non-empty list, no other outcome has the key, and the disposition stage carries its own", () => {
    const inputs = sweepInputs();
    let insufficient = 0;
    let dispositionInsufficient = 0;
    for (const release of allReleases)
      for (const input of inputs) {
        let trace;
        try {
          trace = evaluate(input, release);
        } catch {
          continue; // a typed authoring-ambiguity error is never an outcome (covered elsewhere)
        }
        for (const outcome of trace.sourceEvaluationOutcomes) {
          if (outcome.state === "INSUFFICIENT_INPUT") {
            insufficient++;
            expect(outcome.unresolvedRequiredInputs?.length ?? 0).toBeGreaterThan(0);
          } else {
            expect(outcome).not.toHaveProperty("unresolvedRequiredInputs");
          }
          expect(outcome.recommendation ?? {}).not.toHaveProperty("unresolvedRequiredInputs");
        }
        const disposition = trace.clinicalDispositionEvaluation;
        if (disposition?.state === "INSUFFICIENT_INPUT") {
          dispositionInsufficient++;
          expect(disposition.unresolvedRequiredInputs?.length ?? 0).toBeGreaterThan(0);
        } else if (disposition) {
          expect(disposition).not.toHaveProperty("unresolvedRequiredInputs");
        }
      }
    expect(insufficient).toBeGreaterThan(100);
    expect(dispositionInsufficient).toBeGreaterThan(0);
  });
});

describe("structured unresolved required input: measurement mapping (case 48)", () => {
  const solidBase: ClinicalInputState = {
    nodule_morphology: "solid",
    assessment_context: "incidental",
    assessment_timepoint: "initial",
    nodule_count: 1,
    age: 55,
    known_malignancy_history: false,
    immunocompromised: false,
  };
  const fleischner = (input: ClinicalInputState, release: RuleSetRelease = activeRelease) =>
    evaluate(input, release).sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "fleischner")!;
  const s3 = (input: ClinicalInputState) =>
    evaluate(input, activeRelease).sourceEvaluationOutcomes.find((o) => o.recommendationSourceId === "s3")!;

  it("a missing Fleischner whole-nodule convention -> convention-bound-measurement / missing; the reason string is unchanged", () => {
    const outcome = fleischner({ ...solidBase, nodule_size_mm: 7 });
    expect(outcome.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome.unresolvedRequiredInputs).toEqual([
      { kind: "convention-bound-measurement", container: "nodule_diameter_measurements", conventionId: AVG, problem: "missing" },
    ]);
    expect(outcome.reason).toBe(
      `Measurement convention required by this rule for the whole-nodule ("${AVG}") was not confirmed by the Clinical Input State: no convention-bound whole-nodule diameter measurements were supplied.`,
    );
  });

  it("duplicated same-convention whole-nodule measurements -> convention-bound-measurement / ambiguous", () => {
    const outcome = fleischner({
      ...solidBase,
      nodule_size_mm: 7,
      nodule_diameter_measurements: [
        { valueMm: 7, conventionId: AVG },
        { valueMm: 8, conventionId: AVG },
      ],
    });
    expect(outcome.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome.unresolvedRequiredInputs).toEqual([
      { kind: "convention-bound-measurement", container: "nodule_diameter_measurements", conventionId: AVG, problem: "ambiguous" },
    ]);
  });

  it("a missing solid-component convention on the part-solid >=6 mm path -> container solid_component_diameter_measurements", () => {
    const outcome = fleischner({
      ...solidBase,
      nodule_morphology: "part-solid",
      nodule_size_mm: 8,
      nodule_diameter_measurements: [{ valueMm: 8, conventionId: AVG }],
    });
    expect(outcome.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome.unresolvedRequiredInputs).toEqual([
      { kind: "convention-bound-measurement", container: "solid_component_diameter_measurements", conventionId: SOLID, problem: "missing" },
    ]);
  });

  it("neither diameter nor volume (S3 volume-preferred) -> any-of-fields; the reason string is unchanged", () => {
    const outcome = s3(solidBase);
    expect(outcome.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome.unresolvedRequiredInputs).toEqual([{ kind: "any-of-fields", fields: ["nodule_size_mm", "nodule_volume_mm3"] }]);
    expect(outcome.reason).toBe("Neither diameter nor volume was supplied.");
  });

  it("a missing applicability fact -> one field entry per missing field, in order", () => {
    const { age: _a, ...noAge } = solidBase;
    const outcome = s3({ ...noAge, nodule_size_mm: 7 });
    expect(outcome.state).toBe("INSUFFICIENT_INPUT");
    expect(outcome.unresolvedRequiredInputs).toEqual([{ kind: "field", field: "age" }]);
    expect(outcome.reason).toBe("Missing required applicability input: age.");
  });

  it("a historical plain-diameter rule without a supplied diameter -> field nodule_size_mm (\"Diameter is required\" site)", () => {
    const hits = allReleases.slice(1).flatMap((release) => {
      try {
        const trace = evaluate({ ...solidBase, nodule_volume_mm3: 150 }, release);
        return trace.sourceEvaluationOutcomes.filter(
          (o) => o.reason === "Diameter is required for this source and was not supplied.",
        );
      } catch {
        return [];
      }
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const outcome of hits) {
      expect(outcome.unresolvedRequiredInputs).toEqual([{ kind: "field", field: "nodule_size_mm" }]);
    }
  });
});
