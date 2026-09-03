// Release assembly (ADR-0007): a Rule-Set Release is immutable, content-addressable, and
// assembled ONLY from Approved Rule Revisions. This is a build-time/construction-time
// guarantee, not a runtime filter — buildRuleSetRelease physically rejects anything else.
// Node-only tooling (uses node:crypto); not imported by the browser UI runtime, which loads
// a prebuilt release JSON artifact instead.
import { createHash } from "node:crypto";
import type { ApprovalEvent, AtomicClinicalRuleRevision, Condition, RuleRevision, RuleSetRelease } from "./types";

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

export class OverlappingRuleConditionsError extends Error {
  constructor(
    public readonly ruleA: AtomicClinicalRuleRevision,
    public readonly ruleB: AtomicClinicalRuleRevision,
    public readonly field: string,
  ) {
    super(
      `Release assembly rejected: Atomic Clinical Rules ${ruleA.ruleId}@${ruleA.revisionId} and ` +
        `${ruleB.ruleId}@${ruleB.revisionId} (Recommendation Source "${ruleA.recommendationSourceId}") ` +
        `have deterministically overlapping match conditions on field "${field}".`,
    );
    this.name = "OverlappingRuleConditionsError";
  }
}

interface NumericRange {
  field: string;
  min: number;
  minInclusive: boolean;
  max: number;
  maxInclusive: boolean;
}

/**
 * Reduces a condition list to a single-field numeric range, or returns null when that isn't
 * deterministically decidable from the conditions' own shape (mixed fields, a non-numeric value,
 * or an operator outside eq/gte/gt/lte/lt). issue #20: release-time overlap validation only
 * proves overlap for this simple, decidable case -- it never claims to prove non-overlap for
 * anything more complex; that residual is what the runtime ambiguity guard exists to catch.
 */
function extractNumericRange(conditions: Condition[]): NumericRange | null {
  if (conditions.length === 0) return null;
  const field = conditions[0].field;
  let min = -Infinity;
  let minInclusive = true;
  let max = Infinity;
  let maxInclusive = true;

  for (const c of conditions) {
    if (c.field !== field) return null;
    if (typeof c.value !== "number") return null;
    switch (c.op) {
      case "gte":
        if (c.value > min || (c.value === min && !minInclusive)) {
          min = c.value;
          minInclusive = true;
        }
        break;
      case "gt":
        if (c.value > min || (c.value === min && minInclusive)) {
          min = c.value;
          minInclusive = false;
        }
        break;
      case "lte":
        if (c.value < max || (c.value === max && !maxInclusive)) {
          max = c.value;
          maxInclusive = true;
        }
        break;
      case "lt":
        if (c.value < max || (c.value === max && maxInclusive)) {
          max = c.value;
          maxInclusive = false;
        }
        break;
      case "eq":
        min = c.value;
        max = c.value;
        minInclusive = true;
        maxInclusive = true;
        break;
      default:
        return null;
    }
  }

  return { field, min, minInclusive, max, maxInclusive };
}

function rangesOverlap(a: NumericRange, b: NumericRange): boolean {
  if (a.field !== b.field) return false;
  const aEndsBeforeB = a.max < b.min || (a.max === b.min && !(a.maxInclusive && b.minInclusive));
  const bEndsBeforeA = b.max < a.min || (b.max === a.min && !(b.maxInclusive && a.minInclusive));
  return !aEndsBeforeB && !bEndsBeforeA;
}

/**
 * Release-time semantic validation (issue #20), scoped by Recommendation Source only:
 * AtomicClinicalRuleRevision carries no clinicalPathwayId today, and the Active Rule-Set Release
 * currently spans only one Clinical Pathway (GR-1), so grouping by source alone is already
 * equivalent in scope. Rejects the Release whenever two Approved Atomic Clinical Rules for the
 * same source have deterministically overlapping diameterConditions or volumeConditions.
 */
function assertNoOverlappingAtomicRules(revisions: RuleRevision[]): void {
  const atomicRules = revisions.filter(
    (r): r is AtomicClinicalRuleRevision => r.kind === "atomic-clinical-rule",
  );
  const bySource = new Map<string, AtomicClinicalRuleRevision[]>();
  for (const rule of atomicRules) {
    const group = bySource.get(rule.recommendationSourceId) ?? [];
    group.push(rule);
    bySource.set(rule.recommendationSourceId, group);
  }

  for (const rules of bySource.values()) {
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        for (const key of ["diameterConditions", "volumeConditions"] as const) {
          const condsA = rules[i][key];
          const condsB = rules[j][key];
          if (!condsA || !condsB) continue;
          const rangeA = extractNumericRange(condsA);
          const rangeB = extractNumericRange(condsB);
          if (!rangeA || !rangeB) continue;
          if (rangesOverlap(rangeA, rangeB)) {
            throw new OverlappingRuleConditionsError(rules[i], rules[j], rangeA.field);
          }
        }
      }
    }
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
 * if any revision is not Approved, MissingApprovalEventError if an Approved revision has no
 * explicit approval event, or OverlappingRuleConditionsError (issue #20) if two Approved Atomic
 * Clinical Rules for the same Recommendation Source have deterministically overlapping match
 * conditions — release assembly must physically refuse all three (ADR-0007), never rely on a
 * runtime filter (or a later non-null assertion) applied after the fact. The approval checks are
 * independent of, and in addition to, ruleRevisionSchema's own approval-event refinement —
 * buildRuleSetRelease enforces every invariant itself rather than trusting that every caller
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

  assertNoOverlappingAtomicRules(revisions);

  return {
    releaseId: computeReleaseId(revisions),
    createdAt,
    revisions,
  };
}
