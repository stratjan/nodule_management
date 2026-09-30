import { FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT } from "../workflow/fields";

export function FleischnerRiskDecisionSupport() {
  return (
    <aside className="decision-support" aria-label="Fleischner risk decision support">
      <h3>{FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.heading}</h3>
      <ul>
        {FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}
