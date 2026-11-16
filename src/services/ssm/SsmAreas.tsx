// Systems Manager console pages of every area except Parameter Store, OpsCenter and Settings:
// Automation, Maintenance Windows, Fleet Manager, Compliance, Inventory, Hybrid Activations, Session
// Manager, Run Command, State Manager, Patch Manager, Documents and Resource Data Sync. Many areas
// are red or yellow in the emulator, so the pages are driven by the capability gates: a red primary
// read makes the page UI-only, a yellow one a partial page.

import type { PropertyFilterProperty } from "@cloudscape-design/collection-hooks";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import DatePicker from "@cloudscape-design/components/date-picker";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import { useRef, useState, type ReactNode } from "react";
import {
  commands,
  type SsmActivation_Serialize,
  type SsmAssociation_Serialize,
  type SsmAutomationExecution_Serialize,
  type SsmCommand_Serialize,
  type SsmDataSync_Serialize,
  type SsmInventoryEntity_Serialize,
  type SsmManagedInstance_Serialize,
  type SsmNewActivation,
  type SsmTarget,
} from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, textProperty, UiOnlyScope, type ResourceTableColumn } from "../../patterns";
import { navigate } from "../../shell/router";
import { useNotifications } from "../../shell/notifications";
import { DEFAULT_REGION, REGIONS } from "../../shell/regions";
import { Copyable, EditTagsModal, FormModal, formatDate, GatedDropdown, jsonError, LoadError, prettyJson, TagsTable, useAction, useGates, useLoad, useRegion } from "../common";
import { ssmHref, ssmPage, SSM_HELP, SSM_ROOT } from "./shell";

const crumb = (text: string, path: string, query?: Record<string, string | undefined>) => ({ text, href: ssmHref(path, query) });
const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "-" : String(v));

/** Status text of an automation, command or ping status as a console status indicator. */
function statusType(status: string | null | undefined): StatusIndicatorProps.Type {
  const s = (status ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (["success", "completed", "online", "active", "synced", "compliant"].includes(s)) return "success";
  if (["failed", "cancelled", "canceled", "timedout", "connectionlost", "error", "undeliverable", "terminated", "noncompliant"].includes(s)) return "error";
  if (["inprogress", "running", "executing", "waiting", "cancelling", "delayed"].includes(s)) return "in-progress";
  if (["pending", "scheduled", "notstarted"].includes(s)) return "pending";
  if (["inactive", "stopped"].includes(s)) return "stopped";
  return "info";
}

function Status({ status }: { status: string | null | undefined }) {
  return status ? <StatusIndicator type={statusType(status)}>{status}</StatusIndicator> : <>-</>;
}

// Generic list ------------------------------------------------------------------------------------

interface AreaConfig<T> {
  title: string;
  resourceName: string;
  description?: string;
  columns: ResourceTableColumn<T>[];
  filteringProperties: PropertyFilterProperty[];
  trackBy: string;
  preferencesKey: string;
  /** The read of the list; null on a UI-only area, which loads nothing. */
  loader: ((region: string) => Promise<T[]>) | null;
  create?: { op: string; label: string; href?: string };
  remove?: { op: string; kind: string; name: (item: T) => string; run: (region: string, item: T) => Promise<unknown>; warning?: ReactNode };
  /** More gated buttons next to Delete and Create. */
  extra?: (selected: readonly T[]) => ReactNode;
}

/** One console list driven by a config; wrap it in a `UiOnlyScope` of the area's primary read. */
function AreaList<T>({ config }: { config: AreaConfig<T> }) {
  const region = useRegion();
  const load = useLoad(() => (config.loader ? config.loader(region) : Promise.resolve([] as T[])), [config], config.loader !== null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const { create, remove } = config;
  const createButton = create && (
    <GatedButton variant="primary" op={create.op} href={create.href}>
      {create.label}
    </GatedButton>
  );
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={load.error} onRetry={load.reload} />
      <ResourceTable<T>
        resourceName={config.resourceName}
        title={config.title}
        description={config.description}
        help={SSM_HELP}
        items={load.data ?? []}
        loading={load.loading}
        columns={config.columns}
        filteringProperties={config.filteringProperties}
        trackBy={config.trackBy}
        preferencesKey={config.preferencesKey}
        selectionType={remove ? "single" : undefined}
        onRefresh={config.loader ? load.reload : undefined}
        emptyAction={createButton}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            {remove && (
              <GatedButton op={remove.op} disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
                Delete
              </GatedButton>
            )}
            {config.extra?.(sel)}
            {createButton}
          </SpaceBetween>
        )}
      />
      {remove && (
        <DeleteModal
          visible={deleting !== null}
          resourceKind={remove.kind}
          names={deleting ? [remove.name(deleting)] : []}
          op={remove.op}
          confirmation="simple"
          warning={remove.warning}
          onDismiss={() => setDeleting(null)}
          onDelete={async () => {
            await remove.run(region, deleting!);
            load.reload();
          }}
        />
      )}
    </SpaceBetween>
  );
}

// Key and value rows ------------------------------------------------------------------------------

interface KvRow {
  key: string;
  value: string;
}

/** Rows with the same key accumulate their values, so a value may contain commas. */
function groupRows(rows: KvRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const key = r.key.trim();
    if (!key) continue;
    (out[key] ??= []).push(r.value);
  }
  return out;
}

function KeyValueEditor({ rows, onChange, keyLabel, valueLabel, keyPlaceholder, valuePlaceholder, addText, empty }: { rows: KvRow[]; onChange: (rows: KvRow[]) => void; keyLabel: string; valueLabel: string; keyPlaceholder?: string; valuePlaceholder?: string; addText: string; empty: string }) {
  const set = (i: number, patch: Partial<KvRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <AttributeEditor<KvRow>
      items={rows}
      addButtonText={addText}
      removeButtonText="Remove"
      empty={empty}
      onAddButtonClick={() => onChange([...rows, { key: "", value: "" }])}
      onRemoveButtonClick={({ detail }) => onChange(rows.filter((_, i) => i !== detail.itemIndex))}
      definition={[
        { label: keyLabel, control: (x, i) => <Input value={x.key} placeholder={keyPlaceholder} onChange={({ detail }) => set(i, { key: detail.value })} /> },
        { label: valueLabel, control: (x, i) => <Input value={x.value} placeholder={valuePlaceholder} onChange={({ detail }) => set(i, { value: detail.value })} /> },
      ]}
    />
  );
}

function MonospaceText({ value, rows = 18, readOnly, onChange }: { value: string; rows?: number; readOnly?: boolean; onChange?: (v: string) => void }) {
  return (
    <div style={{ fontFamily: "monospace" }}>
      <Textarea value={value} rows={rows} readOnly={readOnly} spellcheck={false} onChange={({ detail }) => onChange?.(detail.value)} />
    </div>
  );
}

const NOT_FOUND = (what: string) => (
  <Box textAlign="center" color="inherit">
    <b>No {what}</b>
  </Box>
);

// Automation --------------------------------------------------------------------------------------

const executionHref = (id: string) => ssmHref("/automation/detail", { id });

const AUTOMATION: AreaConfig<SsmAutomationExecution_Serialize> = {
  title: "Executions",
  resourceName: "Execution",
  columns: [
    { id: "id", header: "Execution ID", cell: (e) => <Link href={executionHref(e.id)}>{e.id}</Link>, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "document", header: "Document", cell: (e) => e.document_name, sortingField: "document_name" },
    { id: "status", header: "Status", cell: (e) => <Status status={e.status} />, sortingField: "status" },
    { id: "mode", header: "Mode", cell: (e) => dash(e.mode), sortingField: "mode" },
    { id: "by", header: "Executed by", cell: (e) => dash(e.executed_by), sortingField: "executed_by" },
    { id: "start", header: "Start time", cell: (e) => formatDate(e.start_time), sortingField: "start_time" },
    { id: "end", header: "End time", cell: (e) => formatDate(e.end_time), sortingField: "end_time" },
  ],
  filteringProperties: [textProperty("id", "Execution ID"), textProperty("document_name", "Document"), textProperty("status", "Status", "enum"), textProperty("mode", "Mode", "enum")],
  trackBy: "id",
  preferencesKey: "ssm.automation",
  loader: (region) => commands.ssmDescribeAutomationExecutions(region, null),
  create: { op: "ssm:StartAutomationExecution", label: "Execute automation", href: ssmHref("/automation/execute") },
};

function ExecuteAutomation() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [rows, setRows] = useState<KvRow[]>([]);
  const [nameError, setNameError] = useState<string>();
  return (
    <CreateForm
      title="Execute automation"
      help={SSM_HELP}
      mode="create"
      submitLabel="Execute"
      op="ssm:StartAutomationExecution"
      dirty={name !== "" || version !== "" || rows.length > 0}
      cancelHref={ssmHref("/automation")}
      validate={() => {
        const e = name.trim() ? undefined : "Enter the name of an Automation document.";
        setNameError(e);
        return !e;
      }}
      onSubmit={async () => {
        const id = await commands.ssmStartAutomation(region, name.trim(), groupRows(rows), version.trim() || null);
        return id ? executionHref(id) : ssmHref("/automation");
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Document</Header>}>
          <SpaceBetween size="l">
            <FormField label="Document name" errorText={nameError} description="The Automation runbook to run.">
              <Input value={name} placeholder="AWS-RestartEC2Instance" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Document version - optional" description="Leave empty to use the default version.">
              <Input value={version} placeholder="$DEFAULT" onChange={({ detail }) => setVersion(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="Add a row per value; rows with the same key pass several values for one parameter.">Input parameters - optional</Header>}>
          <KeyValueEditor rows={rows} onChange={setRows} keyLabel="Parameter" valueLabel="Value" keyPlaceholder="InstanceId" addText="Add parameter" empty="No parameters." />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

function MapTable({ title, values }: { title: string; values: Record<string, string[]> }) {
  const items = Object.entries(values).map(([name, v]) => ({ name, value: v.join(", ") }));
  return (
    <Table
      variant="container"
      items={items}
      trackBy="name"
      columnDefinitions={[
        { id: "name", header: "Name", cell: (x) => x.name, isRowHeader: true },
        { id: "value", header: "Value", cell: (x) => dash(x.value) },
      ]}
      empty={NOT_FOUND(title.toLowerCase())}
      header={<Header variant="h2" counter={`(${items.length})`}>{title}</Header>}
    />
  );
}

function ExecutionDetails({ id }: { id: string }) {
  const region = useRegion();
  const load = useLoad(() => commands.ssmDescribeAutomationExecutions(region, id), [id]);
  const e = load.data?.find((x) => x.id === id);
  const missing = load.data !== null && !e ? `The emulator returned no execution ${id}.` : null;
  return (
    <SpaceBetween size="m">
      <LoadError error={load.error ?? missing} onRetry={load.reload} />
      <DetailsPage
        title={id}
        help={SSM_HELP}
        layout="hub"
        actions={
          <GatedButton iconName="refresh" ariaLabel="Refresh" op="ssm:DescribeAutomationExecutions" onClick={load.reload} />
        }
        overview={{
          title: "Execution details",
          columns: 3,
          items: [
            { label: "Execution ID", value: <Copyable value={id} label="Execution ID" /> },
            { label: "Document", value: e?.document_name ? <Link href={ssmHref("/documents/detail", { name: e.document_name })}>{e.document_name}</Link> : "-" },
            { label: "Document version", value: dash(e?.document_version) },
            { label: "Status", value: <Status status={e?.status} /> },
            { label: "Mode", value: dash(e?.mode) },
            { label: "Executed by", value: dash(e?.executed_by) },
            { label: "Start time", value: formatDate(e?.start_time) },
            { label: "End time", value: formatDate(e?.end_time) },
            { label: "Failure message", value: dash(e?.failure_message) },
          ],
        }}
        sections={[
          { id: "parameters", label: "Input parameters", content: <MapTable title="Input parameters" values={e?.parameters ?? {}} /> },
          { id: "outputs", label: "Outputs", content: <MapTable title="Outputs" values={e?.outputs ?? {}} /> },
        ]}
      />
    </SpaceBetween>
  );
}

// Areas the emulator does not implement -----------------------------------------------------------

interface WindowRow {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  duration: number;
  cutoff: number;
}

const MAINTENANCE: AreaConfig<WindowRow> = {
  title: "Maintenance windows",
  resourceName: "Maintenance window",
  columns: [
    { id: "name", header: "Name", cell: (w) => w.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "id", header: "Window ID", cell: (w) => w.id, sortingField: "id" },
    { id: "enabled", header: "Enabled", cell: (w) => (w.enabled ? "Yes" : "No"), sortingField: "enabled" },
    { id: "schedule", header: "Schedule", cell: (w) => dash(w.schedule), sortingField: "schedule" },
    { id: "duration", header: "Duration", cell: (w) => `${w.duration} hours`, sortingField: "duration" },
    { id: "cutoff", header: "Cutoff", cell: (w) => `${w.cutoff} hours`, sortingField: "cutoff" },
  ],
  filteringProperties: [textProperty("name", "Name"), textProperty("id", "Window ID")],
  trackBy: "id",
  preferencesKey: "ssm.maintenance-windows",
  loader: null,
  create: { op: "ssm:CreateMaintenanceWindow", label: "Create maintenance window" },
};

interface ComplianceRow {
  type: string;
  compliant: number;
  nonCompliant: number;
}

const COMPLIANCE: AreaConfig<ComplianceRow> = {
  title: "Compliance resources summary",
  resourceName: "Compliance type",
  columns: [
    { id: "type", header: "Compliance type", cell: (c) => c.type, sortingField: "type", isRowHeader: true, alwaysVisible: true },
    { id: "compliant", header: "Compliant resources", cell: (c) => c.compliant, sortingField: "compliant" },
    { id: "non", header: "Non-compliant resources", cell: (c) => c.nonCompliant, sortingField: "nonCompliant" },
  ],
  filteringProperties: [textProperty("type", "Compliance type")],
  trackBy: "type",
  preferencesKey: "ssm.compliance",
  loader: null,
};

interface SessionRow {
  id: string;
  target: string;
  status: string;
  started: string;
  owner: string;
}

const SESSIONS: AreaConfig<SessionRow> = {
  title: "Sessions",
  resourceName: "Session",
  columns: [
    { id: "id", header: "Session ID", cell: (s) => s.id, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "target", header: "Target", cell: (s) => s.target, sortingField: "target" },
    { id: "status", header: "Status", cell: (s) => <Status status={s.status} />, sortingField: "status" },
    { id: "started", header: "Started", cell: (s) => formatDate(s.started), sortingField: "started" },
    { id: "owner", header: "Owner", cell: (s) => s.owner, sortingField: "owner" },
  ],
  filteringProperties: [textProperty("id", "Session ID"), textProperty("target", "Target"), textProperty("status", "Status", "enum")],
  trackBy: "id",
  preferencesKey: "ssm.sessions",
  loader: null,
  create: { op: "ssm:StartSession", label: "Start session" },
};

// Fleet Manager and Inventory ---------------------------------------------------------------------

const platformOf = (n: SsmManagedInstance_Serialize) => [n.platform_name, n.platform_version].filter(Boolean).join(" ") || n.platform_type || "-";

const FLEET: AreaConfig<SsmManagedInstance_Serialize> = {
  title: "Managed nodes",
  resourceName: "Managed node",
  columns: [
    { id: "id", header: "Node ID", cell: (n) => n.instance_id, sortingField: "instance_id", isRowHeader: true, alwaysVisible: true },
    { id: "ping", header: "Ping status", cell: (n) => <Status status={n.ping_status} />, sortingField: "ping_status" },
    { id: "platform", header: "Platform", cell: platformOf },
    { id: "agent", header: "Agent version", cell: (n) => dash(n.agent_version), sortingField: "agent_version" },
    { id: "ip", header: "IP address", cell: (n) => dash(n.ip_address), sortingField: "ip_address" },
    { id: "computer", header: "Computer name", cell: (n) => dash(n.computer_name), sortingField: "computer_name" },
    { id: "ping-time", header: "Last ping", cell: (n) => formatDate(n.last_ping), sortingField: "last_ping" },
  ],
  filteringProperties: [textProperty("instance_id", "Node ID"), textProperty("ping_status", "Ping status", "enum"), textProperty("ip_address", "IP address"), textProperty("computer_name", "Computer name")],
  trackBy: "instance_id",
  preferencesKey: "ssm.fleet-manager",
  loader: (region) => commands.ssmDescribeInstanceInformation(region),
};

const INVENTORY: AreaConfig<SsmInventoryEntity_Serialize> = {
  title: "Inventory entities",
  resourceName: "Entity",
  columns: [
    { id: "id", header: "Entity ID", cell: (e) => e.id, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "capture", header: "Capture time", cell: (e) => dash(e.capture_time), sortingField: "capture_time" },
    { id: "types", header: "Inventory types", cell: (e) => (e.content_types.length ? e.content_types.join(", ") : "-") },
  ],
  filteringProperties: [textProperty("id", "Entity ID")],
  trackBy: "id",
  preferencesKey: "ssm.inventory",
  loader: (region) => commands.ssmGetInventory(region),
};

// Hybrid Activations ------------------------------------------------------------------------------

const ACTIVATIONS: AreaConfig<SsmActivation_Serialize> = {
  title: "Hybrid Activations",
  resourceName: "Activation",
  columns: [
    { id: "id", header: "Activation ID", cell: (a) => a.id, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "description", header: "Description", cell: (a) => dash(a.description), sortingField: "description" },
    { id: "name", header: "Default instance name", cell: (a) => dash(a.default_instance_name), sortingField: "default_instance_name" },
    { id: "role", header: "IAM role", cell: (a) => dash(a.iam_role), sortingField: "iam_role" },
    { id: "limit", header: "Registration limit", cell: (a) => a.registration_limit, sortingField: "registration_limit" },
    { id: "registered", header: "Registered", cell: (a) => a.registrations_count, sortingField: "registrations_count" },
    { id: "expiration", header: "Expiration", cell: (a) => formatDate(a.expiration_date), sortingField: "expiration_date" },
    { id: "expired", header: "Expired", cell: (a) => (a.expired ? "Yes" : "No"), sortingField: "expired" },
  ],
  filteringProperties: [textProperty("id", "Activation ID"), textProperty("description", "Description"), textProperty("default_instance_name", "Default instance name"), textProperty("iam_role", "IAM role")],
  trackBy: "id",
  preferencesKey: "ssm.activations",
  loader: (region) => commands.ssmDescribeActivations(region),
  create: { op: "ssm:CreateActivation", label: "Create activation", href: ssmHref("/activations/create") },
  remove: { op: "ssm:DeleteActivation", kind: "activation", name: (a) => a.id, run: (region, a) => commands.ssmDeleteActivation(region, a.id), warning: "Machines already registered with this activation keep working; no new machine can register with it." },
};

function CreateActivation() {
  const region = useRegion();
  const [description, setDescription] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [role, setRole] = useState("");
  const [limit, setLimit] = useState("1");
  const [expiration, setExpiration] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  // The code is held only while the modal shows it; the form waits for the modal to close.
  const [created, setCreated] = useState<SsmNewActivation | null>(null);
  const closed = useRef<(() => void) | null>(null);
  const dismiss = () => {
    setCreated(null);
    closed.current?.();
    closed.current = null;
  };
  const expiresAt = () => (expiration ? new Date(`${expiration}T23:59:59`) : null);
  return (
    <>
      <CreateForm
        title="Create activation"
        help={SSM_HELP}
        mode="create"
        submitLabel="Create activation"
        op="ssm:CreateActivation"
        dirty={description !== "" || instanceName !== "" || role !== "" || expiration !== "" || limit !== "1"}
        cancelHref={ssmHref("/activations")}
        validate={() => {
          const n = Number(limit);
          const end = expiresAt();
          const e = {
            role: role.trim() ? undefined : "Enter the name of the IAM service role.",
            limit: Number.isInteger(n) && n >= 1 && n <= 1000 ? undefined : "Enter a whole number from 1 to 1000.",
            expiration: end && (isNaN(end.getTime()) || end.getTime() <= Date.now()) ? "Choose a date in the future." : undefined,
          };
          setErrors(e);
          return !e.role && !e.limit && !e.expiration;
        }}
        onSubmit={async () => {
          const end = expiresAt();
          const iso = end ? end.toISOString().replace(/\.\d{3}Z$/, "Z") : null;
          const r = await commands.ssmCreateActivation(region, description.trim() || null, instanceName.trim() || null, role.trim(), Number(limit), iso);
          await new Promise<void>((resolve) => {
            closed.current = resolve;
            setCreated(r);
          });
          return ssmHref("/activations");
        }}
      >
        <Container header={<Header variant="h2">Activation settings</Header>}>
          <SpaceBetween size="l">
            <FormField label="Activation description - optional">
              <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
            </FormField>
            <FormField label="Default instance name - optional" description="The name given to machines that register with this activation.">
              <Input value={instanceName} onChange={({ detail }) => setInstanceName(detail.value)} />
            </FormField>
            <FormField label="IAM role" errorText={errors.role} description="The IAM service role that machines assume when they register.">
              <Input value={role} placeholder="AmazonEC2RunCommandRoleForManagedInstances" onChange={({ detail }) => setRole(detail.value)} />
            </FormField>
            <FormField label="Instance limit" errorText={errors.limit} constraintText="From 1 to 1000. Defaults to 1.">
              <Input type="number" inputMode="numeric" value={limit} onChange={({ detail }) => setLimit(detail.value)} />
            </FormField>
            <FormField label="Activation expiry date - optional" errorText={errors.expiration} constraintText="YYYY-MM-DD. The activation expires at the end of this day, in your local time.">
              <DatePicker value={expiration} placeholder="YYYY-MM-DD" onChange={({ detail }) => setExpiration(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
      </CreateForm>
      <Modal
        visible={created !== null}
        header="Activation created"
        closeAriaLabel="Close dialog"
        onDismiss={dismiss}
        footer={
          <Box float="right">
            <Button variant="primary" onClick={dismiss}>
              Done
            </Button>
          </Box>
        }
      >
        {created && (
          <SpaceBetween size="m">
            <Alert type="warning" header="Copy the activation code now">
              The activation code is shown only once and cannot be retrieved later. Closing this dialog discards it.
            </Alert>
            <ColumnLayout columns={1} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Activation ID</Box>
                <SpaceBetween direction="horizontal" size="xs">
                  <Box variant="code">{created.activation_id}</Box>
                  <Copyable value={created.activation_id} label="Activation ID" />
                </SpaceBetween>
              </div>
              <div>
                <Box variant="awsui-key-label">Activation code</Box>
                <SpaceBetween direction="horizontal" size="xs">
                  <Box variant="code">{created.activation_code}</Box>
                  <Copyable value={created.activation_code} label="Activation code" />
                </SpaceBetween>
              </div>
            </ColumnLayout>
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}

// Run Command -------------------------------------------------------------------------------------

const COMMANDS: AreaConfig<SsmCommand_Serialize> = {
  title: "Command history",
  resourceName: "Command",
  columns: [
    { id: "id", header: "Command ID", cell: (c) => c.command_id, sortingField: "command_id", isRowHeader: true, alwaysVisible: true },
    { id: "document", header: "Document", cell: (c) => dash(c.document_name), sortingField: "document_name" },
    { id: "status", header: "Status", cell: (c) => <Status status={c.status} />, sortingField: "status" },
    { id: "requested", header: "Requested date", cell: (c) => formatDate(c.requested), sortingField: "requested" },
    { id: "targets", header: "Targets", cell: (c) => c.target_count, sortingField: "target_count" },
    { id: "completed", header: "Completed", cell: (c) => c.completed_count, sortingField: "completed_count" },
    { id: "errors", header: "Errors", cell: (c) => c.error_count, sortingField: "error_count" },
  ],
  filteringProperties: [textProperty("command_id", "Command ID"), textProperty("document_name", "Document"), textProperty("status", "Status", "enum")],
  trackBy: "command_id",
  preferencesKey: "ssm.run-command",
  loader: (region) => commands.ssmListCommands(region),
  create: { op: "ssm:SendCommand", label: "Run command", href: ssmHref("/run-command/run") },
};

function RunCommand() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [ids, setIds] = useState("");
  const [rows, setRows] = useState<KvRow[]>([]);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const instanceIds = () => ids.split(/[\s,]+/).filter(Boolean);
  return (
    <CreateForm
      title="Run command"
      help={SSM_HELP}
      mode="create"
      submitLabel="Run"
      op="ssm:SendCommand"
      dirty={name !== "" || ids !== "" || rows.length > 0 || comment !== ""}
      cancelHref={ssmHref("/run-command")}
      validate={() => {
        const e = { name: name.trim() ? undefined : "Enter the name of a Command document.", ids: instanceIds().length ? undefined : "Enter at least one instance ID." };
        setErrors(e);
        return !e.name && !e.ids;
      }}
      onSubmit={async () => {
        await commands.ssmSendCommand(region, name.trim(), instanceIds(), groupRows(rows), comment.trim() || null);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Command document</Header>}>
          <FormField label="Document name" errorText={errors.name}>
            <Input value={name} placeholder="AWS-RunShellScript" onChange={({ detail }) => setName(detail.value)} />
          </FormField>
        </Container>
        <Container header={<Header variant="h2">Targets</Header>}>
          <FormField label="Instance IDs" errorText={errors.ids} description="One instance ID per line.">
            <Textarea value={ids} rows={5} placeholder="i-0123456789abcdef0" onChange={({ detail }) => setIds(detail.value)} />
          </FormField>
        </Container>
        <Container header={<Header variant="h2" description="Add a row per value; rows with the same key pass several values for one parameter.">Command parameters - optional</Header>}>
          <KeyValueEditor rows={rows} onChange={setRows} keyLabel="Parameter" valueLabel="Value" keyPlaceholder="commands" addText="Add parameter" empty="No parameters." />
        </Container>
        <Container header={<Header variant="h2">Comment</Header>}>
          <FormField label="Comment - optional">
            <Input value={comment} onChange={({ detail }) => setComment(detail.value)} />
          </FormField>
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// State Manager -----------------------------------------------------------------------------------

const ASSOCIATIONS: AreaConfig<SsmAssociation_Serialize> = {
  title: "Associations",
  resourceName: "Association",
  columns: [
    { id: "id", header: "Association ID", cell: (a) => dash(a.association_id), sortingField: "association_id", isRowHeader: true, alwaysVisible: true },
    { id: "name", header: "Name", cell: (a) => dash(a.name), sortingField: "name" },
    { id: "assoc-name", header: "Association name", cell: (a) => dash(a.association_name), sortingField: "association_name" },
    { id: "targets", header: "Targets", cell: (a) => (a.targets.length ? a.targets.join("; ") : "-") },
    { id: "schedule", header: "Schedule", cell: (a) => dash(a.schedule), sortingField: "schedule" },
    { id: "last", header: "Last execution", cell: (a) => formatDate(a.last_execution_date), sortingField: "last_execution_date" },
    { id: "status", header: "Status", cell: (a) => <Status status={a.overview_status} />, sortingField: "overview_status" },
  ],
  filteringProperties: [textProperty("association_id", "Association ID"), textProperty("name", "Name"), textProperty("association_name", "Association name"), textProperty("overview_status", "Status", "enum")],
  trackBy: "association_id",
  preferencesKey: "ssm.state-manager",
  loader: (region) => commands.ssmListAssociations(region),
  create: { op: "ssm:CreateAssociation", label: "Create association", href: ssmHref("/state-manager/create") },
  remove: { op: "ssm:DeleteAssociation", kind: "association", name: (a) => a.association_id ?? "", run: (region, a) => commands.ssmDeleteAssociation(region, a.association_id ?? "") },
};

function CreateAssociation() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [rows, setRows] = useState<KvRow[]>([{ key: "InstanceIds", value: "" }]);
  const [schedule, setSchedule] = useState("");
  const [associationName, setAssociationName] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const targets = (): SsmTarget[] => Object.entries(groupRows(rows)).map(([key, values]) => ({ key, values: values.map((v) => v.trim()).filter(Boolean) })).filter((t) => t.values.length > 0);
  return (
    <CreateForm
      title="Create association"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create association"
      op="ssm:CreateAssociation"
      dirty={name !== "" || schedule !== "" || associationName !== "" || rows.some((r) => r.value !== "")}
      cancelHref={ssmHref("/state-manager")}
      validate={() => {
        const e = { name: name.trim() ? undefined : "Enter the name of a document.", targets: targets().length ? undefined : "Add at least one target with a key and a value." };
        setErrors(e);
        return !e.name && !e.targets;
      }}
      onSubmit={async () => {
        await commands.ssmCreateAssociation(region, name.trim(), targets(), schedule.trim() || null, associationName.trim() || null);
        return ssmHref("/state-manager");
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Association details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Name" errorText={errors.name} description="The document the association runs.">
              <Input value={name} placeholder="AWS-GatherSoftwareInventory" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Association name - optional">
              <Input value={associationName} onChange={({ detail }) => setAssociationName(detail.value)} />
            </FormField>
            <FormField label="Schedule expression - optional" constraintText="A cron or rate expression, for example rate(30 minutes).">
              <Input value={schedule} placeholder="rate(30 minutes)" onChange={({ detail }) => setSchedule(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="The key is InstanceIds, tag:<name> or resource-groups:Name. Rows with the same key add values.">Targets</Header>}>
          <FormField errorText={errors.targets}>
            <KeyValueEditor rows={rows} onChange={setRows} keyLabel="Target key" valueLabel="Target value" keyPlaceholder="InstanceIds" valuePlaceholder="i-0123456789abcdef0" addText="Add target" empty="No targets." />
          </FormField>
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Patch Manager -----------------------------------------------------------------------------------

const OPERATING_SYSTEMS = ["WINDOWS", "AMAZON_LINUX_2", "AMAZON_LINUX_2023", "UBUNTU", "REDHAT_ENTERPRISE_LINUX", "DEBIAN", "SUSE", "ORACLE_LINUX", "MACOS", "ROCKY_LINUX", "ALMA_LINUX"] as const;
const OS_OPTIONS = opts(OPERATING_SYSTEMS);

const patchList = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

interface BaselineRow {
  id: string;
  name: string;
  os: string;
  description: string;
  isDefault: boolean;
}

const BASELINES: AreaConfig<BaselineRow> = {
  title: "Patch baselines",
  resourceName: "Patch baseline",
  columns: [
    { id: "id", header: "Baseline ID", cell: (b) => b.id, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "name", header: "Name", cell: (b) => b.name, sortingField: "name" },
    { id: "os", header: "Operating system", cell: (b) => b.os, sortingField: "os" },
    { id: "description", header: "Description", cell: (b) => dash(b.description), sortingField: "description" },
    { id: "default", header: "Default baseline", cell: (b) => (b.isDefault ? "Yes" : "No"), sortingField: "isDefault" },
  ],
  filteringProperties: [textProperty("id", "Baseline ID"), textProperty("name", "Name"), textProperty("os", "Operating system", "enum")],
  trackBy: "id",
  preferencesKey: "ssm.patch-baselines",
  loader: null,
  create: { op: "ssm:CreatePatchBaseline", label: "Create patch baseline" },
};

/** Outside the scope of the red baseline list: reading the default baseline works. */
function DefaultBaseline() {
  const region = useRegion();
  const { run, busy } = useAction();
  const [os, setOs] = useState<string>("AMAZON_LINUX_2");
  const [id, setId] = useState<{ os: string; id: string } | null>(null);
  return (
    <Container header={<Header variant="h2" description="Look up the default patch baseline of an operating system.">Open default baseline</Header>}>
      <SpaceBetween size="m">
        <FormField label="Operating system">
          <Select selectedOption={OS_OPTIONS.find((o) => o.value === os) ?? OS_OPTIONS[0]} options={OS_OPTIONS} onChange={({ detail }) => { setOs(detail.selectedOption.value!); setId(null); }} />
        </FormField>
        <GatedButton
          op="ssm:GetDefaultPatchBaseline"
          loading={busy}
          onClick={() =>
            run(async () => {
              setId({ os, id: await commands.ssmGetDefaultPatchBaseline(region, os) });
            })
          }
        >
          Open default baseline
        </GatedButton>
        {id && (
          <SpaceBetween direction="horizontal" size="xs">
            <Box variant="span">Default baseline of {id.os}:</Box>
            <Box variant="code">{id.id || "-"}</Box>
            {id.id && <Copyable value={id.id} label="Baseline ID" />}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Container>
  );
}

function CreatePatchBaseline() {
  const region = useRegion();
  const { notify } = useNotifications();
  const [name, setName] = useState("");
  const [os, setOs] = useState<string>("AMAZON_LINUX_2");
  const [description, setDescription] = useState("");
  const [patches, setPatches] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [patchError, setPatchError] = useState<string>();
  return (
    <CreateForm
      title="Create patch baseline"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create patch baseline"
      op="ssm:CreatePatchBaseline"
      dirty={name !== "" || description !== "" || patches !== ""}
      cancelHref={ssmHref("/patch-manager")}
      validate={() => {
        const e = /^[a-zA-Z0-9_\-.]{3,128}$/.test(name) ? undefined : "Use 3 to 128 letters, numbers, periods (.), hyphens (-) and underscores (_).";
        setNameError(e);
        const pe = patchList(patches).length > 0 ? undefined : "Enter at least one approved patch; the emulator refuses a baseline without approved patches or approval rules.";
        setPatchError(pe);
        return !e && !pe;
      }}
      onSubmit={async () => {
        const id = await commands.ssmCreatePatchBaseline(region, name, os, description.trim() || null, patchList(patches));
        notify({ type: "success", content: `Patch baseline ${name} created with ID ${id}.` });
        return ssmHref("/patch-manager");
      }}
    >
      <Container header={<Header variant="h2">Patch baseline details</Header>}>
        <SpaceBetween size="l">
          <FormField label="Name" errorText={nameError} constraintText="3 to 128 characters: letters, numbers, periods (.), hyphens (-) and underscores (_).">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} />
          </FormField>
          <FormField label="Operating system">
            <Select selectedOption={OS_OPTIONS.find((o) => o.value === os) ?? OS_OPTIONS[0]} options={OS_OPTIONS} onChange={({ detail }) => setOs(detail.selectedOption.value!)} />
          </FormField>
          <FormField label="Description - optional">
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <FormField label="Approved patches" errorText={patchError} description="One patch ID or KB number per line, for example KB2999226 or the package name." stretch>
            <Textarea value={patches} rows={4} onChange={({ detail }) => setPatches(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Container>
    </CreateForm>
  );
}

// Documents ---------------------------------------------------------------------------------------

interface DocumentRow {
  name: string;
  owner: string;
  platforms: string;
  type: string;
  defaultVersion: string;
  modified: string;
}

const documentHref = (name: string, tab?: string) => ssmHref("/documents/detail", { name, tab });

const DOCUMENTS: AreaConfig<DocumentRow> = {
  title: "Documents",
  resourceName: "Document",
  columns: [
    { id: "name", header: "Name", cell: (d) => <Link href={documentHref(d.name)}>{d.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "owner", header: "Owner", cell: (d) => dash(d.owner), sortingField: "owner" },
    { id: "platforms", header: "Platform types", cell: (d) => dash(d.platforms), sortingField: "platforms" },
    { id: "type", header: "Document type", cell: (d) => d.type, sortingField: "type" },
    { id: "version", header: "Default version", cell: (d) => dash(d.defaultVersion), sortingField: "defaultVersion" },
    { id: "modified", header: "Last modified", cell: (d) => formatDate(d.modified), sortingField: "modified" },
  ],
  filteringProperties: [textProperty("name", "Name"), textProperty("owner", "Owner"), textProperty("type", "Document type", "enum")],
  trackBy: "name",
  preferencesKey: "ssm.documents",
  loader: null,
  create: { op: "ssm:CreateDocument", label: "Create document", href: ssmHref("/documents/create") },
};

/** Outside the scope of the red document list: without it a created document cannot be reached. */
function OpenDocument() {
  const [name, setName] = useState("");
  const open = () => name.trim() && navigate(documentHref(name.trim()));
  return (
    <Container header={<Header variant="h2" description="The document list is not available, but a document can be opened when you know its name.">Open a document by name</Header>}>
      <SpaceBetween size="s" direction="horizontal" alignItems="end">
        <FormField label="Document name">
          <Input value={name} placeholder="MyDocument" onChange={({ detail }) => setName(detail.value)} onKeyDown={({ detail }) => detail.key === "Enter" && open()} />
        </FormField>
        <Button variant="primary" disabled={!name.trim()} onClick={open}>
          Open
        </Button>
      </SpaceBetween>
    </Container>
  );
}

const DOCUMENT_TYPES = opts(["Command", "Automation", "Package", "Policy", "Session", "ChangeCalendar", "CloudFormation"]);
const DOCUMENT_FORMATS = opts(["JSON", "YAML", "TEXT"]);

function CreateDocument() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [type, setType] = useState("Command");
  const [format, setFormat] = useState("JSON");
  const [target, setTarget] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <CreateForm
      title="Create document"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create document"
      op="ssm:CreateDocument"
      dirty={name !== "" || content !== "" || target !== ""}
      cancelHref={ssmHref("/documents")}
      validate={() => {
        const e = {
          name: /^[a-zA-Z0-9_\-.:/]{3,128}$/.test(name) ? undefined : "Use 3 to 128 letters, numbers, periods (.), hyphens (-), underscores (_), colons (:) and slashes (/).",
          content: format === "JSON" ? jsonError(content, false) : content.trim() ? undefined : "Enter the document content.",
        };
        setErrors(e);
        return !e.name && !e.content;
      }}
      onSubmit={async () => {
        const d = await commands.ssmCreateDocument(region, name, content, type, format, target.trim() || null, tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })));
        return documentHref(d.name || name);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Document details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Name" errorText={errors.name} constraintText="3 to 128 characters. Cannot start with aws or amazon.">
              <Input value={name} onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <ColumnLayout columns={2}>
              <FormField label="Document type">
                <Select selectedOption={DOCUMENT_TYPES.find((o) => o.value === type) ?? DOCUMENT_TYPES[0]} options={DOCUMENT_TYPES} onChange={({ detail }) => setType(detail.selectedOption.value!)} />
              </FormField>
              <FormField label="Content format">
                <Select selectedOption={DOCUMENT_FORMATS.find((o) => o.value === format) ?? DOCUMENT_FORMATS[0]} options={DOCUMENT_FORMATS} onChange={({ detail }) => setFormat(detail.selectedOption.value!)} />
              </FormField>
            </ColumnLayout>
            <FormField label="Target type - optional" description="The resource types the document can run on.">
              <Input value={target} placeholder="/AWS::EC2::Instance" onChange={({ detail }) => setTarget(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Content</Header>}>
          <FormField label="Document content" errorText={errors.content} stretch>
            <MonospaceText value={content} rows={18} onChange={setContent} />
          </FormField>
        </Container>
        <Container header={<Header variant="h2" description="A tag is a metadata label that you can assign to a document.">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

function DocumentDetails({ name }: { name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const gates = useGates(["ssm:GetDocument", "ssm:ListTagsForResource"]);
  const doc = useLoad(() => commands.ssmDescribeDocument(region, name), [name]);
  const content = useLoad(() => commands.ssmGetDocument(region, name, null), [name], gates["ssm:GetDocument"].enabled);
  const tags = useLoad(() => commands.ssmListTags(region, "Document", name), [name], gates["ssm:ListTagsForResource"].enabled);
  const [action, setAction] = useState<"update" | "default" | null>(null);
  const [text, setText] = useState("");
  const [version, setVersion] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const d = doc.data;
  const shownTags = tags.data ?? d?.tags ?? null;
  const shownContent = content.data ? (content.data.document_format === "JSON" ? prettyJson(content.data.content) : content.data.content) : "";

  const openUpdate = async () => {
    let ok = true;
    if (gates["ssm:GetDocument"].enabled) {
      ok = await run(async () => {
        setText((await commands.ssmGetDocument(region, name, "$LATEST")).content);
      });
    } else setText("");
    if (ok) setAction("update");
  };

  return (
    <SpaceBetween size="m">
      <LoadError error={doc.error} onRetry={doc.reload} />
      <DetailsPage
        title={name}
        help={SSM_HELP}
        layout="tabs"
        actions={
          <GatedDropdown
            items={[
              { id: "update", text: "Update", op: "ssm:UpdateDocument" },
              { id: "default", text: "Set default version", op: "ssm:UpdateDocumentDefaultVersion" },
              { id: "delete", text: "Delete", op: "ssm:DeleteDocument" },
            ]}
            onItemClick={(id) => {
              if (id === "update") void openUpdate();
              else if (id === "default") {
                setVersion(d?.latest_version ?? "");
                setAction("default");
              } else setDeleting(true);
            }}
          />
        }
        overview={{
          title: "Details",
          columns: 3,
          items: [
            { label: "Name", value: name },
            { label: "Document type", value: dash(d?.document_type) },
            { label: "Document format", value: dash(d?.document_format) },
            { label: "Status", value: <Status status={d?.status} /> },
            { label: "Owner", value: dash(d?.owner) },
            { label: "Created", value: formatDate(d?.created) },
            { label: "Document version", value: dash(d?.document_version) },
            { label: "Default version", value: dash(d?.default_version) },
            { label: "Latest version", value: dash(d?.latest_version) },
            { label: "Platform types", value: d?.platform_types.length ? d.platform_types.join(", ") : "-" },
            { label: "Target type", value: dash(d?.target_type) },
            { label: "Description", value: dash(d?.description) },
          ],
        }}
        sections={[
          {
            id: "content",
            label: "Content",
            content: (
              <Container header={<Header variant="h2" description="The default version of the document.">Content</Header>}>
                <SpaceBetween size="s">
                  <LoadError error={content.error} onRetry={content.reload} />
                  {gates["ssm:GetDocument"].enabled ? <MonospaceText value={shownContent} rows={20} readOnly /> : <Box color="text-status-inactive">Content: {gates["ssm:GetDocument"].reason}.</Box>}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            id: "tags",
            label: "Tags",
            content: (
              <>
                <LoadError error={tags.error} />
                <TagsTable tags={shownTags} loading={tags.loading} op="ssm:AddTagsToResource" onEdit={() => setEditTags(true)} />
              </>
            ),
          },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="document"
        names={[name]}
        op="ssm:DeleteDocument"
        confirmation="typed"
        warning="Deleting the document deletes all of its versions."
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.ssmDeleteDocument(region, name);
          navigate(ssmHref("/documents"));
        }}
      />
      <FormModal
        visible={action === "update"}
        size="large"
        header={`Update ${name}`}
        op="ssm:UpdateDocument"
        submitLabel="Create new version"
        canSubmit={d?.document_format === "JSON" ? !jsonError(text, false) : text.trim() !== ""}
        onDismiss={() => setAction(null)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmUpdateDocument(region, name, text, d?.document_format ?? null);
            doc.reload();
            content.reload();
          }, "New document version created")
        }
      >
        <FormField label="Document content" description="Saving creates a new version of the document." stretch>
          <MonospaceText value={text} rows={18} onChange={setText} />
        </FormField>
      </FormModal>
      <FormModal
        visible={action === "default"}
        header="Set default version"
        op="ssm:UpdateDocumentDefaultVersion"
        canSubmit={/^\d+$/.test(version.trim())}
        onDismiss={() => setAction(null)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmSetDefaultDocumentVersion(region, name, version.trim());
            doc.reload();
            content.reload();
          }, "Default version changed")
        }
      >
        <FormField label="Document version" description={`The default version is ${dash(d?.default_version)}; the latest is ${dash(d?.latest_version)}.`}>
          <Input value={version} inputMode="numeric" onChange={({ detail }) => setVersion(detail.value)} />
        </FormField>
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={shownTags ?? []}
        op="ssm:AddTagsToResource"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = shownTags ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.ssmUpdateTags(region, "Document", name, set, remove);
            tags.reload();
            doc.reload();
          }, "Document tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Resource Data Sync ------------------------------------------------------------------------------

const DATA_SYNCS: AreaConfig<SsmDataSync_Serialize> = {
  title: "Resource data syncs",
  resourceName: "Resource data sync",
  columns: [
    { id: "name", header: "Name", cell: (s) => s.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "type", header: "Type", cell: (s) => dash(s.sync_type), sortingField: "sync_type" },
    { id: "bucket", header: "S3 bucket", cell: (s) => dash(s.s3_bucket), sortingField: "s3_bucket" },
    { id: "prefix", header: "Prefix", cell: (s) => dash(s.s3_prefix), sortingField: "s3_prefix" },
    { id: "region", header: "Region", cell: (s) => dash(s.s3_region), sortingField: "s3_region" },
    { id: "status", header: "Last status", cell: (s) => <Status status={s.last_status} />, sortingField: "last_status" },
    { id: "last", header: "Last sync", cell: (s) => formatDate(s.last_sync_time), sortingField: "last_sync_time" },
  ],
  filteringProperties: [textProperty("name", "Name"), textProperty("s3_bucket", "S3 bucket"), textProperty("last_status", "Last status", "enum")],
  trackBy: "name",
  preferencesKey: "ssm.resource-data-sync",
  loader: (region) => commands.ssmListResourceDataSyncs(region),
  create: { op: "ssm:CreateResourceDataSync", label: "Create resource data sync", href: ssmHref("/resource-data-sync/create") },
  remove: { op: "ssm:DeleteResourceDataSync", kind: "resource data sync", name: (s) => s.name, run: (region, s) => commands.ssmDeleteResourceDataSync(region, s.name) },
};

const BUCKET_REGIONS = REGIONS.map((r) => ({ value: r.code, label: `${r.name} ${r.code}` }));
const SYNC_FORMATS = opts(["JsonSerDe"]);

function CreateDataSync() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [bucketRegion, setBucketRegion] = useState(region || DEFAULT_REGION);
  const [format, setFormat] = useState("JsonSerDe");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <CreateForm
      title="Create resource data sync"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create resource data sync"
      op="ssm:CreateResourceDataSync"
      dirty={name !== "" || bucket !== "" || prefix !== ""}
      cancelHref={ssmHref("/resource-data-sync")}
      validate={() => {
        const e = { name: /^[a-zA-Z0-9_\-.]{1,64}$/.test(name) ? undefined : "Use 1 to 64 letters, numbers, periods (.), hyphens (-) and underscores (_).", bucket: bucket.trim() ? undefined : "Enter the name of an S3 bucket." };
        setErrors(e);
        return !e.name && !e.bucket;
      }}
      onSubmit={async () => {
        await commands.ssmCreateResourceDataSync(region, name, bucket.trim(), prefix.trim() || null, bucketRegion, format);
        return ssmHref("/resource-data-sync");
      }}
    >
      <Container header={<Header variant="h2">Sync details</Header>}>
        <SpaceBetween size="l">
          <FormField label="Sync name" errorText={errors.name}>
            <Input value={name} onChange={({ detail }) => setName(detail.value)} />
          </FormField>
          <FormField label="Bucket name" errorText={errors.bucket} description="The S3 bucket that receives the inventory data.">
            <Input value={bucket} onChange={({ detail }) => setBucket(detail.value)} />
          </FormField>
          <FormField label="Bucket prefix - optional">
            <Input value={prefix} onChange={({ detail }) => setPrefix(detail.value)} />
          </FormField>
          <FormField label="Bucket Region">
            <Select selectedOption={BUCKET_REGIONS.find((o) => o.value === bucketRegion) ?? null} options={BUCKET_REGIONS} filteringType="auto" onChange={({ detail }) => setBucketRegion(detail.selectedOption.value!)} />
          </FormField>
          <FormField label="Sync format">
            <Select selectedOption={SYNC_FORMATS.find((o) => o.value === format) ?? SYNC_FORMATS[0]} options={SYNC_FORMATS} onChange={({ detail }) => setFormat(detail.selectedOption.value!)} />
          </FormField>
        </SpaceBetween>
      </Container>
    </CreateForm>
  );
}

// Routes ------------------------------------------------------------------------------------------

function MissingParameter({ text }: { text: string }) {
  return (
    <Alert type="error" header="Resource not specified">
      {text}
    </Alert>
  );
}

/** The scoped list of an area: the primary read decides between a full, partial and UI-only page. */
function scoped<T>(primaryOp: string, config: AreaConfig<T>, above?: ReactNode) {
  return (
    <SpaceBetween size="m">
      {above}
      <UiOnlyScope primaryOp={primaryOp}>
        <AreaList<T> config={config} />
      </UiOnlyScope>
    </SpaceBetween>
  );
}

/** The Systems Manager page for a route path of the areas of this module, or null otherwise. */
export function ssmAreaPages(path: string, query: URLSearchParams): ReactNode | null {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (!p.startsWith(`${SSM_ROOT}/`)) return null;
  const rel = p.slice(SSM_ROOT.length);
  const automation = crumb("Automation", "/automation");
  const activations = crumb("Hybrid Activations", "/activations");
  const runCommand = crumb("Run Command", "/run-command");
  const stateManager = crumb("State Manager", "/state-manager");
  const patchManager = crumb("Patch Manager", "/patch-manager");
  const documents = crumb("Documents", "/documents");
  const syncs = crumb("Resource Data Sync", "/resource-data-sync");
  switch (rel) {
    case "/automation":
      return ssmPage([automation], scoped("ssm:DescribeAutomationExecutions", AUTOMATION), "table");
    case "/automation/execute":
      return ssmPage([automation, crumb("Execute automation", "/automation/execute")], <ExecuteAutomation />, "form");
    case "/automation/detail": {
      const id = query.get("id");
      return ssmPage(
        [automation, crumb(id ?? "Execution", "/automation/detail", { id: id ?? undefined })],
        id ? (
          <UiOnlyScope primaryOp="ssm:DescribeAutomationExecutions">
            <ExecutionDetails key={id} id={id} />
          </UiOnlyScope>
        ) : (
          <MissingParameter text="Open an execution from the Automation list." />
        ),
      );
    }
    case "/maintenance-windows":
      return ssmPage([crumb("Maintenance Windows", "/maintenance-windows")], scoped("ssm:DescribeMaintenanceWindows", MAINTENANCE), "table");
    case "/fleet-manager":
      return ssmPage([crumb("Fleet Manager", "/fleet-manager")], scoped("ssm:DescribeInstanceInformation", FLEET), "table");
    case "/compliance":
      return ssmPage([crumb("Compliance", "/compliance")], scoped("ssm:ListComplianceSummaries", COMPLIANCE), "table");
    case "/inventory":
      return ssmPage([crumb("Inventory", "/inventory")], scoped("ssm:GetInventory", INVENTORY), "table");
    case "/activations":
      return ssmPage([activations], scoped("ssm:DescribeActivations", ACTIVATIONS), "table");
    case "/activations/create":
      return ssmPage([activations, crumb("Create activation", "/activations/create")], <CreateActivation />, "form");
    case "/session-manager":
      return ssmPage([crumb("Session Manager", "/session-manager")], scoped("ssm:DescribeSessions", SESSIONS), "table");
    case "/run-command":
      return ssmPage([runCommand], scoped("ssm:ListCommands", COMMANDS), "table");
    case "/run-command/run":
      return ssmPage([runCommand, crumb("Run command", "/run-command/run")], <RunCommand />, "form");
    case "/state-manager":
      return ssmPage([stateManager], scoped("ssm:ListAssociations", ASSOCIATIONS), "table");
    case "/state-manager/create":
      return ssmPage([stateManager, crumb("Create association", "/state-manager/create")], <CreateAssociation />, "form");
    case "/patch-manager":
      return ssmPage([patchManager], scoped("ssm:DescribePatchBaselines", BASELINES, <DefaultBaseline />), "table");
    case "/patch-manager/create-baseline":
      return ssmPage([patchManager, crumb("Create patch baseline", "/patch-manager/create-baseline")], <CreatePatchBaseline />, "form");
    case "/documents":
      return ssmPage([documents], scoped("ssm:ListDocuments", DOCUMENTS, <OpenDocument />), "table");
    case "/documents/create":
      return ssmPage([documents, crumb("Create document", "/documents/create")], <CreateDocument />, "form");
    case "/documents/detail": {
      const name = query.get("name");
      return ssmPage(
        [documents, crumb(name ?? "Document", "/documents/detail", { name: name ?? undefined })],
        name ? (
          <UiOnlyScope primaryOp="ssm:DescribeDocument">
            <DocumentDetails key={name} name={name} />
          </UiOnlyScope>
        ) : (
          <MissingParameter text="Open a document from the Documents page." />
        ),
      );
    }
    case "/resource-data-sync":
      return ssmPage([syncs], scoped("ssm:ListResourceDataSync", DATA_SYNCS), "table");
    case "/resource-data-sync/create":
      return ssmPage([syncs, crumb("Create resource data sync", "/resource-data-sync/create")], <CreateDataSync />, "form");
    default:
      return null;
  }
}
