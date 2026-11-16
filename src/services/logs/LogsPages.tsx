// Amazon CloudWatch Logs console pages: log groups, create log group, log group details (streams,
// metric filters, subscription filters, tags), log events and Logs Insights.

import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import DateRangePicker, { type DateRangePickerProps } from "@cloudscape-design/components/date-range-picker";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Multiselect from "@cloudscape-design/components/multiselect";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { commands, type LogsGroup_Serialize, type LogsMetricFilter_Serialize, type LogsQueryDefinition, type LogsQueryResults, type LogsStream_Serialize, type LogsSubscriptionFilter_Serialize } from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, textProperty, UiOnlyScope, useUiOnly, type ResourceTableColumn } from "../../patterns";
import { InfoLink, ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, navigate } from "../../shell/router";
import { Copyable, EditTagsModal, formatBytes, formatDate, FormModal, GatedDropdown, LoadError, prettyJson, TagsTable, useAction, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "CloudWatch Logs", href: href("/cloudwatch/logs/groups") },
  items: [
    { type: "link" as const, text: "Log groups", href: href("/cloudwatch/logs/groups") },
    { type: "link" as const, text: "Logs Insights", href: href("/cloudwatch/logs/insights") },
  ],
};

const HELP: HelpContent = {
  header: "CloudWatch Logs",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Log groups, log streams, log events, metric filters and saved Logs Insights queries of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">Running a Logs Insights query and creating subscription filters are only partly supported by the emulator, so those controls stay disabled.</Box>
      <Box variant="p">Adding test events is an emulator utility: it writes events with the current time to a log stream so there is something to read.</Box>
    </SpaceBetween>
  ),
};

const OP = "cloudwatch-logs:";
const NONE: readonly never[] = [];

const groupHref = (name: string, tab?: string) => href("/cloudwatch/logs/group", { name, tab });
const eventsHref = (group: string, stream?: string) => href("/cloudwatch/logs/events", { group, stream });

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "CloudWatch", href: href("/cloudwatch/logs/groups") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

// Shared pieces ----------------------------------------------------------------------------------

const RETENTION_LABELS: [number, string][] = [
  [1, "1 day"],
  [3, "3 days"],
  [5, "5 days"],
  [7, "1 week (7 days)"],
  [14, "2 weeks (14 days)"],
  [30, "1 month (30 days)"],
  [60, "2 months (60 days)"],
  [90, "3 months (90 days)"],
  [120, "4 months (120 days)"],
  [150, "5 months (150 days)"],
  [180, "6 months (180 days)"],
  [365, "12 months (365 days)"],
  [400, "13 months (400 days)"],
  [545, "18 months (545 days)"],
  [731, "2 years (731 days)"],
  [1096, "3 years (1096 days)"],
  [1827, "5 years (1827 days)"],
  [2192, "6 years (2192 days)"],
  [2557, "7 years (2557 days)"],
  [2922, "8 years (2922 days)"],
  [3288, "9 years (3288 days)"],
  [3653, "10 years (3653 days)"],
];

const RETENTION_OPTIONS = [{ value: "never", label: "Never expire" }, ...RETENTION_LABELS.map(([days, label]) => ({ value: String(days), label }))];

function retentionLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "Never expire";
  return RETENTION_LABELS.find(([d]) => d === days)?.[1] ?? `${days} days`;
}

function retentionOption(days: number | null | undefined) {
  return RETENTION_OPTIONS.find((o) => o.value === (days === null || days === undefined ? "never" : String(days))) ?? RETENTION_OPTIONS[0];
}

function daysOf(value: string | undefined): number | null {
  return !value || value === "never" ? null : Number(value);
}

function RetentionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FormField label="Retention setting" description="How long CloudWatch Logs keeps the log events of the log group.">
      <Select selectedOption={RETENTION_OPTIONS.find((o) => o.value === value) ?? RETENTION_OPTIONS[0]} options={RETENTION_OPTIONS} onChange={({ detail }) => onChange(detail.selectedOption.value!)} />
    </FormField>
  );
}

function RetentionModal({ visible, group, current, onDismiss, onSaved }: { visible: boolean; group: string; current: number | null; onDismiss: () => void; onSaved: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [value, setValue] = useState("never");
  useEffect(() => {
    if (visible) setValue(retentionOption(current).value);
  }, [visible, current]);
  return (
    <FormModal
      visible={visible}
      header="Edit retention setting"
      op={`${OP}PutRetentionPolicy`}
      onDismiss={onDismiss}
      onSubmit={() =>
        run(async () => {
          await commands.logsSetRetention(region, group, daysOf(value));
          onSaved();
        }, "Retention setting updated")
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          Log group <b>{group}</b>
        </Box>
        <RetentionSelect value={value} onChange={setValue} />
      </SpaceBetween>
    </FormModal>
  );
}

interface SimpleTableProps<T> {
  title: string;
  description?: ReactNode;
  items: readonly T[];
  loading: boolean;
  columns: TableProps.ColumnDefinition<T>[];
  trackBy: keyof T & string;
  empty: string;
  selectable?: boolean;
  actions?: (selected: readonly T[]) => ReactNode;
  filter?: ReactNode;
  onRefresh?: () => void;
  pageSize?: number;
}

/** A container table with sorting, paging and an optional single selection, for the tabs and panels. */
function SimpleTable<T>({ title, description, items, loading, columns, trackBy, empty, selectable = true, actions, filter, onRefresh, pageSize = 20 }: SimpleTableProps<T>) {
  const { uiOnly } = useUiOnly();
  const { items: pageItems, collectionProps, paginationProps, actions: collection } = useCollection(items, { pagination: { pageSize }, sorting: {}, selection: { trackBy } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => collection.setSelectedItems([]), [items]);
  const selected = collectionProps.selectedItems ?? NONE;
  return (
    <Table
      {...collectionProps}
      variant="container"
      items={pageItems}
      trackBy={trackBy}
      columnDefinitions={columns}
      selectionType={selectable ? "single" : undefined}
      loading={!uiOnly && loading}
      loadingText="Loading"
      filter={filter}
      pagination={<Pagination {...paginationProps} disabled={uiOnly} />}
      empty={
        <Box textAlign="center" color="inherit">
          <b>{empty}</b>
        </Box>
      }
      ariaLabels={{
        allItemsSelectionLabel: () => "select all",
        itemSelectionLabel: (_, item) => `select ${String((item as Record<string, unknown>)[trackBy])}`,
        selectionGroupLabel: `${title} selection`,
      }}
      header={
        <Header
          variant="h2"
          counter={uiOnly || loading ? undefined : `(${items.length})`}
          description={description}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {onRefresh && <Button iconName="refresh" ariaLabel="Refresh" disabled={uiOnly || loading} onClick={onRefresh} />}
              {actions?.(selected)}
            </SpaceBetween>
          }
        >
          {title}
        </Header>
      }
    />
  );
}

function Missing({ what }: { what: string }) {
  return (
    <Alert type="error" header={`${what} is missing`}>
      Open the page from the list of log groups.
    </Alert>
  );
}

// Time range --------------------------------------------------------------------------------------

type RangeKey = "30m" | "1h" | "12h" | "1d" | "7d" | "all" | "custom";

interface RangeState {
  key: RangeKey;
  custom: DateRangePickerProps.AbsoluteValue | null;
}

const RANGE_OPTIONS: { value: RangeKey; label: string; ms?: number }[] = [
  { value: "30m", label: "Last 30 minutes", ms: 30 * 60_000 },
  { value: "1h", label: "Last 1 hour", ms: 60 * 60_000 },
  { value: "12h", label: "Last 12 hours", ms: 12 * 60 * 60_000 },
  { value: "1d", label: "Last 1 day", ms: 24 * 60 * 60_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

/** Epoch milliseconds of the range, resolved when called so a relative range ends "now". */
function rangeBounds(range: RangeState): { start: number | null; end: number | null } {
  if (range.key === "all") return { start: null, end: null };
  if (range.key === "custom") {
    if (!range.custom) return { start: null, end: null };
    const start = Date.parse(range.custom.startDate);
    const end = Date.parse(range.custom.endDate);
    return { start: isNaN(start) ? null : start, end: isNaN(end) ? null : end };
  }
  const ms = RANGE_OPTIONS.find((o) => o.value === range.key)?.ms ?? 0;
  return { start: Date.now() - ms, end: null };
}

function TimeRange({ value, onChange, disabled }: { value: RangeState; onChange: (v: RangeState) => void; disabled?: boolean }) {
  return (
    <SpaceBetween direction="horizontal" size="xs">
      <Select
        disabled={disabled}
        expandToViewport
        selectedOption={RANGE_OPTIONS.find((o) => o.value === value.key) ?? RANGE_OPTIONS[0]}
        options={RANGE_OPTIONS.map(({ value: v, label }) => ({ value: v, label }))}
        onChange={({ detail }) => onChange({ ...value, key: detail.selectedOption.value as RangeKey })}
      />
      {value.key === "custom" && (
        <DateRangePicker
          disabled={disabled}
          value={value.custom}
          relativeOptions={[]}
          rangeSelectorMode="absolute-only"
          placeholder="Filter by an absolute date and time range"
          onChange={({ detail }) => onChange({ ...value, custom: detail.value && detail.value.type === "absolute" ? detail.value : null })}
          isValidRange={(range) => {
            if (!range || range.type !== "absolute") return { valid: true };
            return Date.parse(range.startDate) < Date.parse(range.endDate) ? { valid: true } : { valid: false, errorMessage: "The start of the range must be before its end." };
          }}
        />
      )}
    </SpaceBetween>
  );
}

// Log groups --------------------------------------------------------------------------------------

type GroupRow = LogsGroup_Serialize & { cls: string; retention: string };

const GROUP_COLUMNS: ResourceTableColumn<GroupRow>[] = [
  { id: "name", header: "Log group", cell: (g) => <Link href={groupHref(g.name)}>{g.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "cls", header: "Log class", cell: (g) => g.cls, sortingField: "cls" },
  { id: "retention", header: "Retention", cell: (g) => g.retention, sortingField: "retention" },
  { id: "bytes", header: "Stored bytes", cell: (g) => formatBytes(g.stored_bytes), sortingField: "stored_bytes" },
  { id: "filters", header: "Metric filters", cell: (g) => g.metric_filter_count, sortingField: "metric_filter_count" },
  { id: "kms", header: "KMS key ID", cell: (g) => g.kms_key_id ?? "-", sortingField: "kms_key_id", hidden: true },
  { id: "created", header: "Creation time", cell: (g) => formatDate(g.created), sortingField: "created" },
];

function GroupsList() {
  const region = useRegion();
  const groups = useLoad(() => commands.logsListGroups(region, null), []);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const rows: GroupRow[] = (groups.data ?? []).map((g) => ({ ...g, cls: g.log_group_class ?? "Standard", retention: retentionLabel(g.retention_days) }));
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={groups.error} onRetry={groups.reload} />
      <ResourceTable<GroupRow>
        resourceName="Log group"
        title="Log groups"
        help={HELP}
        items={rows}
        loading={groups.loading}
        columns={GROUP_COLUMNS}
        filteringProperties={[textProperty("name", "Log group"), textProperty("cls", "Log class", "enum"), textProperty("retention", "Retention", "enum")]}
        trackBy="name"
        preferencesKey="logs.groups"
        selectionType="single"
        onRefresh={groups.reload}
        emptyAction={
          <GatedButton op={`${OP}CreateLogGroup`} href={href("/cloudwatch/logs/create-group")}>
            Create log group
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedDropdown
              items={[
                { id: "retention", text: "Edit retention setting", op: `${OP}PutRetentionPolicy`, disabled: sel.length !== 1 },
                { id: "delete", text: "Delete log group", op: `${OP}DeleteLogGroup`, disabled: sel.length !== 1 },
              ]}
              onItemClick={(id) => (id === "delete" ? setDeleting(sel[0]) : setEditing(sel[0]))}
            />
            <GatedButton variant="primary" op={`${OP}CreateLogGroup`} href={href("/cloudwatch/logs/create-group")}>
              Create log group
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="log group"
        names={deleting ? [deleting.name] : []}
        op={`${OP}DeleteLogGroup`}
        confirmation="typed"
        warning="Deleting the log group deletes all of its log streams and log events."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.logsDeleteGroup(region, deleting!.name);
          groups.reload();
        }}
      />
      <RetentionModal visible={editing !== null} group={editing?.name ?? ""} current={editing?.retention_days ?? null} onDismiss={() => setEditing(null)} onSaved={groups.reload} />
    </SpaceBetween>
  );
}

// Create log group --------------------------------------------------------------------------------

function CreateGroup() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [retention, setRetention] = useState("never");
  const [kms, setKms] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [nameError, setNameError] = useState<string>();
  return (
    <CreateForm
      title="Create log group"
      help={HELP}
      mode="create"
      submitLabel="Create"
      op={`${OP}CreateLogGroup`}
      dirty={name !== "" || kms !== "" || retention !== "never" || tags.length > 0}
      cancelHref={href("/cloudwatch/logs/groups")}
      validate={() => {
        const e = /^[a-zA-Z0-9_\-/.#]{1,512}$/.test(name) ? undefined : "Use 1 to 512 characters: letters, numbers and _ - / . #";
        setNameError(e);
        return !e;
      }}
      onSubmit={async () => {
        await commands.logsCreateGroup(
          region,
          name,
          daysOf(retention),
          kms.trim() || null,
          tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })),
        );
        return groupHref(name);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Log group details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Log group name" errorText={nameError} constraintText="1 to 512 characters. Letters, numbers and the characters _ - / . # are allowed.">
              <Input value={name} placeholder="/my-app/production" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <RetentionSelect value={retention} onChange={setRetention} />
            <FormField label="KMS key ARN - optional" description="Encrypts the log group's data with this AWS KMS key.">
              <Input value={kms} placeholder="arn:aws:kms:us-east-1:000000000000:key/..." onChange={({ detail }) => setKms(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="A tag is a label that you assign to a log group.">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Log group details -------------------------------------------------------------------------------

function StreamsTab({ group }: { group: string }) {
  const region = useRegion();
  const { run } = useAction();
  const [prefix, setPrefix] = useState("");
  const [applied, setApplied] = useState("");
  const streams = useLoad(() => commands.logsListStreams(region, group, applied || null), [group, applied]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<LogsStream_Serialize | null>(null);
  const columns: TableProps.ColumnDefinition<LogsStream_Serialize>[] = [
    { id: "name", header: "Log stream", cell: (s) => <Link href={eventsHref(group, s.name)}>{s.name}</Link>, sortingField: "name", isRowHeader: true },
    { id: "last", header: "Last event time", cell: (s) => formatDate(s.last_event), sortingField: "last_event" },
    { id: "first", header: "First event time", cell: (s) => formatDate(s.first_event), sortingField: "first_event" },
    { id: "created", header: "Creation time", cell: (s) => formatDate(s.created), sortingField: "created" },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={streams.error} onRetry={streams.reload} />
      <SimpleTable<LogsStream_Serialize>
        title="Log streams"
        items={streams.data ?? NONE}
        loading={streams.loading}
        columns={columns}
        trackBy="name"
        empty="No log streams"
        onRefresh={streams.reload}
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <Input
              type="search"
              ariaLabel="Filter log streams by name prefix"
              placeholder="Filter log streams by name prefix"
              value={prefix}
              onChange={({ detail }) => setPrefix(detail.value)}
              onKeyDown={({ detail }) => detail.key === "Enter" && setApplied(prefix)}
            />
            <Button onClick={() => setApplied(prefix)}>Search</Button>
          </SpaceBetween>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op={`${OP}FilterLogEvents`} href={eventsHref(group)}>
              Search all
            </GatedButton>
            <GatedButton op={`${OP}DeleteLogStream`} disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton
              variant="primary"
              op={`${OP}CreateLogStream`}
              onClick={() => {
                setName("");
                setCreating(true);
              }}
            >
              Create log stream
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={creating}
        header="Create log stream"
        op={`${OP}CreateLogStream`}
        submitLabel="Create"
        canSubmit={name.trim() !== "" && !name.includes(":") && !name.includes("*")}
        onDismiss={() => setCreating(false)}
        onSubmit={() =>
          run(async () => {
            await commands.logsCreateStream(region, group, name.trim());
            streams.reload();
          }, "Log stream created")
        }
      >
        <FormField label="Log stream name" constraintText="The name cannot contain a colon (:) or an asterisk (*).">
          <Input value={name} onChange={({ detail }) => setName(detail.value)} />
        </FormField>
      </FormModal>
      <DeleteModal
        visible={deleting !== null}
        resourceKind="log stream"
        names={deleting ? [deleting.name] : []}
        op={`${OP}DeleteLogStream`}
        confirmation="simple"
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.logsDeleteStream(region, group, deleting!.name);
          streams.reload();
        }}
      />
    </SpaceBetween>
  );
}

function MetricFiltersTab({ group }: { group: string }) {
  const region = useRegion();
  const { run } = useAction();
  const filters = useLoad(() => commands.logsListMetricFilters(region, group), [group]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<LogsMetricFilter_Serialize | null>(null);
  const [form, setForm] = useState({ name: "", pattern: "", namespace: "", metric: "", value: "1", dflt: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const dfltBad = form.dflt.trim() !== "" && isNaN(Number(form.dflt));
  const columns: TableProps.ColumnDefinition<LogsMetricFilter_Serialize>[] = [
    { id: "name", header: "Filter name", cell: (f) => f.name, sortingField: "name", isRowHeader: true },
    { id: "pattern", header: "Filter pattern", cell: (f) => f.pattern || "-", sortingField: "pattern" },
    { id: "metric", header: "Metric", cell: (f) => (f.metric_name ? `${f.metric_namespace} / ${f.metric_name}` : "-"), sortingField: "metric_name" },
    { id: "value", header: "Metric value", cell: (f) => f.metric_value || "-" },
    { id: "default", header: "Default value", cell: (f) => f.default_value ?? "-" },
    { id: "created", header: "Creation time", cell: (f) => formatDate(f.created), sortingField: "created" },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={filters.error} onRetry={filters.reload} />
      <SimpleTable<LogsMetricFilter_Serialize>
        title="Metric filters"
        items={filters.data ?? NONE}
        loading={filters.loading}
        columns={columns}
        trackBy="name"
        empty="No metric filters"
        onRefresh={filters.reload}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op={`${OP}DeleteMetricFilter`} disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton
              variant="primary"
              op={`${OP}PutMetricFilter`}
              onClick={() => {
                setForm({ name: "", pattern: "", namespace: "", metric: "", value: "1", dflt: "" });
                setCreating(true);
              }}
            >
              Create metric filter
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={creating}
        size="large"
        header="Create metric filter"
        op={`${OP}PutMetricFilter`}
        submitLabel="Create metric filter"
        canSubmit={form.name.trim() !== "" && form.namespace.trim() !== "" && form.metric.trim() !== "" && form.value.trim() !== "" && !dfltBad}
        onDismiss={() => setCreating(false)}
        onSubmit={() =>
          run(async () => {
            await commands.logsPutMetricFilter(region, group, form.name.trim(), form.pattern, form.metric.trim(), form.namespace.trim(), form.value.trim(), form.dflt.trim() === "" ? null : Number(form.dflt));
            filters.reload();
          }, "Metric filter created")
        }
      >
        <SpaceBetween size="m">
          <FormField label="Filter name">
            <Input value={form.name} onChange={({ detail }) => set({ name: detail.value })} />
          </FormField>
          <FormField label="Filter pattern" description="Leave empty to match every log event." stretch>
            <Input value={form.pattern} placeholder='{ $.level = "ERROR" }' onChange={({ detail }) => set({ pattern: detail.value })} />
          </FormField>
          <FormField label="Metric namespace">
            <Input value={form.namespace} placeholder="MyApp" onChange={({ detail }) => set({ namespace: detail.value })} />
          </FormField>
          <FormField label="Metric name">
            <Input value={form.metric} placeholder="ErrorCount" onChange={({ detail }) => set({ metric: detail.value })} />
          </FormField>
          <FormField label="Metric value" description="A number such as 1, or a field reference such as $.latency.">
            <Input value={form.value} onChange={({ detail }) => set({ value: detail.value })} />
          </FormField>
          <FormField label="Default value - optional" description="Published when no log event matches the pattern." errorText={dfltBad ? "Enter a number." : undefined}>
            <Input value={form.dflt} inputMode="decimal" onChange={({ detail }) => set({ dflt: detail.value })} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <DeleteModal
        visible={deleting !== null}
        resourceKind="metric filter"
        names={deleting ? [deleting.name] : []}
        op={`${OP}DeleteMetricFilter`}
        confirmation="simple"
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.logsDeleteMetricFilter(region, group, deleting!.name);
          filters.reload();
        }}
      />
    </SpaceBetween>
  );
}

function SubscriptionFiltersTab({ group }: { group: string }) {
  const region = useRegion();
  const { run } = useAction();
  const filters = useLoad(() => commands.logsListSubscriptionFilters(region, group), [group]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<LogsSubscriptionFilter_Serialize | null>(null);
  const [form, setForm] = useState({ name: "", pattern: "", destination: "", role: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const columns: TableProps.ColumnDefinition<LogsSubscriptionFilter_Serialize>[] = [
    { id: "name", header: "Filter name", cell: (f) => f.name, sortingField: "name", isRowHeader: true },
    { id: "pattern", header: "Filter pattern", cell: (f) => f.pattern || "-", sortingField: "pattern" },
    { id: "destination", header: "Destination ARN", cell: (f) => f.destination_arn, sortingField: "destination_arn" },
    { id: "role", header: "Role ARN", cell: (f) => f.role_arn ?? "-" },
    { id: "created", header: "Creation time", cell: (f) => formatDate(f.created), sortingField: "created" },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={filters.error} onRetry={filters.reload} />
      <SimpleTable<LogsSubscriptionFilter_Serialize>
        title="Subscription filters"
        items={filters.data ?? NONE}
        loading={filters.loading}
        columns={columns}
        trackBy="name"
        empty="No subscription filters"
        onRefresh={filters.reload}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op={`${OP}DeleteSubscriptionFilter`} disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton
              variant="primary"
              op={`${OP}PutSubscriptionFilter`}
              onClick={() => {
                setForm({ name: "", pattern: "", destination: "", role: "" });
                setCreating(true);
              }}
            >
              Create subscription filter
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={creating}
        size="large"
        header="Create subscription filter"
        op={`${OP}PutSubscriptionFilter`}
        submitLabel="Start streaming"
        canSubmit={form.name.trim() !== "" && form.destination.trim() !== ""}
        onDismiss={() => setCreating(false)}
        onSubmit={() =>
          run(async () => {
            await commands.logsPutSubscriptionFilter(region, group, form.name.trim(), form.pattern, form.destination.trim(), form.role.trim() || null);
            filters.reload();
          }, "Subscription filter created")
        }
      >
        <SpaceBetween size="m">
          <FormField label="Subscription filter name">
            <Input value={form.name} onChange={({ detail }) => set({ name: detail.value })} />
          </FormField>
          <FormField label="Destination ARN" description="A Lambda function, a Kinesis stream or an Amazon Data Firehose delivery stream." stretch>
            <Input value={form.destination} placeholder="arn:aws:lambda:us-east-1:000000000000:function:my-function" onChange={({ detail }) => set({ destination: detail.value })} />
          </FormField>
          <FormField label="Role ARN - optional" description="The role that CloudWatch Logs assumes to deliver to a Kinesis stream or a Firehose delivery stream." stretch>
            <Input value={form.role} onChange={({ detail }) => set({ role: detail.value })} />
          </FormField>
          <FormField label="Filter pattern" description="Leave empty to send every log event." stretch>
            <Input value={form.pattern} onChange={({ detail }) => set({ pattern: detail.value })} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <DeleteModal
        visible={deleting !== null}
        resourceKind="subscription filter"
        names={deleting ? [deleting.name] : []}
        op={`${OP}DeleteSubscriptionFilter`}
        confirmation="simple"
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.logsDeleteSubscriptionFilter(region, group, deleting!.name);
          filters.reload();
        }}
      />
    </SpaceBetween>
  );
}

function GroupTags({ arn }: { arn: string }) {
  const region = useRegion();
  const { run } = useAction();
  const tags = useLoad(() => commands.logsListTags(region, arn), [arn]);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <LoadError error={tags.error} onRetry={tags.reload} />
      <TagsTable tags={tags.data} loading={tags.loading} op={`${OP}TagResource`} onEdit={() => setEditing(true)} />
      <EditTagsModal
        visible={editing}
        tags={tags.data ?? []}
        op={`${OP}TagResource`}
        onDismiss={() => setEditing(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.logsUpdateTags(region, arn, set, remove);
            tags.reload();
          }, "Log group tags updated")
        }
      />
    </>
  );
}

function GroupDetails({ name }: { name: string }) {
  const region = useRegion();
  const { uiOnly } = useUiOnly();
  const group = useLoad(async () => (await commands.logsListGroups(region, name)).find((g) => g.name === name) ?? null, [name]);
  const [deleting, setDeleting] = useState(false);
  const [retention, setRetention] = useState(false);
  const g = group.data;
  return (
    <SpaceBetween size="m">
      <LoadError error={group.error} onRetry={group.reload} />
      {!uiOnly && !group.loading && !group.error && g === null && (
        <Alert type="error" header="Log group not found">
          The emulator has no log group named {name} in this Region.
        </Alert>
      )}
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op={`${OP}PutRetentionPolicy`} disabled={!g} onClick={() => setRetention(true)}>
              Edit retention setting
            </GatedButton>
            <GatedButton op={`${OP}DeleteLogGroup`} disabled={!g} onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op={`${OP}FilterLogEvents`} href={eventsHref(name)}>
              Search log group
            </GatedButton>
          </SpaceBetween>
        }
        overview={{
          title: "Log group details",
          columns: 3,
          items: [
            { label: "Log group name", value: name },
            { label: "ARN", value: g ? <Copyable value={g.arn} label="ARN" /> : "-" },
            { label: "Creation time", value: formatDate(g?.created) },
            { label: "Retention", value: g ? retentionLabel(g.retention_days) : "-" },
            { label: "Stored bytes", value: formatBytes(g?.stored_bytes) },
            { label: "Metric filters", value: g ? String(g.metric_filter_count) : "-" },
            { label: "KMS key ID", value: g?.kms_key_id ?? "-" },
            { label: "Log class", value: g ? (g.log_group_class ?? "Standard") : "-" },
            { label: "Deletion protection", value: g ? (g.deletion_protection ? "Enabled" : "Disabled") : "-" },
          ],
        }}
        sections={[
          { id: "streams", label: "Log streams", content: <StreamsTab group={name} /> },
          { id: "metric-filters", label: "Metric filters", content: <MetricFiltersTab group={name} /> },
          { id: "subscription-filters", label: "Subscription filters", content: <SubscriptionFiltersTab group={name} /> },
          { id: "tags", label: "Tags", content: g ? <GroupTags arn={g.arn} /> : null },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="log group"
        names={[name]}
        op={`${OP}DeleteLogGroup`}
        confirmation="typed"
        warning="Deleting the log group deletes all of its log streams and log events."
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.logsDeleteGroup(region, name);
          navigate(href("/cloudwatch/logs/groups"));
        }}
      />
      <RetentionModal visible={retention} group={name} current={g?.retention_days ?? null} onDismiss={() => setRetention(false)} onSaved={group.reload} />
    </SpaceBetween>
  );
}

// Log events --------------------------------------------------------------------------------------

const EVENTS_PAGE = 100;

interface EventRow {
  id: number;
  stream: string;
  ts: string;
  message: string;
}

interface EventsPage {
  rows: Omit<EventRow, "id">[];
  next: string | null;
}

interface Applied {
  pattern: string;
  range: RangeState;
  stamp: number;
}

function TestEventsModal({ visible, group, stream, onDismiss, onDone }: { visible: boolean; group: string; stream: string | null; onDismiss: () => void; onDone: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const streams = useLoad(() => commands.logsListStreams(region, group, null), [group], visible && !stream);
  const [chosen, setChosen] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    if (visible) setText("");
  }, [visible]);
  const target = stream ?? chosen;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (
    <FormModal
      visible={visible}
      size="large"
      header="Add test events"
      op={`${OP}PutLogEvents`}
      submitLabel="Add events"
      canSubmit={target !== "" && lines.length > 0}
      onDismiss={onDismiss}
      onSubmit={() =>
        run(async () => {
          const now = Date.now();
          await commands.logsPutEvents(region, group, target, lines.map((message) => ({ timestamp_ms: now, message })));
          onDone();
        }, `Added ${lines.length} test event${lines.length === 1 ? "" : "s"}`)
      }
    >
      <SpaceBetween size="m">
        <Alert type="info">This is an emulator utility, not a console feature. Each line becomes one log event with the current time.</Alert>
        {stream ? (
          <FormField label="Log stream">
            <Box>{stream}</Box>
          </FormField>
        ) : (
          <FormField label="Log stream" errorText={streams.error ?? undefined} description={streams.data && streams.data.length === 0 ? "The log group has no log streams. Create one first." : undefined}>
            <Select
              statusType={streams.loading ? "loading" : "finished"}
              placeholder="Choose a log stream"
              selectedOption={chosen ? { value: chosen, label: chosen } : null}
              options={(streams.data ?? []).map((s) => ({ value: s.name, label: s.name }))}
              onChange={({ detail }) => setChosen(detail.selectedOption.value ?? "")}
            />
          </FormField>
        )}
        <FormField label="Messages" description="One event per line." stretch>
          <Textarea value={text} rows={8} spellcheck={false} placeholder={'{"level": "INFO", "message": "hello"}'} onChange={({ detail }) => setText(detail.value)} />
        </FormField>
      </SpaceBetween>
    </FormModal>
  );
}

function LogEvents({ group, stream }: { group: string; stream: string | null }) {
  const region = useRegion();
  const { uiOnly } = useUiOnly();
  const { run } = useAction();
  const [pattern, setPattern] = useState("");
  const [range, setRange] = useState<RangeState>({ key: "1d", custom: null });
  const [applied, setApplied] = useState<Applied>({ pattern: "", range: { key: "1d", custom: null }, stamp: 0 });
  const [more, setMore] = useState<EventsPage["rows"]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [adding, setAdding] = useState(false);

  const usesGet = stream !== null && applied.pattern.trim() === "";
  const fetchPage = async (next: string | null): Promise<EventsPage> => {
    const { start, end } = rangeBounds(applied.range);
    if (stream !== null && usesGet) {
      const p = await commands.logsGetEvents(region, { group, stream, start_ms: start, end_ms: end, start_from_head: true, next_token: next, limit: EVENTS_PAGE });
      // The API repeats the last token at the end of a stream; an empty page is the end.
      return { rows: p.events.map((e) => ({ stream, ts: e.timestamp, message: e.message })), next: p.events.length > 0 ? p.next_forward_token : null };
    }
    const p = await commands.logsFilterEvents(region, { group, streams: stream ? [stream] : [], filter_pattern: applied.pattern.trim() || null, start_ms: start, end_ms: end, next_token: next, limit: EVENTS_PAGE });
    return { rows: p.events.map((e) => ({ stream: e.stream_name, ts: e.timestamp, message: e.message })), next: p.next_token };
  };

  const first = useLoad(() => fetchPage(null), [group, stream, applied]);
  useEffect(() => {
    setMore([]);
    setExpanded(new Set());
    setToken(first.data?.next ?? null);
  }, [first.data]);

  const rows: EventRow[] = useMemo(() => [...(first.data?.rows ?? []), ...more].map((r, id) => ({ ...r, id })), [first.data, more]);
  const loadMore = async () => {
    setLoadingMore(true);
    await run(async () => {
      const p = await fetchPage(token);
      setMore((m) => [...m, ...p.rows]);
      setToken(p.next);
    });
    setLoadingMore(false);
  };
  const apply = () => setApplied({ pattern, range, stamp: Date.now() });
  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const readOp = `${OP}${usesGet ? "GetLogEvents" : "FilterLogEvents"}`;

  const columns: TableProps.ColumnDefinition<EventRow>[] = [
    { id: "ts", header: "Timestamp", width: 280, cell: (r) => formatDate(r.ts) },
    ...(stream ? [] : [{ id: "stream", header: "Log stream", width: 240, cell: (r: EventRow) => <Link href={eventsHref(group, r.stream)}>{r.stream}</Link> }]),
    {
      id: "message",
      header: "Message",
      cell: (r) => {
        const open = expanded.has(r.id);
        const first = r.message.split("\n")[0];
        return (
          <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
            <Button variant="inline-icon" iconName={open ? "treeview-collapse" : "treeview-expand"} ariaLabel={open ? "Collapse message" : "Expand message"} onClick={() => toggle(r.id)} />
            {open ? (
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>{/^\s*[{[]/.test(r.message) ? prettyJson(r.message) : r.message}</pre>
            ) : (
              <span style={{ fontFamily: "monospace" }}>{first.length > 300 ? `${first.slice(0, 300)}...` : first}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={first.error} onRetry={first.reload} />
      <Table
        variant="full-page"
        stickyHeader
        items={uiOnly ? [] : rows}
        trackBy="id"
        columnDefinitions={columns}
        loading={!uiOnly && first.loading}
        loadingText="Loading log events"
        wrapLines
        empty={
          <Box textAlign="center" color="inherit">
            <b>No log events</b>
            <Box variant="p" color="inherit">
              No events match the filter and time range.
            </Box>
          </Box>
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            info={<InfoLink topic={HELP} />}
            counter={uiOnly || first.loading ? undefined : `(${rows.length}${token ? "+" : ""})`}
            description={stream ? `Log stream ${stream} of ${group}` : `All log streams of ${group}`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" disabled={uiOnly || first.loading} onClick={() => setApplied((a) => ({ ...a, stamp: Date.now() }))} />
                <GatedButton
                  op={`${OP}PutLogEvents`}
                  onClick={() => setAdding(true)}
                >
                  Add test events
                </GatedButton>
              </SpaceBetween>
            }
          >
            {stream ?? group}
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <Input
              type="search"
              ariaLabel="Filter events"
              placeholder="Filter events by pattern, for example ERROR"
              disabled={uiOnly}
              value={pattern}
              onChange={({ detail }) => setPattern(detail.value)}
              onKeyDown={({ detail }) => detail.key === "Enter" && apply()}
            />
            <TimeRange value={range} onChange={setRange} disabled={uiOnly} />
            <GatedButton variant="primary" op={readOp} onClick={apply}>
              Search
            </GatedButton>
          </SpaceBetween>
        }
        footer={
          token && !uiOnly ? (
            <Box textAlign="center">
              <GatedButton op={readOp} loading={loadingMore} onClick={loadMore}>
                Load more
              </GatedButton>
            </Box>
          ) : undefined
        }
      />
      <TestEventsModal visible={adding} group={group} stream={stream} onDismiss={() => setAdding(false)} onDone={() => setApplied((a) => ({ ...a, stamp: Date.now() }))} />
    </SpaceBetween>
  );
}

// Logs Insights -----------------------------------------------------------------------------------

const DEFAULT_QUERY = "fields @timestamp, @message | sort @timestamp desc | limit 20";
const POLL_MS = 1000;
const POLL_CAP_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function QueryStatus({ status }: { status: string }) {
  const type = status === "Complete" ? "success" : status === "Failed" || status === "Timeout" ? "error" : status === "Cancelled" ? "stopped" : "in-progress";
  return <StatusIndicator type={type}>{status}</StatusIndicator>;
}

function ResultsTable({ results }: { results: LogsQueryResults | null }) {
  const fields = useMemo(() => {
    const seen: string[] = [];
    for (const row of results?.rows ?? []) for (const f of row) if (f.field !== "@ptr" && !seen.includes(f.field)) seen.push(f.field);
    return seen;
  }, [results]);
  const items = useMemo(() => (results?.rows ?? []).map((row, i) => ({ __id: String(i), ...Object.fromEntries(row.map((f) => [f.field, f.value])) }) as Record<string, string>), [results]);
  const columns: TableProps.ColumnDefinition<Record<string, string>>[] = [
    { id: "__n", header: "#", cell: (r) => Number(r.__id) + 1, width: 70 },
    ...fields.map((f) => ({ id: f, header: f, cell: (r: Record<string, string>) => <span style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{r[f] ?? "-"}</span>, sortingField: f })),
  ];
  return (
    <SimpleTable<Record<string, string>>
      title="Logs"
      description={
        results ? (
          <SpaceBetween direction="horizontal" size="m">
            <QueryStatus status={results.status} />
            <span>
              Records matched: {results.records_matched ?? "-"}, scanned: {results.records_scanned ?? "-"}, bytes scanned: {results.bytes_scanned === null ? "-" : formatBytes(results.bytes_scanned)}
            </span>
          </SpaceBetween>
        ) : undefined
      }
      items={items}
      loading={false}
      columns={columns}
      trackBy="__id"
      selectable={false}
      empty={results ? "No results" : "Run a query to see results"}
      pageSize={50}
    />
  );
}

function Insights() {
  const region = useRegion();
  const { run } = useAction();
  const groups = useLoad(() => commands.logsListGroups(region, null), []);
  const defs = useLoad(() => commands.logsListQueryDefinitions(region), []);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [range, setRange] = useState<RangeState>({ key: "1h", custom: null });
  const [results, setResults] = useState<LogsQueryResults | null>(null);
  const [running, setRunning] = useState(false);
  const [capped, setCapped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [deleting, setDeleting] = useState<LogsQueryDefinition | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const execute = async () => {
    const mine = ++seq.current;
    const { start, end } = rangeBounds(range);
    setRunning(true);
    setCapped(false);
    setResults(null);
    await run(async () => {
      const id = await commands.logsStartQuery(region, { groups: chosen, query, start_secs: Math.floor((start ?? 0) / 1000), end_secs: Math.floor((end ?? Date.now()) / 1000), limit: null });
      const deadline = Date.now() + POLL_CAP_MS;
      for (;;) {
        const r = await commands.logsGetQueryResults(region, id);
        if (!alive.current || mine !== seq.current) return;
        setResults(r);
        if (r.status !== "Scheduled" && r.status !== "Running") return;
        if (Date.now() >= deadline) {
          setCapped(true);
          return;
        }
        await sleep(POLL_MS);
        if (!alive.current || mine !== seq.current) return;
      }
    });
    if (alive.current && mine === seq.current) setRunning(false);
  };

  const defColumns: TableProps.ColumnDefinition<LogsQueryDefinition>[] = [
    { id: "name", header: "Name", cell: (d) => d.name, sortingField: "name", isRowHeader: true },
    { id: "query", header: "Query", cell: (d) => <span style={{ fontFamily: "monospace" }}>{d.query_string}</span> },
    { id: "groups", header: "Log groups", cell: (d) => (d.log_groups.length ? d.log_groups.join(", ") : "-") },
    { id: "modified", header: "Last modified", cell: (d) => (d.last_modified === null ? "-" : formatDate(new Date(d.last_modified).toISOString())), sortingField: "last_modified" },
  ];

  return (
    <SpaceBetween size="m">
      <Header variant="h1" info={<InfoLink topic={HELP} />} description="Search and analyze your log data with the Logs Insights query language.">
        Logs Insights
      </Header>
      <ScopeBanner />
      <LoadError error={groups.error ?? defs.error} onRetry={() => { groups.reload(); defs.reload(); }} />
      <Container header={<Header variant="h2">Select log groups, time range and query</Header>}>
        <SpaceBetween size="m">
          <FormField label="Log groups" description="Choose the log groups to query.">
            <Multiselect
              placeholder="Select log group(s)"
              filteringType="auto"
              keepOpen
              statusType={groups.loading ? "loading" : "finished"}
              selectedOptions={chosen.map((g) => ({ value: g, label: g }))}
              options={(groups.data ?? []).map((g) => ({ value: g.name, label: g.name }))}
              onChange={({ detail }) => setChosen(detail.selectedOptions.map((o) => o.value!))}
            />
          </FormField>
          <FormField label="Time range">
            <TimeRange value={range} onChange={setRange} />
          </FormField>
          <FormField label="Query" stretch>
            <div style={{ fontFamily: "monospace" }}>
              <Textarea value={query} rows={6} spellcheck={false} onChange={({ detail }) => setQuery(detail.value)} />
            </div>
          </FormField>
          <GatedButton variant="primary" op={`${OP}StartQuery`} disabled={chosen.length === 0 || query.trim() === ""} loading={running} onClick={execute}>
            Run query
          </GatedButton>
        </SpaceBetween>
      </Container>
      {capped && (
        <Alert type="warning" header="The query is still running">
          The query did not finish within 60 seconds. The results below are the last ones the emulator returned. Run the query again to refresh them.
        </Alert>
      )}
      <ResultsTable results={results} />
      <SimpleTable<LogsQueryDefinition>
        title="Saved queries"
        items={defs.data ?? NONE}
        loading={defs.loading}
        columns={defColumns}
        trackBy="id"
        empty="No saved queries"
        onRefresh={defs.reload}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              disabled={sel.length !== 1}
              onClick={() => {
                setQuery(sel[0].query_string);
                setChosen(sel[0].log_groups);
              }}
            >
              Load into editor
            </Button>
            <GatedButton op={`${OP}DeleteQueryDefinition`} disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton
              variant="primary"
              op={`${OP}PutQueryDefinition`}
              disabled={query.trim() === ""}
              onClick={() => {
                setSaveName("");
                setSaving(true);
              }}
            >
              Save query
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={saving}
        header="Save query"
        op={`${OP}PutQueryDefinition`}
        submitLabel="Save"
        canSubmit={saveName.trim() !== ""}
        onDismiss={() => setSaving(false)}
        onSubmit={() =>
          run(async () => {
            await commands.logsPutQueryDefinition(region, saveName.trim(), query, chosen, null);
            defs.reload();
          }, "Query saved")
        }
      >
        <SpaceBetween size="m">
          <FormField label="Query name">
            <Input value={saveName} onChange={({ detail }) => setSaveName(detail.value)} />
          </FormField>
          <FormField label="Query" stretch>
            <div style={{ fontFamily: "monospace" }}>
              <Textarea value={query} rows={4} readOnly spellcheck={false} onChange={() => undefined} />
            </div>
          </FormField>
          <Box variant="small">{chosen.length === 0 ? "No log groups are saved with the query." : `Saved with ${chosen.length} log group${chosen.length === 1 ? "" : "s"}.`}</Box>
        </SpaceBetween>
      </FormModal>
      <DeleteModal
        visible={deleting !== null}
        resourceKind="saved query"
        names={deleting ? [deleting.name] : []}
        op={`${OP}DeleteQueryDefinition`}
        confirmation="simple"
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.logsDeleteQueryDefinition(region, deleting!.id);
          defs.reload();
        }}
      />
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The CloudWatch Logs page for a route path, or null when the path is not a Logs page. */
export function logsPage(path: string, query: URLSearchParams): ReactNode | null {
  const groups = { text: "Log groups", href: href("/cloudwatch/logs/groups") };
  if (path === "/cloudwatch/logs" || path === "/cloudwatch/logs/groups") {
    return page([groups], <UiOnlyScope primaryOp={`${OP}DescribeLogGroups`}><GroupsList /></UiOnlyScope>, "table");
  }
  if (path === "/cloudwatch/logs/create-group") {
    return page([groups, { text: "Create log group", href: href("/cloudwatch/logs/create-group") }], <CreateGroup />, "form");
  }
  if (path === "/cloudwatch/logs/group") {
    const name = query.get("name");
    if (!name) return page([groups], <Missing what="The log group name" />);
    return page([groups, { text: name, href: groupHref(name) }], <UiOnlyScope primaryOp={`${OP}DescribeLogGroups`}><GroupDetails key={name} name={name} /></UiOnlyScope>);
  }
  if (path === "/cloudwatch/logs/events") {
    const group = query.get("group");
    const stream = query.get("stream") || null;
    if (!group) return page([groups], <Missing what="The log group name" />);
    const crumbs = [groups, { text: group, href: groupHref(group) }, ...(stream ? [{ text: stream, href: eventsHref(group, stream) }] : []), { text: "Log events", href: eventsHref(group, stream ?? undefined) }];
    return page(
      crumbs,
      <UiOnlyScope primaryOp={`${OP}${stream ? "GetLogEvents" : "FilterLogEvents"}`}>
        <LogEvents key={`${group}|${stream ?? ""}`} group={group} stream={stream} />
      </UiOnlyScope>,
      "table",
    );
  }
  if (path === "/cloudwatch/logs/insights") {
    return page([{ text: "Logs Insights", href: href("/cloudwatch/logs/insights") }], <UiOnlyScope primaryOp={`${OP}DescribeLogGroups`}><Insights /></UiOnlyScope>);
  }
  return null;
}
