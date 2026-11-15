import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiError } from "../bindings";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import type { Capability, CapabilityMatrix, OpCapability, ServiceCapability } from "./types";

export type { Capability, CapabilityMatrix, OpCapability, ServiceCapability, Tier } from "./types";

interface CapabilityValue {
  matrix: CapabilityMatrix | null;
  /** Operations, or `op#variant` pairs, that answered HTTP 501 during the current emulator run. */
  runtime501: ReadonlySet<string>;
  /** Records an `unsupported` error so the control that caused it is disabled for the rest of the run. */
  reportUnsupported: (error: unknown) => void;
}

const CapabilityContext = createContext<CapabilityValue | null>(null);

/** Loads the generated matrix once and keeps the 501 answers of the current run. */
export function CapabilityProvider({ children }: { children: ReactNode }) {
  const { runId } = useRuntimeStatus();
  const [matrix, setMatrix] = useState<CapabilityMatrix | null>(null);
  const [runtime501, setRuntime501] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    // A separate chunk: the matrix covers every modeled service and is the largest asset.
    import("./capability.json").then((m) => setMatrix(m.default as unknown as CapabilityMatrix));
  }, []);

  // A new run is a new emulator process, possibly another build: its 501 answers start over.
  useEffect(() => setRuntime501(new Set()), [runId]);

  const reportUnsupported = useCallback((error: unknown) => {
    const err = error as ApiError | null;
    if (!err || typeof err !== "object" || err.kind !== "unsupported") return;
    const key = err.variant ? `${err.op}#${err.variant}` : err.op;
    setRuntime501((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const value = useMemo(() => ({ matrix, runtime501, reportUnsupported }), [matrix, runtime501, reportUnsupported]);
  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

function useCapabilityContext(): CapabilityValue {
  const value = useContext(CapabilityContext);
  if (!value) throw new Error("capability hook outside CapabilityProvider");
  return value;
}

export function useCapabilityMatrix() {
  return useCapabilityContext().matrix;
}

export function useReportUnsupported() {
  return useCapabilityContext().reportUnsupported;
}

/** `AWS Emulator v1.0.382`, the build the matrix was made from. */
export function emulatorLabel(matrix: CapabilityMatrix | null): string {
  return matrix ? `AWS Emulator ${matrix.vendor.tag}` : "AWS Emulator";
}

/** Splits `service:Operation`, for example `lambda:UpdateFunctionCode`. */
function splitOp(id: string): [string, string] {
  const at = id.indexOf(":");
  return at < 0 ? ["", id] : [id.slice(0, at), id.slice(at + 1)];
}

const PLACEHOLDER_ONLY = /^\{[^}]*\}$/;

/**
 * True when the matrix lists `variant` as unsupported for this operation. A listed entry may hold a
 * `{placeholder}` the emulator fills in at run time; it matches any text there. An entry that is
 * only a placeholder names no feature, so it matches nothing: the run-time 501 cache covers it.
 */
export function variantUnsupported(op: OpCapability, variant: string): boolean {
  const query = variant.toLowerCase();
  return (op.unsupported ?? []).some((entry) => {
    if (PLACEHOLDER_ONLY.test(entry)) return false;
    const lower = entry.toLowerCase();
    if (lower === query || lower.startsWith(`${query}=`) || lower.startsWith(`${query} `)) return true;
    const pattern = lower
      .split(/\{[^}]*\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".+");
    return new RegExp(`^${pattern}$`).test(query);
  });
}

/** Pure form of {@link useCapability}, for lists that judge many operations at once. */
export function judge(
  matrix: CapabilityMatrix | null,
  runtime501: ReadonlySet<string>,
  id: string,
  variant?: string,
): Capability {
  const label = emulatorLabel(matrix);
  if (!matrix) return { tier: "unknown", enabled: false, reason: "Loading the capability matrix" };
  const [service, name] = splitOp(id);
  const op = matrix.services[service]?.ops[name];
  if (!op) return { tier: "unknown", enabled: false, reason: `${name} is not modeled by ${label}` };
  // Backend errors name the operation as `service:Operation`, so a 501 disables only that
  // service's control, not a same-named operation of another service.
  if (runtime501.has(`${service}:${name}`)) {
    return { tier: "red", enabled: false, reason: `${name} answered HTTP 501 during this emulator run`, pass: op.pass };
  }
  if (variant && (runtime501.has(`${service}:${name}#${variant}`) || variantUnsupported(op, variant))) {
    return { tier: op.tier, enabled: false, reason: `${name} with ${variant} is not supported by ${label}`, pass: op.pass };
  }
  switch (op.tier) {
    case "green":
      return { tier: "green", enabled: true, reason: "", pass: op.pass };
    case "yellow":
      return {
        tier: "yellow",
        enabled: false,
        reason: `${name} is only partly supported by ${label} (${op.pass} conformance steps pass)`,
        pass: op.pass,
      };
    default:
      return {
        tier: "red",
        enabled: false,
        reason:
          op.reason === "unwired" || op.reason === "scaffolded"
            ? `${name} is not implemented in ${label} (HTTP 501)`
            : `${name} is not supported by ${label} (${op.pass ?? "0"} conformance steps pass)`,
        pass: op.pass,
      };
  }
}

/**
 * Whether a control bound to `service:Operation` may call the backend. Green is functional; yellow,
 * red, a listed unsupported variant, or a 501 seen in this run disable the control with a reason.
 */
export function useCapability(id: string, variant?: string): Capability {
  const { matrix, runtime501 } = useCapabilityContext();
  return useMemo(() => judge(matrix, runtime501, id, variant), [matrix, runtime501, id, variant]);
}

/** Judges several operations with one hook call. */
export function useCapabilities(ids: readonly string[]): Record<string, Capability> {
  const { matrix, runtime501 } = useCapabilityContext();
  const key = ids.join("|");
  return useMemo(
    () => Object.fromEntries(ids.map((id) => [id, judge(matrix, runtime501, id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix, runtime501, key],
  );
}

export interface TierCounts {
  green: number;
  yellow: number;
  red: number;
  total: number;
}

export function tierCounts(service: ServiceCapability | undefined): TierCounts {
  const counts: TierCounts = { green: 0, yellow: 0, red: 0, total: 0 };
  for (const op of Object.values(service?.ops ?? {})) {
    counts[op.tier] += 1;
    counts.total += 1;
  }
  return counts;
}
