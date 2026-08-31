---
status: accepted
supersedes: "ADR-0009 (orchestration description only)"
---

# Explicit Source Applicability and Source Evaluation Outcomes in rule orchestration

ADR-0009 described the orchestration pipeline as `Clinical Input State → Gating Rules → applicable Clinical Pathway(s) → evaluate all applicable Atomic Clinical Rules independently → collect source-specific Recommendations → Recommendation Set → Decision Execution Trace`. This flattened two distinct concerns into one step: whether a Recommendation Source applies to this patient at all (age, malignancy history, immunocompromise) and whether that source's Atomic Clinical Rules actually match the input (size, morphology). Issue #7's revision pass 1 found this flattening produced a false result — a source whose size bucket simply isn't authored into the current Rule-Set Release read as clinically inapplicable to the patient, when the two are different claims. CONTEXT.md's `Source Applicability Rule` and `Source Evaluation Outcome` entries (added in the revision-pass-2 documentation normalization) formalize the un-flattened pipeline; this ADR records that as the approved orchestration, superseding only ADR-0009's diagram.

The now-approved pipeline:

```
Clinical Input State
  → Clinical Pathway Gating Rule(s)
  → applicable Clinical Pathway
  → per-source Source Applicability Rule
  → per-source Atomic Clinical Rule evaluation
  → Source Evaluation Outcome
      - RECOMMENDATION
      - NOT_APPLICABLE
      - OUTSIDE_CURRENT_RULESET_SCOPE
      - INSUFFICIENT_INPUT
  → Recommendation Set (containing only RECOMMENDATION-state entries)
  → Decision Execution Trace
```

The Clinical Pathway Gating Rule(s) establish pathway identity only (e.g. solid/incidental/initial/solitary) and run once, before any Recommendation Source is considered. Within an applicable Clinical Pathway, every Recommendation Source in the Active Rule-Set Release is then evaluated independently: first its own Source Applicability Rule (does this source apply to this patient at all — age, malignancy history, immunocompromise), then, only if applicable and sufficient input exists, its Atomic Clinical Rule(s). Each source produces exactly one Source Evaluation Outcome — `RECOMMENDATION` when an Approved Atomic Clinical Rule matched, `NOT_APPLICABLE` when the source's own Source Applicability Rule didn't match, `OUTSIDE_CURRENT_RULESET_SCOPE` when the source applies and sufficient input exists but no Approved Atomic Clinical Rule in the current Release covers this input, or `INSUFFICIENT_INPUT` when required source-specific input is missing. Every outcome is carried in the Decision Execution Trace regardless of state; the Recommendation Set is the subset carrying `RECOMMENDATION` only, never the other three states folded in.

This ADR supersedes only ADR-0009's orchestration diagram and its use of "Recommendation Set" as the pipeline's terminal collection step. ADR-0009's accepted decisions are otherwise unchanged and remain in force: a custom minimal interpreter (not a general-purpose rules engine), canonical rule data as inert JSON, a fixed, deterministic, side-effect-free operator vocabulary, and no arbitrary executable rule content. A Source Applicability Rule is evaluated with exactly the same condition vocabulary and interpreter as a Gating Rule or Atomic Clinical Rule — it introduces no new operators, no new execution model, and no exception to ADR-0009's inert-JSON requirement.
