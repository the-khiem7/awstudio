import Alert from "@cloudscape-design/components/alert";
import Button, { type ButtonProps } from "@cloudscape-design/components/button";
import { createContext, useContext, type ReactNode } from "react";
import { emulatorLabel, useCapability, useCapabilityMatrix, type Capability } from "../capability";

// Gating shared by every page pattern: a page whose primary read operation is not green is
// UI-only, and every control on it is disabled, whatever its own operation's tier.

interface UiOnlyValue {
  uiOnly: boolean;
  reason: string;
}

const UiOnlyContext = createContext<UiOnlyValue>({ uiOnly: false, reason: "" });

/** Judges the page's primary read operation (its List or Describe call). */
export function usePageCapability(primaryOp: string): UiOnlyValue & { capability: Capability } {
  const capability = useCapability(primaryOp);
  return { uiOnly: !capability.enabled, reason: capability.reason, capability };
}

/** Puts a page, or a part of one, in UI-only mode for every gated control inside it. */
export function UiOnlyScope({ primaryOp, children }: { primaryOp: string; children: ReactNode }) {
  const { uiOnly, reason } = usePageCapability(primaryOp);
  return <UiOnlyContext.Provider value={{ uiOnly, reason }}>{children}</UiOnlyContext.Provider>;
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
