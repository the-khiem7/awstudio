import Button from "@cloudscape-design/components/button";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useState } from "react";
import { emptyValue, isPrimitive, type Shape } from "./model";

/** Structures nested deeper than this are edited as JSON text: a form that deep is unusable. */
const MAX_FORM_DEPTH = 3;
const NOT_SET = { label: "(not set)", value: "" };

interface FieldProps {
  label: string;
  required?: boolean;
  shape: string;
  shapes: Record<string, Shape>;
  value: unknown;
  onChange: (next: unknown) => void;
  depth: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A JSON text box for a value the form cannot lay out: a document, or a structure nested too deep. */
function JsonText({ label, required, value, onChange }: { label: string; required?: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | undefined>();
  return (
    <FormField label={required ? `${label} *` : label} errorText={error}>
      <Textarea
        value={text}
        rows={4}
        spellcheck={false}
        onChange={({ detail }) => {
          setText(detail.value);
          if (!detail.value.trim()) {
            setError(undefined);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(detail.value));
            setError(undefined);
          } catch (e) {
            setError(`Not valid JSON: ${(e as Error).message}`);
          }
        }}
      />
    </FormField>
  );
}

function ScalarField({ label, required, shape, value, onChange }: Pick<FieldProps, "label" | "required" | "shape" | "value" | "onChange">) {
  const text = value === undefined || value === null ? "" : String(value);
  const title = required ? `${label} *` : label;
  if (shape === "@bool") {
    const current = value === true ? "true" : value === false ? "false" : "";
    return (
      <FormField label={title}>
        <Select
          selectedOption={current ? { label: current, value: current } : NOT_SET}
          options={[NOT_SET, { label: "true", value: "true" }, { label: "false", value: "false" }]}
          onChange={({ detail }) => onChange(detail.selectedOption.value === "" ? undefined : detail.selectedOption.value === "true")}
        />
      </FormField>
    );
  }
  if (shape === "@int" || shape === "@num") {
    return (
      <FormField label={title}>
        <Input
          type="number"
          inputMode={shape === "@int" ? "numeric" : "decimal"}
          value={text}
          onChange={({ detail }) => onChange(detail.value === "" ? undefined : Number(detail.value))}
        />
      </FormField>
    );
  }
  const hint = shape === "@ts" ? "Timestamp: ISO 8601 or epoch seconds" : shape === "@blob" ? "Blob: base64 text" : undefined;
  return (
    <FormField label={title} description={hint}>
      <Input
        value={text}
        onChange={({ detail }) => {
          const v = detail.value;
          onChange(v === "" ? undefined : shape === "@ts" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v);
        }}
      />
    </FormField>
  );
}

/** One input field generated from a shape of the bundle: scalar, enum, structure, list or map. */
export function ShapeField({ label, required, shape, shapes, value, onChange, depth }: FieldProps) {
  if (isPrimitive(shape)) {
    if (shape === "@doc") return <JsonText label={label} required={required} value={value} onChange={onChange} />;
    return <ScalarField label={label} required={required} shape={shape} value={value} onChange={onChange} />;
  }
  const def = shapes[shape];
  const title = required ? `${label} *` : label;
  if (!def) return <JsonText label={label} required={required} value={value} onChange={onChange} />;

  if (def.t === "e") {
    const current = value === undefined ? "" : String(value);
    return (
      <FormField label={title}>
        <Select
          selectedOption={current ? { label: current, value: current } : NOT_SET}
          options={[NOT_SET, ...def.v.map((v) => ({ label: String(v), value: String(v) }))]}
          onChange={({ detail }) => {
            const picked = detail.selectedOption.value ?? "";
            onChange(picked === "" ? undefined : def.n ? Number(picked) : picked);
          }}
          filteringType="auto"
        />
      </FormField>
    );
  }

  if (def.t === "s" || def.t === "u") {
    if (depth >= MAX_FORM_DEPTH) return <JsonText label={label} required={required} value={value} onChange={onChange} />;
    const record = asRecord(value);
    return (
      <ExpandableSection headerText={title} variant="footer" defaultExpanded={required === true || depth === 0 || record !== undefined && Object.keys(record).length > 0}>
        <SpaceBetween size="s">
          {def.t === "u" && <span>Fill in exactly one member.</span>}
          {Object.entries(def.m).map(([name, member]) => (
            <ShapeField
              key={name}
              label={name}
              required={member.length === 2}
              shape={member[0]}
              shapes={shapes}
              value={record[name]}
              onChange={(next) => onChange({ ...record, [name]: next })}
              depth={depth + 1}
            />
          ))}
        </SpaceBetween>
      </ExpandableSection>
    );
  }

  if (def.t === "l") {
    const items = Array.isArray(value) ? value : [];
    return (
      <FormField label={title}>
        <SpaceBetween size="xs">
          {items.map((item, index) => (
            <SpaceBetween key={index} direction="horizontal" size="xs" alignItems="end">
              <ShapeField
                label={`Item ${index + 1}`}
                shape={def.i}
                shapes={shapes}
                value={item}
                onChange={(next) => onChange(items.map((x, i) => (i === index ? next : x)))}
                depth={depth + 1}
              />
              <Button iconName="close" variant="icon" ariaLabel={`Remove item ${index + 1} of ${label}`} onClick={() => onChange(items.filter((_, i) => i !== index))} />
            </SpaceBetween>
          ))}
          <Button iconName="add-plus" onClick={() => onChange([...items, emptyValue(def.i, shapes) ?? ""])}>
            Add item
          </Button>
        </SpaceBetween>
      </FormField>
    );
  }

  // Map: a list of key and value rows, kept as an object.
  const record = asRecord(value);
  const keys = Object.keys(record);
  return (
    <FormField label={title}>
      <SpaceBetween size="xs">
        {keys.map((key) => (
          <SpaceBetween key={key} direction="horizontal" size="xs" alignItems="end">
            <FormField label="Key">
              <Input
                value={key}
                onChange={({ detail }) => {
                  if (detail.value === key || detail.value in record) return;
                  onChange(Object.fromEntries(keys.map((k) => [k === key ? detail.value : k, record[k]])));
                }}
              />
            </FormField>
            <ShapeField label="Value" shape={def.v} shapes={shapes} value={record[key]} onChange={(next) => onChange({ ...record, [key]: next })} depth={depth + 1} />
            <Button
              iconName="close"
              variant="icon"
              ariaLabel={`Remove ${key} from ${label}`}
              onClick={() => {
                const { [key]: _removed, ...rest } = record;
                onChange(rest);
              }}
            />
          </SpaceBetween>
        ))}
        <Button
          iconName="add-plus"
          onClick={() => {
            let n = keys.length + 1;
            while (`key${n}` in record) n += 1;
            onChange({ ...record, [`key${n}`]: emptyValue(def.v, shapes) ?? "" });
          }}
        >
          Add entry
        </Button>
      </SpaceBetween>
    </FormField>
  );
}

/** The input form of one operation: one field per member of its input shape. */
export function InputForm({ input, shapes, value, onChange }: { input: string; shapes: Record<string, Shape>; value: unknown; onChange: (v: unknown) => void }) {
  const def = shapes[input];
  if (!def || (def.t !== "s" && def.t !== "u")) return null;
  const record = asRecord(value);
  return (
    <SpaceBetween size="s">
      {Object.entries(def.m).map(([name, member]) => (
        <ShapeField
          key={name}
          label={name}
          required={member.length === 2}
          shape={member[0]}
          shapes={shapes}
          value={record[name]}
          onChange={(next) => onChange({ ...record, [name]: next })}
          depth={1}
        />
      ))}
    </SpaceBetween>
  );
}
