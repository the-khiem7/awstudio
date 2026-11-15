// Adapted from cloudscape-design/demos (MIT-0): pages/delete-with-simple-confirmation and
// pages/delete-with-additional-confirmation.

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useReportUnsupported } from "../capability";
import { errorText } from "../runtime/api";
import { useGate } from "./gating";

export interface DeleteModalProps {
  visible: boolean;
  /** Singular resource kind, lowercase: `bucket`, `queue`. */
  resourceKind: string;
  /** Names of the resources to delete. */
  names: string[];
  /** `service:Operation` the delete calls. */
  op: string;
  /**
   * `simple` asks once; `typed` asks for written consent, as the console does for resources whose
   * deletion also removes their content. The consent text is the resource name for one resource,
   * `confirm` for several.
   */
  confirmation: "simple" | "typed";
  /** Extra warning, for example what else is lost. */
  warning?: ReactNode;
  onDismiss: () => void;
  onDelete: () => Promise<void>;
}

export function DeleteModal(props: DeleteModalProps) {
  const { visible, resourceKind, names, op, confirmation } = props;
  const gate = useGate(op);
  const reportUnsupported = useReportUnsupported();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTyped("");
    setError(null);
  }, [visible]);

  const many = names.length > 1;
  const consent = many ? "confirm" : (names[0] ?? "");
  const consented = confirmation === "simple" || (many ? typed.toLowerCase() === consent : typed === consent);
  const kinds = many ? `${resourceKind}s` : resourceKind;

  const remove = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!consented || !gate.enabled) return;
    setDeleting(true);
    setError(null);
    try {
      await props.onDelete();
      props.onDismiss();
    } catch (err) {
      reportUnsupported(err);
      setError(errorText(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={props.onDismiss}
      header={`Delete ${kinds}`}
      closeAriaLabel="Close dialog"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={props.onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={deleting}
              disabled={!consented || !gate.enabled}
              disabledReason={!gate.enabled ? gate.reason : undefined}
              onClick={() => remove()}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {names.length > 0 && (
        <SpaceBetween size="m">
          <Box variant="span">
            Permanently delete {many ? "" : `${resourceKind} `}
            <Box variant="span" fontWeight="bold">
              {many ? `${names.length} ${kinds}` : names[0]}
            </Box>
            ? You can't undo this action.
          </Box>
          {error && <Alert type="error">{error}</Alert>}
          {(props.warning || confirmation === "typed") && (
            <Alert type="warning" statusIconAriaLabel="Warning">
              {props.warning ?? `Proceeding with this action will delete the ${kinds} with all ${many ? "their" : "its"} content.`}
            </Alert>
          )}
          {confirmation === "typed" && (
            <form onSubmit={remove}>
              <FormField label={`To confirm this deletion, type "${consent}".`}>
                <ColumnLayout columns={2}>
                  <Input placeholder={consent} value={typed} onChange={({ detail }) => setTyped(detail.value)} ariaRequired />
                </ColumnLayout>
              </FormField>
            </form>
          )}
        </SpaceBetween>
      )}
    </Modal>
  );
}
