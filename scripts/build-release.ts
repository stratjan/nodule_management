// Dev-time governance tooling (ADR-0007): assembles the Phase 1 Rule-Set Release from the
// Approved Rule Revisions in clinical/rules/, writes the immutable release artifact + Release
// Manifest, and updates the explicit, version-controlled Active Rule-Set pointer. Run via
// `npm run release:build`. Not imported by the browser UI runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuleSetRelease, requireApprovalEvent } from "../src/engine/releaseBuilder";
import {
  ruleRevisionSchema,
  ruleSetReleaseSchema,
  releaseManifestSchema,
  activeRuleSetPointerSchema,
  localSopSnapshotSchema,
} from "../src/engine/schema";
import type { ReleaseManifest, ReleaseManifestEntry, RuleRevision } from "../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const ruleFiles = [
  "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json",
  "clinical/rules/pathway/gr-2-incidental-solitary-pure-ggn-initial.json",
  "clinical/rules/pathway/gr-3-incidental-solitary-part-solid-initial.json",
  "clinical/rules/pathway/gr-4-incidental-solitary-solid-follow-up.json",
  "clinical/rules/applicability/s3-applicability.json",
  "clinical/rules/applicability/fleischner-applicability.json",
  "clinical/rules/recommendations/s3-5to8mm.json",
  "clinical/rules/recommendations/fleischner-6to8mm.json",
  "clinical/rules/recommendations/fleischner-gt8to30mm.json",
  "clinical/rules/recommendations/fleischner-ggn-lt6mm.json",
  "clinical/rules/recommendations/fleischner-ggn-gte6mm.json",
  "clinical/rules/recommendations/fleischner-partsolid-lt6mm.json",
  "clinical/rules/recommendations/fleischner-partsolid-gte6mm-solidlt6mm.json",
  "clinical/rules/recommendations/fleischner-partsolid-solidgt8mm.json",
  "clinical/rules/recommendations/s3-followup-discharge-volume-or-vdt.json",
];

function loadRevision(relativePath: string): RuleRevision {
  const raw = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const revisions = ruleFiles.map(loadRevision);

const release = buildRuleSetRelease(revisions);
ruleSetReleaseSchema.parse(release);

// requireApprovalEvent throws MissingApprovalEventError rather than trusting a non-null
// assertion here -- buildRuleSetRelease having succeeded above already guarantees every
// revision has one, but the guarantee is enforced there, not asserted at this call site.
const manifestEntries: ReleaseManifestEntry[] = revisions.map((r) => ({
  ruleId: r.ruleId,
  revisionId: r.revisionId,
  kind: r.kind,
  approvalEvent: requireApprovalEvent(r),
}));

const localSopSourceRaw = JSON.parse(
  readFileSync(join(repoRoot, "clinical/sources/local-sop.json"), "utf-8"),
);
const motivatingLocalSopSnapshot = localSopSnapshotSchema.parse(localSopSourceRaw.snapshot);

const manifest: ReleaseManifest = {
  releaseId: release.releaseId,
  createdAt: release.createdAt,
  motivatingLocalSopSnapshot,
  includedRevisions: manifestEntries,
  sourceQualityFindings: [
    "BTS Table 2 vs. narrative interval contradiction (table: 3 months, narrative: 6-12 months for the same case) -- unresolved; recorded here, never picked between to manufacture rule content.",
    "BTS bibliography mismatch -- correct citation is Callister MEJ et al., Thorax 2015;70(Suppl 2):ii1-ii54, doi:10.1136/thoraxjnl-2015-207168; recorded as a finding only.",
    "S3 body (\"Langversion 4.0/April 2025\") vs. bibliography (\"Langversion 2.2/2023\") mismatch.",
    "Local SOP's hybrid \"5/6-8mm\" summary boundary is imprecise and not independently executable as a standalone Local SOP Recommendation.",
    "No separately defined Local SOP applicability model exists -- deferred, not invented.",
    "The Local SOP source document itself appears procedurally unreleased (blank effective/release-date fields, unsigned).",
    "Local SOP states the pure ground-glass/non-solid nodule management boundary as \">6mm\"; this is treated (issue #17 clinical HITL approval) as an imprecise transcription of the underlying Fleischner 2017 source table, and the governed executable boundary for ACR-FLEISCHNER-GGN-GTE6MM is \">=6mm\" (6.0mm belongs to the surveillance bucket). This approval applies only to the Fleischner Recommendation Source for this pathway and does not generalize to S3/BTS or other subsolid-nodule sources.",
    "Local SOP states the part-solid nodule management boundary as a simplified whole-nodule-only \"<6mm\"/\">6mm\" trajectory, with no solid-component stratification anywhere in the text. Per primary-source verification (issue #18, MacMahon et al. 2017 Recommendation 4), the governed executable boundary for the active branch is \">=6mm\", and a materially distinct solid-component <6mm/>=6mm stratification exists in the primary Fleischner guideline that is absent from the Local SOP text. Recorded as separate local-management/primary-management provenance anchors on ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM, never merged; applies only to the Fleischner Recommendation Source for the part-solid pathway.",
    "Local SOP Tabelle 4's >600-day VDT band conditions its own \"no further follow-up\" action on stable radiological findings over 2 years -- a durational precondition the S3 narrative's own >600-day discharge sentence does not state (issue #15/#28). ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT's vdt-over-600 condition group implements only the S3 narrative sentence; Tabelle 4's additional precondition is recorded here as an unresolved table-vs-narrative conflict, never silently imported or reconciled.",
  ],
  notes: [
    "BTS is not available in this Rule-Set Release: it has neither a Source Applicability Rule nor an Atomic Clinical Rule of any Approval Status (Draft or Approved) in clinical/rules/. Its absence is explained here, not computed per-evaluation.",
    "No standalone Local SOP Recommendation is included in this Release; the Local SOP remains the normative source S3/Fleischner rules are derived from and cited against, not an executable Recommendation Source itself in Phase 1.",
    "ACR-FLEISCHNER-6TO8MM-r2 (superseding r1) is a documentation correction, not a Local SOP Version change (issue #20): it adds an explicit measurementConventionId declaration and switches from single to multi-anchor provenance. Its recommendation content and diameter thresholds are unchanged from r1.",
    "ACR-S3-5TO8MM-r2, ACR-FLEISCHNER-6TO8MM-r3, and ACR-FLEISCHNER-GT8TO30MM-r2 (each superseding its prior revision) are governance/documentation corrections, not Local SOP Version changes or clinical policy changes (issue #17): each adds the now-required explicit clinicalPathwayId binding (\"incidental-solitary-solid-initial\") introduced by this Release's second Clinical Pathway. Thresholds, recommendation content, measurement semantics, and provenance are otherwise unchanged from the prior revision.",
    "GR-2 / incidental-solitary-pure-ggn-initial (issue #17) is a new Clinical Pathway for the pure ground-glass/non-solid morphology, evaluated deterministically alongside GR-1 (evaluate-all, never first-match). ACR-FLEISCHNER-GGN-LT6MM and ACR-FLEISCHNER-GGN-GTE6MM are new, Fleischner-only Atomic Clinical Rules bound to it; S3 and BTS have no Atomic Clinical Rule for this pathway and produce no Source Evaluation Outcome for it. SAR-FLEISCHNER (source-global, unchanged) is reused unmodified for this pathway.",
    "GR-3 / incidental-solitary-part-solid-initial (issue #18, Candidate B) is a new Clinical Pathway for the part-solid morphology, evaluated deterministically alongside GR-1/GR-2. ACR-FLEISCHNER-PARTSOLID-LT6MM (whole nodule <6mm, no routine follow-up) and ACR-FLEISCHNER-PARTSOLID-GTE6MM-SOLIDLT6MM (whole nodule >=6mm AND solid component <6mm, persistence-surveillance) are new, Fleischner-only Atomic Clinical Rules bound to it. The second rule is this Release's first dual-measurement Atomic Clinical Rule: it independently resolves a whole-nodule diameter (measurementConventionId: fleischner-2017-average-diameter) and a solid-component diameter (solidComponentMeasurementConventionId: fleischner-2017-solid-component-long-axis, a new, distinct governed convention -- Bankier et al. 2017, Figure 4), stored in the new, structurally separate ClinicalInputState.solid_component_diameter_measurements container. Solid component >=6mm (including >8mm), growing solid component, and suspicious morphology are explicitly out of scope for this Release and correctly resolve to OUTSIDE_CURRENT_RULESET_SCOPE or INSUFFICIENT_INPUT, never a fabricated recommendation. S3 and BTS have no Atomic Clinical Rule for this pathway and produce no Source Evaluation Outcome for it. SAR-FLEISCHNER (source-global, unchanged) is reused unmodified for this pathway. No policy change to the existing solid or pure-GGN pathways; no screening/Lung-RADS support of any kind.",
    "ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM (issue #26, Candidate C) is a new, Fleischner-only Atomic Clinical Rule bound to GR-3 (incidental-solitary-part-solid-initial), governing Recommendation 4's solid-component->8mm escalation trigger (PET/CT, biopsy, or resection -- coequal, no source-stated timing). It declares only solidComponentMeasurementConventionId (fleischner-2017-solid-component-long-axis), no measurementConventionId and no whole-nodule diameterConditions entry, since the source states no independent whole-nodule threshold for this trigger. evaluate.ts's diameter-basis dispatch was extended with a generic, source-agnostic solid-component-only resolution branch, reachable without a whole-nodule measurement, to make this schema-valid rule shape evaluable (previously it would have been permanently unreachable). ENGINE_VERSION and SCHEMA_VERSION both move 1.3.0 -> 1.4.0: this Release introduces a real, additive schema extension -- AtomicClinicalRuleRevision.operandInapplicabilityPreconditions (issue #26 architecture-review correction) -- not merely an evaluate.ts-internal change. Governance note on a source-incompatible cross-state input, established by explicit source/HITL review (issue #26): a Clinical Input State combining whole-nodule <6mm (ACR-FLEISCHNER-PARTSOLID-LT6MM's own condition) with a solid-component measurement >8mm is not reliably definable per Recommendation 4's own State-A text (\"discrete solid components cannot be reliably defined in such small nodules\") -- these two rules are not mutually exclusive by field construction (they condition on different fields), and evaluate() correctly throws AmbiguousRuleMatchError for this combination rather than guessing or ranking either rule. This is intentional, fail-closed behavior, not a defect, and is not resolved by rule ordering or precedence. Separately, this same State-A text is also the governed provenance behind ACR-FLEISCHNER-PARTSOLID-SOLIDGT8MM's own operandInapplicabilityPreconditions entry (operand: solidComponent, whenOperand: wholeNodule, whenConditions: nodule_size_mm < 6, under fleischner-2017-average-diameter): when the solid-component measurement is missing entirely (not merely ambiguous) and the whole-nodule diameter independently resolves below 6mm, this rule reports OUTSIDE_CURRENT_RULESET_SCOPE rather than INSUFFICIENT_INPUT, so it never masks ACR-FLEISCHNER-PARTSOLID-LT6MM's own valid State-A match via evaluateAtomicRulesForSource's existing, unmodified INSUFFICIENT_INPUT-precedence rule. This mechanism -- OperandInapplicabilityPrecondition (types.ts), consulted only when an operand is genuinely missing, never when it is present or merely ambiguous -- is generic and reusable by any future rule/source; evaluate.ts itself contains no Fleischner-specific or Recommendation-4-specific literal anywhere in this dispatch. Neither of these two cross-state cases is reachable through the current UI: the solid-component input is shown only once whole-nodule diameter >=6mm is entered, and the generic initial-assessment `canEvaluate` gate additionally requires some whole-nodule diameter/volume before evaluation can run at all -- both are exercised only via a directly-constructed Clinical Input State (tests, or a future non-UI integration). Solid component >=6mm to <=8mm, growing solid component, and suspicious morphology remain out of scope (State C/E/F), unchanged.",
    "GR-4 / incidental-solitary-solid-follow-up (issue #15, Candidate A0, clinical HITL comment #5603995097, architecture-corrected per review #5604290019) is a new Clinical Pathway for solid-nodule follow-up assessment. ACR-S3-FOLLOWUP-VOLUME-STABLE is a new, S3-only, clinical-condition-shaped Atomic Clinical Rule (no measurementBasis; a bounded `conditions` array) representing S3's volume-based discharge criterion (<25% volume increase over approximately one year) as an explicit clinician-attested boolean input (ClinicalInputState.s3_volume_stability_criterion_met) -- never computed from prior/current volumes or an elapsed interval, and never modeled as a diameter/volume measurement. The Local SOP states no exact numeric day/month interval for 'approximately one year', and none is invented here; this is an intentional bounded representation, not missing implementation. The complement (>=25% volume increase) is deliberately not encoded as an inferred growth/work-up rule: a criterion explicitly answered false resolves to OUTSIDE_CURRENT_RULESET_SCOPE, never a fabricated recommendation. Fleischner and BTS have no Atomic Clinical Rule for this pathway (no follow-up-after-follow-up text exists in either narrative section per #15's grilling pass) and produce no Source Evaluation Outcome for it. SAR-S3 (source-global, unchanged) is reused unmodified. ACR-S3-FOLLOWUP-VOLUME-STABLE-r1's own governed JSON file is unmutated and remains exactly as it was, Approved, in every historical Rule-Set Release that actually includes it (e.g. rel-fb4eb398cb3ae65d, which stays byte-for-byte unchanged). It is superseded, not mutated, by ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r1 below: this Release and every subsequent one include the successor instead, not both.",
    "ACR-S3-FOLLOWUP-DISCHARGE-VOLUME-OR-VDT-r1 (issue #15 Candidate B1, architecture per issue #28) supersedes ACR-S3-FOLLOWUP-VOLUME-STABLE-r1 on GR-4 / incidental-solitary-solid-follow-up in this and every subsequent Release -- a new successor ruleId, not a `-r2` revision of the prior rule, per explicit HITL governance ruling (folding an independently-sourced, differently-measured second criterion into the existing 'VOLUME-STABLE' name would misdescribe what the rule now decides). ACR-S3-FOLLOWUP-VOLUME-STABLE-r1's own JSON file is unmutated and remains exactly as embedded in every historical Release that already includes it (e.g. rel-fb4eb398cb3ae65d), which stays byte-for-byte unchanged. The successor rule is this Release's first sufficientConditionGroups-shaped Atomic Clinical Rule (issue #28 architecture: a single, bounded OR-of-AND, never two separate same-source rules) with two independently sufficient groups: `volume-stability` (s3_volume_stability_criterion_met == true, reusing A0's own criterion unchanged) and `vdt-over-600` (the new ClinicalInputState.s3_vdt_days > 600, strict; exactly 600 does not match). Each group cross-references its own provenance anchor by role (criterion-volume-stability / criterion-vdt-over-600); no VDT formula, computation, or arithmetic helper is added -- s3_vdt_days is a plain clinician-entered value, never derived from prior/current volumes or an elapsed interval. A third S3-stated discharge condition (general-condition status) and Candidate B2 (VDT <400, pursue definitive pathological clarification) both remain fully out of scope; a value of s3_vdt_days <= 600 carries no clinical meaning here (no growth, no work-up, no PET/CT, no biopsy, no resection) -- it simply leaves this rule's own groups unmatched. evaluateAtomicRulesForSource() itself is unchanged: this rule still yields exactly one SourceEvaluationOutcome per evaluation, and a genuinely separate, future Atomic Clinical Rule for source s3 matching alongside it would still throw AmbiguousRuleMatchError exactly as today. No Local SOP Recommendation Source is introduced; Tabelle 3/4 remain non-executable (see the companion Source Quality Finding above on Tabelle 4's additional 2-year-stability precondition).",
  ],
};
releaseManifestSchema.parse(manifest);

const activePointer = { activeReleaseId: release.releaseId };
activeRuleSetPointerSchema.parse(activePointer);

mkdirSync(join(repoRoot, "clinical/rule-sets/releases"), { recursive: true });
mkdirSync(join(repoRoot, "clinical/rule-sets/manifests"), { recursive: true });

writeFileSync(
  join(repoRoot, `clinical/rule-sets/releases/${release.releaseId}.json`),
  JSON.stringify(release, null, 2) + "\n",
);
writeFileSync(
  join(repoRoot, `clinical/rule-sets/manifests/${release.releaseId}.json`),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  join(repoRoot, "clinical/rule-sets/active-release.json"),
  JSON.stringify(activePointer, null, 2) + "\n",
);

console.log(`Built Rule-Set Release ${release.releaseId} (${revisions.length} Approved revisions).`);
console.log(`Active Rule-Set pointer updated -> clinical/rule-sets/active-release.json`);
