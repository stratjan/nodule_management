import { useMemo, useState } from "react";
import { evaluate } from "../engine/evaluate";
import type { ClinicalInputState, DecisionExecutionTrace } from "../engine/types";
import { activeRelease } from "../data/activeRelease";
import { activeManifest } from "../data/activeManifest";
import { pathwayFields, measurementFields, applicabilityFields, followUpFields } from "../workflow/fields";
import {
  canContinuePastPathwayStep,
  isNoduleCountOutOfScope,
  shouldClearS3FollowUpCriterion,
} from "../workflow/pathwayNavigation";
import { parseWholeMmDiameter } from "../workflow/wholeMmInput";
import { FieldInput } from "./FieldInput";
import { RecommendationView } from "./RecommendationView";

type FieldValue = string | number | boolean | undefined;
type Step = "pathway" | "clinical-details" | "results";

const SOURCE_LABELS: Record<string, string> = {
  s3: "German S3 Lung Cancer Guideline",
  fleischner: "Fleischner Society",
};

const OUTCOME_LABELS: Record<string, string> = {
  RECOMMENDATION: "Recommendation available",
  NOT_APPLICABLE: "Not applicable to this patient",
  OUTSIDE_CURRENT_RULESET_SCOPE: "Not covered by this Rule-Set Release yet",
  INSUFFICIENT_INPUT: "Insufficient input",
};

export function App() {
  const [step, setStep] = useState<Step>("pathway");
  const [input, setInput] = useState<ClinicalInputState>({});
  const [trace, setTrace] = useState<DecisionExecutionTrace | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  // issue #20: a minimal, explicit affirmation tied to the existing diameter field -- never a
  // blind copy of it. Kept as UI-only state, not a ClinicalInputState field itself; only
  // translated into a convention-bound nodule_diameter_measurements entry when the clinician has
  // actually checked it, at evaluation time.
  const [fleischnerConventionConfirmed, setFleischnerConventionConfirmed] = useState(false);
  // issue #18: the solid component is a distinct anatomical measurement target (Bankier et al.
  // 2017, Fig. 4) -- kept as its own local UI state, never derived from or copied to the
  // whole-nodule diameter, mirroring the existing affirmation pattern above but independently
  // scoped. Not a ClinicalInputState field itself; only translated into a convention-bound
  // solid_component_diameter_measurements entry when the clinician has explicitly affirmed it.
  const [solidComponentSizeMm, setSolidComponentSizeMm] = useState<number | undefined>(undefined);
  const [solidComponentConventionConfirmed, setSolidComponentConventionConfirmed] = useState(false);

  const handleChange = (id: string, value: FieldValue) => {
    setInput((prev) => {
      const next: ClinicalInputState = { ...prev, [id]: value };
      if (shouldClearS3FollowUpCriterion(id, value)) {
        delete next.s3_volume_stability_criterion_met;
      }
      return next;
    });
    // issue #20 review: the affirmation is only ever valid for the diameter value it was given
    // for -- any edit to that value (including clearing it) invalidates a prior affirmation, so
    // it must never silently carry over and get tagged onto a new, unaffirmed value.
    if (id === "nodule_size_mm") {
      setFleischnerConventionConfirmed(false);
      // issue #18: the solid-component input/confirmation is only ever meaningful while the
      // whole-nodule diameter remains part-solid and >=6mm -- any whole-nodule diameter edit
      // invalidates it (it may no longer even be shown), same never-carry-over invariant as above.
      setSolidComponentSizeMm(undefined);
      setSolidComponentConventionConfirmed(false);
    }
    // issue #18: solid-component state is only ever relevant to the part-solid pathway -- changing
    // morphology clears it, since it becomes irrelevant (or a different pathway's own state) for
    // any other value.
    if (id === "nodule_morphology") {
      setSolidComponentSizeMm(undefined);
      setSolidComponentConventionConfirmed(false);
    }
  };

  const handleSolidComponentDiameterChange = (raw: string) => {
    const parsed = parseWholeMmDiameter(raw);
    if (parsed === "invalid") return;
    setSolidComponentSizeMm(parsed);
    setSolidComponentConventionConfirmed(false);
  };

  const hasMeasurement = input.nodule_size_mm !== undefined || input.nodule_volume_mm3 !== undefined;

  // issue #20 review: Fleischner's average-diameter convention resolves to a whole-mm value
  // before a clinician would ever enter it -- a fractional diameter can never legitimately be
  // affirmed under this convention, so the affirmation control is only offered for whole-mm
  // values.
  const isWholeMmDiameter =
    input.nodule_size_mm !== undefined && Number.isInteger(input.nodule_size_mm);

  // issue #18: progressive disclosure -- the solid-component question is only ever asked for the
  // part-solid pathway once the whole-nodule diameter is >=6mm (State A, <6mm, structurally never
  // needs it; Fleischner's own text states discrete solid components cannot be reliably defined
  // below 6mm anyway).
  const showSolidComponentInput =
    input.nodule_morphology === "part-solid" &&
    input.nodule_size_mm !== undefined &&
    input.nodule_size_mm >= 6;

  // issue #15 Candidate A0: the solid follow-up pathway needs no diameter/volume measurement at
  // all -- its step-2 measurement block (and the Fleischner/solid-component controls nested in
  // it) is hidden whenever the timepoint is follow-up, regardless of morphology, since Candidate
  // A0 introduces no measurement-based follow-up content for any morphology.
  const isFollowUpTimepoint = input.assessment_timepoint === "follow-up";

  // issue #15 Candidate A0: the S3 criterion question is shown only for the exact pathway shape
  // GR-4 gates on (solid/incidental/follow-up/solitary) -- never for part-solid or pure-GGN
  // follow-up-shaped input, which this Release has no follow-up rule for at all.
  const showFollowUpCriterionInput =
    input.nodule_morphology === "solid" &&
    input.assessment_context === "incidental" &&
    input.assessment_timepoint === "follow-up" &&
    input.nodule_count === 1;

  const canConfirmPathway = canContinuePastPathwayStep(input);
  // issue #15 Candidate A0: the follow-up pathway is evaluable with no measurement field at all --
  // an unanswered S3 criterion is itself a valid, intended INSUFFICIENT_INPUT outcome (G3), not a
  // state the UI should block reaching. Unchanged for every existing initial-timepoint pathway.
  const canEvaluate = hasMeasurement || isFollowUpTimepoint;

  const handleConfirmPathway = () => {
    if (!canConfirmPathway) return;
    setStep("clinical-details");
  };

  const handleEvaluate = () => {
    // issue #20: the Fleischner-bound convention-checked measurement is populated only when the
    // clinician has explicitly affirmed it for a whole-mm value -- never inferred from
    // nodule_size_mm alone, and never emitted for a fractional value the convention could never
    // have produced. The legacy nodule_size_mm value used by S3/BTS is untouched either way.
    // issue #18: the solid-component measurement is populated independently, under its own
    // convention id, only when its own confirmation is checked -- never copied from or derived
    // from the whole-nodule value.
    const evaluationInput: ClinicalInputState = {
      ...input,
      ...(fleischnerConventionConfirmed && isWholeMmDiameter
        ? {
            nodule_diameter_measurements: [
              { valueMm: input.nodule_size_mm as number, conventionId: "fleischner-2017-average-diameter" as const },
            ],
          }
        : {}),
      ...(solidComponentConventionConfirmed && solidComponentSizeMm !== undefined
        ? {
            solid_component_diameter_measurements: [
              {
                valueMm: solidComponentSizeMm,
                conventionId: "fleischner-2017-solid-component-long-axis" as const,
              },
            ],
          }
        : {}),
    };
    const result = evaluate(evaluationInput, activeRelease);
    setTrace(result);
    setStep("results");
  };

  const handleRestart = () => {
    setInput({});
    setTrace(null);
    setShowTrace(false);
    setFleischnerConventionConfirmed(false);
    setSolidComponentSizeMm(undefined);
    setSolidComponentConventionConfirmed(false);
    setStep("pathway");
  };

  const btsNote = useMemo(
    () => activeManifest.notes.find((n) => n.startsWith("BTS is not available")),
    [],
  );

  return (
    <main className="app">
      <header>
        <h1>Colibri Nodule Management</h1>
        <p className="subtitle">
          Incidental, solitary pulmonary nodule &mdash; initial assessment (S3 + Fleischner)
        </p>
      </header>

      {step === "pathway" && (
        <section aria-label="Pathway identification">
          <h2>1. Confirm this pathway applies</h2>
          <p>
            All four fields must be answered before any guideline is evaluated -- pathway
            identification is never guessed.
          </p>
          <div className="field-grid">
            {pathwayFields.map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={input[field.id as keyof ClinicalInputState] as FieldValue}
                onChange={handleChange}
              />
            ))}
          </div>
          {isNoduleCountOutOfScope(input) && (
            <p className="notice notice-block">
              This pathway is scoped to a solitary nodule only. A nodule count of{" "}
              {input.nodule_count} (discrete-multiple or disseminated) is out of scope for this
              vertical slice. Continue is disabled until nodule count is 1.
            </p>
          )}
          <button disabled={!canConfirmPathway} onClick={handleConfirmPathway}>
            Continue
          </button>
        </section>
      )}

      {step === "clinical-details" && (
        <section aria-label="Clinical details">
          <h2>2. Nodule measurement and patient factors</h2>

          {!isFollowUpTimepoint && (
            <>
              <p>Enter diameter and/or volume &mdash; at least one is required.</p>
              <div className="field-grid">
                {measurementFields.map((field) => (
                  <FieldInput
                    key={field.id}
                    field={field}
                    value={input[field.id as keyof ClinicalInputState] as FieldValue}
                    onChange={handleChange}
                  />
                ))}
              </div>
              <label className="field field-checkbox">
                <input
                  type="checkbox"
                  checked={fleischnerConventionConfirmed}
                  disabled={!isWholeMmDiameter}
                  onChange={(e) => setFleischnerConventionConfirmed(e.target.checked)}
                />
                <span>
                  The diameter above was measured using Fleischner&apos;s average-diameter
                  convention (long-axis + perpendicular short-axis average, same plane,
                  greatest-dimension plane, rounded to the nearest whole mm). Required for any
                  Fleischner recommendation at any diameter, regardless of nodule morphology or
                  pathway; leave unchecked if unsure.
                  {input.nodule_size_mm !== undefined && !isWholeMmDiameter && (
                    <> Only available for a whole-millimeter diameter -- this convention rounds to
                    the nearest whole mm before entry.</>
                  )}
                </span>
              </label>

              {showSolidComponentInput && (
                <>
                  <label className="field">
                    <span>Solid-component diameter (mm)</span>
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={solidComponentSizeMm ?? ""}
                      onChange={(e) => handleSolidComponentDiameterChange(e.target.value)}
                    />
                  </label>
                  <label className="field field-checkbox">
                    <input
                      type="checkbox"
                      checked={solidComponentConventionConfirmed}
                      disabled={solidComponentSizeMm === undefined}
                      onChange={(e) => setSolidComponentConventionConfirmed(e.target.checked)}
                    />
                    <span>
                      The solid-component diameter above was measured separately from the whole
                      nodule, using Fleischner&apos;s solid-component long-axis convention (if the
                      solid component&apos;s margins are ill-defined and measurements differ, the
                      larger long-axis value). Required for this recommendation; leave unchecked if
                      unsure. Never copied from the whole-nodule diameter.
                    </span>
                  </label>
                </>
              )}
            </>
          )}

          {showFollowUpCriterionInput && (
            <>
              <p>
                Confirm whether the S3 volume-stability criterion is met for this follow-up
                assessment. This records the clinician&apos;s own assessment against the S3
                criterion (volume increase &lt;25% over approximately one year) &mdash; the app
                does not calculate volume change or elapsed time from prior/current measurements.
              </p>
              <div className="field-grid">
                {followUpFields.map((field) => (
                  <FieldInput
                    key={field.id}
                    field={field}
                    value={input[field.id as keyof ClinicalInputState] as FieldValue}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </>
          )}

          <p>
            Age, malignancy history, and immunocompromise status are used independently by each
            guideline. Leaving one blank only affects the guideline(s) that need it.
          </p>
          <div className="field-grid">
            {applicabilityFields.map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={input[field.id as keyof ClinicalInputState] as FieldValue}
                onChange={handleChange}
              />
            ))}
          </div>
          <div className="button-row">
            <button onClick={() => setStep("pathway")}>Back</button>
            <button disabled={!canEvaluate} onClick={handleEvaluate}>
              Evaluate
            </button>
          </div>
        </section>
      )}

      {step === "results" && trace && (
        <section aria-label="Results">
          <h2>3. Source Evaluation Outcomes</h2>

          {trace.pathwaySelection.state !== "MATCHED" && (
            <p className="notice notice-block">
              This Clinical Input State did not confirm a pathway this tool covers. No guideline
              was evaluated.
            </p>
          )}

          {trace.pathwaySelection.state === "MATCHED" && (
            <ul className="outcome-list">
              {trace.sourceEvaluationOutcomes.map((outcome) => (
                <li key={outcome.recommendationSourceId} className={`outcome outcome-${outcome.state}`}>
                  <h3>{SOURCE_LABELS[outcome.recommendationSourceId] ?? outcome.recommendationSourceId}</h3>
                  <p className="outcome-state">{OUTCOME_LABELS[outcome.state]}</p>
                  {outcome.reason && <p className="outcome-reason">{outcome.reason}</p>}
                  {outcome.state === "RECOMMENDATION" && outcome.recommendation && (
                    <RecommendationView recommendation={outcome.recommendation} />
                  )}
                  {outcome.measurementDiscordance && (
                    <p className="notice">
                      Diameter and volume classify this nodule differently for this source
                      (diameter: {outcome.measurementValues?.diameter} mm, volume:{" "}
                      {outcome.measurementValues?.volume} mm&sup3;). The volume-based
                      classification was used, per this source's measurement-basis rule.
                    </p>
                  )}
                </li>
              ))}
              <li className="outcome outcome-not-in-release">
                <h3>British Thoracic Society (BTS)</h3>
                <p className="outcome-state">Not in this Rule-Set Release</p>
                <p className="outcome-reason">{btsNote}</p>
              </li>
            </ul>
          )}

          <div className="button-row">
            <button onClick={() => setShowTrace((s) => !s)}>
              {showTrace ? "Hide" : "Show"} Decision Execution Trace
            </button>
            <button onClick={handleRestart}>Start over</button>
          </div>

          {showTrace && <pre className="trace">{JSON.stringify(trace, null, 2)}</pre>}
        </section>
      )}
    </main>
  );
}
