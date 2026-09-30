// Wizard question sequencing/navigation for this one pathway (ADR-0006 repo layout).
// Zero clinical logic here -- only which fields to ask, in what order, and how to render
// them. All actual evaluation happens in src/engine.

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
    | "fleischner_multiple_solid_all_lt_6mm";
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
