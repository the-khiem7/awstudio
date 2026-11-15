// AWS Lambda console pages: dashboard, functions, create function, and function details with the
// Code editor, Test events, Configuration, Aliases and Versions. Functions are addressed by name.

import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import { useEffect, useState, type ReactNode } from "react";
import { commands, type CodeFileInput_Deserialize, type CodeFile_Serialize, type InvokeResult_Serialize, type LambdaAlias_Serialize, type LambdaFunction_Serialize } from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceCounts, ResourceTable, ScopeBanner, ServiceDashboard, textProperty, UiOnlyScope, useUiOnly, useUnsavedChanges, type ResourceTableColumn } from "../../patterns";
import { useReportUnsupported } from "../../capability";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, matchPath } from "../../shell/router";
import { useLocalStorage } from "../../shell/storage";
import { Copyable, EditTagsModal, formatBytes, formatDate, FormModal, JsonEditor, jsonError, LoadError, lastSegment, prettyJson, TagsTable, useAction, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "AWS Lambda", href: href("/lambda/dashboard") },
  items: [
    { type: "link" as const, text: "Dashboard", href: href("/lambda/dashboard") },
    { type: "link" as const, text: "Functions", href: href("/lambda/functions") },
  ],
};

const HELP: HelpContent = {
  header: "AWS Lambda",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Functions of the local emulator, in the Region of the region selector. The emulator runs Node.js and Python handlers inside its own process; function code is not isolated from your machine.</Box>
      <Box variant="p">A function that was just created or updated is Pending for a moment; a test run waits for it.</Box>
      <Box variant="p">The emulator keeps one set of functions for every Region: a function created in one Region is listed and found in all of them, and its name cannot be reused in another. The Region column shows the Region in each function ARN.</Box>
    </SpaceBetween>
  ),
};

export const functionHref = (name: string, tab?: string) => href(`/lambda/functions/${encodeURIComponent(name)}`, { tab });

function page(rest: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Lambda", href: href("/lambda/dashboard") }, ...rest]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

const RUNTIMES = ["nodejs22.x", "nodejs20.x", "python3.13", "python3.12", "python3.11", "python3.10", "python3.9"];
const isPython = (runtime: string) => runtime.startsWith("python");
const defaultHandler = (runtime: string) => (isPython(runtime) ? "lambda_function.lambda_handler" : "index.handler");

/** The file a handler string names: `index.handler` is `index.js`, `app.main` on Python is `app.py`. */
function handlerFile(handler: string, runtime: string): string {
  const module = handler.slice(0, handler.lastIndexOf("."));
  return `${module || "index"}.${isPython(runtime) ? "py" : "js"}`;
}

const SAMPLE_NODE = `exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));
  return { statusCode: 200, body: JSON.stringify("Hello from Lambda!") };
};
`;

const SAMPLE_PYTHON = `import json


def lambda_handler(event, context):
    print("Received event:", json.dumps(event))
    return {"statusCode": 200, "body": json.dumps("Hello from Lambda!")}
`;

const stateType = (state: string | null | undefined): StatusIndicatorProps.Type =>
  state === "Active" ? "success" : state === "Pending" ? "in-progress" : state === "Failed" ? "error" : state === "Inactive" ? "stopped" : "pending";

// Dashboard ---------------------------------------------------------------------------------------

function Dashboard() {
  const region = useRegion();
  const account = useLoad(() => commands.lambdaAccountSettings(region), []);
  const a = account.data;
  return (
    <ServiceDashboard
      title="Dashboard"
      help={HELP}
      actions={<GatedButton variant="primary" op="lambda:CreateFunction" href={href("/lambda/functions/create")}>Create function</GatedButton>}
      widgets={[
        {
          id: "resources",
          title: "Resources for this Region",
          span: 8,
          content: (
            <SpaceBetween size="m">
              <LoadError error={account.error} onRetry={account.reload} />
              <ResourceCounts items={[{ label: "Functions", count: a?.function_count ?? null, href: href("/lambda/functions") }]} />
              <KeyValuePairs columns={2} items={[{ label: "Total code storage", value: a ? formatBytes(a.total_code_size) : "-" }, { label: "Code storage limit", value: a ? formatBytes(a.code_size_limit) : "-" }, { label: "Concurrent executions", value: a?.concurrent_executions ?? "-" }]} />
            </SpaceBetween>
          ),
        },
        {
          id: "start",
          title: "Get started",
          span: 4,
          content: (
            <SpaceBetween size="s">
              <Box variant="p">Author a function from scratch, then edit its code, deploy it and run it with a test event.</Box>
              <GatedButton op="lambda:CreateFunction" href={href("/lambda/functions/create")}>Create function</GatedButton>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Functions list ----------------------------------------------------------------------------------

type FunctionRow = LambdaFunction_Serialize & { modified: Date | null };

const FUNCTION_COLUMNS: ResourceTableColumn<FunctionRow>[] = [
  { id: "name", header: "Function name", cell: (f) => <Link href={functionHref(f.name)}>{f.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "package", header: "Package type", cell: (f) => f.package_type ?? "Zip" },
  { id: "runtime", header: "Runtime", cell: (f) => f.runtime ?? "-", sortingField: "runtime" },
  { id: "region", header: "Region", cell: (f) => f.arn.split(":")[3] ?? "-" },
  { id: "size", header: "Code size", cell: (f) => formatBytes(f.code_size), sortingField: "code_size" },
  { id: "modified", header: "Last modified", cell: (f) => f.last_modified ?? "-", sortingField: "modified" },
  { id: "arn", header: "Function ARN", cell: (f) => f.arn, hidden: true },
];

function FunctionsList() {
  const region = useRegion();
  const functions = useLoad(() => commands.lambdaListFunctions(region), []);
  const [deleting, setDeleting] = useState<FunctionRow | null>(null);
  const rows: FunctionRow[] = (functions.data ?? []).map((f) => ({ ...f, modified: f.last_modified ? new Date(f.last_modified.replace(/\+0000$/, "Z")) : null }));
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={functions.error} onRetry={functions.reload} />
      <ResourceTable<FunctionRow>
        resourceName="Function"
        title="Functions"
        help={HELP}
        items={rows}
        loading={functions.loading}
        columns={FUNCTION_COLUMNS}
        filteringProperties={[textProperty("name", "Function name"), textProperty("runtime", "Runtime", "enum")]}
        trackBy="name"
        preferencesKey="lambda.functions"
        selectionType="single"
        onRefresh={functions.reload}
        emptyAction={<GatedButton op="lambda:CreateFunction" href={href("/lambda/functions/create")}>Create function</GatedButton>}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="lambda:DeleteFunction" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>Delete</GatedButton>
            <GatedButton variant="primary" op="lambda:CreateFunction" href={href("/lambda/functions/create")}>Create function</GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="function" names={deleting ? [deleting.name] : []} op="lambda:DeleteFunction" confirmation="typed" warning="Deleting the function also deletes its versions and aliases." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.lambdaDeleteFunction(region, deleting!.name); functions.reload(); }} />
    </SpaceBetween>
  );
}

// Create function ---------------------------------------------------------------------------------

interface EnvVar {
  key: string;
  value: string;
}

function EnvEditor({ vars, onChange }: { vars: EnvVar[]; onChange: (v: EnvVar[]) => void }) {
  return (
    <AttributeEditor<EnvVar>
      items={vars}
      addButtonText="Add environment variable"
      removeButtonText="Remove"
      empty="No environment variables."
      onAddButtonClick={() => onChange([...vars, { key: "", value: "" }])}
      onRemoveButtonClick={({ detail }) => onChange(vars.filter((_, i) => i !== detail.itemIndex))}
      definition={[
        { label: "Key", control: (v, i) => <Input value={v.key} onChange={({ detail }) => onChange(vars.map((x, j) => (j === i ? { ...x, key: detail.value } : x)))} /> },
        { label: "Value", control: (v, i) => <Input value={v.value} onChange={({ detail }) => onChange(vars.map((x, j) => (j === i ? { ...x, value: detail.value } : x)))} /> },
      ]}
    />
  );
}

const envOf = (vars: EnvVar[]) => Object.fromEntries(vars.filter((v) => v.key).map((v) => [v.key, v.value]));

function CreateFunctionForm() {
  const region = useRegion();
  const roles = useLoad(() => commands.iamListRoles(), []);
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState("nodejs22.x");
  const [arch, setArch] = useState("x86_64");
  const [role, setRole] = useState("");
  const [handler, setHandler] = useState(defaultHandler("nodejs22.x"));
  const [description, setDescription] = useState("");
  const [memory, setMemory] = useState("128");
  const [timeout, setTimeoutValue] = useState("3");
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const validate = () => {
    const e: Record<string, string | undefined> = {};
    if (!/^[a-zA-Z0-9-_]{1,64}$/.test(name)) e.name = "Use 1 to 64 letters, numbers, hyphens (-) and underscores (_).";
    if (!role.startsWith("arn:")) e.role = "Choose an execution role or enter its ARN.";
    if (!/^[\w./-]+$/.test(handler) || !handler.includes(".")) e.handler = "Use the form file.function, for example index.handler.";
    const m = Number(memory);
    if (!Number.isInteger(m) || m < 128 || m > 10240) e.memory = "Enter a whole number from 128 to 10240.";
    const t = Number(timeout);
    if (!Number.isInteger(t) || t < 1 || t > 900) e.timeout = "Enter a whole number from 1 to 900.";
    setErrors(e);
    return Object.values(e).every((x) => !x);
  };
  return (
    <CreateForm
      title="Create function"
      description="Author from scratch: the function starts with sample code that you can edit on the Code tab."
      help={HELP}
      mode="create"
      submitLabel="Create function"
      op="lambda:CreateFunction"
      dirty={name !== "" || role !== "" || description !== "" || env.length > 0 || tags.length > 0}
      cancelHref={href("/lambda/functions")}
      validate={validate}
      onSubmit={async () => {
        await commands.lambdaCreateFunction(region, {
          name,
          runtime,
          handler,
          role,
          description: description || null,
          architecture: arch,
          memory_size: Number(memory),
          timeout: Number(timeout),
          environment: envOf(env),
          tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })),
          file_name: handlerFile(handler, runtime),
          source: isPython(runtime) ? SAMPLE_PYTHON : SAMPLE_NODE,
        });
        return functionHref(name);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Basic information</Header>}>
          <SpaceBetween size="l">
            <FormField label="Function name" errorText={errors.name} constraintText="Use 1 to 64 letters, numbers, hyphens and underscores.">
              <Input value={name} placeholder="Enter a name that describes the purpose of your function" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <ColumnLayout columns={2}>
              <FormField label="Runtime" description="Node.js and Python run in the emulator.">
                <Select
                  selectedOption={{ value: runtime, label: runtime }}
                  options={RUNTIMES.map((r) => ({ value: r, label: r }))}
                  onChange={({ detail }) => {
                    const next = detail.selectedOption.value!;
                    if (handler === defaultHandler(runtime)) setHandler(defaultHandler(next));
                    setRuntime(next);
                  }}
                />
              </FormField>
              <FormField label="Architecture">
                <Tiles value={arch} onChange={({ detail }) => setArch(detail.value)} items={[{ value: "x86_64", label: "x86_64" }, { value: "arm64", label: "arm64" }]} columns={2} />
              </FormField>
            </ColumnLayout>
            <FormField label="Execution role" errorText={errors.role} description="Choose a role from IAM, or enter the ARN of one.">
              <SpaceBetween size="xs">
                <Select
                  placeholder="Choose an existing role"
                  statusType={roles.loading ? "loading" : "finished"}
                  empty="No roles. Create a role in IAM first."
                  selectedOption={roles.data?.find((r) => r.arn === role) ? { value: role, label: roles.data.find((r) => r.arn === role)!.name } : null}
                  options={(roles.data ?? []).map((r) => ({ value: r.arn, label: r.name, description: r.arn }))}
                  onChange={({ detail }) => setRole(detail.selectedOption.value!)}
                />
                <Input value={role} placeholder="arn:aws:iam::000000000000:role/my-role" onChange={({ detail }) => setRole(detail.value)} />
              </SpaceBetween>
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Configuration</Header>}>
          <ColumnLayout columns={2}>
            <FormField label="Handler" errorText={errors.handler} constraintText={`The file in the package is ${handlerFile(handler, runtime)}.`}>
              <Input value={handler} onChange={({ detail }) => setHandler(detail.value)} />
            </FormField>
            <FormField label="Description - optional">
              <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
            </FormField>
            <FormField label="Memory (MB)" errorText={errors.memory} constraintText="128 to 10240.">
              <Input type="number" value={memory} onChange={({ detail }) => setMemory(detail.value)} />
            </FormField>
            <FormField label="Timeout (seconds)" errorText={errors.timeout} constraintText="1 to 900.">
              <Input type="number" value={timeout} onChange={({ detail }) => setTimeoutValue(detail.value)} />
            </FormField>
          </ColumnLayout>
        </Container>
        <Container header={<Header variant="h2">Environment variables - optional</Header>}>
          <EnvEditor vars={env} onChange={setEnv} />
        </Container>
        <Container header={<Header variant="h2">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Code --------------------------------------------------------------------------------------------

interface EditableFile {
  name: string;
  size: number;
  /** Null for a file that is binary or too large to edit; it keeps its bytes on deploy. */
  text: string | null;
}

const snapshot = (files: EditableFile[]) => JSON.stringify(files.map((f) => [f.name, f.text]));

function CodeTab({ name, onDeployed }: { name: string; onDeployed: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const code = useLoad(() => commands.lambdaGetFunctionCode(region, name, null), [name]);
  const [files, setFiles] = useState<EditableFile[]>([]);
  const [loaded, setLoaded] = useState(snapshot([]));
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const { uiOnly } = useUiOnly();
  const dirty = snapshot(files) !== loaded;
  const guard = useUnsavedChanges(dirty && !deploying);

  useEffect(() => {
    if (!code.data) return;
    const next = code.data.map((f: CodeFile_Serialize) => ({ name: f.name, size: f.size ?? 0, text: f.text }));
    setFiles(next);
    setLoaded(snapshot(next));
    setSelected((cur) => (cur && next.some((f) => f.name === cur) ? cur : (next[0]?.name ?? null)));
  }, [code.data]);

  const current = files.find((f) => f.name === selected) ?? null;
  const setText = (text: string) => setFiles((fs) => fs.map((f) => (f.name === selected ? { ...f, text } : f)));
  const deploy = async () => {
    setDeploying(true);
    const input: CodeFileInput_Deserialize[] = files.map((f) => ({ name: f.name, text: f.text }));
    const ok = await run(async () => {
      await commands.lambdaDeployCode(region, name, input);
    }, "Successfully updated the function code");
    setDeploying(false);
    if (ok) {
      guard.release();
      code.reload();
      onDeployed();
    }
  };

  return (
    <SpaceBetween size="m">
      <LoadError error={code.error} onRetry={code.reload} />
      <Container
        header={
          <Header
            variant="h2"
            description="Edit the files of the deployment package, then deploy."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="lambda:UpdateFunctionCode" disabled={!files.length} onClick={() => setAdding("")}>New file</GatedButton>
                <GatedButton op="lambda:UpdateFunctionCode" disabled={!current} onClick={() => { setFiles((fs) => fs.filter((f) => f.name !== selected)); setSelected(null); }}>Remove file</GatedButton>
                <GatedButton variant="primary" op="lambda:UpdateFunctionCode" disabled={!dirty || files.length === 0} loading={deploying} onClick={deploy}>Deploy</GatedButton>
              </SpaceBetween>
            }
          >
            Code source
          </Header>
        }
      >
        <SpaceBetween size="m">
          {dirty && <StatusIndicator type="warning">Changes not deployed</StatusIndicator>}
          <Grid gridDefinition={[{ colspan: { default: 12, s: 3 } }, { colspan: { default: 12, s: 9 } }]}>
            <div>
              <Table<EditableFile>
                variant="embedded"
                items={uiOnly ? [] : files}
                loading={code.loading}
                trackBy="name"
                selectionType="single"
                selectedItems={current ? [current] : []}
                onSelectionChange={({ detail }) => setSelected(detail.selectedItems[0]?.name ?? null)}
                columnDefinitions={[{ id: "name", header: "Files", cell: (f) => f.name, isRowHeader: true }]}
                empty={<Box textAlign="center" color="inherit">No files</Box>}
              />
            </div>
            <div>
              {current === null ? (
                <Box color="text-status-inactive">Select a file to edit it.</Box>
              ) : current.text === null ? (
                <StatusIndicator type="info">{current.name} ({formatBytes(current.size)}) is binary or too large to edit here. It is kept as it is when you deploy.</StatusIndicator>
              ) : (
                <FormField label={current.name} stretch>
                  <div style={{ fontFamily: "monospace" }}>
                    <Textarea value={current.text} rows={22} spellcheck={false} onChange={({ detail }) => setText(detail.value)} />
                  </div>
                </FormField>
              )}
            </div>
          </Grid>
        </SpaceBetween>
      </Container>
      <FormModal
        visible={adding !== null}
        header="New file"
        op="lambda:UpdateFunctionCode"
        submitLabel="Add file"
        canSubmit={!!adding && !files.some((f) => f.name === adding) && !/^\/|\.\.|\\/.test(adding)}
        onDismiss={() => setAdding(null)}
        onSubmit={async () => {
          setFiles((fs) => [...fs, { name: adding!, size: 0, text: "" }].sort((a, b) => a.name.localeCompare(b.name)));
          setSelected(adding);
          return true;
        }}
      >
        <FormField label="File name" constraintText="A path inside the package, for example lib/util.js.">
          <Input value={adding ?? ""} onChange={({ detail }) => setAdding(detail.value)} />
        </FormField>
      </FormModal>
      {guard.modal}
    </SpaceBetween>
  );
}

// Test --------------------------------------------------------------------------------------------

interface SavedEvent {
  name: string;
  json: string;
}

const DEFAULT_EVENT = JSON.stringify({ key1: "value1", key2: "value2", key3: "value3" }, null, 2);

function TestTab({ name, qualifier }: { name: string; qualifier: string | null }) {
  const region = useRegion();
  const report = useReportUnsupported();
  const [saved, setSaved] = useLocalStorage<SavedEvent[]>(`lambda.events.${name}`, []);
  const [event, setEvent] = useState(DEFAULT_EVENT);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; value: InvokeResult_Serialize | null; error: string | null; ms: number } | null>(null);

  const test = async () => {
    setRunning(true);
    setResult(null);
    const started = performance.now();
    try {
      const value = await commands.lambdaInvoke(region, name, qualifier, JSON.stringify(JSON.parse(event)));
      setResult({ ok: !value.function_error, value, error: null, ms: performance.now() - started });
    } catch (e) {
      report(e);
      setResult({ ok: false, value: null, error: errorText(e), ms: performance.now() - started });
    } finally {
      setRunning(false);
    }
  };

  return (
    <SpaceBetween size="m">
      <Container
        header={
          <Header
            variant="h2"
            description="Invoke the function with a JSON event."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={!!jsonError(event, false)} onClick={() => setSaving(chosen ?? "")}>Save event</Button>
                <Button disabled={chosen === null} onClick={() => { setSaved(saved.filter((s) => s.name !== chosen)); setChosen(null); }}>Delete event</Button>
                <GatedButton variant="primary" op="lambda:Invoke" disabled={!!jsonError(event, false)} loading={running} onClick={test}>Test</GatedButton>
              </SpaceBetween>
            }
          >
            Test event
          </Header>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Saved events" description="Saved in this app on this computer, as the emulator keeps no test events.">
            <Select
              placeholder="Choose a saved event"
              selectedOption={chosen ? { value: chosen, label: chosen } : null}
              options={saved.map((s) => ({ value: s.name, label: s.name }))}
              empty="No saved events"
              onChange={({ detail }) => {
                const s = saved.find((x) => x.name === detail.selectedOption.value);
                if (s) {
                  setChosen(s.name);
                  setEvent(s.json);
                }
              }}
            />
          </FormField>
          <JsonEditor label="Event JSON" value={event} rows={12} allowEmpty={false} onChange={setEvent} />
        </SpaceBetween>
      </Container>
      {result && (
        <Container header={<Header variant="h2" description={`Took ${Math.round(result.ms)} ms`}>Execution result: <StatusIndicator type={result.ok ? "success" : "error"}>{result.ok ? "Succeeded" : "Failed"}</StatusIndicator></Header>}>
          <SpaceBetween size="m">
            {result.error && <LoadError error={result.error} />}
            {result.value && (
              <>
                <KeyValuePairs columns={3} items={[{ label: "Status code", value: result.value.status }, { label: "Executed version", value: result.value.executed_version ?? "-" }, { label: "Function error", value: result.value.function_error ?? "-" }]} />
                <FormField label="Response" stretch>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(result.value.payload)}</pre>
                </FormField>
                <FormField label="Log output" description="The last 4 KB of the function's log." stretch>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result.value.log ?? "-"}</pre>
                </FormField>
              </>
            )}
          </SpaceBetween>
        </Container>
      )}
      <FormModal
        visible={saving !== null}
        header="Save test event"
        op="lambda:Invoke"
        submitLabel="Save"
        canSubmit={!!saving?.trim()}
        onDismiss={() => setSaving(null)}
        onSubmit={async () => {
          const n = saving!.trim();
          setSaved([...saved.filter((s) => s.name !== n), { name: n, json: event }]);
          setChosen(n);
          return true;
        }}
      >
        <FormField label="Event name" constraintText="Saving under an existing name replaces that event.">
          <Input value={saving ?? ""} onChange={({ detail }) => setSaving(detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

// Configuration -----------------------------------------------------------------------------------

function GeneralConfiguration({ fn, reload }: { fn: LambdaFunction_Serialize; reload: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [handler, setHandler] = useState("");
  const [memory, setMemory] = useState("");
  const [timeout, setTimeoutValue] = useState("");
  const [env, setEnv] = useState<EnvVar[]>([]);
  const vars = Object.entries(fn.environment);
  const open = () => {
    setDescription(fn.description ?? "");
    setHandler(fn.handler ?? "");
    setMemory(String(fn.memory_size ?? 128));
    setTimeoutValue(String(fn.timeout ?? 3));
    setEnv(vars.map(([key, value]) => ({ key, value })));
    setEditing(true);
  };
  const valid = Number(memory) >= 128 && Number(memory) <= 10240 && Number(timeout) >= 1 && Number(timeout) <= 900 && handler.includes(".");
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" actions={<GatedButton op="lambda:UpdateFunctionConfiguration" onClick={open}>Edit</GatedButton>}>General configuration</Header>}>
        <KeyValuePairs
          columns={3}
          items={[
            { label: "Description", value: fn.description ?? "-" },
            { label: "Runtime", value: fn.runtime ?? "-" },
            { label: "Handler", value: fn.handler ?? "-" },
            { label: "Memory", value: fn.memory_size ? `${fn.memory_size} MB` : "-" },
            { label: "Timeout", value: fn.timeout ? `${fn.timeout} sec` : "-" },
            { label: "Ephemeral storage", value: fn.ephemeral_storage ? `${fn.ephemeral_storage} MB` : "-" },
            { label: "Architecture", value: fn.architectures.join(", ") || "-" },
            { label: "Execution role", value: fn.role ? <Link href={href(`/iam/roles/${encodeURIComponent(lastSegment(fn.role, "/"))}`)}>{lastSegment(fn.role, "/")}</Link> : "-" },
          ]}
        />
      </Container>
      <Table
        variant="container"
        items={vars}
        trackBy={([k]) => k}
        columnDefinitions={[{ id: "key", header: "Key", cell: ([k]) => k, isRowHeader: true }, { id: "value", header: "Value", cell: ([, v]) => v }]}
        empty={<Box textAlign="center" color="inherit">No environment variables.</Box>}
        header={<Header variant="h2" counter={`(${vars.length})`}>Environment variables</Header>}
      />
      <FormModal
        visible={editing}
        size="large"
        header="Edit configuration"
        op="lambda:UpdateFunctionConfiguration"
        canSubmit={valid}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.lambdaUpdateConfiguration(region, fn.name, { description, handler, memory_size: Number(memory), timeout: Number(timeout), environment: envOf(env) }); reload(); }, "Configuration updated")}
      >
        <SpaceBetween size="m">
          <FormField label="Description">
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <ColumnLayout columns={3}>
            <FormField label="Handler">
              <Input value={handler} onChange={({ detail }) => setHandler(detail.value)} />
            </FormField>
            <FormField label="Memory (MB)" constraintText="128 to 10240.">
              <Input type="number" value={memory} onChange={({ detail }) => setMemory(detail.value)} />
            </FormField>
            <FormField label="Timeout (seconds)" constraintText="1 to 900.">
              <Input type="number" value={timeout} onChange={({ detail }) => setTimeoutValue(detail.value)} />
            </FormField>
          </ColumnLayout>
          <EnvEditor vars={env} onChange={setEnv} />
        </SpaceBetween>
      </FormModal>
    </SpaceBetween>
  );
}

function TriggersSection({ name }: { name: string }) {
  const region = useRegion();
  const mappings = useLoad(() => commands.lambdaListEventSourceMappings(region, name), [name]);
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="s">
      <ScopeBanner />
      <LoadError error={uiOnly ? null : mappings.error} />
      <Table
        variant="container"
        items={uiOnly ? [] : (mappings.data ?? [])}
        loading={mappings.loading && !uiOnly}
        trackBy="uuid"
        columnDefinitions={[
          { id: "source", header: "Event source", cell: (m) => m.event_source_arn ?? "-", isRowHeader: true },
          { id: "state", header: "State", cell: (m) => m.state ?? "-" },
          { id: "batch", header: "Batch size", cell: (m) => m.batch_size ?? "-" },
          { id: "modified", header: "Last modified", cell: (m) => formatDate(m.last_modified) },
        ]}
        empty={<Box textAlign="center" color="inherit">No triggers. Event source mappings such as an SQS queue appear here.</Box>}
        header={<Header variant="h2" counter={`(${uiOnly ? 0 : (mappings.data?.length ?? 0)})`} actions={<GatedButton op="lambda:CreateEventSourceMapping" disabled>Add trigger</GatedButton>}>Triggers</Header>}
      />
    </SpaceBetween>
  );
}

function PermissionsSection({ fn }: { fn: LambdaFunction_Serialize }) {
  const region = useRegion();
  const policy = useLoad(() => commands.lambdaGetPolicy(region, fn.name), [fn.name]);
  const url = useLoad(() => commands.lambdaGetFunctionUrl(region, fn.name), [fn.name]);
  return (
    <SpaceBetween size="l">
      <LoadError error={policy.error ?? url.error} />
      <Container header={<Header variant="h2">Resource-based policy statements</Header>}>
        {policy.data ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy.data)}</pre> : <Box color="text-status-inactive">{policy.loading ? "Loading" : "The function has no resource-based policy."}</Box>}
      </Container>
      <Container header={<Header variant="h2" actions={<GatedButton op="lambda:CreateFunctionUrlConfig" disabled>Create function URL</GatedButton>}>Function URL</Header>}>
        {url.data ? <KeyValuePairs columns={2} items={[{ label: "Function URL", value: <Copyable value={url.data.url} label="function URL" /> }, { label: "Auth type", value: url.data.auth_type }]} /> : <Box color="text-status-inactive">{url.loading ? "Loading" : "The function has no function URL."}</Box>}
      </Container>
    </SpaceBetween>
  );
}

function FunctionTags({ arn }: { arn: string }) {
  const region = useRegion();
  const { run } = useAction();
  const tags = useLoad(() => commands.lambdaListTags(region, arn), [arn], arn !== "");
  const [editing, setEditing] = useState(false);
  return (
    <>
      <TagsTable tags={tags.data} loading={tags.loading} op="lambda:TagResource" onEdit={() => setEditing(true)} />
      <EditTagsModal
        visible={editing}
        tags={tags.data ?? []}
        op="lambda:TagResource"
        onDismiss={() => setEditing(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            await commands.lambdaUpdateTags(region, arn, next.filter((t) => before.find((b) => b.key === t.key)?.value !== t.value), before.filter((b) => !next.some((t) => t.key === b.key)).map((b) => b.key));
            tags.reload();
          }, "Function tags updated")
        }
      />
    </>
  );
}

// Aliases and versions ----------------------------------------------------------------------------

function AliasesTab({ name }: { name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const aliases = useLoad(() => commands.lambdaListAliases(region, name), [name]);
  const versions = useLoad(() => commands.lambdaListVersions(region, name), [name]);
  const [editing, setEditing] = useState<{ alias: string; version: string; description: string; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<LambdaAlias_Serialize | null>(null);
  const published = (versions.data ?? []).filter((v) => v.version && v.version !== "$LATEST");
  return (
    <SpaceBetween size="m">
      <LoadError error={aliases.error} />
      <Table<LambdaAlias_Serialize>
        variant="container"
        items={aliases.data ?? []}
        loading={aliases.loading}
        trackBy="name"
        columnDefinitions={[
          { id: "name", header: "Aliases", cell: (a) => a.name, isRowHeader: true },
          { id: "version", header: "Function version", cell: (a) => a.version },
          { id: "description", header: "Description", cell: (a) => a.description ?? "-" },
          {
            id: "actions",
            header: "Actions",
            cell: (a) => (
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton variant="inline-link" op="lambda:UpdateAlias" onClick={() => setEditing({ alias: a.name, version: a.version, description: a.description ?? "", isNew: false })}>Edit</GatedButton>
                <GatedButton variant="inline-link" op="lambda:DeleteAlias" onClick={() => setDeleting(a)}>Delete</GatedButton>
              </SpaceBetween>
            ),
          },
        ]}
        empty={<Box textAlign="center" color="inherit">No aliases. An alias is a pointer to a published version.</Box>}
        header={<Header variant="h2" counter={`(${aliases.data?.length ?? 0})`} actions={<GatedButton variant="primary" op="lambda:CreateAlias" onClick={() => { versions.reload(); setEditing({ alias: "", version: "", description: "", isNew: true }); }}>Create alias</GatedButton>}>Aliases</Header>}
      />
      <FormModal
        visible={editing !== null}
        header={editing?.isNew ? "Create alias" : `Edit alias ${editing?.alias}`}
        op={editing?.isNew ? "lambda:CreateAlias" : "lambda:UpdateAlias"}
        submitLabel={editing?.isNew ? "Create alias" : "Save"}
        canSubmit={!!editing && /^[a-zA-Z0-9-_]{1,128}$/.test(editing.alias) && editing.version !== ""}
        onDismiss={() => setEditing(null)}
        onSubmit={() =>
          run(async () => {
            if (editing!.isNew) await commands.lambdaCreateAlias(region, name, editing!.alias, editing!.version, editing!.description || null);
            else await commands.lambdaUpdateAlias(region, name, editing!.alias, editing!.version, editing!.description);
            aliases.reload();
          }, "Alias saved")
        }
      >
        {editing && (
          <SpaceBetween size="m">
            <FormField label="Name" constraintText="Letters, numbers, hyphens and underscores.">
              <Input value={editing.alias} disabled={!editing.isNew} onChange={({ detail }) => setEditing({ ...editing, alias: detail.value })} />
            </FormField>
            <FormField label="Version" description="Publish a version on the Versions tab first.">
              <Select
                placeholder="Choose a version"
                statusType={versions.loading ? "loading" : "finished"}
                empty="No published versions"
                selectedOption={editing.version ? { value: editing.version, label: editing.version } : null}
                options={published.map((v) => ({ value: v.version!, label: v.version!, description: v.description ?? undefined }))}
                onChange={({ detail }) => setEditing({ ...editing, version: detail.selectedOption.value! })}
              />
            </FormField>
            <FormField label="Description - optional">
              <Input value={editing.description} onChange={({ detail }) => setEditing({ ...editing, description: detail.value })} />
            </FormField>
          </SpaceBetween>
        )}
      </FormModal>
      <DeleteModal visible={deleting !== null} resourceKind="alias" names={deleting ? [deleting.name] : []} op="lambda:DeleteAlias" confirmation="simple" onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.lambdaDeleteAlias(region, name, deleting!.name); aliases.reload(); }} />
    </SpaceBetween>
  );
}

function VersionsTab({ name }: { name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const versions = useLoad(() => commands.lambdaListVersions(region, name), [name]);
  const [publishing, setPublishing] = useState<string | null>(null);
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="s">
      <ScopeBanner />
      <LoadError error={uiOnly ? null : versions.error} />
      <Table<LambdaFunction_Serialize>
        variant="container"
        items={uiOnly ? [] : (versions.data ?? [])}
        loading={versions.loading && !uiOnly}
        trackBy={(v) => v.version ?? v.arn}
        columnDefinitions={[
          { id: "version", header: "Version", cell: (v) => v.version ?? "-", isRowHeader: true },
          { id: "description", header: "Description", cell: (v) => v.description ?? "-" },
          { id: "size", header: "Code size", cell: (v) => formatBytes(v.code_size) },
          { id: "modified", header: "Last modified", cell: (v) => v.last_modified ?? "-" },
        ]}
        empty={<Box textAlign="center" color="inherit">No versions</Box>}
        header={<Header variant="h2" counter={`(${uiOnly ? 0 : (versions.data?.length ?? 0)})`} actions={<GatedButton variant="primary" op="lambda:PublishVersion" onClick={() => setPublishing("")}>Publish new version</GatedButton>}>Versions</Header>}
      />
      <FormModal visible={publishing !== null} header="Publish new version" op="lambda:PublishVersion" submitLabel="Publish" onDismiss={() => setPublishing(null)} onSubmit={() => run(async () => { await commands.lambdaPublishVersion(region, name, publishing || null); versions.reload(); }, "Published a new version")}>
        <FormField label="Version description - optional" description="Publishing freezes the current code and configuration as a numbered version.">
          <Input value={publishing ?? ""} onChange={({ detail }) => setPublishing(detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

// Function details --------------------------------------------------------------------------------

function FunctionDetails({ name }: { name: string }) {
  const region = useRegion();
  const details = useLoad(() => commands.lambdaGetFunction(region, name, null), [name]);
  const [deleting, setDeleting] = useState(false);
  const fn = details.data?.function;
  const busy = fn?.state === "Pending" || fn?.last_update_status === "InProgress";
  // A function that was just created or updated finishes on its own; follow it until it does.
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(details.reload, 1500);
    return () => clearTimeout(t);
  }, [busy, details.data]);
  return (
    <SpaceBetween size="m">
      <LoadError error={details.error} onRetry={details.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={<GatedButton op="lambda:DeleteFunction" onClick={() => setDeleting(true)}>Delete</GatedButton>}
        overview={{
          title: "Function overview",
          columns: 3,
          items: [
            { label: "State", value: fn ? <StatusIndicator type={stateType(fn.state)}>{fn.state ?? "-"}{fn.last_update_status === "InProgress" ? " (updating)" : ""}</StatusIndicator> : "-" },
            { label: "Function ARN", value: fn ? <Copyable value={fn.arn} label="ARN" /> : "-" },
            { label: "Runtime", value: fn?.runtime ?? "-" },
            { label: "Handler", value: fn?.handler ?? "-" },
            { label: "Last modified", value: fn?.last_modified ?? "-" },
            { label: "Code size", value: fn ? formatBytes(fn.code_size) : "-" },
          ],
        }}
        sections={[
          { id: "code", label: "Code", content: <CodeTab name={name} onDeployed={details.reload} /> },
          { id: "test", label: "Test", content: <TestTab name={name} qualifier={null} /> },
          {
            id: "configuration",
            label: "Configuration",
            content: fn ? (
              <SpaceBetween size="l">
                <GeneralConfiguration fn={fn} reload={details.reload} />
                <UiOnlyScope primaryOp="lambda:ListEventSourceMappings"><TriggersSection name={name} /></UiOnlyScope>
                <PermissionsSection fn={fn} />
                <FunctionTags arn={fn.arn} />
              </SpaceBetween>
            ) : null,
          },
          { id: "aliases", label: "Aliases", content: <AliasesTab name={name} /> },
          { id: "versions", label: "Versions", content: <UiOnlyScope primaryOp="lambda:ListVersionsByFunction"><VersionsTab name={name} /></UiOnlyScope> },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="function" names={[name]} op="lambda:DeleteFunction" confirmation="typed" warning="Deleting the function also deletes its versions and aliases." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.lambdaDeleteFunction(region, name); window.location.hash = "#/lambda/functions"; }} />
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The Lambda page for a route path, or null when the path is not a Lambda page. */
export function lambdaPage(path: string): ReactNode | null {
  if (path === "/lambda" || path === "/lambda/dashboard") return page([{ text: "Dashboard", href: href("/lambda/dashboard") }], <UiOnlyScope primaryOp="lambda:GetAccountSettings"><Dashboard /></UiOnlyScope>);
  if (path === "/lambda/functions") return page([{ text: "Functions", href: href("/lambda/functions") }], <UiOnlyScope primaryOp="lambda:ListFunctions"><FunctionsList /></UiOnlyScope>, "table");
  if (path === "/lambda/functions/create") return page([{ text: "Functions", href: href("/lambda/functions") }, { text: "Create function", href: href("/lambda/functions/create") }], <CreateFunctionForm />, "form");
  const fn = matchPath("/lambda/functions/:name", path);
  if (fn) return page([{ text: "Functions", href: href("/lambda/functions") }, { text: fn.name, href: functionHref(fn.name) }], <UiOnlyScope primaryOp="lambda:GetFunction"><FunctionDetails key={fn.name} name={fn.name} /></UiOnlyScope>);
  return null;
}
