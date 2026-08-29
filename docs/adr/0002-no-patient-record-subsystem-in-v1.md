---
status: accepted
---

# No patient-record subsystem in v1

The application does not persist identifiable, longitudinal patient records in v1. We considered modeling a Patient/Case history subsystem to support follow-up over time, but rejected it for now: it would add persistence, identity, and data-protection scope the product doesn't yet need, since a clinician can supply prior imaging, size, and volume-change values as plain inputs on Clinical Input State for the current evaluation. The domain model (Clinical Input State as transient, non-identifying wizard input, Decision Execution Trace as the reproducible output) is deliberately kept free of any assumption that a patient record exists, so longitudinal persistence can be added later as a separate subsystem without rewriting the clinical rule engine.
