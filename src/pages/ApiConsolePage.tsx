import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import { useEffect, useMemo, useState } from "react";
import { InputForm } from "../apiconsole/ShapeForm";
import { inputText, loadServiceModel, missingRequired, type ServiceModel } from "../apiconsole/model";
import { addSeedStep } from "../apiconsole/seeds";
import { commands, type CliResponse_Serialize } from "../bindings";
import { judge, useCapabilityMatrix, useRuntime501 } from "../capability";
import { errorText } from "../runtime/api";
import { Copyable, useRegion } from "../services/common";
import { ConsolePage } from "../shell/ConsolePage";
import { useNotifications } from "../shell/notifications";
import { href, useLocation } from "../shell/router";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";

const TIER_LABEL = { green: "Supported", yellow: "Partial", red: "Not supported", unknown: "Not judged" } as const;

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function AddToSeed({ visible, onDismiss, onAdd }: { visible: boolean; onDismiss: () => void; onAdd: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("default");
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Add to seed script"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await onAdd(name);
                setBusy(false);
                if (ok) onDismiss();
              }}
            >
              Add
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <FormField
        label="Seed script name"
        description="The call is appended to this script; a script that does not exist yet is created."
        errorText={valid ? undefined : "Use letters, digits, dots, hyphens and underscores, up to 64 characters."}
      >
        <Input value={name} onChange={({ detail }) => setName(detail.value)} />
      </FormField>
    </Modal>
  );
}

/**
 * The API Console: any operation of any modeled service, with a form generated from the trimmed
 * Smithy bundle, run through the AWS CLI (ASD-D8, ASD-D17). The same gating as the console pages
 * applies: only an operation the matrix judges green runs (ASD-D9).
 */
export function ApiConsolePage() {
  const { query } = useLocation();
  const matrix = useCapabilityMatrix();
  const runtime501 = useRuntime501();
  const region = useRegion();
  const { notify } = useNotifications();
  const { running, healthy } = useRuntimeStatus();

  const [serviceKey, setServiceKey] = useState(query.get("service") ?? "");
  const [operation, setOperation] = useState(query.get("op") ?? "");
  const [model, setModel] = useState<ServiceModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState<unknown>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [tab, setTab] = useState("form");
  const [running_, setRunning] = useState(false);
  const [result, setResult] = useState<CliResponse_Serialize | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);

  useEffect(() => {
    commands.apiCliInfo().then((i) => setCliVersion(i.version), (e) => setCliError(errorText(e)));
  }, []);

  useEffect(() => {
    setModel(null);
    setLoadError(null);
    if (!serviceKey) return;
    let live = true;
    loadServiceModel(serviceKey).then(
      (m) => live && (m ? setModel(m) : setLoadError(`No model bundle for ${serviceKey}`)),
      (e) => live && setLoadError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [serviceKey]);

  const serviceOptions = useMemo<SelectProps.Options>(
    () =>
      Object.entries(matrix?.services ?? {})
        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
        .map(([key, s]) => ({ label: s.name, value: key, description: key })),
    [matrix],
  );

  const operationOptions = useMemo<SelectProps.Options>(() => {
    if (!model) return [];
    return Object.entries(model.ops)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, op]) => {
        const cap = judge(matrix, runtime501, `${serviceKey}:${name}`);
        return { label: name, value: name, tags: [TIER_LABEL[cap.tier]], disabled: !op.c, description: op.c ? op.c : "The installed AWS CLI does not know this operation" };
      });
  }, [model, matrix, runtime501, serviceKey]);

  const op = model && operation ? model.ops[operation] : undefined;
  const capability = judge(matrix, runtime501, `${serviceKey}:${operation}`);
  const missing = model && op ? missingRequired(op.i, model.shapes, value) : [];

  // The JSON tab shows the form's value; leaving it for the form keeps what was typed.
  useEffect(() => {
    if (tab === "json") {
      setJsonText(inputText(value) ?? "{}");
      setJsonError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const reason = !model || !op
    ? "Pick a service and an operation"
    : !model.cli || !op.c
      ? "The installed AWS CLI does not know this operation"
      : !capability.enabled
        ? capability.reason
        : !running || !healthy
          ? "The emulator is not running; start it on the Emulator page"
          : jsonError
            ? "The JSON input is not valid"
            : missing.length
              ? `Required: ${missing.join(", ")}`
              : "";

  const run = async () => {
    if (!model || !op?.c || !model.cli) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      setResult(await commands.apiRun(region, model.cli, op.c, inputText(value), op.st === 1));
    } catch (e) {
      setRunError(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const addToSeed = async (name: string): Promise<boolean> => {
    if (!model || !op?.c || !model.cli) return false;
    try {
      const count = await addSeedStep(name, {
        service_key: serviceKey,
        service: model.cli,
        operation,
        command: op.c,
        region,
        input: inputText(value),
        streaming: op.st === 1,
        note: "",
      });
      notify({ type: "success", content: `Added ${operation} to seed script ${name} (${count} ${count === 1 ? "step" : "steps"})` });
      return true;
    } catch (e) {
      notify({ type: "error", header: "The seed script was not saved", content: errorText(e) });
      return false;
    }
  };

  const succeeded = result && result.exit_code === 0;

  return (
    <ConsolePage
      breadcrumbs={[
        { text: "Console Home", href: href("/") },
        { text: "API Console", href: href("/api-console") },
      ]}
      help={{
        header: "API Console",
        body: (
          <SpaceBetween size="s">
            <Box variant="p">Runs one operation of any modeled service against the emulator through the AWS CLI installed on this machine. The form comes from the service's Smithy model.</Box>
            <Box variant="p">An operation runs only when the emulator supports it fully. Others are listed with their support level and stay disabled, as on the service pages.</Box>
            <Box variant="p">Requests use the emulator's keys and the Region selected in the top bar. The CLI never sees a real AWS profile or key.</Box>
          </SpaceBetween>
        ),
      }}
      content={
        <SpaceBetween size="l">
          <Header variant="h1" description="Run any operation of the 436 services the emulator models.">
            API Console
          </Header>
          {cliError && (
            <Alert type="error" header="AWS CLI not available">
              {cliError}
            </Alert>
          )}
          {!cliError && cliVersion && <Box color="text-body-secondary">{cliVersion}</Box>}
          <Container header={<Header variant="h2">Operation</Header>}>
            <ColumnLayout columns={2}>
              <FormField label="Service">
                <Select
                  selectedOption={serviceKey ? (serviceOptions as SelectProps.Option[]).find((o) => o.value === serviceKey) ?? { label: serviceKey, value: serviceKey } : null}
                  options={serviceOptions}
                  onChange={({ detail }) => {
                    setServiceKey(detail.selectedOption.value ?? "");
                    setOperation("");
                    setValue({});
                    setResult(null);
                    setRunError(null);
                  }}
                  placeholder="Choose a service"
                  filteringType="auto"
                  statusType={matrix ? "finished" : "loading"}
                  loadingText="Loading the capability matrix"
                />
              </FormField>
              <FormField label="Operation" errorText={loadError ?? undefined}>
                <Select
                  selectedOption={operation ? { label: operation, value: operation } : null}
                  options={operationOptions}
                  onChange={({ detail }) => {
                    setOperation(detail.selectedOption.value ?? "");
                    setValue({});
                    setResult(null);
                    setRunError(null);
                  }}
                  placeholder="Choose an operation"
                  filteringType="auto"
                  disabled={!model}
                  statusType={serviceKey && !model && !loadError ? "loading" : "finished"}
                  loadingText="Loading the model"
                />
              </FormField>
            </ColumnLayout>
          </Container>
          {op && model && (
            <Container
              header={
                <Header
                  variant="h2"
                  description={
                    capability.enabled ? undefined : (
                      <StatusIndicator type={capability.tier === "red" ? "error" : "warning"}>{capability.reason}</StatusIndicator>
                    )
                  }
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button disabled={!!reason || !op.c} disabledReason={reason || undefined} onClick={() => setSeedOpen(true)} iconName="add-plus">
                        Add to seed script
                      </Button>
                      <Button variant="primary" loading={running_} disabled={!!reason} disabledReason={reason || undefined} onClick={run}>
                        Run
                      </Button>
                    </SpaceBetween>
                  }
                >
                  {operation} input
                </Header>
              }
            >
              {op.i ? (
                <Tabs
                  activeTabId={tab}
                  onChange={({ detail }) => setTab(detail.activeTabId)}
                  tabs={[
                    { id: "form", label: "Form", content: <InputForm input={op.i} shapes={model.shapes} value={value} onChange={setValue} /> },
                    {
                      id: "json",
                      label: "JSON",
                      content: (
                        <FormField label="Input JSON" description="Same input as the form; the CLI reads it with --cli-input-json." errorText={jsonError}>
                          <Textarea
                            value={jsonText}
                            rows={14}
                            spellcheck={false}
                            onChange={({ detail }) => {
                              setJsonText(detail.value);
                              try {
                                setValue(detail.value.trim() ? JSON.parse(detail.value) : {});
                                setJsonError(undefined);
                              } catch (e) {
                                setJsonError(`Not valid JSON: ${(e as Error).message}`);
                              }
                            }}
                          />
                        </FormField>
                      ),
                    },
                  ]}
                />
              ) : (
                <Box color="text-body-secondary">This operation takes no input.</Box>
              )}
              {op.st === 1 && (
                <Box margin={{ top: "s" }} color="text-body-secondary">
                  The answer is a streaming body. The CLI writes it to a temporary file that is discarded; the size is shown.
                </Box>
              )}
            </Container>
          )}
          {runError && (
            <Alert type="error" header="The call did not run">
              {runError}
            </Alert>
          )}
          {result && (
            <Container
              header={
                <Header variant="h2" description={`${result.millis} ms in ${region}`}>
                  Response
                </Header>
              }
            >
              <SpaceBetween size="m">
                <StatusIndicator type={succeeded ? "success" : "error"}>{succeeded ? "Succeeded" : `Failed, exit code ${result.exit_code}`}</StatusIndicator>
                {result.truncated && <Alert type="warning">The output was longer than 4 MiB and is cut.</Alert>}
                {result.streamed_bytes !== null && <Box>Streamed body: {result.streamed_bytes} bytes</Box>}
                <FormField label="Command">
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box variant="code">{result.command}</Box>
                    <Copyable value={result.command} label="command" />
                  </SpaceBetween>
                </FormField>
                {result.stdout ? (
                  <FormField label="Output">
                    <Textarea value={pretty(result.stdout)} readOnly rows={Math.min(24, Math.max(4, pretty(result.stdout).split("\n").length))} spellcheck={false} />
                  </FormField>
                ) : null}
                {result.stderr ? (
                  <FormField label="Error output">
                    <Textarea value={result.stderr} readOnly rows={Math.min(12, Math.max(3, result.stderr.split("\n").length))} spellcheck={false} />
                  </FormField>
                ) : null}
              </SpaceBetween>
            </Container>
          )}
          <AddToSeed visible={seedOpen} onDismiss={() => setSeedOpen(false)} onAdd={addToSeed} />
        </SpaceBetween>
      }
    />
  );
}
