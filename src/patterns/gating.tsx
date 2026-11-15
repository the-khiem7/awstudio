import Alert from "@cloudscape-design/components/alert";
import Button, { type ButtonProps } from "@cloudscape-design/components/button";
import { createContext, useContext, type ReactNode } from "react";
import { emulatorLabel, useCapability, useCapabilityMatrix, type Capability } from "../capability";

// Gating shared by every page pattern. A page whose primary read operation (its List or Describe
// call) is red, or not judged yet, is UI-only: no data is loaded and every control is disabled. A
// yellow primary read still loads data under a "partly supported" banner; the page's other
// controls keep their own tiers, so yellow actions stay disabled.

interface UiOnlyValue {
  uiOnly: boolean;
  /** The primary read is yellow: data loads, with a banner saying it is only partly supported. */
  partial: boolean;
  reason: string;
  /** The page's primary read, which may run on a partial page although it is yellow. */
  primaryOp: string;
}

const UiOnlyContext = createContext<UiOnlyValue>({ uiOnly: false, partial: false, reason: "", primaryOp: "" });

/** Judges the page's primary read operation (its List or Describe call). */
export function usePageCapability(primaryOp: string): UiOnlyValue & { capability: Capability } {
  const capability = useCapability(primaryOp);
  const partial = capability.tier === "yellow" && !capability.enabled;
  const uiOnly = !capability.enabled && !partial;
  return { uiOnly, partial, reason: capability.reason, primaryOp, capability };
}

/** Puts a page, or a part of one, in UI-only or partial mode for every gated control inside it. */
export function UiOnlyScope({ primaryOp, children }: { primaryOp: string; children: ReactNode }) {
  const { uiOnly, partial, reason } = usePageCapability(primaryOp);
  return <UiOnlyContext.Provider value={{ uiOnly, partial, reason, primaryOp }}>{children}</UiOnlyContext.Provider>;
}

export function useUiOnly(): UiOnlyValue {
  return useContext(UiOnlyContext);
}

/** Combines a control's own capability with the page's UI-only state. */
export function useGate(op?: string, variant?: string): { enabled: boolean; reason: string } {
  const page = useUiOnly();
  const own = useCapability(op ?? "", variant);
  if (page.uiOnly) return { enabled: false, reason: `This page is view-only: ${page.reason}` };
  if (!op) return { enabled: true, reason: "" };
  // The primary read of a partial page runs: the page exists to show what it returns.
  if (page.partial && op === page.primaryOp && !variant) return { enabled: true, reason: "" };
  return { enabled: own.enabled, reason: own.reason };
}

export interface GatedButtonProps extends Omit<ButtonProps, "disabledReason"> {
  /** `service:Operation` the button calls, for example `s3:CreateBucket`. */
  op?: string;
  /** Feature of the operation the button uses, for example `PublishTo`. */
  feature?: string;
}

/** A Button that is disabled, with the reason as its tooltip, unless its operation may run. */
export function GatedButton({ op, feature, disabled, ...rest }: GatedButtonProps) {
  const gate = useGate(op, feature);
  return <Button {...rest} disabled={disabled || !gate.enabled} disabledReason={!gate.enabled ? gate.reason : undefined} />;
}

/** The banner of a UI-only page: "Not supported by AWS Emulator vX". */
export function UnsupportedBanner({ reason, children }: { reason?: string; children?: ReactNode }) {
  const matrix = useCapabilityMatrix();
  const page = useUiOnly();
  const text = reason ?? page.reason;
  return (
    <Alert type="info" header={`Not supported by ${emulatorLabel(matrix)}`}>
      {children ?? `${text}. This page shows the console layout only; its actions are disabled and no data is loaded.`}
    </Alert>
  );
}

/** The banner of a partial page: the data shown may be incomplete. */
export function PartialBanner() {
  const matrix = useCapabilityMatrix();
  const page = useUiOnly();
  return (
    <Alert type="warning" header={`Partly supported by ${emulatorLabel(matrix)}`}>
      {`${page.reason}. The data below comes from the emulator and may be incomplete; actions that the emulator supports only partly are disabled.`}
    </Alert>
  );
}

/** The banner of the current scope, if any: UI-only or partly supported. */
export function ScopeBanner() {
  const { uiOnly, partial } = useUiOnly();
  if (uiOnly) return <UnsupportedBanner />;
  if (partial) return <PartialBanner />;
  return null;
}
