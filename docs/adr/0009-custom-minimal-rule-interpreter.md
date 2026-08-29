---
status: accepted
---

# A small custom interpreter evaluates rules, not a general-purpose rules engine

We researched adopting an existing TS/JS rules-engine library (`json-rules-engine`, `json-logic-js`, and decision-table engines like GoRules `zen-engine`) against a small custom interpreter (see [issue #3 findings](https://github.com/stratjan/nodule_management/issues/3)). We rejected every library option: `json-rules-engine` fits the collect-all shape well but carries a general-purpose engine's unused machinery (priority scheduling, event buses, an almanac abstraction) and a dependency (`jsonpath-plus`) with a real, if now-patched, RCE CVE history; `json-logic-js` is excellent as an inert-JSON condition format but isn't an engine at all, so custom orchestration is needed regardless; GoRules `zen-engine` has the best native fit for collecting all matches but its decision-table cells are a string-based expression DSL, in real tension with ADR-0006's inert-JSON requirement, and its browser build is heavy (~1.79 MB) and explicitly experimental. ADR-0001 already rejects general conflict-resolution/rule-chaining machinery — the exact thing a general-purpose engine mostly provides — so we chose to build only what this domain shape needs.

**We are not building a general-purpose rules engine.** The interpreter is scoped exactly to this orchestration, which is fixed and not meant to be generalized:

```
Clinical Input State
  → Gating Rules
  → applicable Clinical Pathway(s)
  → evaluate all applicable Atomic Clinical Rules independently
  → collect source-specific Recommendations
  → Recommendation Set
  → Decision Execution Trace
```

Gating determines applicability; within an applicable pathway every Atomic Clinical Rule is evaluated independently (no short-circuit, no priority/winner semantics); every match's Recommendation is collected; differing Recommendations across Recommendation Sources are preserved, never resolved (ADR-0001); the run produces a structured Decision Execution Trace.

**Condition vocabulary.** Individual rule conditions use a JsonLogic-*inspired* declarative model — but we do not adopt JsonLogic's full operator surface wholesale. The supported predicate vocabulary is whatever this clinical rule schema actually needs, and nothing else. Every supported operator must be: explicitly defined in the schema/domain contract, deterministic, side-effect free, incapable of executing arbitrary code, stable across Rule-Set Releases, and covered by unit and boundary tests. Canonical rule data stays inert JSON (ADR-0006): no functions, scripts, expression strings, dynamic `eval`, arbitrary property execution, or plugin-defined operators may appear in clinical rule data, full stop — the interpreter's fixed operator set is the only vocabulary rule data can use.

**Correctness is owned by this project**, with no upstream library to inherit tested edge-case behavior from. It is validated through: interpreter unit tests, schema/semantic validation, boundary tests, the Golden Clinical Corpus, and end-to-end real-SOP-derived clinical scenarios.
