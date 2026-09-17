---
status: accepted
---

# A same-source Atomic Clinical Rule's unresolved sibling may be non-blocking only as an explicit, directional, governed fact

Issue #15 Candidate B2 exposed a gap in the orchestration ADR-0010 records: ADR-0010 fixes the four-value `SourceEvaluationOutcomeState` vocabulary and requires exactly one Source Evaluation Outcome per Recommendation Source, but says nothing about how multiple Atomic Clinical Rules for the same source should be combined when they disagree in state. `evaluate.ts`'s existing implementation gives any rule-level `INSUFFICIENT_INPUT` absolute precedence over a sibling rule's definite `RECOMMENDATION` — a choice that was never itself specified by an ADR or by issue #20 (which introduced evaluate-all-then-classify), and that happened to be harmless only because every same-source multi-rule pair governed before B1/B2 was mutually exclusive by construction on one shared field. B1 (an existing S3 discharge rule) and B2 (a proposed S3 work-up rule) are the first same-source pair with disjoint required inputs: B1 can match on `s3_volume_stability_criterion_met` alone, B2 can match on `s3_vdt_days` alone, and each is `INSUFFICIENT_INPUT` when only the other rule's field is supplied. Under the existing precedence, adding B2 regressed an already-Approved B1 clinical outcome. Full analysis: issue #30, architecture recommendation in [comment 5718569008](https://github.com/stratjan/nodule_management/issues/30#issuecomment-5718569008).

This ADR extends and clarifies ADR-0010's orchestration; it does not supersede it. ADR-0010's four-value `SourceEvaluationOutcomeState` vocabulary, the "exactly one outcome per Recommendation Source" rule, and the rest of its accepted pipeline remain in force, unmodified and not obsolete.

## Decision

A same-source Atomic Clinical Rule that has definitively matched (`RECOMMENDATION`) may treat a sibling Atomic Clinical Rule's unresolved (`INSUFFICIENT_INPUT`) status as non-blocking **only when that exact directional relationship is an explicit, provenance-backed, governed clinical fact**. The relationship is:

- **directional** — a statement that rule A's own unresolved status does not block rule B's match says nothing about the reverse (B's unresolved status blocking A); the reverse, if needed, is its own, separately governed fact;
- **explicit** — never derived by the engine from rule shape, only ever read from governed data authored for this purpose;
- **governed** — content, subject to the same Rule Revision lifecycle, review, and Approval as every other clinical fact in this Rule-Set (ADR-0007);
- **provenance-backed** — cites the source text/interpretation that justifies it, exactly like every other governed clinical fact (ADR-0003/ADR-0006);
- **review/approval gated** — cannot exist, or take effect, outside the normal Approval lifecycle; an unapproved or absent relation is simply not consulted.

This is explicitly **not**:

- logical independence between the two rules;
- mutual exclusivity;
- equivalence of the two rules' outcomes;
- a priority or precedence ordering between rules;
- rule ordering of any kind (file order, declaration order, or otherwise);
- recommendation convergence (the two rules may produce entirely different clinical endpoints; this decision never merges them);
- permission for the engine to ignore missing input in general — it excuses one named sibling's unresolved status for one named matched rule, nothing broader.

### No inference

The directional relationship is never derived from any of the following, individually or in combination:

- rule or file declaration order;
- rule IDs or names;
- threshold arithmetic (e.g. two numeric ranges appearing disjoint);
- apparent disjointness of the two rules' own conditions;
- free-text rationale;
- equality or similarity of the two rules' recommendation/action content;
- provenance similarity or shared source document;
- the two rules sharing a Recommendation Source;
- the reverse direction having been declared (symmetry is never inferred).

### Source-level aggregation contract

For one Recommendation Source, every sibling Atomic Clinical Rule bound to the matched Clinical Pathway is evaluated (unchanged, evaluate-all-then-classify, issue #20). The source-level result is then determined as follows:

- **More than one definite `RECOMMENDATION`** → `AmbiguousRuleMatchError`, exactly as today. A non-blocking relation never participates in, or suppresses, this check.
- **Exactly one definite `RECOMMENDATION`, every other sibling definitively `OUTSIDE_CURRENT_RULESET_SCOPE`** → return the recommendation. No non-blocking relation is needed here: a sibling that is `OUTSIDE_CURRENT_RULESET_SCOPE` ran to completion with sufficient input and definitively excluded itself; nothing about it remains unresolved.
- **No definite `RECOMMENDATION`, at least one sibling `INSUFFICIENT_INPUT`** → the source result is `INSUFFICIENT_INPUT`, exactly as today.
- **No definite `RECOMMENDATION`, every sibling `OUTSIDE_CURRENT_RULESET_SCOPE`** → `OUTSIDE_CURRENT_RULESET_SCOPE`, exactly as today.
- **Exactly one definite `RECOMMENDATION`, plus one or more siblings `INSUFFICIENT_INPUT`** → the recommendation may be returned **only if every one of those unresolved siblings is explicitly declared non-blocking in the direction from the matched rule to that sibling**. If even one unresolved sibling lacks that specific governed relation, the source result remains the conservative `INSUFFICIENT_INPUT`, exactly as today.

No first-match or file-order semantics are introduced anywhere in this contract.

### Auditability

When a recommendation is emitted despite one or more unresolved, declared-non-blocking sibling rules, that fact must remain visible at the **Source Evaluation Outcome / Decision Execution Trace level** — a reviewer inspecting the trace afterward must be able to see that a sibling rule existed and was unresolved, not just that a recommendation was returned. This is source-level aggregation state, not intrinsic content of the matched Atomic Clinical Rule, and is therefore not required to be duplicated into `RecommendationPayload`. The exact field name and object shape are not decided here; they belong to `/to-spec #30`.

### Provenance and governance for a specific relation

A directional non-blocking relation is clinically material governed content, not engine plumbing. Whichever concrete representation `/to-spec #30` chooses, it must carry:

- stable identity of the referenced sibling rule (by `ruleId`/`revisionId`, never by position or name-matching);
- its own explicit `Provenance` citation, independent of the two rules' own existing provenance;
- the same Rule Revision review/Approval lifecycle as every other governed clinical fact (ADR-0007);
- the same immutable-Release-history discipline as every other governed content (ADR-0007/ADR-0008) — a relation, once part of an Approved, Released rule, is never edited in place.

### Motivating example — B1/B2 (illustrative only, not source-specific engine logic)

Issue #15's S3 follow-up pathway motivated this decision and is recorded here only as an example; no source-specific logic is introduced into the engine or this ADR.

- **B1 → B2**: a definite B1 match (via S3's independently sufficient discharge criterion) is not blocked solely because `s3_vdt_days` is absent.
- **B2 → B1**: a definite B2 match (`s3_vdt_days < 400`) is not blocked solely because `s3_volume_stability_criterion_met` is absent.
- **Both definite**: if both rules definitively match on the same Clinical Input State, `AmbiguousRuleMatchError` still applies, unconditionally.

These are **two separately governed directional relations**, not one symmetric "independence" declaration between B1 and B2. The clinical source interpretation behind each is already recorded on issue #30 (comment 5718569008) and is not reopened or re-derived here.

## Preserved, unmodified

This decision changes only how multiple Atomic Clinical Rules for one source are aggregated when they disagree in state. It leaves unmodified:

- ADR-0010's four `SourceEvaluationOutcomeState` values (`RECOMMENDATION`, `NOT_APPLICABLE`, `OUTSIDE_CURRENT_RULESET_SCOPE`, `INSUFFICIENT_INPUT`) — no fifth state is introduced;
- exactly one Source Evaluation Outcome per Recommendation Source;
- evaluate-all-then-classify (issue #20);
- `AmbiguousRuleMatchError` for genuine multiple definite matches;
- the absence of any first-match/file-order semantics anywhere in the engine;
- ADR-0009's fixed, deterministic, side-effect-free condition vocabulary — no general Boolean/expression language is introduced;
- canonical rule content as inert JSON (ADR-0006);
- the provenance and Approval lifecycle (ADR-0003/ADR-0007);
- immutable Rule-Set Releases (ADR-0007).

## Versioning implication

Implementing this decision will require an additive schema change (the governed relation itself, plus whatever audit structure `/to-spec #30` settles on) and a genuine engine aggregation-contract change in `evaluate.ts` — consistent with this project's own history, that combination has always meant a `SCHEMA_VERSION` and `ENGINE_VERSION` bump together (issues #17/#18/#20/#26/#28 each bumped both). The exact next version numbers are not chosen here; this is a documentation-only step, and no version constant is changed by it.

## Alternatives considered

Full comparative analysis: issue #30. Briefly, why each was rejected in favor of the accepted decision:

- **Keep the existing global `INSUFFICIENT_INPUT` precedence.** Maximally conservative, but empirically regresses an already-Approved B1 outcome and leaves B2 unable to fire in its own primary use case — not viable.
- **Unconditional `RECOMMENDATION` precedence** (let any definite match dominate any unresolved sibling, with no governed relation required). Fixes the same cases, but relies on an unchecked, implicit assumption that every same-source rule pair is genuinely independently sufficient — an assumption this project has already found to fail once before, at a narrower scope (issue #26). Rejected as unsafe by default.
- **Make all branch-discriminating inputs mandatory before evaluating the source.** Would misrepresent the S3 source, which textually treats VDT as a value that may or may not exist for a given follow-up visit, not one every visit must produce — a workflow decision this ADR does not make, and not adopted.
- **Infer independence/equivalence from rule shape.** Rejected outright — see "No inference" above; this project's standing discipline never lets the engine invent a clinical relationship no governed fact states.
- **Introduce a fifth Source Evaluation Outcome state** (e.g. a distinct "recommendation with unresolved sibling" state). Rejected in favor of keeping ADR-0010's four-state vocabulary closed and instead carrying the extra detail as additive information on the existing outcome/trace — smaller, and does not touch the state vocabulary at all.

## Scope boundary

This ADR decides the general semantic contract only. It does not decide:

- the exact field/property name(s) for the directional relation or the audit fact;
- the exact Zod schema shape;
- whether the relation is represented directly on `AtomicClinicalRuleRevision` or via a nested object;
- the exact `releaseBuilder.ts` validations, if any;
- the exact `evaluate.ts` implementation;
- the exact test-file layout;
- the exact `SCHEMA_VERSION`/`ENGINE_VERSION` numbers.

All of the above are `/to-spec #30` concerns.
