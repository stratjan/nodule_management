// Schema/JSON validation for the Clinical Pathway Gate, Source Applicability Rules, and
// Atomic Clinical Rules against the Zod schema (ADR-0006), plus the assembled Release,
// Release Manifest, and Active Rule-Set pointer.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ruleRevisionSchema,
  ruleSetReleaseSchema,
  releaseManifestSchema,
  activeRuleSetPointerSchema,
} from "../../src/engine/schema";
import { buildRuleSetRelease } from "../../src/engine/releaseBuilder";
import { loadApprovedPhase1Revisions } from "../helpers/loadTestRelease";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const RULE_FILES = [
  "clinical/rules/pathway/gr-1-incidental-solitary-solid-initial.json",
  "clinical/rules/applicability/s3-applicability.json",
  "clinical/rules/applicability/fleischner-applicability.json",
  "clinical/rules/recommendations/s3-5to8mm.json",
  "clinical/rules/recommendations/fleischner-6to8mm.json",
];

describe("clinical rule JSON validates against the schema", () => {
  for (const relativePath of RULE_FILES) {
    it(relativePath, () => {
      const raw = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8"));
      expect(() => ruleRevisionSchema.parse(raw)).not.toThrow();
    });
  }
});

describe("assembled Release / Manifest / Active pointer", () => {
  it("a Release built from the Approved revisions validates against ruleSetReleaseSchema", () => {
    const release = buildRuleSetRelease(loadApprovedPhase1Revisions());
    expect(() => ruleSetReleaseSchema.parse(release)).not.toThrow();
  });

  it("the committed Active Rule-Set pointer validates and resolves to a committed release artifact", () => {
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);

    const releaseRaw = JSON.parse(
      readFileSync(
        join(repoRoot, `clinical/rule-sets/releases/${pointer.activeReleaseId}.json`),
        "utf-8",
      ),
    );
    expect(() => ruleSetReleaseSchema.parse(releaseRaw)).not.toThrow();
  });

  it("the committed Release Manifest for the active release validates", () => {
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);

    const manifestRaw = JSON.parse(
      readFileSync(
        join(repoRoot, `clinical/rule-sets/manifests/${pointer.activeReleaseId}.json`),
        "utf-8",
      ),
    );
    expect(() => releaseManifestSchema.parse(manifestRaw)).not.toThrow();
  });

  it("the committed active release matches what the builder produces from current source rule files (no drift)", () => {
    const rebuilt = buildRuleSetRelease(loadApprovedPhase1Revisions());
    const pointerRaw = JSON.parse(
      readFileSync(join(repoRoot, "clinical/rule-sets/active-release.json"), "utf-8"),
    );
    const pointer = activeRuleSetPointerSchema.parse(pointerRaw);
    expect(rebuilt.releaseId).toBe(pointer.activeReleaseId);
  });
});
