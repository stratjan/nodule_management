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
  id: "nodule_count" | "nodule_size_mm" | "nodule_volume_mm3" | "age";
  label: string;
  type: "number";
  step?: string;
  min?: number;
}

export interface BooleanFieldDef {
  id: "known_malignancy_history" | "immunocompromised";
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
    options: [{ value: "solid", label: "Solid" }],
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
    options: [{ value: "initial", label: "Initial assessment" }],
  },
  { id: "nodule_count", label: "Number of discrete nodules", type: "number", min: 1 },
];

/** Step 2: measurement -- at least one of the two required, neither individually mandatory. */
export const measurementFields: FieldDef[] = [
  { id: "nodule_size_mm", label: "Diameter (mm)", type: "number", step: "0.1", min: 0 },
  { id: "nodule_volume_mm3", label: "Volume (mm³)", type: "number", step: "1", min: 0 },
];

/** Step 2: per-source applicability -- each optional; omitting one only affects sources that need it. */
export const applicabilityFields: FieldDef[] = [
  { id: "age", label: "Age (years)", type: "number", min: 0 },
  { id: "known_malignancy_history", label: "Known malignancy history", type: "boolean" },
  { id: "immunocompromised", label: "Immunocompromised", type: "boolean" },
];
