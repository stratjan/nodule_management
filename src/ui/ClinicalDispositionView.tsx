import type { ClinicalDisposition } from "../engine/types";
import { CLINICAL_DISPOSITION_HEADINGS } from "../workflow/fields";

/**
 * issue #16 Candidate D (ADR-0012 §3; HITL Q1/Q3): presentation only. Renders a terminal
 * clinician-directed disposition in place of the Source Evaluation Outcome list -- never as a
 * source outcome, never with a source label, and never as "no routine follow-up" recommendation
 * content.
 */
export function ClinicalDispositionView({ disposition }: { disposition: ClinicalDisposition }) {
  const { provenance } = disposition;
  return (
    <div className="clinical-disposition">
      <h3>{CLINICAL_DISPOSITION_HEADINGS[disposition.dispositionKind]}</h3>
      <p className="disposition-statement">{disposition.statement}</p>
      <p className="rationale">{disposition.rationale}</p>
      <p className="provenance">
        Provenance: {provenance.sourceDocument} ({provenance.version}), {provenance.locator}
      </p>
    </div>
  );
}
