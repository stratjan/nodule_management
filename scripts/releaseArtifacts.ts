// Release artifact writer (ADR-0007): assembles the Rule-Set Release from the governed inputs and
// writes the Release, its Release Manifest, and the Active Rule-Set pointer. A Release and its
// Manifest are content-addressed by releaseId and immutable: once they exist, a rebuild of the
// same Approved revision set must reproduce them byte-for-byte (createdAt is reused from the
// existing Release, never re-stamped from the wall clock) or fail closed with
// ReleaseArtifactConflictError -- it never overwrites them. Only the Active Rule-Set pointer is
// mutable. Node-only tooling; not imported by the browser UI runtime.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRuleSetRelease, computeReleaseId, requireApprovalEvent } from "../src/engine/releaseBuilder";
import {
  activeRuleSetPointerSchema,
  localSopSnapshotSchema,
  releaseManifestSchema,
  ruleRevisionSchema,
  ruleSetReleaseSchema,
} from "../src/engine/schema";
import type { ReleaseManifest, RuleRevision } from "../src/engine/types";

export interface ReleaseBuildInputs {
  ruleFiles: readonly string[];
  sourceQualityFindings: readonly string[];
  notes: readonly string[];
}

export interface ReleaseBuildOptions {
  /** Root that ruleFiles and clinical/sources/local-sop.json are read from. */
  inputRoot: string;
  /** Root whose clinical/rule-sets/ receives the artifacts (the repo root for the real build). */
  artifactRoot: string;
  inputs: ReleaseBuildInputs;
  /** createdAt for a Release that does not exist yet; ignored when it already exists. */
  now?: () => string;
}

export interface ReleaseBuildResult {
  releaseId: string;
  revisionCount: number;
  /** Whether the Release/Manifest were newly written (false = an identical artifact already existed). */
  releaseWritten: boolean;
  manifestWritten: boolean;
}

/** An artifact already exists under the computed releaseId but differs from what this revision
 * set produces -- refused rather than overwritten, since a releaseId names immutable content. */
export class ReleaseArtifactConflictError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`Release build refused: existing immutable artifact ${path} ${reason}; it is never overwritten.`);
    this.name = "ReleaseArtifactConflictError";
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// A Windows checkout with core.autocrlf materializes LF-committed artifacts as CRLF; that is a
// working-tree representation of the same committed bytes, not a content difference.
function readNormalized(path: string): string {
  return readFileSync(path, "utf-8").replace(/\r\n/g, "\n");
}

export function writeReleaseArtifacts(options: ReleaseBuildOptions): ReleaseBuildResult {
  const { inputRoot, artifactRoot, inputs } = options;
  const now = options.now ?? (() => new Date().toISOString());

  const revisions: RuleRevision[] = inputs.ruleFiles.map(
    (path) => ruleRevisionSchema.parse(JSON.parse(readFileSync(join(inputRoot, path), "utf-8"))) as RuleRevision,
  );

  const releasesDir = join(artifactRoot, "clinical/rule-sets/releases");
  const manifestsDir = join(artifactRoot, "clinical/rule-sets/manifests");
  const releaseId = computeReleaseId(revisions);
  const releasePath = join(releasesDir, `${releaseId}.json`);
  const manifestPath = join(manifestsDir, `${releaseId}.json`);

  // Reuse the existing Release's createdAt -- the only non-content field -- so an identical
  // revision set reproduces the identical artifact instead of re-stamping it.
  let createdAt = now();
  if (existsSync(releasePath)) {
    const existing = ruleSetReleaseSchema.parse(JSON.parse(readNormalized(releasePath)));
    if (existing.releaseId !== releaseId || computeReleaseId(existing.revisions as RuleRevision[]) !== releaseId) {
      throw new ReleaseArtifactConflictError(releasePath, "does not recompute to its own releaseId");
    }
    createdAt = existing.createdAt;
  }

  const release = buildRuleSetRelease(revisions, createdAt);
  ruleSetReleaseSchema.parse(release);

  const manifest: ReleaseManifest = {
    releaseId: release.releaseId,
    createdAt: release.createdAt,
    motivatingLocalSopSnapshot: localSopSnapshotSchema.parse(
      JSON.parse(readFileSync(join(inputRoot, "clinical/sources/local-sop.json"), "utf-8")).snapshot,
    ),
    // requireApprovalEvent throws MissingApprovalEventError rather than trusting a non-null
    // assertion -- buildRuleSetRelease already guarantees every revision has one.
    includedRevisions: revisions.map((r) => ({
      ruleId: r.ruleId,
      revisionId: r.revisionId,
      kind: r.kind,
      approvalEvent: requireApprovalEvent(r),
    })),
    sourceQualityFindings: [...inputs.sourceQualityFindings],
    notes: [...inputs.notes],
  };
  releaseManifestSchema.parse(manifest);

  const activePointer = activeRuleSetPointerSchema.parse({ activeReleaseId: release.releaseId });

  // Check both immutable artifacts before writing anything, so a conflict leaves the tree untouched.
  const releaseJson = serialize(release);
  const manifestJson = serialize(manifest);
  const releaseExists = existsSync(releasePath);
  const manifestExists = existsSync(manifestPath);
  if (releaseExists && readNormalized(releasePath) !== releaseJson) {
    throw new ReleaseArtifactConflictError(releasePath, "differs from the rebuilt Release for the same revision set");
  }
  if (manifestExists && readNormalized(manifestPath) !== manifestJson) {
    throw new ReleaseArtifactConflictError(manifestPath, "differs from the rebuilt Release Manifest for the same revision set");
  }

  mkdirSync(releasesDir, { recursive: true });
  mkdirSync(manifestsDir, { recursive: true });
  if (!releaseExists) writeFileSync(releasePath, releaseJson);
  if (!manifestExists) writeFileSync(manifestPath, manifestJson);
  writeFileSync(join(artifactRoot, "clinical/rule-sets/active-release.json"), serialize(activePointer));

  return {
    releaseId,
    revisionCount: revisions.length,
    releaseWritten: !releaseExists,
    manifestWritten: !manifestExists,
  };
}
