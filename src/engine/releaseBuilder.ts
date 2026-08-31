// Release assembly (ADR-0007): a Rule-Set Release is immutable, content-addressable, and
// assembled ONLY from Approved Rule Revisions. This is a build-time/construction-time
// guarantee, not a runtime filter — buildRuleSetRelease physically rejects anything else.
// Node-only tooling (uses node:crypto); not imported by the browser UI runtime, which loads
// a prebuilt release JSON artifact instead.
import { createHash } from "node:crypto";
import type { RuleRevision, RuleSetRelease } from "./types";

export class NonApprovedRevisionError extends Error {
  constructor(public readonly rejected: RuleRevision[]) {
    super(
      `Release assembly rejected: ${rejected.length} non-Approved Rule Revision(s) present: ` +
        rejected.map((r) => `${r.ruleId}@${r.revisionId} (${r.approvalStatus})`).join(", "),
    );
    this.name = "NonApprovedRevisionError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeReleaseId(revisions: RuleRevision[]): string {
  const sorted = [...revisions].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const hash = createHash("sha256").update(canonicalJson(sorted)).digest("hex");
  return `rel-${hash.slice(0, 16)}`;
}

/**
 * Assembles a Rule-Set Release from a set of Rule Revisions. Throws NonApprovedRevisionError
 * if any revision is not Approved — release assembly must physically refuse to include
 * anything not Approved (ADR-0007), never rely on a runtime filter applied after the fact.
 */
export function buildRuleSetRelease(
  revisions: RuleRevision[],
  createdAt: string = new Date().toISOString(),
): RuleSetRelease {
  const nonApproved = revisions.filter((r) => r.approvalStatus !== "Approved");
  if (nonApproved.length > 0) {
    throw new NonApprovedRevisionError(nonApproved);
  }

  return {
    releaseId: computeReleaseId(revisions),
    createdAt,
    revisions,
  };
}
