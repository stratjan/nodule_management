---
status: research
issue: https://github.com/stratjan/nodule_management/issues/3
decision-ticket: https://github.com/stratjan/nodule_management/issues/4
researched: 2026-08-29
---

# Rule-engine implementation approaches for deterministic clinical rule evaluation

This is **research, not a decision**. It surveys mature TS/JS approaches to the shape of
problem described in `CONTEXT.md` and compares them against this repo's constraints. The
actual choice belongs to the follow-on decision ticket (#4).

## The shape of the problem (recap from CONTEXT.md / ADRs)

1. **Gating Rules** run first and select the applicable **Clinical Pathway**(s) for a Case
   State.
2. Within a pathway, multiple **Atomic Clinical Rules** are evaluated — each scoped to
   exactly **one Recommendation Source** — independently of one another.
3. Every rule that matches contributes a **Recommendation**; the engine collects them into a
   **Recommendation Set**. There is no "pick a winner" step — two sources disagreeing is two
   Recommendations shown together (ADR-0001).
4. Canonical rule content is **inert JSON**, never executable code — no functions,
   expressions-as-code, or imports in rule data. Zod/TS are validation and typing tooling
   around the data, never the source of truth (ADR-0006).
5. Ships as a **fully static client-side PWA**, no backend (ADR-0004) — so client bundle size
   and the absence of any server-side sandboxing matter directly.
6. The engine has **zero dependency on the UI** (ADR-0005) — it is a plain TS module.

## Evaluation criteria (per the issue)

For each option: fit with "inert JSON, never executable code"; maturity/maintenance;
client bundle size; and how naturally it produces a *collected* Recommendation Set rather
than single-winner resolution.

---

## Option A — `json-rules-engine`

**What it is.** A widely-used Node/browser rules engine where rules are "simple json
structures, making them human readable and easy to persist" — a top-level `conditions` tree
(`all` / `any` / `not` combinators over `{fact, operator, value}` triples) plus an `event`
object, `priority`, and optional `name` [(source: README, GitHub)](https://github.com/CacheControl/json-rules-engine).

Example rule shape, from the library's own docs:

```json
{
  "conditions": {
    "all": [
      { "fact": "product-price", "operator": "greaterThan", "value": 100 }
    ]
  },
  "event": { "type": "price-alert", "params": { "threshold": 100 } },
  "priority": 1,
  "name": "high-price-notification"
}
```
[(source: docs/rules.md)](https://github.com/CacheControl/json-rules-engine/blob/master/docs/rules.md)

**Fit with inert JSON.** The *rule* JSON itself never embeds functions or expressions — good
fit for ADR-0006 on its face. But two caveats worth flagging for the decision ticket:

- Custom **operators** and **dynamic facts** (anything beyond the built-in comparisons) must
  be registered as JS functions at engine-construction time (`engine.addFact('x', function
  (params, almanac) {...})`, `engine.addOperator(...)`), i.e. outside the rule JSON
  [(source: docs/engine.md, docs/rules.md)](https://github.com/CacheControl/json-rules-engine/blob/master/docs/engine.md).
  That's consistent with ADR-0006 (the logic lives in versioned application code, not in the
  clinical JSON), but it means any condition richer than the ~14 built-in operators becomes
  an *implicit* extension point that lives outside the audited rule content — worth an
  explicit inventory/lint if adopted.
- The library's own dependency tree is **not zero-dependency**: `package.json` on `master`
  (v7.3.2) lists `clone`, `eventemitter2`, `hash-it`, and `jsonpath-plus` as runtime
  dependencies [(source: package.json)](https://github.com/CacheControl/json-rules-engine/blob/master/package.json).
  `jsonpath-plus` is notable: versions before 10.2.0 had a critical remote-code-execution
  vulnerability (CVE-2024-21534, with an incompletely-fixed follow-up CVE-2025-1302) arising
  from unsafe use of Node's `vm` module to evaluate JSONPath expressions
  [(source: Snyk advisory SNYK-JS-JSONPATHPLUS-7945884)](https://security.snyk.io/vuln/SNYK-JS-JSONPATHPLUS-7945884).
  `json-rules-engine` currently pins `jsonpath-plus": "^10.3.0"`, which is patched, but it's a
  concrete illustration that "the rule engine's internals," not just the rule JSON, are part
  of the trust boundary for a clinical tool, and that boundary should be re-checked at
  adoption/upgrade time rather than assumed permanently safe.

**Maturity / maintenance.** Actively maintained: 3,128 GitHub stars, repo last pushed
2026-02-16, latest npm release `7.3.1` published 2025-02-20, ISC license
[(source: GitHub API / npm registry, queried 2026-08-29)](https://github.com/CacheControl/json-rules-engine).
68 open issues at time of research — not unusual for a library this size, but worth noting
alongside the still-fresh-looking last release.

**Bundle size.** Bundlephobia reports the package (v7.3.1) at **~76.8 KB minified / ~20.7 KB
gzipped** [(source: bundlephobia.com/package/json-rules-engine, queried 2026-08-29)](https://bundlephobia.com/package/json-rules-engine).
Non-trivial for a static PWA's initial bundle, though not disqualifying on its own — it's in
the same order of magnitude as a small UI component library.

**Collecting multiple matches.** This is where `json-rules-engine` fits *very* naturally.
`engine.run()` evaluates **every** rule with no built-in short-circuit — the only stop
mechanism is an explicit `engine.stop()` call — and returns `{ events, failureEvents,
almanac, results, failureResults }`, i.e. the full set of rules that matched, not a single
winner [(source: docs/engine.md)](https://github.com/CacheControl/json-rules-engine/blob/master/docs/engine.md).
Rules sharing a `priority` value run in parallel; different priority tiers run in sequence.
That priority mechanism maps reasonably well onto the two-phase shape here: Gating Rules at
priority 1 (writing a "pathway" fact), Atomic Clinical Rules at priority 2 (conditioned on
that fact) — each Atomic Clinical Rule that matches independently produces its own event,
which is structurally a Recommendation. What the library does **not** provide out of the box
is a first-class "pathway" grouping — there's no named-group/scoping concept beyond a cosmetic
`name` field, priority tiers, and facts; a two-phase gate-then-evaluate-within-pathway
structure would be built by the calling code (e.g. instantiating a pathway-scoped `Engine`
after gating, or conditioning every Atomic Clinical Rule on a `pathway` fact) rather than by
the library itself [(source: docs/rules.md)](https://github.com/CacheControl/json-rules-engine/blob/master/docs/rules.md).

---

## Option A2 — `json-logic-js` (a lower-level building block, not a full engine)

Included because the issue asks about "an existing library... or similar," and this is a
materially different point in the design space than a full engine.

**What it is.** JsonLogic is "a small, safe way to delegate one decision" — rules are pure
JSON ASTs of the form `{"operator": [args...]}` (comparisons, `and`/`or`, `var` for data
access, etc.), explicitly documented as having "no setters, no loops, no functions or gotos,"
with implementations in JS, PHP, Python, Ruby, Go, Java, .NET and C++ sharing one spec
[(source: jsonlogic.com)](https://jsonlogic.com/).

**Fit with inert JSON.** Best-in-class fit among the options surveyed: JsonLogic rules are
*only* a JSON expression tree evaluated against a data object; there is no facility for
embedding functions or arbitrary code in the rule data at all, and the shared cross-language
spec is itself a forcing function against sneaking in JS-specific behavior.

**Maturity / maintenance.** `json-logic-js` (the reference JS implementation, by the spec's
author) is MIT-licensed, 1,479 GitHub stars, but release cadence is slow: latest npm version
`2.0.5` was published 2024-07-09, and the repo's last push predates this research by roughly
two years [(source: npm registry / GitHub API, queried 2026-08-29)](https://www.npmjs.com/package/json-logic-js).
It has zero runtime dependencies (`package.json` lists only devDependencies)
[(source: package.json)](https://github.com/jwadhams/json-logic-js/blob/master/package.json),
which sidesteps the supply-chain concern raised above for `json-rules-engine`. 84 open issues
at time of research.

**Bundle size.** **~4.9 KB minified / ~1.6 KB gzipped**
[(source: bundlephobia.com/package/json-logic-js, queried 2026-08-29)](https://bundlephobia.com/package/json-logic-js) —
an order of magnitude smaller than `json-rules-engine`.

**Collecting multiple matches.** JsonLogic evaluates **one rule to one value** — it has no
concept of "engine," multiple rules, priorities, or events at all. Using it here means it
could only ever be the *condition-evaluation primitive* inside a hand-written orchestration
layer (iterate Atomic Clinical Rules, evaluate each rule's JsonLogic condition against Case
State, collect the ones that return truthy) — i.e. it answers "does this one Atomic Clinical
Rule match?" but the Gating → Pathway → collect-into-Recommendation-Set orchestration is
entirely custom code either way. It is closer to a component of Option B (custom
interpreter) than a competing full solution to Option A.

---

## Option B — small custom interpreter tailored to this shape

**What it would look like.** A hand-rolled TS module (living in `src/engine/` per ADR-0006's
repository layout) that:

- Defines the Gating Rule / Atomic Clinical Rule / Clinical Pathway JSON shapes as Zod
  schemas (the schema is tooling around the data, never the source of truth, per ADR-0006).
- Represents each rule's condition as a small, closed set of JSON-serializable predicate
  nodes — e.g. a JsonLogic-style `{all: [...]}`/`{any: [...]}`/`{fact, operator, value}`
  vocabulary restricted to the operators this domain actually needs (numeric comparisons,
  set membership, boolean combinators) — interpreted by a pure, hand-written recursive
  evaluator function with no `eval`/`Function`/dynamic-`import` anywhere in the interpreter.
- Implements the two-phase control flow directly: run Gating Rules against Case State to
  select the applicable Clinical Pathway(s); for each applicable pathway, iterate its Atomic
  Clinical Rules independently (one loop, no early return), and push every match's
  Recommendation into a `Recommendation Set` array grouped by Recommendation Source — the
  literal shape ADR-0001 and CONTEXT.md describe, rather than an approximation bent to fit a
  general-purpose engine's control flow.

**Fit with inert JSON.** Perfect by construction — the schema is written to enforce exactly
CONTEXT.md's vocabulary (Gating Rule, Atomic Clinical Rule, Recommendation Source, Clinical
Endpoint) instead of a generic `fact`/`event` vocabulary borrowed from an unrelated domain,
and nothing in the design requires accepting any dependency's stance on functions-as-facts or
embedded expression languages, because there is no dependency to take a stance.

**Maturity / maintenance.** N/A in the conventional sense — there's no upstream project to
track for security advisories, breaking changes, or abandonment (contrast with `nools`, a
once-popular Rete-algorithm-based JS rules engine that is now unmaintained: last npm release
`0.4.4` in 2016, last GitHub push in 2019 [(source: npm registry / GitHub API, queried
2026-08-29)](https://github.com/noolsjs/nools) — a real illustration of the abandonment risk
a general-purpose dependency carries over a multi-year clinical-software lifetime). The
maintenance burden instead falls entirely on this team, which cuts both ways: no upstream
risk, but 100% of bugs, edge cases (e.g. short-circuit semantics, `NaN`/`null` handling) are
this project's to find and fix, whereas `json-rules-engine`/`json-logic-js` have had years of
external users surfacing exactly those edge cases already.

**Bundle size.** Effectively the size of the code actually written — realistically well under
1 KB gzipped for the predicate evaluator and orchestration loop described above, with zero
added `node_modules` dependencies. This is the smallest possible footprint of any option
surveyed, by definition.

**Collecting multiple matches.** Trivial and exact, because the orchestration loop is written
to produce precisely a Recommendation Set — there's no general-purpose engine semantics
(priority tiers, event emission, short-circuit flags) to work around or map the domain onto;
the collect-all behavior is simply "don't `break`/`return` on the first match; push every
match to an array."

**Where this option is weaker.** No community, no existing test suite, no docs to compare
behavior against — correctness rests entirely on this project's own tests (which ADR-0006's
neighbors already call for via the Golden Clinical Corpus, so the safety net exists, but it's
this project's net to weave). Any future need for genuinely complex condition logic (e.g.
backward-chaining, rule dependencies, conflict resolution across large rule sets) would mean
building that complexity in-house rather than getting it "for free" from a mature engine —
though ADR-0001 explicitly says conflict resolution across sources is *not wanted* here, which
weakens that argument for this specific project.

---

## Option C — decision tables (as a well-established alternative pattern)

**The general pattern.** Decision tables (rows = rules, columns = input conditions + output
values, with a "hit policy" governing what happens when multiple rows match) are a
long-established way to express exactly this domain shape — many independent condition/action
pairs evaluated against the same input — and are the modeling primitive behind the OMG DMN
(Decision Model and Notation) standard.

**A concrete, actively-maintained JS/TS implementation: GoRules `zen-engine`.** GoRules'
"JSON Decision Model" (JDM) represents decision tables (among other node types) as JSON graphs,
and its decision tables support a **`collect` hit policy** that returns an array with one
entry per matching row (as opposed to the default first-match policy) — output columns can
even be configured to collect while other columns stay first-match
[(source: docs.gorules.io / gorules.io decision-table docs, queried 2026-08-29)](https://docs.gorules.io/docs/decision-table).
That `collect` hit policy is a close conceptual match for "evaluate every Atomic Clinical Rule
independently and gather all matches" — arguably the most direct off-the-shelf mapping onto
this project's Recommendation Set semantics of anything surveyed.

The engine itself is written in Rust and shipped with native Node bindings
(`@gorules/zen-engine`) and an **experimental WASM build for browsers**
(`@gorules/zen-engine-wasm`, MIT-licensed, latest `0.23.1` published 2026-03-17, actively
maintained) [(source: npm registry, queried 2026-08-29)](https://www.npmjs.com/package/@gorules/zen-engine-wasm).

**Fit with inert JSON — the important caveat.** Decision table *cell values* are not plain
JSON literals/operator-trees the way `json-rules-engine`'s conditions or JsonLogic's ASTs are
— they are strings written in GoRules' own **ZEN Expression Language**, a business-rule DSL
("business-friendly expressions... equality, numeric comparisons, boolean values, date-time
functions, array functions") that the engine parses and evaluates at runtime
[(source: gorules.io expression-language docs, queried 2026-08-29)](https://gorules.io/docs/user-manual/decision-modeling/expression-language).
That is a real tension with ADR-0006's "must not contain executable expressions" language:
it is not arbitrary JavaScript and it cannot do IO/side-effects, so it is not "code" in the
dangerous sense ADR-0006 is guarding against (arbitrary imports, side effects, opaque
control flow) — but it is a string-typed expression grammar embedded inside otherwise-static
JSON, which is a meaningfully different trust/auditability shape than a rule file a
non-engineer or a JSON-diff tool can read as pure structured data. This is the single most
important nuance for whoever makes the final call on ADR-0006 fit.

**Maturity / maintenance.** Actively developed (native package pushed to in the last months as
of this research) and MIT-licensed, but younger and with a smaller install base than
`json-rules-engine`; the browser/WASM target is explicitly labeled "experimental" by GoRules
itself.

**Bundle size.** The WASM package is **~1.79 MB unpacked**
[(source: npm registry metadata for `@gorules/zen-engine-wasm@0.23.1`, queried 2026-08-29)](https://www.npmjs.com/package/@gorules/zen-engine-wasm) —
roughly 90x the gzipped size of `json-rules-engine` and orders of magnitude past
`json-logic-js` or a custom interpreter. For a static PWA that should load fast on a clinical
workstation or mobile device, this is the heaviest option surveyed by a wide margin.
Additionally, GoRules' own WASM-in-browser guidance notes that loading the module requires
`Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` headers for `SharedArrayBuffer`
support [(source: npm README for `@gorules/zen-engine-wasm`, queried 2026-08-29)](https://www.npmjs.com/package/@gorules/zen-engine-wasm?activeTab=readme) —
an extra static-hosting configuration constraint that plain-JS options don't impose.

**Collecting multiple matches.** As above — the `collect` hit policy is a strong, native fit,
arguably the best of any option surveyed for this specific requirement, *if* the ZEN
Expression Language trust/auditability trade-off is accepted.

**Other decision-table-shaped JS libraries found but not deep-dived** (weaker maturity
signals, listed for completeness rather than fully assessed): `Trool` (spreadsheet-driven
rule engine for Node/TS), `@brixx/decision-script`, `rules-engine-js`. None showed evidence of
materially more active maintenance or a materially better inert-JSON story than the two
options analyzed in depth above, based on a maintenance-status pass over their npm/GitHub
metadata.

---

## Comparison summary

| | Inert-JSON fit | Maintenance | Bundle (gzip, approx.) | Collect-all fit |
|---|---|---|---|---|
| **json-rules-engine** | Good (rule JSON is data; custom operators/facts are JS but live outside rule content) — but ships a dependency (`jsonpath-plus`) with a real RCE CVE history, now patched | Active (last push 2026-02, npm 7.3.1 / 2025-02) | ~20.7 KB | Very good — runs all rules, no short-circuit, priority tiers map onto gate-then-evaluate; no native "pathway" grouping |
| **json-logic-js** | Excellent — pure JSON AST, no functions possible by spec | Slow-moving (npm 2.0.5 / 2024-07), zero deps | ~1.6 KB | N/A alone — single-rule evaluator only; would need custom orchestration on top (≈ Option B) |
| **Custom interpreter (Option B)** | Excellent by construction — schema is the domain vocabulary itself | No upstream risk, but no upstream track record either — all correctness burden is internal | Smallest possible (bespoke code, no deps) | Exact fit — orchestration written to produce Recommendation Set directly |
| **Decision table / GoRules zen-engine (Option C)** | Caveat — cells are ZEN Expression Language strings, not plain JSON operator trees | Active but younger; browser target explicitly "experimental" | ~1.79 MB unpacked (heaviest by far) | Best native semantic fit (`collect` hit policy) if the DSL trade-off is accepted |
| **nools** (mentioned for contrast) | N/A | Abandoned (npm 0.4.4 / 2016, GitHub push 2019) | not evaluated further | not evaluated further |

## My lean (not a decision)

If I had to bet, I'd lean toward **Option B, a small custom interpreter**, restricted to a
JsonLogic-flavored predicate vocabulary for individual rule conditions (borrowing the *idea*
of JsonLogic's operator-tree, not necessarily the dependency itself). Reasoning:

- ADR-0001's core point is that this project *specifically does not want* general
  conflict-resolution/rule-chaining machinery — it wants independent per-source evaluation
  with everything collected. That is exactly the case where a general-purpose engine's extra
  machinery (priority scheduling, event buses, almanac abstractions in `json-rules-engine`;
  a full expression-language parser and hit-policy engine in GoRules) is mostly unused weight,
  bundle size included.
- ADR-0006's inert-JSON requirement is best satisfied by a schema that *is* the domain
  vocabulary (Gating Rule, Atomic Clinical Rule, Recommendation Source) rather than a
  general-purpose `fact`/`event`/`condition` vocabulary that this project's code would need to
  translate to and from anyway.
- The two-phase gate-then-evaluate-within-pathway control flow is simple enough (a filter,
  then a flat loop with no `break`) that writing it directly is genuinely less code, and
  less indirection to audit, than bending an engine's model onto it.
- The clinical/regulatory context favors an interpreter whose entire behavior is visible in
  one small, project-owned file over a third-party dependency whose edge-case behavior
  (`null` handling, operator precedence, upgrade behavior) must be trusted or independently
  verified regardless.

That said, this is a genuine judgment call, not a clear-cut case — `json-rules-engine`'s
"run everything, collect events, no short-circuit" behavior is a legitimately strong fit for
the collect-all requirement, is a known, documented, tested piece of software, and the
CVE history is in a dependency that's already patched in the pinned range, not a
current live issue. A team that would rather lean on tested library behavior than own an
interpreter — especially given the Golden Clinical Corpus testing regime already planned
for this project regardless of engine choice — could reasonably land there instead. I'd
weight the decision ticket's outcome more on team risk appetite for owning the interpreter
long-term than on any of the numbers above being disqualifying either way.

## Sources consulted (primary)

- [CacheControl/json-rules-engine — GitHub repo, README, docs/rules.md, docs/engine.md, package.json](https://github.com/CacheControl/json-rules-engine)
- [json-rules-engine — npm registry metadata](https://www.npmjs.com/package/json-rules-engine)
- [json-rules-engine — Bundlephobia](https://bundlephobia.com/package/json-rules-engine)
- [jsonpath-plus RCE advisory (CVE-2024-21534) — Snyk](https://security.snyk.io/vuln/SNYK-JS-JSONPATHPLUS-7945884)
- [JsonLogic — jsonlogic.com (spec/homepage)](https://jsonlogic.com/)
- [jwadhams/json-logic-js — GitHub repo, package.json](https://github.com/jwadhams/json-logic-js)
- [json-logic-js — npm registry metadata](https://www.npmjs.com/package/json-logic-js)
- [json-logic-js — Bundlephobia](https://bundlephobia.com/package/json-logic-js)
- [GoRules decision tables (hit policies incl. `collect`)](https://docs.gorules.io/docs/decision-table)
- [GoRules ZEN Expression Language](https://gorules.io/docs/user-manual/decision-modeling/expression-language)
- [@gorules/zen-engine-wasm — npm registry metadata / README](https://www.npmjs.com/package/@gorules/zen-engine-wasm)
- [noolsjs/nools — GitHub repo (maintenance-status contrast)](https://github.com/noolsjs/nools)
- [nools — npm registry metadata](https://www.npmjs.com/package/nools)
- This repo: `CONTEXT.md`, `docs/adr/0001-recommendations-are-collected-not-merged.md`,
  `docs/adr/0004-static-client-pwa-two-audit-concepts.md`,
  `docs/adr/0005-single-package-strict-internal-boundary.md`,
  `docs/adr/0006-clinical-rule-data-is-inert-json.md`

All library metadata (versions, publish dates, star counts, dependency lists, bundle sizes)
was queried directly from the GitHub API, the npm registry API, and Bundlephobia on
2026-08-29; figures will drift as these projects release new versions.
