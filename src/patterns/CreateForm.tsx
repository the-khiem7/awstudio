// Adapted from cloudscape-design/demos (MIT-0): pages/form, pages/form-validation,
// pages/form-unsaved-changes and pages/edit.

import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../runtime/api";
import { useReportUnsupported } from "../capability";
import { InfoLink, type HelpContent } from "../shell/ConsolePage";
import { GatedButton, UnsupportedBanner, useGate, useUiOnly } from "./gating";
import { useUnsavedChanges } from "./unsaved";

export interface CreateFormProps {
  title: string;
  description?: ReactNode;
  help?: HelpContent;
  /** `create` (single-page create) or `edit`; sets the submit label as the console does. */
  mode: "create" | "edit";
  /** Submit label, for example "Create bucket"; defaults to "Save changes" for edit. */
  submitLabel?: string;
  /** `service:Operation` the submit calls. */
  op: string;
  /** Feature of the operation the current form values use, if any is gated. */
  feature?: string;
  dirty: boolean;
  /**
   * Validates every field and returns false to stop the submit; fields show their own errors
   * (the form-validation pattern validates on submit, then on change).
   */
  validate?: () => boolean;
  /** Saves the form; may return the route of the created resource to go to instead of `doneHref`. */
  onSubmit: () => Promise<void | string>;
  /** Where Cancel and a successful submit go. */
  cancelHref: string;
  doneHref?: string;
  children: ReactNode;
}

/** A single-page create or edit form with validation, a submit error alert and an unsaved-changes guard. */
export function CreateForm(props: CreateFormProps) {
  const { uiOnly } = useUiOnly();
  const reportUnsupported = useReportUnsupported();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useUnsavedChanges(props.dirty && !submitting);

  // One request per submit: the primary button is the form's submit button, so a click submits
  // the form once and Enter in a field submits it the same way.
  const inFlight = useRef(false);
  const gate = useGate(props.op, props.feature);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    // A gated button is only aria-disabled (so its reason shows), which does not stop Enter.
    if (inFlight.current || !gate.enabled || (props.validate && !props.validate())) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const created = await props.onSubmit();
      guard.release();
      guard.go(created || (props.doneHref ?? props.cancelHref));
    } catch (err) {
      reportUnsupported(err);
      setError(errorText(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Form
        header={
          <Header variant="h1" description={props.description} info={props.help && <InfoLink topic={props.help} />}>
            {props.title}
          </Header>
        }
        errorText={error ?? undefined}
        errorIconAriaLabel="Error"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" formAction="none" onClick={() => guard.leave(props.cancelHref)}>
              Cancel
            </Button>
            <GatedButton variant="primary" op={props.op} feature={props.feature} loading={submitting}>
              {props.submitLabel ?? (props.mode === "edit" ? "Save changes" : "Create")}
            </GatedButton>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          {uiOnly && <UnsupportedBanner />}
          {error && (
            <Alert type="error" header="The request failed" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}
          {props.children}
        </SpaceBetween>
      </Form>
      {guard.modal}
    </form>
  );
}
