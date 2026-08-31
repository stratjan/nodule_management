// Release assembly (ADR-0007): a Rule-Set Release is immutable, content-addressable, and
// assembled ONLY from Approved Rule Revisions. This is a build-time/construction-time
// guarantee, not a runtime filter — buildRuleSetRelease physically rejects anything else.
// Node-only tooling (uses node:crypto); not imported by the browser UI runtime, which loads
// a prebuilt release JSON artifact instead.
import { createHash } from "node:crypto";
import type { ApprovalEvent, RuleRevision, RuleSetRelease } from "./types";

export class NonApprovedRevisionError extends Error {
  constructor(public readonly rejected: RuleRevision[]) {
    super(
      `Release assembly rejected: ${rejected.length} non-Approved Rule Revision(s) present: ` +
        rejected.map((r) => `${r.ruleId}@${r.revisionId} (${r.approvalStatus})`).join(", "),
    );
    this.name = "NonApprovedRevisionError";
  }
}

export class MissingApprovalEventError extends Error {
  constructor(public readonly offending: RuleRevision[]) {
    super(
      `Release assembly rejected: ${offending.length} Approved Rule Revision(s) missing an ` +
        `explicit approval event (approvalEvent.by, approvalEvent.at): ` +
        offending.map((r) => `${r.ruleId}@${r.revisionId}`).join(", "),
    );
    this.name = "MissingApprovalEventError";
  }
}

/**
 * Returns a Rule Revision's approval event, or throws MissingApprovalEventError. Use this
 * instead of a non-null assertion anywhere approvalEvent is read off a revision that came out
 * of buildRuleSetRelease -- the guarantee is enforced here, not asserted at the call site.
 */
export function requireApprovalEvent(revision: RuleRevision): ApprovalEvent {
  if (!revision.approvalEvent?.by || !revision.approvalEvent?.at) {
    throw new MissingApprovalEventError([revision]);
  }
  return revision.approvalEvent;
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
 * if any revision is not Approved, or MissingApprovalEventError if an Approved revision has no
 * explicit approval event — release assembly must physically refuse both (ADR-0007), never
 * rely on a runtime filter (or a later non-null assertion) applied after the fact. This check
 * is independent of, and in addition to, ruleRevisionSchema's own approval-event refinement —
 * buildRuleSetRelease enforces the invariant itself rather than trusting that every caller
 * validated with the schema first.
 */
export function buildRuleSetRelease(
  revisions: RuleRevision[],
  createdAt: string = new Date().toISOString(),
): RuleSetRelease {
  const nonApproved = revisions.filter((r) => r.approvalStatus !== "Approved");
  if (nonApproved.length > 0) {
    throw new NonApprovedRevisionError(nonApproved);
  }

  const missingApprovalEvent = revisions.filter((r) => !r.approvalEvent?.by || !r.approvalEvent?.at);
  if (missingApprovalEvent.length > 0) {
    throw new MissingApprovalEventError(missingApprovalEvent);
  }

  return {
    releaseId: computeReleaseId(revisions),
    createdAt,
    revisions,
  };
}
