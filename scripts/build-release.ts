// Dev-time governance tooling (ADR-0007): assembles the Rule-Set Release from the Approved Rule
// Revisions in clinical/rules/, writes the immutable release artifact + Release Manifest, and
// updates the explicit, version-controlled Active Rule-Set pointer. Run via
// `npm run release:build`. Not imported by the browser UI runtime. Governed inputs live in
// scripts/releaseInputs.ts; the immutability-preserving writer in scripts/releaseArtifacts.ts.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReleaseArtifacts } from "./releaseArtifacts";
import { RELEASE_NOTES, RULE_FILES, SOURCE_QUALITY_FINDINGS } from "./releaseInputs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const result = writeReleaseArtifacts({
  inputRoot: repoRoot,
  artifactRoot: repoRoot,
  inputs: { ruleFiles: RULE_FILES, sourceQualityFindings: SOURCE_QUALITY_FINDINGS, notes: RELEASE_NOTES },
});

console.log(
  `${result.releaseWritten ? "Built" : "Verified existing, unchanged"} Rule-Set Release ` +
    `${result.releaseId} (${result.revisionCount} Approved revisions).`,
);
console.log(`Active Rule-Set pointer updated -> clinical/rule-sets/active-release.json`);
