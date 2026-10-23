---
status: accepted
---

# Explicit terminal states, governed clinician-directed dispositions, and guided-UI completeness

Issue #16's multiple-solid `>=6 mm` follow-up work exposed three gaps that ADR-0010's orchestration cannot close without new architecture:

1. **No lawful place for a clinician's own decision.** A clinician may decide, on the basis of interval imaging and overall context, that no further routine nodule surveillance is planned. That decision is not a Recommendation, has no Recommendation Source, and must never be attributed to Fleischner or shown as `NoRoutineFollowUpRecommendationContent`. ADR-0010's pipeline only knows source-attributed outcomes, so there is nowhere to put it.
2. **Binary condition evaluation lets a missing value hide a known contradiction.** A bare-`conditions` Atomic Clinical Rule is evaluated with the binary `evaluateConditions()`, so any missing value for a referenced field yields `INSUFFICIENT_INPUT`, even when another supplied value already rules the rule out. In the #16 follow-up, a not-confirmed governing-lesion safeguard plus an unasked (and now irrelevant) risk category would yield `INSUFFICIENT_INPUT` instead of a definite terminal state.
3. **No completeness contract for the guided UI.** The product now requires every fully completed guided path to end in an explicit, clinically meaningful state. Today several completed guided paths end in `INSUFFICIENT_INPUT` by design.

Full analysis: issue #16 architecture report [6337918762](https://github.com/stratjan/nodule_management/issues/16#issuecomment-6337918762). Clinical/Product decisions Q1–Q7: [6338095264](https://github.com/stratjan/nodule_management/issues/16#issuecomment-6338095264).

This ADR **extends** ADR-0010. It does not supersede it. ADR-0010's four Source Evaluation Outcome states and their meanings, and the rule that every source evaluated produces exactly one outcome, remain in force. ADR-0011 is unchanged.

## Decision

### 1. A terminal state is broader than a Recommendation

A completed clinical decision path may end in any of these:

- a source-defined Recommendation;
- a source `NOT_APPLICABLE` outcome;
- `OUTSIDE_CURRENT_RULESET_SCOPE`;
- a clinician-directed disposition (§3);
- a reserved, future scientific/source-gap state (§7);
- another explicitly governed terminal classification, introduced by its own reviewed decision.

The engine must never invent a Recommendation just to make a decision path complete.

### 2. `INSUFFICIENT_INPUT` stays engine-level fail-closed behaviour

`INSUFFICIENT_INPUT` is not an error. It remains the correct engine outcome for an incomplete, malformed, stale, or externally constructed Clinical Input State, and raw engine callers can still receive it.

The guided product makes a separate promise (§6): **a fully completed guided path must not end in `INSUFFICIENT_INPUT`.** That promise constrains the UI. It does not change what the engine is allowed to return.

This ADR uses three related terms that overlap but are not interchangeable:

- **Missing value:** a concrete input value is absent from the Clinical Input State.
- **Unresolved required input:** the engine cannot complete a governed decision (pathway selection, disposition stage, source applicability, or Atomic Clinical Rule matching) because required clinical input has not been resolved. A missing value is the most common cause, but not the only possible one: for example, a measurement may be present but not bound to the required convention, or two entries may be ambiguous.
- **`INSUFFICIENT_INPUT`:** the engine-level outcome or state that is produced because required input remains unresolved.

**Explicit uncertainty** (a clinician actively answering "unknown", "unsure" or "cannot confirm") is a separate concept. It is an answer, not an absence. How it is treated is governed by §6 and HITL Q5.

### 3. A new governed `clinical-disposition` Rule Revision kind

A **Clinical Disposition Rule** is a fourth governed Rule Revision kind, next to the Gating Rule (implemented as the `pathway-gate` kind and called "Clinical Pathway Gating Rule" in ADR-0010; this ADR uses "Pathway Gate" for it), the Source Applicability Rule, and the Atomic Clinical Rule. It is not a Gating Rule: it never decides which Clinical Pathway applies. When it matches, the result is a **Clinical Disposition**: the recorded terminal decision of the clinician.

**Governance**
- It is inert JSON (ADR-0006).
- It follows the same Rule Revision lifecycle as every other kind: Draft / Approved / Superseded / Rejected, with an explicit approval event (ADR-0007).
- It is assembled into Rule-Set Releases only once Approved, and listed in the Release Manifest.

**Structure**
- `clinicalPathwayId` is required. A disposition rule belongs to exactly one Clinical Pathway.
- Conditions use only the existing fixed `Condition` vocabulary (ADR-0009): AND-only, no new operator, no executable content.
- The disposition content is a closed vocabulary. Its only initial member is `clinician-directed-no-further-routine-surveillance`. It is not extended in advance; each new member needs its own review.
- Provenance cites the Clinical/Product decision that authorizes the disposition. It is never presented as a Source Guideline citation.
- No free-text reason, patient identifier, or narrative case record is ever stored (ADR-0002).

**Evaluation**
- Classification is three-valued (`classifyConditions`, the same semantics as Pathway Gates).
- Every disposition rule bound to the matched pathway is evaluated. There is no order and no priority.
- At most one disposition can be terminal per evaluation. If more than one matches, a typed ambiguity error is thrown (mirroring `AmbiguousPathwayMatchError`). It is never encoded as an outcome.
- Clinical ordering, for example "the safeguard is confirmed before omission can be chosen", is expressed in the rule's own conditions. The engine never orders rules.

**What "source-independent" means.** A Clinical Disposition is not *attributed* to any Recommendation Source, and it does not depend on any source's applicability or rule evaluation. Its conditions may still reference any Clinical Input State fact, including a source-specific clinician attestation. Issue #16 needs exactly that: the Fleischner-named governing-lesion safeguard must be confirmed before the decision to omit surveillance can match. Referencing such a fact in a condition does not attribute the disposition to that source.

**Separation from Recommendations**
- A Clinical Disposition has no Recommendation Source.
- It never enters the Recommendation Set.
- It is not Recommendation Content and never reuses `NoRoutineFollowUpRecommendationContent`.
- It is not a Clinical Endpoint of any Atomic Clinical Rule.
- It is carried explicitly in the Decision Execution Trace.

**Effect**
- A matched disposition ends evaluation **before** any Source Applicability Rule runs (HITL Q1).
- The trace then shows the matched pathway, the disposition evaluation, the disposition, empty `sourceEvaluationOutcomes`, and an empty `recommendationSet`.
- This makes no claim about whether any source was applicable. A disposition must never be rendered as a source's `NOT_APPLICABLE` or "no routine follow-up".
- Whenever a source Recommendation is produced, that source's applicability is evaluated normally and completely.

### 4. Orchestration extension of ADR-0010

```
Clinical Input State
  → Clinical Pathway Gate(s)                        [unchanged]
  → matched Clinical Pathway
  → Clinical Disposition stage                      [NEW; only if the pathway has bound disposition rules;
                                                     no bound rules → stage skipped, continue]
      → more than one MATCHED
           → typed ambiguity / authoring-defect error (thrown, never an outcome)
      → exactly one MATCHED
           → terminal Clinical Disposition
           → no source evaluation
      → zero MATCHED, any INDETERMINATE
           → INSUFFICIENT_INPUT (disposition stage; not a Clinical Disposition)
           → no source evaluation
      → all NOT_MATCHED
           → continue
  → per-source Source Applicability Rule            [unchanged]
  → per-source Atomic Clinical Rule evaluation      [bare-conditions classification per §5]
  → Source Evaluation Outcome (ADR-0010's four states, unchanged)
  → Recommendation Set (RECOMMENDATION entries only — unchanged)
  → Decision Execution Trace
```

The disposition stage writes a trace entry only for a pathway that has at least one bound disposition rule. That entry lists every bound rule's classification and the stage result. Pathways and historical Releases without disposition rules follow ADR-0010's orchestration exactly as before (see §10 for additive trace data).

**ADR-0010 is extended by this pre-source stage.** Once a Clinical Pathway is matched, Source Applicability evaluation is skipped if the governed Clinical Disposition stage terminates evaluation, either:

1. because exactly one Clinical Disposition Rule matched and produced a terminal Clinical Disposition; or
2. because the disposition stage cannot be resolved due to unresolved required input, and therefore terminates with `INSUFFICIENT_INPUT`.

In both cases:
- no Recommendation Source is evaluated;
- no Source Evaluation Outcome is fabricated;
- the Decision Execution Trace records, in the disposition-stage entry, why source evaluation did not occur.

Case 2 is not a Clinical Disposition and is never rendered as one. It is the same fail-closed `INSUFFICIENT_INPUT` that §2 describes, raised at the disposition stage.

Evaluation continues to ADR-0010's source evaluation, unchanged, when the matched pathway has no bound disposition rules, or when every bound disposition rule is definitively `NOT_MATCHED`. More than one `MATCHED` rule is a typed authoring-defect error, never an outcome.

Both stops follow the existing precedent of a non-matched pathway, which also produces no Source Evaluation Outcome and records why in the trace. ADR-0010's phrase "every Recommendation Source in the Active Rule-Set Release is then evaluated independently" therefore now holds **unless the Clinical Disposition stage has terminated evaluation** in one of the two ways above. These two stop conditions are this ADR's only changes to ADR-0010's orchestration.

**Disposition input is resolved before source evaluation.** A direct consequence of case 2, not a new priority rule: if a pathway has bound Clinical Disposition Rules whose conditions need a clinician answer, that input must be resolved (including a definite "no") before any source on that pathway is evaluated. Exact Candidate-D UI wording is left to specification.

§5 also makes one reading of ADR-0010 explicit, without changing any outcome state or its meaning. For a bare-`conditions` rule, "sufficient input exists" (`OUTSIDE_CURRENT_RULESET_SCOPE`) and "required input is missing" (`INSUFFICIENT_INPUT`) are judged by whether the supplied input is sufficient to *decide* the rule. A supplied contradiction is sufficient to decide it. Measurement rules (the part-solid pre-check, issue #18) and `sufficientConditionGroups` (issue #28) already follow this reading.

### 5. Three-valued classification for bare-`conditions` Atomic Clinical Rules

For an Atomic Clinical Rule whose evaluation shape is bare `conditions`, a known contradiction must not be hidden by a missing value for a different condition:

| Classification | When | Result |
|---|---|---|
| `MATCHED` | every condition is present and satisfied | Recommendation |
| `NOT_MATCHED` | any supplied value contradicts a condition | the existing non-match handling (`OUTSIDE_CURRENT_RULESET_SCOPE` for the rule) |
| `INDETERMINATE` | no contradiction, at least one value missing | `INSUFFICIENT_INPUT` |

This applies the principle Pathway Gates already follow (issue #17), which the part-solid pre-check (issue #18) applies to measurement rules and `sufficientConditionGroups` apply per group (issue #28).

**Not changed:**
- Source Applicability Rules keep their current binary semantics. Changing them would change historical outcomes.
- Measurement-shaped rules are not changed.
- ADR-0011 aggregation is not changed.

**Historical neutrality:** every bare-`conditions` Atomic Clinical Rule in all 13 existing Rule-Set Releases references exactly one field (architecture report 6337918762, finding F8). With one field, binary and three-valued classification give identical results, so this change cannot alter any historical outcome. The implementation must regression-test this:
- an equivalence check of historical evaluations under the old and new behaviour;
- an assertion that every historical bare-`conditions` rule has exactly one condition.

A future multi-condition bare-`conditions` rule is then a deliberate, reviewed event.

### 6. Guided-UI completeness: the engine is the oracle

**The invariant:** a guided UI must be able to determine unresolved required clinical input from structured Decision Execution Trace data alone.

- **The engine is the clinical authority.** Workflow and UI code never re-implement which inputs a rule needs, or whether it matches. They are not a second rule engine.
- **Obtaining the trace.** Workflow may evaluate the current Clinical Input State with the deterministic engine (a dry run, or pre-evaluation) to obtain a trace. `evaluate()` is pure, so this has no side effects.
- **Completeness comes from structured trace data only.** A guided path is not presented as complete, and final evaluation is not offered as complete, while the structured trace data reports unresolved required input. That applies at pathway selection, at the disposition stage, or in any Source Evaluation Outcome. A valid explicit terminal state (§1) is complete. Within the states this ADR covers, `INSUFFICIENT_INPUT` is the state that signals incompleteness.
- **`NO_PATHWAY_MATCHED` is not classified here.** This ADR does not decide whether a pathway-selection `NO_PATHWAY_MATCHED` is an explicit terminal classification for a guided path or lies outside this taxonomy. A guided user can reach it today: for example, a solitary pure-ground-glass or part-solid nodule at follow-up passes pathway navigation, but no gate covers it. This ADR does not decide that `NO_PATHWAY_MATCHED` is incomplete, and does not decide that it is complete. Classifying it is an explicit open question for the retrofit work package (issue #40).
- **No `reason` parsing.** Human-readable `reason` is never the machine-readable source of completeness information. It is explanatory text for humans only. Workflow and UI must never parse, inspect, regex-match, or infer completeness, or which input is unresolved, from `reason` text.
- **Structured unresolved-input information is required.** Every `INSUFFICIENT_INPUT` state that a guided user path can encounter must expose structured information that tells the workflow which unresolved required input remains.
  - This requirement is global. It is not specific to the disposition stage. It applies equally to `INSUFFICIENT_INPUT` from Source Applicability Rules, from Atomic Clinical Rules, and from any other guided unresolved-input state, so it appears on existing pathways that have no Clinical Disposition Rules.
  - Pathway Gates already report `missingFields`.
  - Source Evaluation Outcomes today carry it only in `reason`, so implementing this ADR needs an additive, optional structured representation in the trace.
  - It must be sufficient for the guided UI to identify the unresolved required input without parsing `reason`.
  - Its exact form and property name are left to the implementation specification (`/to-spec`), for example a list of unresolved required inputs, typed field references, or structured input descriptors. It must be able to express unresolved required input that is not a single missing scalar value (see §2).
- **Every unresolved required input has an interaction.** Every unresolved required input reachable through the guided workflow must correspond to an answerable UI interaction on that path.
- **Workflow still owns presentation.** Workflow decides which questions to show and in what order. It never decides clinical outcomes.
- **Raw callers are unaffected.** Raw engine evaluation may still legitimately return `INSUFFICIENT_INPUT`.
- **Explicit uncertainty is not absence (HITL Q5).** A required question left unanswered blocks completion. Where an explicit "unknown / unsure / cannot confirm" answer is offered, it must either block completion or map to an explicit, clinically meaningful terminal state. That choice is made per question by Clinical/Product review.
- **Rollout.** Retrofitting existing guided pathways to this contract is a separate work package (issue #40). Product-wide compliance must not be claimed before that retrofit is done. New pathways comply from the start.

### 7. Scientific/source gap versus Rule-Set coverage gap

These are different claims and are never merged.

- **Rule-Set coverage gap:** `OUTSIDE_CURRENT_RULESET_SCOPE`, with its existing meaning (CONTEXT.md, ADR-0010). The source may govern the state, but no Approved Atomic Clinical Rule in the Active Rule-Set Release covers it. This stays the default whenever an applicable source has no matching approved rule.
- **Scientific/source-definition gap:** the source itself gives no sufficiently determinate recommendation for a fully characterized state.

**No match does not mean the source is silent.** A source-gap state:
- is never inferred from no Atomic Clinical Rule matching;
- can only come from an explicit, governed, Approved declaration with provenance that names which source was reviewed and where;
- belongs to one Recommendation Source, so it would be a Source Evaluation Outcome;
- stays outside the Recommendation Set;
- is never represented as Recommendation Content, and in particular never as `NoRoutineFollowUpRecommendationContent`.

**Implementation is deferred** until the first source gap has been verified by research and approved by Clinical/Product. This ADR reserves the meaning only. Until then:
- no Release can produce a source-gap state;
- ADR-0010's four-state vocabulary is unchanged;
- no identifier, schema shape or declaration kind is fixed here.

### 8. Recommendation and source integrity: rejected alternatives

- **A "clinician" Recommendation Source.** This contradicts the CONTEXT.md definition (a Recommendation Source is a Source Guideline or the Local SOP). It would put a clinician's decision into the Recommendation Set, and under ADR-0001's collect-all evaluation it would sit next to a contradicting source output.
- **A clinician disposition rendered as a Fleischner (or any source's) recommendation, or as that source's `NOT_APPLICABLE`.** Rejected.
- **Reusing `NoRoutineFollowUpRecommendationContent`** for a clinician decision. Rejected.
- **A React/workflow-only exit.** It puts clinical semantics outside inert JSON (ADR-0006). It also lets `evaluate()` and the UI disagree for the same input, and the trace would not record why the result occurred.
- **A special Clinical Pathway or gate representing the disposition.** This mixes pathway identity with a management decision. A pathway with no Atomic Clinical Rule is skipped silently and would carry no stated meaning.
- **A hard-coded source- or pathway-specific terminal flag in TypeScript.** It puts clinical preconditions in code (ADR-0006/0009).
- **Excusing unresolved required input with ADR-0011 non-blocking relations.** Those relations govern two same-source *recommendations*. Using them here would still produce a source-attributed result.
- **Three-valued Source Applicability Rules.** Rejected for now because it changes historical outcomes (§5).

### 9. Pathway identity is not current-management eligibility

Illustrative only; this is not general policy. In issue #16, the multiple-solid `>=6 mm` follow-up episode is identified by an explicitly attested **episode origin**, not by requiring the original set composition to persist (HITL Q2). Requiring any of these at follow-up would make regression, resolution, or reduction to a single remaining nodule unable to reach the clinician's disposition:
- `nodule_count >= 2`;
- a solid-only set;
- a discrete/circumscribed set;
- a `>=6 mm` size state.

The **origin** attestation answers "which episode is this". It is not the same as **eligibility**: whether current findings still support a source-derived surveillance branch. The two must not be merged, and this ADR defines no eligibility criterion.

Two constraints apply to the #16 follow-up specification. They come from #16 HITL Q2 and the existing gate architecture; they are not new general policy:
- **Pathway exclusivity by construction** (existing architecture) stays binding. `AmbiguousPathwayMatchError` must remain unreachable, including against the solitary-solid follow-up gate. Per HITL Q2, this must be achieved without reintroducing a follow-up multiplicity requirement. The concrete discriminator is a matter for specification.
- **An unsupported eligibility state** (HITL Q2) must end in an explicit, recognized non-recommendation terminal state, governed under §1. It must never be invented surveillance, and it must never be treated as the clinician-directed disposition.

### 10. Historical compatibility

- Historical Rule-Set Release and Release Manifest artifacts stay byte-for-byte immutable. The existing immutability and reproducibility guards apply unchanged.
- Historical Releases still parse. The new revision kind and its closed vocabulary are additive.
- This ADR adds two separate kinds of trace data, and they are never conflated:
  - **Disposition-stage trace data** is present only when the matched pathway has bound Clinical Disposition Rules. It is absent wherever that stage does not exist for the pathway, which includes every historical Release.
  - **Structured unresolved-required-input data (§6)** is not specific to the disposition stage. It may accompany any `INSUFFICIENT_INPUT` reachable through guided evaluation, including on pathways without disposition rules and when a historical Release is executed by a newer engine. It is additive, and optional in the serialized trace shape where appropriate.
- Historical compatibility is judged on **clinical semantics**, not on literal deep equality with additive trace metadata. Executing a historical Release with the newer engine must preserve:
  - pathway-selection semantics;
  - each Source Evaluation Outcome's state;
  - Recommendation content;
  - Recommendation attribution;
  - clinically meaningful `reason` semantics, where they are currently contractual;
  - Recommendation Set contents.
- Additive structured trace metadata required by this ADR may appear when a historical Release is executed by a newer engine. That does not reinterpret the historical governed clinical content.
- No historical Recommendation may change, and no historical Source Evaluation Outcome may change merely because of this ADR. They contain no disposition rules, and §5 is outcome-neutral for their content. Both claims are regression-tested.
- Regression tests that currently assert deep structural equality must be updated by the implementation where they would include the new additive, non-clinical trace metadata. They must keep asserting every clinical-semantic property listed above.
- No historical Recommendation, Atomic Clinical Rule, or provenance is reinterpreted.

### 11. Versioning implication

Implementing this decision requires **both** a `SCHEMA_VERSION` and an `ENGINE_VERSION` bump:

- **Schema:** a new governed revision kind in the closed rule-revision and Manifest `kind` vocabularies, plus the closed disposition vocabulary.
- **Engine:** a new orchestration stage, the changed bare-`conditions` classification, and new trace semantics. This is a genuine engine change, not a lockstep bump.

Any new Clinical Pathway id a follow-up pathway introduces is a schema change too (issue #16 Candidate A/C precedent). The exact numbers are chosen in the implementation specification. Implementing a source-gap state later (§7) will need its own further bump.

## Preserved, unmodified

This ADR leaves the following unchanged:

- ADR-0001: recommendations are collected, never merged; the Recommendation Set holds source Recommendations only.
- ADR-0002: no patient record. The episode-origin attestation is transient Clinical Input State.
- ADR-0003: provenance and rationale rules.
- ADR-0005: the engine keeps zero UI dependency. The UI consults the engine, never the reverse.
- ADR-0006: canonical clinical content is inert JSON.
- ADR-0007: approval lifecycle and immutable Releases.
- ADR-0009: the fixed operator vocabulary, and no general rules engine.
- ADR-0010: four Source Evaluation Outcome states and their meanings, and exactly one outcome per evaluated source. ADR-0010 is extended by the §4 pre-source Clinical Disposition stage, whose two stop conditions (a matched Clinical Disposition, or disposition-stage `INSUFFICIENT_INPUT`) are the only orchestration changes. §5 makes the "sufficient to decide" reading explicit for bare-`conditions` rules.
- ADR-0011: in full.

## Scope boundary

This ADR does not decide:

- exact field, type, or schema identifiers;
- the shape of the trace entry for the disposition stage;
- the exact structured representation of unresolved required input (§6);
- the follow-up Clinical Pathway id or its gate conditions;
- the gate discriminator against the solitary-solid follow-up pathway;
- the criterion for continued-surveillance eligibility, or how its terminal state is represented;
- the UI wording beyond the HITL Q3 semantic contract;
- the source-gap identifier or declaration kind;
- the exact version numbers;
- the plan for retrofitting existing pathways.

All of these belong to subsequent Clinical/Product specification and `/to-spec` work.

When this ADR is accepted and rolled out, CONTEXT.md needs these updates:
- new glossary entries for **Clinical Disposition Rule** and **Clinical Disposition**;
- the Rule Revision and Rule-Set entries extended to list the fourth kind;
- the **Decision Execution Trace** entry, which currently says the trace carries a Source Evaluation Outcome for every Recommendation Source, given the §4 pre-source stop carve-out (a matched Clinical Disposition, or disposition-stage `INSUFFICIENT_INPUT`).

No existing term's core meaning is redefined.
