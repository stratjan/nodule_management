# Colibri Nodule Management

A web-based clinical decision-support application that reproduces a local SOP for pulmonary nodule management deterministically, transparently, and auditably. It is not an autonomous diagnostic AI system.

## Language

### Core clinical model

**Clinical Input State**:
All currently known findings, nodule characteristics, and context (including prior imaging measurements such as size or volume change) entered through the current decision wizard for the evaluation being performed. Transient structured input, not a patient record — carries no patient identity and is not persisted as a case.
_Avoid_: Patient record, session, case, Case State

**Clinical Pathway**:
A named clinical area within a Rule-Set (e.g. solid nodule follow-up, growth/VDT assessment, Lung-RADS screening) that groups the Gating Rules, Source Applicability Rules, and Atomic Clinical Rules relevant to that area.
_Avoid_: Domain, clinical domain, bounded domain, module

**Gating Rule**:
A rule that determines which Clinical Pathway(s) or special context applies to a Clinical Input State (e.g. incidental finding vs. lung cancer screening, benign morphology early exit), evaluated before any source-specific rule evaluation. Distinct from a Source Applicability Rule, which gates one specific Recommendation Source rather than the Clinical Pathway itself.
_Avoid_: Applicability check, filter

**Source Applicability Rule**:
A rule that determines whether one specific Recommendation Source applies to a Clinical Input State that has already passed the Clinical Pathway's Gating Rule(s) — evaluated per Recommendation Source, before that source's Atomic Clinical Rule(s). Unlike an Atomic Clinical Rule, a match produces no Recommendation, only an applicability determination; a non-match yields a `NOT_APPLICABLE` Source Evaluation Outcome. Governed identically to other clinical logic: stable identity, authored as a Rule Revision with an explicit Approval Status, carries Provenance, schema-validated, and included in a Rule-Set Release only once Approved — never stored as ungoverned source metadata, since it directly changes evaluation outcomes.
_Avoid_: Eligibility check, source metadata, applicability check (ambiguous with Gating Rule)

**Atomic Clinical Rule**:
The smallest unit of clinical logic: a condition over Clinical Input State, scoped to exactly one Recommendation Source, that produces one Recommendation when matched. Two sources disagreeing means two separate Atomic Clinical Rules in the same Clinical Pathway, not one rule with conflicting provenance. Has a stable identity that persists across Rule Revisions.
_Avoid_: Rule (when source scope matters), decision rule

**Clinical Endpoint**:
A terminal recommendation category an Atomic Clinical Rule's action resolves to (e.g. no further surveillance, CT surveillance, PET-CT, biopsy, surgical/local treatment, multidisciplinary review).
_Avoid_: Outcome, result

**Recommendation**:
The single-source output of one Atomic Clinical Rule matching: the Recommendation Source and its version, the matched rule ID, applicability conditions, the resulting Clinical Endpoint/action, interval or threshold where applicable, Rationale, Provenance, and any uncertainty or applicability limitations. Never merged with another source's Recommendation.
_Avoid_: Result, answer, output

**Recommendation Set**:
The full collection of Recommendations produced for one Clinical Input State evaluation — one per Recommendation Source whose Source Evaluation Outcome is `RECOMMENDATION` — presented together rather than reconciled into a single answer. Never includes `NOT_APPLICABLE`, `OUTSIDE_CURRENT_RULESET_SCOPE`, or `INSUFFICIENT_INPUT` entries; those are Source Evaluation Outcomes, carried alongside the Recommendation Set in the Decision Execution Trace, not folded into it. Carried inside the Decision Execution Trace.
_Avoid_: Merged recommendation, consensus recommendation, final recommendation

**Source Evaluation Outcome**:
The result of evaluating one Recommendation Source against a Clinical Input State that has already passed the Clinical Pathway's Gating Rule(s): exactly one of `RECOMMENDATION` (an Approved Atomic Clinical Rule matched — carries the Recommendation), `NOT_APPLICABLE` (that source's Source Applicability Rule did not match), `OUTSIDE_CURRENT_RULESET_SCOPE` (the source is applicable and sufficient input exists, but no Approved Atomic Clinical Rule in the Active Rule-Set Release covers this input), or `INSUFFICIENT_INPUT` (required source-specific input for applicability or rule-matching is missing). Produced once per Recommendation Source per evaluation, carried in the Decision Execution Trace regardless of which state it is — a non-`RECOMMENDATION` outcome is never silently omitted.
_Avoid_: Result, status (ambiguous with Approval Status), applicability (bare, ambiguous with Source Applicability Rule)

**Recommendation Source**:
The authority a given Recommendation is attributed to: either a Source Guideline or the Local SOP itself, on equal footing. When the Local SOP explicitly overrides or selects between Source Guidelines, that override is itself a Recommendation Source with its own Atomic Clinical Rule and provenance, not a silent merge.
_Avoid_: Reference, authority

**Source Guideline**:
An external evidence-based guideline or risk model the Local SOP integrates (e.g. German S3 lung cancer guideline, Fleischner Society, BTS pulmonary nodule guideline, Brock model, Herder model, Lung-RADS/V-Lung-RADS). Identified with a version where the guideline itself is versioned.
_Avoid_: Guideline (ambiguous with Local SOP), source

### Local SOP & provenance

**Local SOP**:
The institutional standard operating procedure that integrates multiple Source Guidelines for this application's clinical domain. Acts as a Recommendation Source in its own right and is the initial scientific source of truth. Kept as a local, gitignored development artifact, not committed to the public repository. Exists as a sequence of Local SOP Versions rather than one fixed document.
_Avoid_: SOP guideline, protocol

**Local SOP Version**:
A versioned revision of the Local SOP document. A new Local SOP Version is a trigger for identifying affected Atomic Clinical Rules and authoring new Rule Revisions for them; a prior Local SOP Version is never edited in place.
_Avoid_: SOP update, new SOP

**Provenance**:
The identity and exact locator of the original-language source substantiating a Recommendation (via its Atomic Clinical Rule) — source document identity, version/publication date, original language, source type, and locator (section, recommendation number, table, figure, page). Remains authoritative for verification regardless of any English rendering. An original-language excerpt may optionally be attached but is never required, and must never be a copyrighted/internal text copied into the public repository or production package.
_Avoid_: Citation, reference (when meaning provenance specifically), source excerpt (as if required)

**Rationale**:
The authored, versioned English clinical explanation for a Recommendation, derived from its Provenance source at authoring time and linked to it explicitly. Application content, not a replacement for the source, and never produced by runtime translation.
_Avoid_: Translation, source text, explanation (when meaning provenance specifically)

### Rule lifecycle & release governance

**Rule Revision**:
A specific content version of an Atomic Clinical Rule, Gating Rule, or Source Applicability Rule. New content for an existing rule is always authored as a new Rule Revision, never an edit in place, and carries its own Approval Status.
_Avoid_: Rule version, rule update

**Approval Status**:
The lifecycle state of a Rule Revision: *Draft* (authored, not yet asserted ready), *Approved* (an explicit, recorded approval event — who, when — asserts clinical authority; schema validity and passing tests are prerequisites, never substitutes, for this event), *Superseded* (an Approved revision replaced by a newer Approved revision of the same rule), or *Rejected* (a Draft explicitly declined rather than approved). The same person may author and approve in v1, but the approval event must always be explicit, never implied by authorship.
_Avoid_: Review status, sign-off

**Rule-Set**:
The versioned collection of Gating Rules, Source Applicability Rules, and Atomic Clinical Rules across all Clinical Pathways.
_Avoid_: Rule package, clinical rule package

**Rule-Set Release**:
An immutable, content-addressable, versioned artifact assembled only from Approved Rule Revisions across Clinical Pathways at a point in time. Never mutated after publication — a later change always produces a new Release. Triggered either by a new Local SOP Version, or by an authoring/implementation-error correction to an already-Approved Rule Revision that fails to faithfully reproduce the current, unchanged Local SOP Version. A change in actual clinical policy or interpretation must originate from a new Local SOP Version, never from a same-version correction.
_Avoid_: Rule-set version (as if mutable), build, deploy

**Active Rule-Set Release**:
The single Rule-Set Release currently designated as in effect for the running application. Promoting a Release to Active is an explicit governance event, distinct from publishing the Release itself. The running application evaluates against the Active Rule-Set Release only; there is no runtime selection of historical releases in v1.
_Avoid_: Current version, latest release

**Release Manifest**:
The record accompanying a Rule-Set Release listing exactly which Rule Revisions (and their approval events) it contains, and which Local SOP Version(s) motivated it where applicable.
_Avoid_: Changelog, release notes

**Decision Execution Trace**:
The structured, reproducible record the deterministic engine produces for one evaluation: the exact Active Rule-Set Release used, normalized Clinical Input State, the applicable Clinical Pathway, the Source Evaluation Outcome for every Recommendation Source in the Active Rule-Set Release (including matched rule IDs and measurement basis/discordance where applicable), the resulting Recommendation Set, and engine/schema version. Ephemeral unless explicitly exported; generated without assuming server-side persistence. Distinct from the Clinical Knowledge Governance Audit, which audits how the knowledge base itself changed, not one evaluation.
_Avoid_: Audit log, decision log, result trace

**Clinical Knowledge Governance Audit**:
The audit trail for how clinical knowledge changed over time: git history, GitHub Issues/PRs/reviews, ADRs, Rule-Set Releases, Release Manifests, and clinical fixture/test history. Exists even though the application itself is a stateless, backend-free PWA — a static application does not mean no audit trail, it means no server-side patient/session audit log.
_Avoid_: Audit log (ambiguous with Decision Execution Trace), compliance log

### Testing

**Golden Clinical Case**:
A human-reviewed fixture pairing a Clinical Input State with its expected Recommendation Set, used as a clinical regression contract. The expected outcome must be authored or reviewed by a human; an implementation agent must never invent the expected answer and use it as test truth. The **Golden Clinical Corpus** is the full collection of Golden Clinical Cases, spanning boundary cases, applicability/exit cases, missing-information cases, source-specific recommendation cases, deliberate multi-guideline divergence cases, and regression cases.
_Avoid_: Test case (when meaning a clinically-reviewed fixture specifically), example
