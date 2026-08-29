---
status: accepted
---

# Canonical clinical rule data is inert JSON, never executable code

The core architectural principle is that medical knowledge is separated from application code. We considered authoring rules as TypeScript objects for type-safety convenience, but rejected it: TypeScript source code must never become the canonical medical knowledge representation, because it can carry arbitrary executable logic (expressions, functions, imports) that defeats auditability and machine-validation. Canonical Rule-Sets are structured, inert JSON. TypeScript/Zod schemas validate this data during development, build, and release, and TypeScript types may be generated or inferred from the schema — but the schema and generated types are tooling around the data, never the source of truth. Clinical rule definitions must not contain executable expressions, functions, or imports.

Repository layout mirrors this separation physically:

```
clinical/
├── sources/      ← Source Guideline & Local SOP Version metadata
├── rules/        ← canonical Rule Revisions, inert JSON
└── rule-sets/    ← assembled, immutable Rule-Set Release artifacts
src/
├── engine/       ← deterministic evaluation, zero UI dependency
├── workflow/     ← next-question / navigation logic
└── ui/           ← React components; ask questions, render results only
```
