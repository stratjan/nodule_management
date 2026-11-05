// Wizard question sequencing/navigation for this one pathway (ADR-0006 repo layout).
// Zero clinical logic here -- only which fields to ask, in what order, and how to render
// them. All actual evaluation happens in src/engine.
import type { ClinicalDispositionKind } from "../engine/types";

export interface SelectFieldDef {
  id: "nodule_morphology" | "assessment_context" | "assessment_timepoint" | "fleischner_multiple_solid_risk_category";
  label: string;
  type: "select";
  options: { value: string; label: string }[];
}

export interface NumberFieldDef {
  id: "nodule_count" | "nodule_size_mm" | "nodule_volume_mm3" | "age" | "s3_vdt_days";
  label: string;
  type: "number";
  step?: string;
  min?: number;
  /** issue #18/#9: product-wide whole-millimeter clinical diameter authoring -- rejects (never
   * rounds) a fractional committed value at the UI layer. See src/workflow/wholeMmInput.ts.
   * Not part-solid-specific; applies to nodule_size_mm generally, per the binding product
   * decision recorded on issue #9. */
  wholeMmOnly?: boolean;
}

export interface BooleanFieldDef {
  id:
    | "known_malignancy_history"
    | "immunocompromised"
    | "s3_volume_stability_criterion_met"
    | "s3_general_condition_precludes_further_workup_or_therapy"
    | "multiple_nodules_all_subsolid"
    | "multiple_nodules_discrete_circumscribed"
    | "fleischner_multiple_subsolid_any_gte_6mm"
    | "multiple_nodules_all_solid"
    | "fleischner_multiple_solid_all_lt_6mm"
    | "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management"
    | "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed"
    | "clinician_decides_no_further_routine_nodule_surveillance";
  label: string;
  type: "boolean";
}

export type FieldDef = SelectFieldDef | NumberFieldDef | BooleanFieldDef;

/** Step 1: solitary-branch pathway-identity fields. All four required for nodule_count = 1 -- any
 * omission blocks evaluation entirely. The multiple-nodule branch (issue #16 Candidate A) asks
 * assessment_context/assessment_timepoint/nodule_count plus multipleSubsolidPathwayFields instead,
 * never nodule_morphology. */
export const pathwayFields: FieldDef[] = [
  {
    id: "nodule_morphology",
    label: "Nodule morphology",
    type: "select",
    options: [
      { value: "solid", label: "Solid" },
      { value: "pure-ground-glass", label: "Pure ground-glass / non-solid" },
      { value: "part-solid", label: "Part-solid" },
    ],
  },
  {
    id: "assessment_context",
    label: "Assessment context",
    type: "select",
    options: [{ value: "incidental", label: "Incidental finding" }],
  },
  {
    id: "assessment_timepoint",
    label: "Assessment timepoint",
    type: "select",
    options: [
      { value: "initial", label: "Initial assessment" },
      { value: "follow-up", label: "Follow-up assessment" },
    ],
  },
  { id: "nodule_count", label: "Number of discrete nodules", type: "number", min: 1 },
];

/** Step 2: measurement -- at least one of the two required, neither individually mandatory. */
export const measurementFields: FieldDef[] = [
  { id: "nodule_size_mm", label: "Whole-nodule diameter (mm)", type: "number", step: "1", min: 0, wholeMmOnly: true },
  { id: "nodule_volume_mm3", label: "Volume (mm³)", type: "number", step: "1", min: 0 },
];

/** Step 2: per-source applicability -- each optional; omitting one only affects sources that need it. */
export const applicabilityFields: FieldDef[] = [
  { id: "age", label: "Age (years)", type: "number", min: 0 },
  { id: "known_malignancy_history", label: "Known malignancy history", type: "boolean" },
  { id: "immunocompromised", label: "Immunocompromised", type: "boolean" },
];

/** Step 2, solid-follow-up pathway only (issue #15 Candidate A0/B1/C): the three independently
 * sufficient S3 discharge criteria. Rendered only when the pathway-shaped input is solid/
 * incidental/follow-up/solitary (App.tsx) -- optional here like every other Step-2 field; an
 * unanswered value is itself a valid, intended INSUFFICIENT_INPUT outcome, not a blocked
 * evaluation. */
export const followUpFields: FieldDef[] = [
  {
    id: "s3_volume_stability_criterion_met",
    label: "S3 criterion confirmed: volume increase <25% over approximately one year",
    type: "boolean",
  },
  {
    id: "s3_vdt_days",
    label: "S3 criterion: volume-doubling time (VDT), in days (clinician-entered; not calculated)",
    type: "number",
    min: 0,
  },
  {
    id: "s3_general_condition_precludes_further_workup_or_therapy",
    label: "S3 criterion confirmed: general condition does not permit further diagnostic work-up or therapy",
    type: "boolean",
  },
];

/** Step 1, multiple-nodule branch only (issue #16 Candidate A): the two source-neutral, set-level
 * pathway-identity facts GR-5 gates on. Rendered only when nodule_count >= 2 (App.tsx), in place
 * of nodule_morphology -- the solitary morphology field is never reused to describe a multiple
 * set. */
export const multipleSubsolidPathwayFields: FieldDef[] = [
  {
    id: "multiple_nodules_all_subsolid",
    label: "All nodules are subsolid (pure ground-glass and/or part-solid); none is fully solid",
    type: "boolean",
  },
  {
    id: "multiple_nodules_discrete_circumscribed",
    label:
      "Nodules are discrete/circumscribed (not a disseminated, diffuse, miliary, or metastatic-pattern presentation)",
    type: "boolean",
  },
];

/** Step 2, GR-5 shape only (issue #16 Candidate A): the Fleischner-specific, set-level size-state
 * attestation. Optional like every other Step-2 field -- an unanswered value is itself a valid,
 * intended Fleischner INSUFFICIENT_INPUT outcome, not a blocked evaluation. */
export const multipleSubsolidFleischnerFields: FieldDef[] = [
  {
    id: "fleischner_multiple_subsolid_any_gte_6mm",
    label:
      "Fleischner: at least one subsolid nodule measures 6 mm or larger (Yes = at least one ≥6 mm; No = all <6 mm)",
    type: "boolean",
  },
];

/** issue #16 Candidate A implementation-readiness sign-off (comment 5858952610 §4), binding
 * wording: the already-established Fleischner whole-nodule measurement convention, made explicit
 * where the clinician applies the 6 mm threshold to fleischner_multiple_subsolid_any_gte_6mm.
 * Wording only -- no measurement field, per-lesion storage, or engine-side measurement logic
 * follows from it; the fact itself stays a clinician-attested set-level criterion. */
export const FLEISCHNER_MULTIPLE_SUBSOLID_MEASUREMENT_HELP_TEXT =
  "When determining whether any subsolid nodule is 6 mm or larger, use the established Fleischner whole-nodule diameter convention: average the long- and short-axis diameters and round to the nearest whole millimeter.";

/** issue #16 Candidate B: source-neutral multiple-solid set membership. */
export const multipleSolidSetField: FieldDef = {
  id: "multiple_nodules_all_solid",
  label: "All nodules are solid; none is pure ground-glass or part-solid",
  type: "boolean",
};

export const multipleSolidSizeField: FieldDef = {
  id: "fleischner_multiple_solid_all_lt_6mm",
  label: "Fleischner: all solid nodules measure less than 6 mm (Yes = all <6 mm; No = at least one ≥6 mm)",
  type: "boolean",
};

export const multipleSolidFleischnerRiskFields: FieldDef[] = [
  {
    id: "fleischner_multiple_solid_risk_category",
    label: "Fleischner risk category — your clinical decision",
    type: "select",
    options: [
      { value: "low", label: "Low risk" },
      { value: "high", label: "High risk" },
    ],
  },
];

export const FLEISCHNER_MULTIPLE_SOLID_MEASUREMENT_HELP_TEXT =
  "When determining whether all solid nodules are smaller than 6 mm, use the established Fleischner whole-nodule diameter convention: average the long- and short-axis diameters and round to the nearest whole millimeter.";

export const FLEISCHNER_MULTIPLE_SOLID_RISK_DECISION_SUPPORT = {
  heading: "Fleischner risk context — decision support only (not scored)",
  items: [
    "Fleischner 2017 defines low risk as an estimated lung-cancer risk below 5%, and high risk as the combined intermediate-risk (5–65%) and high-risk (>65%) categories of the American College of Chest Physicians.",
    "Factors the guideline describes as relevant to this estimate include: age; smoking exposure; nodule size; nodule margins (for example irregular or spiculated); upper-lobe location.",
    "The guideline gives no scoring rule for these factors. This app does not calculate a score, weight any factor, or derive low or high risk from them; no single factor or combination determines the category here.",
    "The risk category you select is your clinical decision.",
  ],
} as const;

export const FLEISCHNER_MULTIPLE_SOLID_CONTEXT_NOTE =
  "Fleischner notes that this pathway may not apply unchanged when there is a known or suspected primary neoplasm that could be a source of metastatic disease, or when there is clinical evidence of active infection; those contexts may require different individualized management.";

/** Step 2, GR-7 shape only (issue #16 Candidate C, HITL 6262113321 HITL 3/4): the single
 * clinician confirmation of the binding governing-nodule safeguard. Confirmation-shaped -- only
 * "Yes" unlocks the recommendation; an unanswered value is an intended Fleischner
 * INSUFFICIENT_INPUT outcome, not a blocked evaluation. Never phrased as "there is no dominant
 * nodule". No Fleischner risk field is asked on this pathway. */
export const multipleSolidGte6mmSafeguardFields: FieldDef[] = [
  {
    id: "fleischner_multiple_solid_no_individual_nodule_requires_solitary_management",
    label:
      "Fleischner: I confirm that no individual larger / more suspicious nodule currently requires management according to the Fleischner solitary-nodule recommendations instead of this bounded multiple-nodule pathway (Yes = confirmed; No = not confirmed)",
    type: "boolean",
  },
];

/** issue #16 Candidate C (HITL 3): neutral help text -- explains the source's governing-nodule
 * clause without enumerating or executing any alternative solitary-nodule action. */
export const FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_HELP_TEXT =
  "Fleischner 2017 notes that, when multiple solid nodules are present, management may be guided by a larger or more suspicious nodule according to its solitary-nodule recommendations. The most suspicious nodule is not necessarily the largest. This app does not identify, rank, or select any individual nodule; whether such a nodule requires solitary-nodule management is your clinical judgment.";

/** issue #16 Candidate C (HITL 4; readiness 6268250838 clarification 2): neutral notice shown in
 * Step 2 and on the Results page when the safeguard is not confirmed. Explanatory only -- no
 * redirect, no solitary evaluation, no lesion identity, no alternative management. */
export const FLEISCHNER_MULTIPLE_SOLID_SOLITARY_SAFEGUARD_NOT_CONFIRMED_NOTICE =
  "Solitary-nodule-directed management is outside this bounded multiple-nodule pathway and is not evaluated here.";

/** Step 1, every incidental follow-up (issue #16 Candidate D, HITL 6338095264 Q2; sign-off
 * 6376704317 B): the episode-origin attestation GR-8 (true) and GR-4-r2 (false) gate on. Identity
 * only -- asks how this episode started, never about the current appearance. */
export const firstFollowUpOriginField: FieldDef = {
  id: "fleischner_multiple_solid_gte6mm_first_follow_up_origin_confirmed",
  label:
    "First follow-up after an initial Fleischner multiple solid nodule assessment with at least one nodule ≥6 mm, for which CT at 3–6 months was intended (Yes / No)",
  type: "boolean",
};

export const FIRST_FOLLOW_UP_ORIGIN_HELP_TEXT =
  "Answer about how this episode started. \"Yes\" does not state that the nodules are still multiple, solid, 6 mm or larger, stable, or persistent at this examination.";

/** Step 2, GR-8 shape only, once the safeguard is confirmed (issue #16 Candidate D, HITL Q3;
 * ADR-0012 §3): the clinician's own terminal decision. Source-neutral; never a Fleischner rule. */
export const clinicianDispositionFields: FieldDef[] = [
  {
    id: "clinician_decides_no_further_routine_nodule_surveillance",
    label:
      "Clinician-directed decision: based on the current interval imaging findings and overall clinical context, I decide that no further routine pulmonary nodule surveillance is planned (Yes = no further routine surveillance planned; No = continue to the Fleischner 18–24-month guidance)",
    type: "boolean",
  },
];

/** issue #16 Candidate D sign-off D1: examples only -- never criteria, thresholds, or Fleischner
 * stop rules. */
export const CLINICIAN_DISPOSITION_HELP_TEXT =
  "Examples of interval findings that may inform this decision include clear regression or radiographic resolution of the nodules. These are examples only: they are not criteria or thresholds, they are not Fleischner stop rules, the app calculates no change, and your decision is not limited to them.";

/** issue #16 Candidate D sign-off D2: follow-up examples for the existing safeguard -- examples only,
 * no alternative management listed, no redirect. */
export const FLEISCHNER_MULTIPLE_SOLID_FOLLOW_UP_SAFEGUARD_HELP_TEXT =
  "At follow-up, examples of what may make an individual nodule more suspicious include interval growth or new or changed suspicious features. These are examples only, not criteria; this app does not identify any such nodule, list alternative management, or redirect to another pathway.";

/** issue #16 Candidate D (HITL Q3 heading): presentation-only heading per closed disposition kind. */
export const CLINICAL_DISPOSITION_HEADINGS: Record<ClinicalDispositionKind, string> = {
  "clinician-directed-no-further-routine-surveillance":
    "Clinician-directed disposition: No further routine nodule surveillance planned.",
};
