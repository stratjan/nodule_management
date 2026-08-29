---
status: accepted
---

# Single package with a strict internal boundary; monorepo deferred until a second consumer exists

A future Capacitor Android wrapper may reuse the same application and clinical engine. We considered setting up monorepo/workspace tooling now to anticipate that, but rejected it: there is no second consumer yet, and standing up workspace tooling for a hypothetical one is exactly the premature structure to avoid. Instead the repository stays a single package, with a strict internal boundary enforced between the clinical engine and the UI: the engine has zero dependency on React or any UI code. This boundary, not the tooling, is what makes a future workspace split cheap when a second real consumer actually appears.
