// The trimmed Smithy bundle `src/apimodel/<service key>.json`, written by tools/apimodel-gen, and
// the helpers the API Console forms are built from. One file per service, loaded on demand.

export type Shape =
  | { t: "s"; m: Record<string, [string] | [string, 1]> }
  | { t: "u"; m: Record<string, [string] | [string, 1]> }
  | { t: "l"; i: string }
  | { t: "m"; k: string; v: string }
  | { t: "e"; v: (string | number)[]; n: boolean };

export interface ModelOp {
  /** CLI operation name; absent when the installed AWS CLI does not know the operation. */
  c?: string;
  /** Input shape name; absent for an operation without input. */
  i?: string;
  /** The answer is a streaming blob, which the CLI writes to a file. */
  st?: 1;
}

export interface ServiceModel {
  n: string;
  /** CLI service name; absent when the installed AWS CLI does not know the service. */
  cli?: string;
  ops: Record<string, ModelOp>;
  shapes: Record<string, Shape>;
}

const loaders = import.meta.glob<{ default: ServiceModel }>("../apimodel/*.json");

/** Loads the bundle of one service, by its capability key (the SDK id slug). */
export async function loadServiceModel(key: string): Promise<ServiceModel | null> {
  const load = loaders[`../apimodel/${key}.json`];
  return load ? (await load()).default : null;
}

export type Primitive = "@str" | "@int" | "@num" | "@bool" | "@ts" | "@blob" | "@doc";

export function isPrimitive(ref: string): ref is Primitive {
  return ref.startsWith("@");
}

/** An empty value of a shape, as the form starts it: nothing for a scalar, `{}` for a structure. */
export function emptyValue(ref: string, shapes: Record<string, Shape>): unknown {
  if (isPrimitive(ref)) return undefined;
  const shape = shapes[ref];
  if (!shape) return undefined;
  if (shape.t === "s" || shape.t === "u") return {};
  if (shape.t === "l") return [];
  if (shape.t === "m") return {};
  return undefined;
}

/** Drops empty strings, empty containers and undefined, so the CLI input holds only what was filled in. */
export function prune(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

/** The input text for the CLI: `null` when nothing was filled in. */
export function inputText(value: unknown): string | null {
  const pruned = prune(value);
  return pruned === undefined ? null : JSON.stringify(pruned, null, 2);
}

/** Names of the required members of an input shape, for the form's markers and the Run check. */
export function requiredMembers(input: string | undefined, shapes: Record<string, Shape>): string[] {
  const shape = input ? shapes[input] : undefined;
  if (!shape || (shape.t !== "s" && shape.t !== "u")) return [];
  return Object.entries(shape.m)
    .filter(([, m]) => m.length === 2)
    .map(([name]) => name);
}

/** Required members that the filled-in value leaves empty, at the top level of the input. */
export function missingRequired(input: string | undefined, shapes: Record<string, Shape>, value: unknown): string[] {
  const filled = (prune(value) ?? {}) as Record<string, unknown>;
  return requiredMembers(input, shapes).filter((name) => filled[name] === undefined);
}
