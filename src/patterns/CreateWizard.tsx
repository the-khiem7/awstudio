// Adapted from cloudscape-design/demos (MIT-0): pages/wizard.

import Wizard, { type WizardProps } from "@cloudscape-design/components/wizard";
import { useState, type ReactNode } from "react";
import { useReportUnsupported } from "../capability";
import { errorText } from "../runtime/api";
import { useGate } from "./gating";
import { useUnsavedChanges } from "./unsaved";

export interface WizardStep {
  title: string;
  description?: ReactNode;
  info?: ReactNode;
  isOptional?: boolean;
  content: ReactNode;
  /** Validates the step before Next; returns false to stay on it. */
  validate?: () => boolean;
}

export interface CreateWizardProps {
  steps: WizardStep[];
  /** Label of the last step's submit, for example "Create user". */
  submitLabel: string;
  /** `service:Operation` the submit calls. */
  op: string;
  dirty: boolean;
  onSubmit: () => Promise<void>;
  cancelHref: string;
  doneHref?: string;
}

/** A multi-step create flow with a review step, per-step validation and an unsaved-changes guard. */
export function CreateWizard({ steps, submitLabel, op, dirty, onSubmit, cancelHref, doneHref }: CreateWizardProps) {
  const [active, setActive] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useGate(op);
  const reportUnsupported = useReportUnsupported();
  const guard = useUnsavedChanges(dirty && !submitting);

  const onNavigate: WizardProps["onNavigate"] = ({ detail }) => {
    if (detail.reason === "next" && steps[active]?.validate && !steps[active].validate!()) return;
    setActive(detail.requestedStepIndex);
  };

  const submit = async () => {
    if (!gate.enabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit();
      guard.release();
      guard.go(doneHref ?? cancelHref);
    } catch (err) {
      reportUnsupported(err);
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const last = steps.length - 1;
  return (
    <>
      <Wizard
        activeStepIndex={active}
        onNavigate={onNavigate}
        onCancel={() => guard.leave(cancelHref)}
        onSubmit={submit}
        isLoadingNextStep={submitting}
        submitButtonText={submitLabel}
        allowSkipTo
        i18nStrings={{
          stepNumberLabel: (n) => `Step ${n}`,
          collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
          skipToButtonLabel: (step) => `Skip to ${step.title}`,
          navigationAriaLabel: "Steps",
          cancelButton: "Cancel",
          previousButton: "Previous",
          nextButton: "Next",
          optional: "optional",
        }}
        steps={steps.map((step, i) => ({
          title: step.title,
          description: step.description,
          info: step.info,
          isOptional: step.isOptional,
          errorText: i === last ? (error ?? (!gate.enabled ? gate.reason : undefined)) : undefined,
          content: step.content,
        }))}
      />
      {guard.modal}
    </>
  );
}
