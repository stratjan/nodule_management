---
status: accepted
---

# Recommendations are collected into a Recommendation Set, never reconciled into one answer

The Local SOP integrates multiple Source Guidelines (S3, Fleischner, BTS, Brock, Herder, Lung-RADS) that can legitimately disagree on the same clinical finding. We considered auto-reconciling disagreements into a single "correct" recommendation, but rejected it: silent reconciliation would hide real clinical uncertainty and make the engine's output non-auditable against its sources. Instead, each Atomic Clinical Rule is scoped to exactly one Recommendation Source, and evaluation produces a Recommendation Set — one Recommendation per applicable source, shown together. A Local SOP override of the guidelines is modeled as its own explicit Recommendation Source with its own rule and provenance, never as a hidden merge.
