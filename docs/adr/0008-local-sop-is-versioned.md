---
status: accepted
---

# The Local SOP itself is versioned; historical SOP and Rule-Set versions are immutable

Clinical knowledge evolves — guidelines change and the Local SOP must be updateable over time. We considered treating the Local SOP as one fixed document, but rejected it: that would make evolution mean silently editing the meaning of past decisions. Instead the Local SOP exists as a sequence of Local SOP Versions. A new Local SOP Version triggers identifying affected Atomic Clinical Rules, authoring new Rule Revisions for them, clinical review/approval, running the full Golden Clinical Corpus regression suite, publishing a new Rule-Set Release, and explicitly promoting it to Active. A previously released Local SOP Version or Rule-Set Release is never modified in place — only ever superseded by a new version, keeping current/active clinical content free to advance while historical released versions stay immutable and reproducible.
