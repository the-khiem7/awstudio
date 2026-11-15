// Amazon DynamoDB console pages: dashboard, tables, create table, table details, Explore items,
// the JSON item editor, the PartiQL editor and backups. Items are edited in DynamoDB JSON
// (`{"name": {"S": "x"}}`), so a number is never guessed from a string.

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
import RadioGroup from "@cloudscape-design/components/radio-group";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { useMemo, useState, type ReactNode } from "react";
import { commands, type DdbBackup_Serialize, type DdbIndex_Serialize, type DdbTable_Serialize, type KeyAttribute } from "../../bindings";
import { useReportUnsupported } from "../../capability";
import {
  CreateForm,
  dateTimeProperty,
  DeleteModal,
  DetailsPage,
  GatedButton,
  ResourceCounts,
  ResourceTable,
  ServiceDashboard,
  textProperty,
  UiOnlyScope,
  UnsupportedBanner,
  useUiOnly,
  type ResourceTableColumn,
} from "../../patterns";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, matchPath, navigate } from "../../shell/router";
import { formatBytes, formatDate, FormModal, JsonEditor, jsonError, LoadError, TagsTable, useAction, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "DynamoDB", href: href("/dynamodbv2/dashboard") },
  items: [
    { type: "link" as const, text: "Dashboard", href: href("/dynamodbv2/dashboard") },
    { type: "link" as const, text: "Tables", href: href("/dynamodbv2/tables") },
    { type: "link" as const, text: "Explore items", href: href("/dynamodbv2/item-explorer") },
    { type: "link" as const, text: "PartiQL editor", href: href("/dynamodbv2/partiql-editor") },
    { type: "link" as const, text: "Backups", href: href("/dynamodbv2/backups") },
  ],
};

const HELP: HelpContent = {
  header: "Amazon DynamoDB",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Tables and items of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">Items are shown and edited in DynamoDB JSON, where each value names its type, for example {'{"price": {"N": "9.5"}}'}.</Box>
    </SpaceBetween>
  ),
};

const tableHref = (name: string, tab?: string) => href(`/dynamodbv2/tables/${encodeURIComponent(name)}`, { tab });
const explorerHref = (table?: string) => href("/dynamodbv2/item-explorer", { table });
const itemHref = (table: string, key?: unknown) => href(key ? "/dynamodbv2/edit-item" : "/dynamodbv2/create-item", { table, key: key ? JSON.stringify(key) : undefined });

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "DynamoDB", href: href("/dynamodbv2/dashboard") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

const keyText = (k: KeyAttribute | null | undefined) => (k ? `${k.name} (${k.kind === "S" ? "String" : k.kind === "N" ? "Number" : "Binary"})` : "-");
const capacityMode = (t: DdbTable_Serialize) => (t.billing_mode === "PROVISIONED" ? "Provisioned" : "On-demand");

function TableStatus({ status }: { status: string | null }) {
  const type = status === "ACTIVE" ? "success" : status === "DELETING" ? "pending" : status ? "in-progress" : "stopped";
  return <StatusIndicator type={type}>{status ? status.charAt(0) + status.slice(1).toLowerCase() : "-"}</StatusIndicator>;
}

type Item = Record<string, Record<string, unknown>>;

/** One DynamoDB JSON value as the console's item table shows it. */
function plain(value: Record<string, unknown> | undefined): unknown {
  if (!value) return undefined;
  const [type, v] = Object.entries(value)[0] ?? [];
  switch (type) {
    case "S":
    case "B":
      return v;
    case "N":
      return Number(v);
    case "BOOL":
      return v;
    case "NULL":
      return null;
    case "L":
      return (v as Record<string, unknown>[]).map(plain);
    case "M":
      return Object.fromEntries(Object.entries(v as Item).map(([k, x]) => [k, plain(x)]));
    default:
      return v;
  }
}

function cellText(value: Record<string, unknown> | undefined): string {
  if (!value) return "";
  const p = plain(value);
  return typeof p === "string" ? p : JSON.stringify(p);
}

function keyOf(item: Item, table: DdbTable_Serialize): Item {
  const key: Item = {};
  for (const k of [table.partition_key, table.sort_key]) if (k && item[k.name]) key[k.name] = item[k.name];
  return key;
}

// Dashboard ---------------------------------------------------------------------------------------

function Dashboard() {
  const region = useRegion();
  const tables = useLoad(() => commands.ddbListTables(region), []);
  const backups = useLoad(() => commands.ddbListBackups(region, null), []);
  return (
    <ServiceDashboard
      title="Dashboard"
      help={HELP}
      actions={
        <GatedButton variant="primary" op="dynamodb:CreateTable" href={href("/dynamodbv2/create-table")}>
          Create table
        </GatedButton>
      }
      widgets={[
        {
          id: "resources",
          title: "Resources",
          span: 8,
          content: (
            <SpaceBetween size="m">
              <LoadError error={tables.error ?? backups.error} />
              <ResourceCounts
                items={[
                  { label: "Tables", count: tables.data?.length ?? null, href: href("/dynamodbv2/tables") },
                  { label: "Backups", count: backups.data?.length ?? null, href: href("/dynamodbv2/backups") },
                  { label: "Items", count: tables.data ? tables.data.reduce((n, t) => n + (t.item_count ?? 0), 0) : null, href: href("/dynamodbv2/tables") },
                ]}
              />
            </SpaceBetween>
          ),
        },
        {
          id: "create",
          title: "Create resources",
          span: 4,
          content: (
            <SpaceBetween size="s">
              <Box variant="p">Create a table to store items. Each item needs the table's partition key, and its sort key when the table has one.</Box>
              <GatedButton op="dynamodb:CreateTable" href={href("/dynamodbv2/create-table")}>
                Create table
              </GatedButton>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Tables ------------------------------------------------------------------------------------------

type TableRow = DdbTable_Serialize & { pk: string; sk: string; indexes: number; mode: string; items: number; size: number };

const TABLE_COLUMNS: ResourceTableColumn<TableRow>[] = [
  { id: "name", header: "Name", cell: (t) => <Link href={tableHref(t.name)}>{t.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "status", header: "Status", cell: (t) => <TableStatus status={t.status} />, sortingField: "status" },
  { id: "pk", header: "Partition key", cell: (t) => t.pk, sortingField: "pk" },
  { id: "sk", header: "Sort key", cell: (t) => t.sk, sortingField: "sk" },
  { id: "indexes", header: "Indexes", cell: (t) => t.indexes, sortingField: "indexes" },
  { id: "mode", header: "Read/write capacity mode", cell: (t) => t.mode, sortingField: "mode" },
  { id: "items", header: "Item count", cell: (t) => t.items, sortingField: "items", hidden: true },
  { id: "size", header: "Size", cell: (t) => formatBytes(t.size), sortingField: "size" },
  { id: "protection", header: "Deletion protection", cell: (t) => (t.deletion_protection ? "On" : "Off") },
];

function TablesList() {
  const region = useRegion();
  const tables = useLoad(() => commands.ddbListTables(region), []);
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows: TableRow[] = (tables.data ?? []).map((t) => ({
    ...t,
    pk: keyText(t.partition_key),
    sk: keyText(t.sort_key),
    indexes: t.global_indexes.length + t.local_indexes.length,
    mode: capacityMode(t),
    items: t.item_count ?? 0,
    size: t.size_bytes ?? 0,
  }));
  return (
    <SpaceBetween size="m">
      <LoadError error={tables.error} onRetry={tables.reload} />
      <ResourceTable<TableRow>
        resourceName="Table"
        title="Tables"
        help={HELP}
        items={rows}
        loading={tables.loading}
        columns={TABLE_COLUMNS}
        filteringProperties={[textProperty("name", "Name"), textProperty("status", "Status", "enum"), textProperty("mode", "Capacity mode", "enum")]}
        trackBy="name"
        preferencesKey="dynamodb.tables"
        selectionType="single"
        onRefresh={tables.reload}
        emptyAction={
          <GatedButton op="dynamodb:CreateTable" href={href("/dynamodbv2/create-table")}>
            Create table
          </GatedButton>
        }
        actions={(selected) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button disabled={selected.length !== 1} href={selected[0] ? explorerHref(selected[0].name) : undefined}>
              Explore table items
            </Button>
            <GatedButton op="dynamodb:DeleteTable" disabled={selected.length !== 1 || selected[0]?.deletion_protection} onClick={() => setDeleting(selected[0].name)}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="dynamodb:CreateTable" href={href("/dynamodbv2/create-table")}>
              Create table
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="table"
        names={deleting ? [deleting] : []}
        op="dynamodb:DeleteTable"
        confirmation="typed"
        warning="Deleting the table deletes all of its items and indexes."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.ddbDeleteTable(region, deleting!);
          tables.reload();
        }}
      />
    </SpaceBetween>
  );
}

// Create table ------------------------------------------------------------------------------------

const KEY_TYPES = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
];

function KeyField({ label, description, value, onChange, error, optional }: { label: string; description: string; value: KeyAttribute; onChange: (k: KeyAttribute) => void; error?: string; optional?: boolean }) {
  return (
    <FormField label={optional ? <span>{label} - <i>optional</i></span> : label} description={description} errorText={error} constraintText="1 to 255 characters and case sensitive.">
      <Grid gridDefinition={[{ colspan: 8 }, { colspan: 4 }]}>
        <Input value={value.name} placeholder="Enter the name" onChange={({ detail }) => onChange({ ...value, name: detail.value })} />
        <Select selectedOption={KEY_TYPES.find((t) => t.value === value.kind) ?? KEY_TYPES[0]} options={KEY_TYPES} onChange={({ detail }) => onChange({ ...value, kind: detail.selectedOption.value! })} />
      </Grid>
    </FormField>
  );
}

interface IndexDraft {
  name: string;
  pk: string;
  pkKind: string;
  sk: string;
  skKind: string;
  projection: string;
}

function CreateTable() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [pk, setPk] = useState<KeyAttribute>({ name: "", kind: "S" });
  const [sk, setSk] = useState<KeyAttribute>({ name: "", kind: "S" });
  const [settings, setSettings] = useState("default");
  const [mode, setMode] = useState("PAY_PER_REQUEST");
  const [rcu, setRcu] = useState("5");
  const [wcu, setWcu] = useState("5");
  const [indexes, setIndexes] = useState<IndexDraft[]>([]);
  const [protection, setProtection] = useState(false);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const custom = settings === "custom";

  const validate = () => {
    const e: Record<string, string | undefined> = {};
    if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(name)) e.name = "Table name must be 3 to 255 characters: letters, numbers, underscores (_), hyphens (-) and periods (.).";
    if (!pk.name || pk.name.length > 255) e.pk = "Enter the partition key.";
    indexes.forEach((i, n) => {
      if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(i.name) || !i.pk) e[`index${n}`] = "Each index needs a name of 3 to 255 characters and a partition key.";
    });
    setErrors(e);
    return Object.values(e).every((x) => !x);
  };

  return (
    <CreateForm
      title="Create table"
      help={HELP}
      mode="create"
      submitLabel="Create table"
      op="dynamodb:CreateTable"
      dirty={name !== "" || pk.name !== ""}
      cancelHref={href("/dynamodbv2/tables")}
      doneHref={tableHref(name)}
      validate={validate}
      onSubmit={async () => {
        await commands.ddbCreateTable(region, {
          name,
          partition_key: pk,
          sort_key: sk.name ? sk : null,
          billing_mode: custom ? mode : "PAY_PER_REQUEST",
          read_capacity: parseInt(rcu, 10) || 1,
          write_capacity: parseInt(wcu, 10) || 1,
          global_indexes: custom
            ? indexes.map((i) => ({ name: i.name, partition_key: { name: i.pk, kind: i.pkKind }, sort_key: i.sk ? { name: i.sk, kind: i.skKind } : null, projection: i.projection }))
            : [],
          deletion_protection: custom && protection,
          tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })),
        });
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Table details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Table name" description="This will be used to identify your table." errorText={errors.name} constraintText="Between 3 and 255 characters, containing only letters, numbers, underscores (_), hyphens (-), and periods (.).">
              <Input value={name} placeholder="Enter a name for your table" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <KeyField label="Partition key" description="The partition key is part of the table's primary key. It is a hash value that is used to retrieve items from your table." value={pk} onChange={setPk} error={errors.pk} />
            <KeyField label="Sort key" optional description="You can use a sort key as the second part of a table's primary key." value={sk} onChange={setSk} />
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Table settings</Header>}>
          <RadioGroup
            value={settings}
            onChange={({ detail }) => setSettings(detail.value)}
            items={[
              { value: "default", label: "Default settings", description: "The fastest way to create your table: on-demand capacity, no secondary indexes and deletion protection off." },
              { value: "custom", label: "Customize settings", description: "Choose the capacity mode, secondary indexes and deletion protection." },
            ]}
          />
        </Container>
        {custom && (
          <>
            <Container header={<Header variant="h2">Read/write capacity settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Capacity mode">
                  <RadioGroup
                    value={mode}
                    onChange={({ detail }) => setMode(detail.value)}
                    items={[
                      { value: "PAY_PER_REQUEST", label: "On-demand", description: "Simplify billing by paying for the actual reads and writes your application performs." },
                      { value: "PROVISIONED", label: "Provisioned", description: "Manage and optimize the read and write capacity of the table." },
                    ]}
                  />
                </FormField>
                {mode === "PROVISIONED" && (
                  <ColumnLayout columns={2}>
                    <FormField label="Read capacity units">
                      <Input type="number" value={rcu} onChange={({ detail }) => setRcu(detail.value)} />
                    </FormField>
                    <FormField label="Write capacity units">
                      <Input type="number" value={wcu} onChange={({ detail }) => setWcu(detail.value)} />
                    </FormField>
                  </ColumnLayout>
                )}
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2" description="Global secondary indexes allow you to query on alternate keys.">Secondary indexes</Header>}>
              <AttributeEditor<IndexDraft>
                items={indexes}
                addButtonText="Create global index"
                removeButtonText="Remove"
                empty="No global secondary indexes."
                onAddButtonClick={() => setIndexes([...indexes, { name: "", pk: "", pkKind: "S", sk: "", skKind: "S", projection: "ALL" }])}
                onRemoveButtonClick={({ detail }) => setIndexes(indexes.filter((_, i) => i !== detail.itemIndex))}
                definition={[
                  { label: "Index name", control: (i, n) => <Input value={i.name} onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, name: detail.value } : x)))} />, errorText: (_, n) => errors[`index${n}`] },
                  { label: "Partition key", control: (i, n) => <Input value={i.pk} onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, pk: detail.value } : x)))} /> },
                  { label: "Type", control: (i, n) => <Select selectedOption={KEY_TYPES.find((t) => t.value === i.pkKind)!} options={KEY_TYPES} onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, pkKind: detail.selectedOption.value! } : x)))} /> },
                  { label: "Sort key - optional", control: (i, n) => <Input value={i.sk} onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, sk: detail.value } : x)))} /> },
                  { label: "Type", control: (i, n) => <Select selectedOption={KEY_TYPES.find((t) => t.value === i.skKind)!} options={KEY_TYPES} onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, skKind: detail.selectedOption.value! } : x)))} /> },
                  {
                    label: "Projected attributes",
                    control: (i, n) => (
                      <Select
                        selectedOption={{ value: i.projection, label: i.projection === "ALL" ? "All" : "Only keys" }}
                        options={[{ value: "ALL", label: "All" }, { value: "KEYS_ONLY", label: "Only keys" }]}
                        onChange={({ detail }) => setIndexes(indexes.map((x, j) => (j === n ? { ...x, projection: detail.selectedOption.value! } : x)))}
                      />
                    ),
                  },
                ]}
              />
            </Container>
            <Container header={<Header variant="h2">Deletion protection</Header>}>
              <Toggle checked={protection} onChange={({ detail }) => setProtection(detail.checked)} description="Protects the table from being deleted unintentionally.">
                Turn on deletion protection
              </Toggle>
            </Container>
          </>
        )}
        <Container header={<Header variant="h2" description="Tags are pairs of keys and optional values that you can assign to AWS resources.">Tags</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Table details -----------------------------------------------------------------------------------

function IndexTable({ title, items }: { title: string; items: DdbIndex_Serialize[] }) {
  return (
    <Table
      variant="container"
      items={items}
      trackBy="name"
      columnDefinitions={[
        { id: "name", header: "Name", cell: (i) => i.name, isRowHeader: true },
        { id: "status", header: "Status", cell: (i) => <TableStatus status={i.status ?? "ACTIVE"} /> },
        { id: "pk", header: "Partition key", cell: (i) => keyText(i.partition_key) },
        { id: "sk", header: "Sort key", cell: (i) => keyText(i.sort_key) },
        { id: "projection", header: "Projected attributes", cell: (i) => (i.projection === "ALL" ? "All" : i.projection === "KEYS_ONLY" ? "Keys only" : (i.projection ?? "-")) },
        { id: "size", header: "Size", cell: (i) => formatBytes(i.size_bytes) },
        { id: "items", header: "Item count", cell: (i) => i.item_count ?? 0 },
      ]}
      empty={<Box textAlign="center" color="inherit">No indexes.</Box>}
      header={<Header variant="h2" counter={`(${items.length})`}>{title}</Header>}
    />
  );
}

function BackupsTable({ table, title = "Backups" }: { table: string | null; title?: string }) {
  const region = useRegion();
  const { run } = useAction();
  const backups = useLoad(() => commands.ddbListBackups(region, table), [table]);
  const [creating, setCreating] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [restoring, setRestoring] = useState<DdbBackup_Serialize | null>(null);
  const [target, setTarget] = useState("");
  const [deleting, setDeleting] = useState<DdbBackup_Serialize | null>(null);
  const columns: ResourceTableColumn<DdbBackup_Serialize & { createdAt: Date | null }>[] = [
    { id: "name", header: "Backup name", cell: (b) => b.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "table", header: "Table name", cell: (b) => <Link href={tableHref(b.table)}>{b.table}</Link>, sortingField: "table" },
    { id: "status", header: "Status", cell: (b) => <StatusIndicator type={b.status === "AVAILABLE" ? "success" : "in-progress"}>{b.status ?? "-"}</StatusIndicator>, sortingField: "status" },
    { id: "created", header: "Creation time", cell: (b) => formatDate(b.created), sortingField: "createdAt" },
    { id: "size", header: "Size", cell: (b) => formatBytes(b.size_bytes) },
    { id: "kind", header: "Backup type", cell: (b) => b.kind ?? "-" },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={backups.error} onRetry={backups.reload} />
      <ResourceTable
        resourceName="Backup"
        title={title}
        variant={table ? "container" : "full-page"}
        items={(backups.data ?? []).map((b) => ({ ...b, createdAt: b.created ? new Date(b.created) : null }))}
        loading={backups.loading}
        columns={columns}
        filteringProperties={[textProperty("name", "Backup name"), textProperty("table", "Table name"), dateTimeProperty("createdAt", "Creation time")]}
        trackBy="arn"
        preferencesKey="dynamodb.backups"
        selectionType="single"
        onRefresh={backups.reload}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="dynamodb:DeleteBackup" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton op="dynamodb:RestoreTableFromBackup" disabled={sel.length !== 1} onClick={() => { setTarget(`${sel[0].table}-restored`); setRestoring(sel[0]); }}>
              Restore
            </GatedButton>
            {table && (
              <GatedButton variant="primary" op="dynamodb:CreateBackup" onClick={() => { setBackupName(`${table}-${new Date().toISOString().slice(0, 10)}`); setCreating(true); }}>
                Create backup
              </GatedButton>
            )}
          </SpaceBetween>
        )}
      />
      <FormModal visible={creating} header="Create on-demand backup" op="dynamodb:CreateBackup" submitLabel="Create backup" canSubmit={/^[a-zA-Z0-9_.-]{3,255}$/.test(backupName)} onDismiss={() => setCreating(false)} onSubmit={() => run(async () => { await commands.ddbCreateBackup(region, table!, backupName); backups.reload(); }, `Backup ${backupName} created`)}>
        <FormField label="Backup name" constraintText="3 to 255 letters, numbers, underscores, hyphens and periods.">
          <Input value={backupName} onChange={({ detail }) => setBackupName(detail.value)} />
        </FormField>
      </FormModal>
      <FormModal visible={restoring !== null} header={`Restore ${restoring?.name ?? ""}`} op="dynamodb:RestoreTableFromBackup" submitLabel="Restore" canSubmit={/^[a-zA-Z0-9_.-]{3,255}$/.test(target)} onDismiss={() => setRestoring(null)} onSubmit={() => run(async () => { await commands.ddbRestoreBackup(region, restoring!.arn, target); backups.reload(); }, `Restoring table ${target}`)}>
        <FormField label="Name of restored table" description="The backup is restored into a new table.">
          <Input value={target} onChange={({ detail }) => setTarget(detail.value)} />
        </FormField>
      </FormModal>
      <DeleteModal visible={deleting !== null} resourceKind="backup" names={deleting ? [deleting.name] : []} op="dynamodb:DeleteBackup" confirmation="simple" onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.ddbDeleteBackup(region, deleting!.arn); backups.reload(); }} />
    </SpaceBetween>
  );
}

function SettingsTab({ table }: { table: DdbTable_Serialize }) {
  const region = useRegion();
  const { run } = useAction();
  const ttl = useLoad(() => commands.ddbDescribeTtl(region, table.name), [table.name]);
  const tags = useLoad(() => (table.arn ? commands.ddbListTags(region, table.arn) : Promise.resolve([])), [table.arn]);
  const [editTtl, setEditTtl] = useState(false);
  const [ttlOn, setTtlOn] = useState(true);
  const [ttlAttr, setTtlAttr] = useState("");
  const enabled = ttl.data?.status === "ENABLED" || ttl.data?.status === "ENABLING";
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Read/write capacity</Header>}>
        <KeyValuePairs
          columns={3}
          items={[
            { label: "Capacity mode", value: capacityMode(table) },
            { label: "Read capacity", value: table.billing_mode === "PROVISIONED" ? `${table.read_capacity ?? 0} RCU` : "On-demand" },
            { label: "Write capacity", value: table.billing_mode === "PROVISIONED" ? `${table.write_capacity ?? 0} WCU` : "On-demand" },
          ]}
        />
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="Automatically delete expired items from your table."
            actions={
              <GatedButton op="dynamodb:UpdateTimeToLive" onClick={() => { setTtlOn(!enabled); setTtlAttr(ttl.data?.attribute ?? "ttl"); setEditTtl(true); }}>
                {enabled ? "Turn off" : "Turn on"}
              </GatedButton>
            }
          >
            Time to Live (TTL)
          </Header>
        }
      >
        <LoadError error={ttl.error} />
        <KeyValuePairs columns={2} items={[{ label: "TTL status", value: ttl.data ? <StatusIndicator type={enabled ? "success" : "stopped"}>{ttl.data.status}</StatusIndicator> : "-" }, { label: "TTL attribute", value: ttl.data?.attribute ?? "-" }]} />
      </Container>
      <Container header={<Header variant="h2">Deletion protection</Header>}>
        <KeyValuePairs items={[{ label: "Deletion protection", value: <StatusIndicator type={table.deletion_protection ? "success" : "stopped"}>{table.deletion_protection ? "On" : "Off"}</StatusIndicator> }]} />
      </Container>
      <LoadError error={tags.error} />
      {/* Tag writes are not implemented by the backend; the button is disabled by the tier of TagResource. */}
      <TagsTable tags={tags.data} loading={tags.loading} op="dynamodb:TagResource" onEdit={() => undefined} />
      <FormModal
        visible={editTtl}
        header={ttlOn ? "Turn on Time to Live (TTL)" : "Turn off Time to Live (TTL)"}
        op="dynamodb:UpdateTimeToLive"
        submitLabel={ttlOn ? "Turn on TTL" : "Turn off TTL"}
        canSubmit={ttlAttr.trim() !== ""}
        onDismiss={() => setEditTtl(false)}
        onSubmit={() => run(async () => { await commands.ddbUpdateTtl(region, table.name, ttlOn, ttlAttr); ttl.reload(); }, `Time to Live turned ${ttlOn ? "on" : "off"}`)}
      >
        <FormField label="TTL attribute name" description="The name of the attribute that holds the expiry time, in epoch seconds.">
          <Input value={ttlAttr} disabled={!ttlOn} onChange={({ detail }) => setTtlAttr(detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

function TableDetails({ name }: { name: string }) {
  const region = useRegion();
  const table = useLoad(() => commands.ddbDescribeTable(region, name), [name]);
  const [deleting, setDeleting] = useState(false);
  const t = table.data;
  return (
    <SpaceBetween size="m">
      <LoadError error={table.error} onRetry={table.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" ariaLabel="Refresh" onClick={table.reload} />
            <GatedButton op="dynamodb:DeleteTable" disabled={!t || t.deletion_protection} onClick={() => setDeleting(true)}>
              Delete table
            </GatedButton>
            <GatedButton op="dynamodb:PutItem" href={itemHref(name)}>
              Create item
            </GatedButton>
            <Button variant="primary" href={explorerHref(name)}>
              Explore table items
            </Button>
          </SpaceBetween>
        }
        overview={{
          title: "General information",
          columns: 4,
          items: [
            { label: "Partition key", value: keyText(t?.partition_key) },
            { label: "Sort key", value: keyText(t?.sort_key) },
            { label: "Capacity mode", value: t ? capacityMode(t) : "-" },
            { label: "Table status", value: <TableStatus status={t?.status ?? null} /> },
            { label: "Item count", value: t?.item_count ?? "-" },
            { label: "Table size", value: formatBytes(t?.size_bytes) },
            { label: "Creation date", value: formatDate(t?.created) },
            { label: "Amazon Resource Name (ARN)", value: t?.arn ?? "-" },
          ],
        }}
        sections={[
          { id: "indexes", label: "Indexes", content: t ? <SpaceBetween size="l"><IndexTable title="Global secondary indexes" items={t.global_indexes} /><IndexTable title="Local secondary indexes" items={t.local_indexes} /></SpaceBetween> : null },
          { id: "backups", label: "Backups", content: <BackupsTable table={name} /> },
          { id: "settings", label: "Additional settings", content: t ? <SettingsTab table={t} /> : null },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="table"
        names={[name]}
        op="dynamodb:DeleteTable"
        confirmation="typed"
        warning="Deleting the table deletes all of its items and indexes."
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.ddbDeleteTable(region, name);
          navigate(href("/dynamodbv2/tables"));
        }}
      />
    </SpaceBetween>
  );
}

// Explore items -----------------------------------------------------------------------------------

const SORT_CONDITIONS = ["=", "<", "<=", ">", ">=", "between", "begins_with"];

function ItemExplorer({ initialTable }: { initialTable: string | null }) {
  const region = useRegion();
  const { uiOnly } = useUiOnly();
  const report = useReportUnsupported();
  const { run } = useAction();
  const tables = useLoad(() => commands.ddbListTables(region), []);
  const [tableName, setTableName] = useState(initialTable);
  const table = tables.data?.find((t) => t.name === tableName) ?? null;
  const [mode, setMode] = useState<"scan" | "query">("scan");
  const [pkValue, setPkValue] = useState("");
  const [skOp, setSkOp] = useState("=");
  const [skValue, setSkValue] = useState("");
  const [skValue2, setSkValue2] = useState("");
  const [forward, setForward] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [lastKey, setLastKey] = useState<unknown>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Item[]>([]);
  const [deleting, setDeleting] = useState(false);

  const typed = (k: KeyAttribute, v: string) => ({ [k.kind]: v });
  const execute = async (more = false) => {
    if (!table) return;
    setRunning(true);
    setError(null);
    try {
      const names: Record<string, string> = {};
      const values: Item = {};
      let condition: string | null = null;
      if (mode === "query" && table.partition_key) {
        names["#pk"] = table.partition_key.name;
        values[":pk"] = typed(table.partition_key, pkValue);
        condition = "#pk = :pk";
        if (table.sort_key && skValue) {
          names["#sk"] = table.sort_key.name;
          values[":sk"] = typed(table.sort_key, skValue);
          if (skOp === "between") {
            values[":sk2"] = typed(table.sort_key, skValue2);
            condition += " AND #sk BETWEEN :sk AND :sk2";
          } else if (skOp === "begins_with") condition += " AND begins_with(#sk, :sk)";
          else condition += ` AND #sk ${skOp} :sk`;
        }
      }
      const input = { table: table.name, index: null, key_condition: condition, filter: null, names, values, limit: 50, forward, start_key: more ? lastKey : null };
      const page = mode === "query" ? await commands.ddbQuery(region, input) : await commands.ddbScan(region, input);
      const got = page.items as Item[];
      setItems(more ? [...items, ...got] : got);
      setLastKey(page.last_key);
      setSummary(`${mode === "query" ? "Query" : "Scan"}: ${page.count} items returned, ${page.scanned_count} items scanned`);
      if (!more) setSelected([]);
    } catch (e) {
      report(e);
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const attributes = useMemo(() => {
    const keys = [table?.partition_key?.name, table?.sort_key?.name].filter(Boolean) as string[];
    const rest = new Set<string>();
    for (const i of items) for (const k of Object.keys(i)) if (!keys.includes(k)) rest.add(k);
    return [...keys, ...[...rest].sort()];
  }, [items, table]);

  return (
    <SpaceBetween size="m">
      <Header variant="h1" info={undefined} description="Scan or query the items of a table.">
        Explore items
      </Header>
      {uiOnly && <UnsupportedBanner />}
      <LoadError error={tables.error} onRetry={tables.reload} />
      <Container header={<Header variant="h2">Scan or query items</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Table">
              <Select
                disabled={uiOnly}
                placeholder="Choose a table"
                selectedOption={tableName ? { value: tableName, label: tableName } : null}
                options={(tables.data ?? []).map((t) => ({ value: t.name, label: t.name }))}
                onChange={({ detail }) => {
                  setTableName(detail.selectedOption.value ?? null);
                  setItems([]);
                  setSummary(null);
                  navigate(explorerHref(detail.selectedOption.value));
                }}
              />
            </FormField>
            <FormField label="Operation">
              <SegmentedControl selectedId={mode} onChange={({ detail }) => setMode(detail.selectedId as "scan" | "query")} options={[{ id: "scan", text: "Scan", disabled: uiOnly }, { id: "query", text: "Query", disabled: uiOnly }]} />
            </FormField>
          </ColumnLayout>
          {mode === "query" && table && (
            <ColumnLayout columns={3}>
              <FormField label={`${table.partition_key?.name ?? "Partition key"} (Partition key)`}>
                <Input value={pkValue} placeholder="Enter partition key value" onChange={({ detail }) => setPkValue(detail.value)} />
              </FormField>
              {table.sort_key && (
                <FormField label={`${table.sort_key.name} (Sort key)`}>
                  <Grid gridDefinition={[{ colspan: 4 }, { colspan: skOp === "between" ? 4 : 8 }, ...(skOp === "between" ? [{ colspan: 4 }] : [])]}>
                    <Select selectedOption={{ value: skOp, label: skOp === "begins_with" ? "Begins with" : skOp === "between" ? "Between" : skOp }} options={SORT_CONDITIONS.map((c) => ({ value: c, label: c === "begins_with" ? "Begins with" : c === "between" ? "Between" : c }))} onChange={({ detail }) => setSkOp(detail.selectedOption.value!)} />
                    <Input value={skValue} placeholder="Enter sort key value" onChange={({ detail }) => setSkValue(detail.value)} />
                    {skOp === "between" && <Input value={skValue2} placeholder="And" onChange={({ detail }) => setSkValue2(detail.value)} />}
                  </Grid>
                </FormField>
              )}
              <FormField label="Sort descending">
                <Toggle checked={!forward} onChange={({ detail }) => setForward(!detail.checked)}>
                  Sort descending
                </Toggle>
              </FormField>
            </ColumnLayout>
          )}
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton variant="primary" op={mode === "query" ? "dynamodb:Query" : "dynamodb:Scan"} loading={running} disabled={!table || (mode === "query" && !pkValue)} onClick={() => execute(false)}>
              Run
            </GatedButton>
          </SpaceBetween>
        </SpaceBetween>
      </Container>
      {error && <LoadError error={error} />}
      <Table<Item>
        variant="container"
        items={uiOnly ? [] : items}
        loading={running}
        loadingText="Loading items"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        trackBy={(i) => JSON.stringify(table ? keyOf(i, table) : i)}
        resizableColumns
        columnDefinitions={attributes.map((a, n) => ({
          id: a,
          header: a,
          isRowHeader: n === 0,
          cell: (i: Item) => (n === 0 && table ? <Link href={itemHref(table.name, keyOf(i, table))}>{cellText(i[a])}</Link> : cellText(i[a])),
        }))}
        empty={<Box textAlign="center" color="inherit">{summary ? "The operation returned no items." : "Run a scan or a query to see items."}</Box>}
        header={
          <Header
            variant="h2"
            counter={summary ? `(${items.length})` : undefined}
            description={summary ?? undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="dynamodb:DeleteItem" disabled={selected.length === 0} onClick={() => setDeleting(true)}>
                  Delete items
                </GatedButton>
                <GatedButton op="dynamodb:PutItem" disabled={!table} href={table ? itemHref(table.name) : undefined}>
                  Create item
                </GatedButton>
              </SpaceBetween>
            }
          >
            Items returned
          </Header>
        }
        footer={lastKey ? <Box textAlign="center"><Button onClick={() => execute(true)} loading={running}>Retrieve next page</Button></Box> : undefined}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="item"
        names={selected.map((i) => (table ? cellText(i[table.partition_key?.name ?? ""]) : ""))}
        op="dynamodb:DeleteItem"
        confirmation="simple"
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await run(() => commands.ddbDeleteItems(region, table!.name, selected.map((i) => keyOf(i, table!))));
          await execute(false);
        }}
      />
    </SpaceBetween>
  );
}

// Item editor -------------------------------------------------------------------------------------

function ItemEditor({ tableName, itemKey }: { tableName: string; itemKey: unknown }) {
  const region = useRegion();
  const editing = itemKey !== null;
  const table = useLoad(() => commands.ddbDescribeTable(region, tableName), [tableName]);
  const item = useLoad(() => commands.ddbGetItem(region, tableName, itemKey), [tableName, JSON.stringify(itemKey)], editing);
  const [text, setText] = useState<string | null>(null);
  const template = useMemo(() => {
    if (editing) return item.data ? JSON.stringify(item.data, null, 2) : "";
    const t = table.data;
    if (!t) return "";
    const tmpl: Item = {};
    for (const k of [t.partition_key, t.sort_key]) if (k) tmpl[k.name] = { [k.kind]: "" };
    return JSON.stringify(tmpl, null, 2);
  }, [editing, item.data, table.data]);
  const value = text ?? template;
  const parseError = jsonError(value, false);

  return (
    <CreateForm
      title={editing ? "Edit item" : "Create item"}
      description="Item attributes in DynamoDB JSON: each value is an object with one type key, such as S, N, BOOL, L or M."
      help={HELP}
      mode={editing ? "edit" : "create"}
      submitLabel={editing ? "Save changes" : "Create item"}
      op="dynamodb:PutItem"
      dirty={text !== null && text !== template}
      cancelHref={explorerHref(tableName)}
      validate={() => !parseError}
      onSubmit={async () => {
        await commands.ddbPutItem(region, tableName, JSON.parse(value), editing ? null : (table.data?.partition_key?.name ?? null));
      }}
    >
      <SpaceBetween size="l">
        <LoadError error={table.error ?? item.error} />
        {editing && !item.loading && !item.data && !item.error && <LoadError error="The item does not exist." />}
        <Container header={<Header variant="h2" description={`Table ${tableName}`}>Attributes</Header>}>
          <JsonEditor label="Item (DynamoDB JSON)" value={value} onChange={setText} rows={20} allowEmpty={false} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// PartiQL editor ----------------------------------------------------------------------------------

function PartiqlEditor() {
  const region = useRegion();
  const report = useReportUnsupported();
  const [statement, setStatement] = useState('SELECT * FROM "my-table"');
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState("table");

  const execute = async (token: string | null) => {
    setRunning(true);
    setError(null);
    try {
      const page = await commands.ddbExecuteStatement(region, statement, null, token);
      setItems(token && items ? [...items, ...(page.items as Item[])] : (page.items as Item[]));
      setNext(page.next_token);
    } catch (e) {
      report(e);
      setError(errorText(e));
      setItems(null);
    } finally {
      setRunning(false);
    }
  };
  const attributes = [...new Set((items ?? []).flatMap((i) => Object.keys(i)))].sort();

  return (
    <SpaceBetween size="m">
      <Header variant="h1" description="Run PartiQL statements (SELECT, INSERT, UPDATE, DELETE) against the tables of this Region.">
        PartiQL editor
      </Header>
      <Container header={<Header variant="h2">Query</Header>}>
        <SpaceBetween size="s">
          <div style={{ fontFamily: "monospace" }}>
            <Textarea value={statement} rows={6} spellcheck={false} onChange={({ detail }) => setStatement(detail.value)} />
          </div>
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton variant="primary" op="dynamodb:ExecuteStatement" loading={running} disabled={!statement.trim()} onClick={() => execute(null)}>
              Run
            </GatedButton>
            <Button onClick={() => { setItems(null); setError(null); }}>Clear</Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>
      {error && <StatusIndicator type="error">{error}</StatusIndicator>}
      {items && (
        <Container
          header={
            <Header variant="h2" counter={`(${items.length})`} actions={<SegmentedControl selectedId={view} onChange={({ detail }) => setView(detail.selectedId)} options={[{ id: "table", text: "Table view" }, { id: "json", text: "JSON view" }]} />}>
              Items returned
            </Header>
          }
          footer={next ? <Box textAlign="center"><Button loading={running} onClick={() => execute(next)}>Retrieve next page</Button></Box> : undefined}
        >
          {view === "json" ? (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(items, null, 2)}</pre>
          ) : (
            <Table<Item>
              variant="embedded"
              items={items}
              resizableColumns
              columnDefinitions={attributes.map((a) => ({ id: a, header: a, cell: (i: Item) => cellText(i[a]) }))}
              empty={<Box textAlign="center" color="inherit">The statement returned no items.</Box>}
            />
          )}
        </Container>
      )}
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The DynamoDB page for a route path, or null when the path is not a DynamoDB page. */
export function dynamoDbPage(path: string, query: URLSearchParams): ReactNode | null {
  const tables = { text: "Tables", href: href("/dynamodbv2/tables") };
  if (path === "/dynamodbv2" || path === "/dynamodbv2/dashboard") return page([{ text: "Dashboard", href: href("/dynamodbv2/dashboard") }], <UiOnlyScope primaryOp="dynamodb:ListTables"><Dashboard /></UiOnlyScope>);
  if (path === "/dynamodbv2/tables") return page([tables], <UiOnlyScope primaryOp="dynamodb:ListTables"><TablesList /></UiOnlyScope>, "table");
  if (path === "/dynamodbv2/create-table") return page([tables, { text: "Create table", href: href("/dynamodbv2/create-table") }], <CreateTable />, "form");
  if (path === "/dynamodbv2/backups") return page([{ text: "Backups", href: href("/dynamodbv2/backups") }], <UiOnlyScope primaryOp="dynamodb:ListBackups"><BackupsTable table={null} /></UiOnlyScope>, "table");
  if (path === "/dynamodbv2/partiql-editor") return page([{ text: "PartiQL editor", href: href("/dynamodbv2/partiql-editor") }], <PartiqlEditor />);
  if (path === "/dynamodbv2/item-explorer") {
    const table = query.get("table");
    return page([{ text: "Explore items", href: explorerHref() }, ...(table ? [{ text: table, href: explorerHref(table) }] : [])], <UiOnlyScope primaryOp="dynamodb:Scan"><ItemExplorer key={table ?? ""} initialTable={table} /></UiOnlyScope>);
  }
  if ((path === "/dynamodbv2/create-item" || path === "/dynamodbv2/edit-item") && query.get("table")) {
    const table = query.get("table")!;
    let key: unknown = null;
    if (path === "/dynamodbv2/edit-item") {
      try {
        key = JSON.parse(query.get("key") ?? "null");
      } catch {
        key = null;
      }
    }
    const crumbs = [{ text: "Explore items", href: explorerHref() }, { text: table, href: explorerHref(table) }, { text: key ? "Edit item" : "Create item", href: "#" }];
    return page(crumbs, key ? <UiOnlyScope primaryOp="dynamodb:GetItem"><ItemEditor key={JSON.stringify(key)} tableName={table} itemKey={key} /></UiOnlyScope> : <ItemEditor tableName={table} itemKey={null} />, "form");
  }
  const details = matchPath("/dynamodbv2/tables/:name", path);
  if (details) return page([tables, { text: details.name, href: tableHref(details.name) }], <UiOnlyScope primaryOp="dynamodb:DescribeTable"><TableDetails key={details.name} name={details.name} /></UiOnlyScope>);
  return null;
}
