import type { ClinicalActionTiming, Provenance, RecommendationPayload } from "../engine/types";
import { hasMultiAnchorProvenance, isStructuredRecommendation } from "../engine/types";

function TimingView({ timing }: { timing: ClinicalActionTiming }) {
  if (timing.kind === "specified") {
    return <>{timing.intervals.join(", ")}</>;
  }
  return <span className="timing-not-specified">Not specified by source</span>;
}

function ProvenanceLine({ label, provenance }: { label: string; provenance: Provenance }) {
  return (
    <p className="provenance">
      {label}: {provenance.sourceDocument} ({provenance.version}), {provenance.locator}
    </p>
  );
}

/**
 * issue #20: renders whichever recommendation and provenance form the matched Atomic Clinical
 * Rule actually declared, without collapsing structured actions or multi-anchor provenance back
 * into one string, and without inventing a primary/secondary hierarchy the source doesn't state.
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
      <p className="basis">Measurement basis used: {recommendation.measurementBasisUsed}</p>
    </div>
  );
}
