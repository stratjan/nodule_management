import type {
  ClinicalActionTiming,
  PersistenceSurveillanceStep,
  Provenance,
  RecommendationPayload,
} from "../engine/types";
import {
  hasMeasurementBasis,
  hasMultiAnchorProvenance,
  isNoRoutineFollowUpRecommendation,
  isPersistenceSurveillanceRecommendation,
  isStructuredRecommendation,
} from "../engine/types";

function TimingView({ timing }: { timing: ClinicalActionTiming }) {
  if (timing.kind === "specified") {
    return <>{timing.intervals.join(", ")}</>;
  }
  return <span className="timing-not-specified">Not specified by source</span>;
}

/** issue #17: `ifPersistent` must render visibly distinct from an unconditional step -- the
 * qualifier is UI-authored render copy, never embedded in the rule's own authored `label`. */
function PersistenceStepView({
  step,
  conditional,
}: {
  step: PersistenceSurveillanceStep;
  conditional: boolean;
}) {
  return (
    <li className="clinical-action">
      <strong>{step.label}</strong>: {step.timing.intervals.join(", ")}
      {conditional && <span className="conditional-qualifier"> (only if persistent)</span>}
    </li>
  );
}

function ProvenanceLine({ label, provenance }: { label: string; provenance: Provenance }) {
  return (
    <p className="provenance">
      {label}: {provenance.sourceDocument} ({provenance.version}), {provenance.locator}
    </p>
  );
}

/**
 * issue #20/#17: renders whichever recommendation and provenance form the matched Atomic Clinical
 * Rule actually declared, without collapsing structured actions, the no-routine-follow-up marker,
 * the persistence-surveillance sequence, or multi-anchor provenance back into one string, and
 * without inventing a primary/secondary hierarchy or a false equal-weight look the source doesn't
 * state.
 */
export function RecommendationView({ recommendation }: { recommendation: RecommendationPayload }) {
  return (
    <div className="recommendation">
      {isStructuredRecommendation(recommendation) ? (
        <ul className="action-list">
          {recommendation.actions.map((action) => (
            <li key={action.label} className="clinical-action">
              <strong>{action.label}</strong>: <TimingView timing={action.timing} />
            </li>
          ))}
        </ul>
      ) : isNoRoutineFollowUpRecommendation(recommendation) ? (
        <p>
          <strong>No routine follow-up</strong>
        </p>
      ) : isPersistenceSurveillanceRecommendation(recommendation) ? (
        <ul className="action-list">
          <PersistenceStepView step={recommendation.persistenceConfirmation} conditional={false} />
          <PersistenceStepView step={recommendation.ifPersistent} conditional={true} />
        </ul>
      ) : (
        <p>
          <strong>{recommendation.clinicalEndpoint}</strong>: {recommendation.intervals.join(", ")}
        </p>
      )}
      <p className="rationale">{recommendation.rationale}</p>
      {hasMultiAnchorProvenance(recommendation) ? (
        <div className="provenance-anchors">
          {recommendation.provenanceAnchors.map((anchor) => (
            <ProvenanceLine
              key={anchor.role}
              label={`Provenance (${anchor.role})`}
              provenance={anchor.provenance}
            />
          ))}
        </div>
      ) : (
        <ProvenanceLine label="Provenance" provenance={recommendation.provenance} />
      )}
      {/* issue #15 Candidate A0: a clinical-condition-shaped match (e.g. the S3 follow-up
          attestation rule) used no physical measurement -- never render a fabricated
          "Measurement basis used" line for it; show its own, accurate audit line instead. */}
      {hasMeasurementBasis(recommendation) ? (
        <p className="basis">Measurement basis used: {recommendation.measurementBasisUsed}</p>
      ) : recommendation.matchedSufficientConditionGroupIds ? (
        // issue #28/#15 Candidate B1: a sufficientConditionGroups-shaped match may have been
        // reached via one or more independently sufficient criteria -- never collapse this into
        // the single "clinician attestation" label below, which would misdescribe a VDT-only
        // match. Render the governed group identity itself, nothing invented beyond it.
        <p className="basis">
          Matched sufficient criteria: {recommendation.matchedSufficientConditionGroupIds.join(", ")}
        </p>
      ) : recommendation.clinicalCriterionUsed ? (
        <p className="basis">Clinical criterion used: clinician attestation</p>
      ) : null}
    </div>
  );
}
