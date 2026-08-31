import { useMemo, useState } from "react";
import { evaluate } from "../engine/evaluate";
import type { ClinicalInputState, DecisionExecutionTrace } from "../engine/types";
import { activeRelease } from "../data/activeRelease";
import { activeManifest } from "../data/activeManifest";
import { pathwayFields, measurementFields, applicabilityFields } from "../workflow/fields";
import { canContinuePastPathwayStep, isNoduleCountOutOfScope } from "../workflow/pathwayNavigation";
import { FieldInput } from "./FieldInput";

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

  const handleChange = (id: string, value: FieldValue) => {
    setInput((prev) => ({ ...prev, [id]: value }));
  };

  const hasMeasurement = input.nodule_size_mm !== undefined || input.nodule_volume_mm3 !== undefined;

  const canConfirmPathway = canContinuePastPathwayStep(input);
  const canEvaluate = hasMeasurement;

  const handleConfirmPathway = () => {
    if (!canConfirmPathway) return;
    setStep("clinical-details");
  };

  const handleEvaluate = () => {
    const result = evaluate(input, activeRelease);
    setTrace(result);
    setStep("results");
  };

  const handleRestart = () => {
    setInput({});
    setTrace(null);
    setShowTrace(false);
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
                    <div className="recommendation">
                      <p>
                        <strong>{outcome.recommendation.clinicalEndpoint}</strong>:{" "}
                        {outcome.recommendation.intervals.join(", ")}
                      </p>
                      <p className="rationale">{outcome.recommendation.rationale}</p>
                      <p className="provenance">
                        Provenance: {outcome.recommendation.provenance.sourceDocument} (
                        {outcome.recommendation.provenance.version}),{" "}
                        {outcome.recommendation.provenance.locator}
                      </p>
                      <p className="basis">
                        Measurement basis used: {outcome.recommendation.measurementBasisUsed}
                      </p>
                    </div>
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
