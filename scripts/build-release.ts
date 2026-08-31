// Dev-time governance tooling (ADR-0007): assembles the Phase 1 Rule-Set Release from the
// Approved Rule Revisions in clinical/rules/, writes the immutable release artifact + Release
// Manifest, and updates the explicit, version-controlled Active Rule-Set pointer. Run via
// `npm run release:build`. Not imported by the browser UI runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuleSetRelease } from "../src/engine/releaseBuilder";
import {
  ruleRevisionSchema,
  ruleSetReleaseSchema,
  releaseManifestSchema,
  activeRuleSetPointerSchema,
} from "../src/engine/schema";
import type { ReleaseManifest, ReleaseManifestEntry, RuleRevision } from "../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const ruleFiles = [
  "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json",
  "clinical/rules/applicability/s3-applicability.json",
  "clinical/rules/applicability/fleischner-applicability.json",
  "clinical/rules/recommendations/s3-5to8mm.json",
  "clinical/rules/recommendations/fleischner-6to8mm.json",
];

function loadRevision(relativePath: string): RuleRevision {
  const raw = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
  return ruleRevisionSchema.parse(raw) as RuleRevision;
}

const revisions = ruleFiles.map(loadRevision);

const release = buildRuleSetRelease(revisions);
ruleSetReleaseSchema.parse(release);

const manifestEntries: ReleaseManifestEntry[] = revisions.map((r) => ({
  ruleId: r.ruleId,
  revisionId: r.revisionId,
  kind: r.kind,
  approvalEvent: r.approvalEvent!,
}));

const manifest: ReleaseManifest = {
  releaseId: release.releaseId,
  createdAt: release.createdAt,
  motivatingLocalSopVersion: "251201 SOP-Rundherdmanagement",
  includedRevisions: manifestEntries,
  sourceQualityFindings: [
    "BTS Table 2 vs. narrative interval contradiction (table: 3 months, narrative: 6-12 months for the same case) -- unresolved; recorded here, never picked between to manufacture rule content.",
    "BTS bibliography mismatch -- correct citation is Callister MEJ et al., Thorax 2015;70(Suppl 2):ii1-ii54, doi:10.1136/thoraxjnl-2015-207168; recorded as a finding only.",
    "S3 body (\"Langversion 4.0/April 2025\") vs. bibliography (\"Langversion 2.2/2023\") mismatch.",
    "Local SOP's hybrid \"5/6-8mm\" summary boundary is imprecise and not independently executable as a standalone Local SOP Recommendation.",
    "No separately defined Local SOP applicability model exists -- deferred, not invented.",
    "The Local SOP source document itself appears procedurally unreleased (blank effective/release-date fields, unsigned).",
  ],
  notes: [
    "BTS is not available in this Rule-Set Release: it has neither a Source Applicability Rule nor an Atomic Clinical Rule of any Approval Status (Draft or Approved) in clinical/rules/. Its absence is explained here, not computed per-evaluation.",
    "No standalone Local SOP Recommendation is included in this Release; the Local SOP remains the normative source S3/Fleischner rules are derived from and cited against, not an executable Recommendation Source itself in Phase 1.",
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
