import type { FieldDef } from "../workflow/fields";

type FieldValue = string | number | boolean | undefined;

interface Props {
  field: FieldDef;
  value: FieldValue;
  onChange: (id: string, value: FieldValue) => void;
}

export function FieldInput({ field, value, onChange }: Props) {
  if (field.type === "select") {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.id, e.target.value || undefined)}
        >
          <option value="">-- select --</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "boolean") {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(field.id, e.target.value === "" ? undefined : e.target.value === "true")
          }
        >
          <option value="">-- unknown / not provided --</option>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type="number"
        step={field.step ?? "1"}
        min={field.min}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(field.id, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}
