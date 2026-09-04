import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { ruleRevisionSchema } from "../../src/engine/schema";
import type { RuleRevision, RuleSetRelease } from "../../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const RULE_FILES = [
  "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json",
  "clinical/rules/applicability/s3-applicability.json",
  "clinical/rules/applicability/fleischner-applicability.json",
  "clinical/rules/recommendations/s3-5to8mm.json",
  "clinical/rules/recommendations/fleischner-6to8mm.json",
  "clinical/rules/recommendations/fleischner-gt8to30mm.json",
];

export function loadApprovedPhase1Revisions(): RuleRevision[] {
  return RULE_FILES.map((relativePath) => {
    const raw = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
    return ruleRevisionSchema.parse(raw) as RuleRevision;
  });
}

export function loadTestRelease(): RuleSetRelease {
  return buildRuleSetRelease(loadApprovedPhase1Revisions());
}
