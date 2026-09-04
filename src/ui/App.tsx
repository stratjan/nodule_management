import { useMemo, useState } from "react";
import { evaluate } from "../engine/evaluate";
import type { ClinicalInputState, DecisionExecutionTrace } from "../engine/types";
import { activeRelease } from "../data/activeRelease";
import { activeManifest } from "../data/activeManifest";
import { pathwayFields, measurementFields, applicabilityFields } from "../workflow/fields";
import { canContinuePastPathwayStep, isNoduleCountOutOfScope } from "../workflow/pathwayNavigation";
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

  const handleChange = (id: string, value: FieldValue) => {
    setInput((prev) => ({ ...prev, [id]: value }));
    // issue #20 review: the affirmation is only ever valid for the diameter value it was given
    // for -- any edit to that value (including clearing it) invalidates a prior affirmation, so
    // it must never silently carry over and get tagged onto a new, unaffirmed value.
    if (id === "nodule_size_mm") {
      setFleischnerConventionConfirmed(false);
    }
  };

  const hasMeasurement = input.nodule_size_mm !== undefined || input.nodule_volume_mm3 !== undefined;

  // issue #20 review: Fleischner's average-diameter convention resolves to a whole-mm value
  // before a clinician would ever enter it -- a fractional diameter can never legitimately be
  // affirmed under this convention, so the affirmation control is only offered for whole-mm
  // values.
  const isWholeMmDiameter =
    input.nodule_size_mm !== undefined && Number.isInteger(input.nodule_size_mm);

  const canConfirmPathway = canContinuePastPathwayStep(input);
  const canEvaluate = hasMeasurement;

  const handleConfirmPathway = () => {
    if (!canConfirmPathway) return;
    setStep("clinical-details");
  };

  const handleEvaluate = () => {
    // issue #20: the Fleischner-bound convention-checked measurement is populated only when the
    // clinician has explicitly affirmed it for a whole-mm value -- never inferred from
    // nodule_size_mm alone, and never emitted for a fractional value the convention could never
    // have produced. The legacy nodule_size_mm value used by S3/BTS is untouched either way.
    const evaluationInput: ClinicalInputState =
      fleischnerConventionConfirmed && isWholeMmDiameter
        ? {
            ...input,
            nodule_diameter_measurements: [
              { valueMm: input.nodule_size_mm as number, conventionId: "fleischner-2017-average-diameter" },
            ],
          }
        : input;
    const result = evaluate(evaluationInput, activeRelease);
    setTrace(result);
    setStep("results");
  };

  const handleRestart = () => {
    setInput({});
    setTrace(null);
    setShowTrace(false);
    setFleischnerConventionConfirmed(false);
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
          Incidental, solitary, solid pulmonary nodule &mdash; initial assessment (S3 + Fleischner)
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
              The diameter above was measured using Fleischner&apos;s average-diameter convention
              (long-axis + perpendicular short-axis average, same plane, greatest-dimension plane,
              rounded to the nearest whole mm). Required for any Fleischner recommendation (6mm
              and above); leave unchecked if unsure.
              {input.nodule_size_mm !== undefined && !isWholeMmDiameter && (
                <> Only available for a whole-millimeter diameter -- this convention rounds to the
                nearest whole mm before entry.</>
              )}
            </span>
          </label>
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

          {!trace.clinicalPathwayGate.passed && (
            <p className="notice notice-block">
              This Clinical Input State did not confirm the pathway this tool covers. No
              guideline was evaluated.
            </p>
          )}

          {trace.clinicalPathwayGate.passed && (
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
