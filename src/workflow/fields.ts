// Wizard question sequencing/navigation for this one pathway (ADR-0006 repo layout).
// Zero clinical logic here -- only which fields to ask, in what order, and how to render
// them. All actual evaluation happens in src/engine.

export interface SelectFieldDef {
  id: "nodule_morphology" | "assessment_context" | "assessment_timepoint";
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
    | "s3_general_condition_precludes_further_workup_or_therapy";
  label: string;
  type: "boolean";
}

export type FieldDef = SelectFieldDef | NumberFieldDef | BooleanFieldDef;

/** Step 1: pathway-identity fields. All four required -- any omission blocks evaluation entirely. */
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
