// issue #18 final spec review, correction 1: `step="1"` on a number input changes spinner/
// constraint semantics but does not by itself prevent a user from typing/pasting a decimal value
// in every browser/React flow. This is the explicit UI-layer rejection logic that does: a pure,
// directly-testable predicate, never rounding silently. The engine/schema's own capability to
// accept a fractional diameter is deliberately untouched (existing boundary-test regression
// fixtures rely on it) -- this restricts only what a clinician can newly author through the UI.
export type WholeMmInputResult = number | undefined | "invalid";

/**
 * Parses a raw number-input string into a whole-millimeter value for authoring. Returns:
 * - `undefined` for an empty string (field cleared, not an invalid entry);
 * - the integer value, for any string representing a whole number (e.g. "6", "7");
 * - `"invalid"` for anything else (fractional, e.g. "6.5"; non-numeric; infinite/NaN) -- callers
 *   must reject this rather than commit it, and must never round it.
 */
export function parseWholeMmDiameter(raw: string): WholeMmInputResult {
  if (raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "invalid";
  if (!Number.isInteger(n)) return "invalid";
  return n;
}
