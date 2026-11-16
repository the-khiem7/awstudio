// Amazon EventBridge console pages: rules (list, create wizard, details with targets, event pattern
// and tags), event buses, archives and send events.

import Alert from "@cloudscape-design/components/alert";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import Toggle from "@cloudscape-design/components/toggle";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { commands, type EventsPutResult_Serialize, type EventsRule_Serialize, type EventsTarget_Deserialize, type EventsTarget_Serialize, type Tag } from "../../bindings";
import { CreateForm, CreateWizard, DeleteModal, DetailsPage, GatedButton, ResourceTable, textProperty, UiOnlyScope, useGate, type ResourceTableColumn } from "../../patterns";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, navigate } from "../../shell/router";
import { queueUrlOfArn } from "../sqs/SqsPages";
import { Copyable, EditTagsModal, formatBytes, formatDate, FormModal, GatedDropdown, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "Amazon EventBridge", href: href("/events/rules") },
  items: [
    { type: "link" as const, text: "Rules", href: href("/events/rules") },
    { type: "link" as const, text: "Event buses", href: href("/events/buses") },
    { type: "link" as const, text: "Archives", href: href("/events/archives") },
    { type: "link" as const, text: "Send events", href: href("/events/send-events") },
  ],
};

const HELP: HelpContent = {
  header: "Amazon EventBridge",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Event buses, rules, targets and archives of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">A rule matches events with an event pattern or runs on a schedule, and sends what it matches to its targets. Adding targets to a rule is only available when the emulator supports it fully.</Box>
    </SpaceBetween>
  ),
};

type ContentType = "table" | "form" | "wizard" | "default";

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: ContentType) {
  return <ConsolePage breadcrumbs={[{ text: "Amazon EventBridge", href: href("/events/rules") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

// Buses and routes --------------------------------------------------------------------------------

const DEFAULT_BUS = "default";

/** The bus argument of the commands: an empty name is the default bus. */
const busArg = (bus: string) => (bus === DEFAULT_BUS ? "" : bus);

const rulesHref = (bus: string) => href("/events/rules", { bus: busArg(bus) });
const createRuleHref = (bus: string) => href("/events/rules/create", { bus: busArg(bus) });
const ruleHref = (bus: string, name: string, tab?: string) => href("/events/rule", { bus: busArg(bus), name, tab });
const BUSES_HREF = href("/events/buses");
const ARCHIVES_HREF = href("/events/archives");

interface BusOption {
  value: string;
  label: string;
  arn: string;
}

/** The event buses of the Region as select options; the default bus is always listed first. */
function useBuses() {
  const region = useRegion();
  const gate = useGate("eventbridge:ListEventBuses");
  const buses = useLoad(() => commands.eventsListBuses(region), [], gate.enabled);
  const options = useMemo<BusOption[]>(() => {
    const list = (buses.data ?? []).map((b) => ({ value: b.name, label: b.name, arn: b.arn }));
    const rest = list.filter((b) => b.value !== DEFAULT_BUS);
    return [list.find((b) => b.value === DEFAULT_BUS) ?? { value: DEFAULT_BUS, label: DEFAULT_BUS, arn: "" }, ...rest];
  }, [buses.data]);
  return { ...buses, options };
}

function BusField({ label = "Event bus", description, value, options, loading, onChange }: { label?: string; description?: string; value: string; options: BusOption[]; loading: boolean; onChange: (bus: string) => void }) {
  const current = value || DEFAULT_BUS;
  return (
    <FormField label={label} description={description}>
      <Select
        statusType={loading ? "loading" : "finished"}
        filteringType="auto"
        selectedOption={options.find((o) => o.value === current) ?? { value: current, label: current }}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        onChange={({ detail }) => onChange(detail.selectedOption.value ?? DEFAULT_BUS)}
      />
    </FormField>
  );
}

// Validation and JSON helpers ---------------------------------------------------------------------

const compactJson = (text: string) => JSON.stringify(JSON.parse(text));

/** The error of an event pattern text, or undefined when it is a JSON object. */
function patternError(text: string): string | undefined {
  const syntax = jsonError(text, false);
  if (syntax) return syntax;
  const value = JSON.parse(text);
  return value && typeof value === "object" && !Array.isArray(value) ? undefined : "An event pattern is a JSON object.";
}

function scheduleError(text: string): string | undefined {
  return /^(rate|cron)\(.+\)$/.test(text.trim()) ? undefined : "Enter a rate(...) or cron(...) expression, for example rate(5 minutes).";
}

const RULE_NAME = /^[.\-_A-Za-z0-9]{1,64}$/;

function tagList(tags: TagEditorProps.Tag[]): Tag[] {
  return tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value }));
}

// Test pattern ------------------------------------------------------------------------------------

const SAMPLE_EVENT = JSON.stringify(
  { id: "1", version: "0", account: "000000000000", time: "2026-01-01T00:00:00Z", region: "us-east-1", source: "my.app", "detail-type": "Order Placed", resources: [], detail: { status: "FAILED", amount: 120 } },
  null,
  2,
);

/** Runs `TestEventPattern` of a pattern against an editable sample event and shows Match or No match. */
function TestPattern({ pattern }: { pattern: string }) {
  const region = useRegion();
  const { run, busy } = useAction();
  const [event, setEvent] = useState(SAMPLE_EVENT);
  const [result, setResult] = useState<boolean | null>(null);
  useEffect(() => setResult(null), [pattern, event]);
  const test = () =>
    run(async () => {
      setResult(await commands.eventsTestEventPattern(region, compactJson(pattern), compactJson(event)));
    });
  return (
    <Container header={<Header variant="h2" description="Check whether a sample event matches the event pattern.">Test pattern</Header>}>
      <SpaceBetween size="m">
        <JsonEditor label="Sample event" value={event} onChange={setEvent} rows={12} allowEmpty={false} />
        <SpaceBetween direction="horizontal" size="s">
          <GatedButton op="eventbridge:TestEventPattern" loading={busy} disabled={!!patternError(pattern) || !!jsonError(event, false)} onClick={test}>
            Test pattern
          </GatedButton>
          {result !== null && <StatusIndicator type={result ? "success" : "error"}>{result ? "Match" : "No match"}</StatusIndicator>}
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );
}

const PATTERN_SAMPLES = [
  { value: "custom", label: "Custom pattern", description: "Events from one source you name.", pattern: '{\n  "source": ["my.app"]\n}' },
  { value: "prefix", label: "Any event from a source prefix", description: "Every event whose source starts with a prefix.", pattern: '{\n  "source": [{ "prefix": "my." }]\n}' },
  { value: "detail-type", label: "A detail type of a source", description: "One kind of event of one source.", pattern: '{\n  "source": ["my.app"],\n  "detail-type": ["Order Placed"]\n}' },
  { value: "detail", label: "A value in the event detail", description: "Events whose detail has one of the listed values.", pattern: '{\n  "source": ["my.app"],\n  "detail": {\n    "status": ["FAILED"]\n  }\n}' },
  { value: "numeric", label: "A numeric comparison", description: "Events whose detail number is above a limit.", pattern: '{\n  "detail": {\n    "amount": [{ "numeric": [">", 100] }]\n  }\n}' },
  { value: "exists", label: "A field that exists", description: "Events whose detail has an error field.", pattern: '{\n  "detail": {\n    "error": [{ "exists": true }]\n  }\n}' },
];

function PatternEditor({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const [sample, setSample] = useState<string | null>("custom");
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="An event pattern is a JSON document that the events to match must contain the fields of.">Event pattern</Header>}>
        <SpaceBetween size="l">
          <FormField label="Sample patterns" description="Choosing a sample replaces the pattern below.">
            <Select
              placeholder="Choose a sample"
              selectedOption={PATTERN_SAMPLES.find((s) => s.value === sample) ?? null}
              options={PATTERN_SAMPLES.map(({ value: v, label, description }) => ({ value: v, label, description }))}
              onChange={({ detail }) => {
                setSample(detail.selectedOption.value ?? null);
                const picked = PATTERN_SAMPLES.find((s) => s.value === detail.selectedOption.value);
                if (picked) onChange(picked.pattern);
              }}
            />
          </FormField>
          <JsonEditor label="Event pattern (JSON)" value={value} onChange={onChange} rows={12} allowEmpty={false} />
          {error && <Box color="text-status-error">{error}</Box>}
        </SpaceBetween>
      </Container>
      <TestPattern pattern={value} />
    </SpaceBetween>
  );
}

// Target form -------------------------------------------------------------------------------------

type TargetKind = "sqs" | "sns" | "lambda" | "other";
type TargetInput = "matched" | "constant" | "transformer";

interface PathRow {
  name: string;
  path: string;
}

interface TargetDraft {
  id: string;
  kind: TargetKind;
  arn: string;
  roleArn: string;
  groupId: string;
  input: TargetInput;
  constant: string;
  paths: PathRow[];
  template: string;
}

const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: "sqs", label: "SQS queue" },
  { value: "sns", label: "SNS topic" },
  { value: "lambda", label: "Lambda function" },
  { value: "other", label: "Other ARN" },
];

const newDraft = (): TargetDraft => ({ id: `target-${Math.random().toString(36).slice(2, 8)}`, kind: "sqs", arn: "", roleArn: "", groupId: "", input: "matched", constant: "", paths: [], template: "" });

const isFifoQueue = (d: TargetDraft) => d.kind === "sqs" && d.arn.trim().endsWith(".fifo");

type TargetErrors = Partial<Record<"id" | "arn" | "group" | "constant" | "paths" | "template", string>>;

function targetErrors(d: TargetDraft, taken: readonly string[]): TargetErrors {
  const e: TargetErrors = {};
  if (!/^[.\-_A-Za-z0-9]{1,64}$/.test(d.id)) e.id = "Use 1 to 64 letters, numbers, periods (.), hyphens (-) and underscores (_).";
  else if (taken.includes(d.id)) e.id = "A target with this ID already exists.";
  if (!d.arn.trim()) e.arn = "Choose a resource or enter an ARN.";
  else if (!/^arn:[^:]+:[^:]+:[^:]*:[^:]*:.+$/.test(d.arn.trim())) e.arn = "Enter a valid ARN.";
  if (isFifoQueue(d) && !d.groupId.trim()) e.group = "A FIFO queue needs a message group ID.";
  if (d.input === "constant") e.constant = jsonError(d.constant, false);
  if (d.input === "transformer") {
    if (d.paths.some((p) => p.name.trim() && !p.path.trim())) e.paths = "Every input path needs a JSONPath, for example $.detail.id.";
    if (!d.template.trim()) e.template = "Enter an input template.";
  }
  return e;
}

const hasErrors = (e: TargetErrors) => Object.values(e).some(Boolean);
/**
 * Lets EventBridge send to the SQS queues among `targets`. The emulator, like SNS, delivers to a queue
 * only when its policy grants the sender `SQS:SendMessage`; without the grant PutTargets succeeds and
 * the queue stays empty. Statements already in the policy are kept.
 */
async function grantQueues(region: string, ruleArn: string, targets: EventsTarget_Deserialize[]): Promise<void> {
  for (const t of targets) {
    const p = t.arn.split(":");
    if (p[2] !== "sqs" || p.length !== 6) continue;
    const url = queueUrlOfArn(t.arn);
    const current = (await commands.sqsGetQueue(region, url)).attributes.Policy;
    let doc: { Version?: string; Statement?: unknown[] } = {};
    try {
      doc = current ? JSON.parse(current) : {};
    } catch {
      doc = {};
    }
    const existing = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement ? [doc.Statement] : [];
    const sid = `events-rule-${ruleArn}`;
    const statement = { Sid: sid, Effect: "Allow", Principal: { Service: "events.amazonaws.com" }, Action: "SQS:SendMessage", Resource: t.arn, Condition: { ArnEquals: { "aws:SourceArn": ruleArn } } };
    const policy = JSON.stringify({ Version: doc.Version ?? "2012-10-17", Statement: [...existing.filter((s) => (s as { Sid?: string }).Sid !== sid), statement] });
    await commands.sqsSetQueueAttributes(region, url, { Policy: policy });
  }
}

function draftToTarget(d: TargetDraft): EventsTarget_Deserialize {
  return {
    id: d.id,
    arn: d.arn.trim(),
    role_arn: d.roleArn.trim() || null,
    input: d.input === "constant" ? compactJson(d.constant) : null,
    input_path: null,
    input_transformer: d.input === "transformer" ? { paths_map: Object.fromEntries(d.paths.filter((p) => p.name.trim()).map((p) => [p.name.trim(), p.path.trim()])), template: d.template } : null,
    dead_letter_arn: null,
    sqs_message_group_id: isFifoQueue(d) ? d.groupId.trim() : null,
  };
}

const SERVICE_LABEL: Record<string, string> = { sqs: "SQS queue", sns: "SNS topic", lambda: "Lambda function" };

function arnKind(arn: string): string {
  const service = arn.split(":")[2] ?? "";
  return SERVICE_LABEL[service] ?? (service || "-");
}

function inputKind(t: { input?: string | null; input_path?: string | null; input_transformer?: unknown }): string {
  if (t.input_transformer) return "Input transformer";
  if (t.input) return "Constant (JSON text)";
  if (t.input_path) return `Input path ${t.input_path}`;
  return "Matched event";
}

/** The form of one target: the same in the create wizard and in the Add target modal of a rule. */
function TargetForm({ draft, onChange, disabled, errors }: { draft: TargetDraft; onChange: (d: TargetDraft) => void; disabled?: boolean; errors: TargetErrors }) {
  const region = useRegion();
  const queuesGate = useGate("sqs:ListQueues");
  const topicsGate = useGate("sns:ListTopics");
  const functionsGate = useGate("lambda:ListFunctions");
  const queues = useLoad(() => commands.sqsListQueues(region), [], draft.kind === "sqs" && queuesGate.enabled);
  const topics = useLoad(() => commands.snsListTopics(region), [], draft.kind === "sns" && topicsGate.enabled);
  const functions = useLoad(() => commands.lambdaListFunctions(region), [], draft.kind === "lambda" && functionsGate.enabled);
  const set = (patch: Partial<TargetDraft>) => onChange({ ...draft, ...patch });

  const source = draft.kind === "sqs" ? queues : draft.kind === "sns" ? topics : functions;
  const options =
    draft.kind === "sqs"
      ? (queues.data ?? []).flatMap((q) => (q.arn ? [{ value: q.arn, label: q.name, description: q.arn }] : []))
      : draft.kind === "sns"
        ? (topics.data ?? []).map((t) => ({ value: t.arn, label: t.name, description: t.arn }))
        : draft.kind === "lambda"
          ? (functions.data ?? []).map((f) => ({ value: f.arn, label: f.name, description: f.arn }))
          : [];
  const resourceLabel = draft.kind === "sqs" ? "Queue" : draft.kind === "sns" ? "Topic" : "Function";

  return (
    <SpaceBetween size="l">
      <FormField label="Target ID" description="Identifies the target within the rule." errorText={errors.id}>
        <Input value={draft.id} disabled={disabled} onChange={({ detail }) => set({ id: detail.value })} />
      </FormField>
      <FormField label="Target type">
        <Select
          disabled={disabled}
          selectedOption={TARGET_KINDS.find((k) => k.value === draft.kind) ?? TARGET_KINDS[0]}
          options={TARGET_KINDS}
          onChange={({ detail }) => set({ kind: detail.selectedOption.value as TargetKind, arn: "", groupId: "" })}
        />
      </FormField>
      {draft.kind !== "other" && (
        <FormField label={resourceLabel} description={`Choose one of the ${resourceLabel.toLowerCase()}s of this Region, or type an ARN below.`}>
          <SpaceBetween size="xs">
            <Select
              disabled={disabled}
              placeholder={`Choose a ${resourceLabel.toLowerCase()}`}
              statusType={source.loading ? "loading" : "finished"}
              loadingText="Loading"
              empty="Nothing to choose from"
              filteringType="auto"
              selectedOption={options.find((o) => o.value === draft.arn) ?? null}
              options={options}
              onChange={({ detail }) => set({ arn: detail.selectedOption.value ?? "" })}
            />
            <LoadError error={source.error} onRetry={source.reload} />
          </SpaceBetween>
        </FormField>
      )}
      <FormField label="ARN" errorText={errors.arn} description={draft.kind === "other" ? "The ARN of the resource that receives the events." : undefined}>
        <Input value={draft.arn} disabled={disabled} placeholder="arn:aws:service:us-east-1:000000000000:resource" onChange={({ detail }) => set({ arn: detail.value })} />
      </FormField>
      {isFifoQueue(draft) && (
        <FormField label="Message group ID" description="Events sent to a FIFO queue need a message group." errorText={errors.group}>
          <Input value={draft.groupId} disabled={disabled} onChange={({ detail }) => set({ groupId: detail.value })} />
        </FormField>
      )}
      {draft.kind === "other" && (
        <FormField label="Execution role ARN - optional" description="The role that EventBridge assumes to send events to the target.">
          <Input value={draft.roleArn} disabled={disabled} onChange={({ detail }) => set({ roleArn: detail.value })} />
        </FormField>
      )}
      <FormField label="Input" description="What the target receives.">
        <RadioGroup
          value={draft.input}
          onChange={({ detail }) => set({ input: detail.value as TargetInput })}
          items={[
            { value: "matched", label: "Matched event", description: "The whole event that matched the rule.", disabled },
            { value: "constant", label: "Constant (JSON text)", description: "A fixed JSON text instead of the event.", disabled },
            { value: "transformer", label: "Input transformer", description: "Pick parts of the event and put them in a template.", disabled },
          ]}
        />
      </FormField>
      {draft.input === "constant" && (
        <FormField label="Constant" errorText={errors.constant} stretch>
          <div style={{ fontFamily: "monospace" }}>
            <Textarea value={draft.constant} rows={5} readOnly={disabled} spellcheck={false} placeholder='{"key": "value"}' onChange={({ detail }) => set({ constant: detail.value })} />
          </div>
        </FormField>
      )}
      {draft.input === "transformer" && (
        <SpaceBetween size="l">
          <FormField label="Input path" description="Each name can be used in the template as <name>." errorText={errors.paths} stretch>
            <AttributeEditor<PathRow>
              items={draft.paths}
              addButtonText="Add path"
              removeButtonText="Remove"
              empty="No input paths."
              disableAddButton={disabled}
              onAddButtonClick={() => set({ paths: [...draft.paths, { name: "", path: "" }] })}
              onRemoveButtonClick={({ detail }) => set({ paths: draft.paths.filter((_, i) => i !== detail.itemIndex) })}
              definition={[
                { label: "Name", control: (x, i) => <Input value={x.name} disabled={disabled} placeholder="id" onChange={({ detail }) => set({ paths: draft.paths.map((y, j) => (j === i ? { ...y, name: detail.value } : y)) })} /> },
                { label: "JSONPath", control: (x, i) => <Input value={x.path} disabled={disabled} placeholder="$.detail.id" onChange={({ detail }) => set({ paths: draft.paths.map((y, j) => (j === i ? { ...y, path: detail.value } : y)) })} /> },
              ]}
            />
          </FormField>
          <FormField label="Template" description="The text the target receives, with the input path names in angle brackets." errorText={errors.template} stretch>
            <div style={{ fontFamily: "monospace" }}>
              <Textarea value={draft.template} rows={5} readOnly={disabled} spellcheck={false} placeholder='{"order": <id>}' onChange={({ detail }) => set({ template: detail.value })} />
            </div>
          </FormField>
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}

// Rules list --------------------------------------------------------------------------------------

type RuleRow = Omit<EventsRule_Serialize, "description"> & { description: string; status: string; type: string };

function RuleStatus({ enabled }: { enabled: boolean }) {
  return <StatusIndicator type={enabled ? "success" : "stopped"}>{enabled ? "Enabled" : "Disabled"}</StatusIndicator>;
}

function RulesList({ bus }: { bus: string }) {
  const region = useRegion();
  const { run } = useAction();
  const buses = useBuses();
  const rules = useLoad(() => commands.eventsListRules(region, busArg(bus)), [bus]);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const rows: RuleRow[] = (rules.data ?? []).map((r) => ({ ...r, description: r.description ?? "", status: r.state === "ENABLED" ? "Enabled" : "Disabled", type: r.schedule_expression ? "Scheduled" : "Standard" }));
  const columns: ResourceTableColumn<RuleRow>[] = [
    { id: "name", header: "Name", cell: (r) => <Link href={ruleHref(bus, r.name)}>{r.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "status", header: "Status", cell: (r) => <RuleStatus enabled={r.state === "ENABLED"} />, sortingField: "status" },
    { id: "type", header: "Type", cell: (r) => r.type, sortingField: "type" },
    { id: "description", header: "Description", cell: (r) => r.description || "-", sortingField: "description" },
    { id: "bus", header: "Event bus", cell: (r) => r.event_bus_name, sortingField: "event_bus_name" },
  ];
  const setState = (r: RuleRow, enabled: boolean) =>
    run(async () => {
      await commands.eventsSetRuleState(region, busArg(bus), r.name, enabled);
      rules.reload();
    }, `Rule ${r.name} ${enabled ? "enabled" : "disabled"}`);
  return (
    <SpaceBetween size="m">
      <LoadError error={rules.error} onRetry={rules.reload} />
      <BusField label="Event bus" value={bus} options={buses.options} loading={buses.loading} onChange={(b) => navigate(rulesHref(b))} />
      <ResourceTable<RuleRow>
        resourceName="Rule"
        title="Rules"
        help={HELP}
        items={rows}
        loading={rules.loading}
        columns={columns}
        filteringProperties={[textProperty("name", "Name"), textProperty("status", "Status", "enum"), textProperty("type", "Type", "enum"), textProperty("description", "Description")]}
        trackBy="name"
        preferencesKey="events.rules"
        selectionType="single"
        onRefresh={rules.reload}
        emptyAction={
          <GatedButton op="eventbridge:PutRule" href={createRuleHref(bus)}>
            Create rule
          </GatedButton>
        }
        actions={(sel) => {
          const r = sel[0];
          const locked = !r || !!r.managed_by;
          return (
            <SpaceBetween direction="horizontal" size="xs">
              <GatedDropdown
                items={[
                  { id: "enable", text: "Enable", op: "eventbridge:EnableRule", disabled: locked || r.state === "ENABLED" },
                  { id: "disable", text: "Disable", op: "eventbridge:DisableRule", disabled: locked || r.state === "DISABLED" },
                  { id: "delete", text: "Delete", op: "eventbridge:DeleteRule", disabled: locked },
                ]}
                onItemClick={(id) => {
                  if (id === "delete") setDeleting(r);
                  else void setState(r, id === "enable");
                }}
              />
              <GatedButton variant="primary" op="eventbridge:PutRule" href={createRuleHref(bus)}>
                Create rule
              </GatedButton>
            </SpaceBetween>
          );
        }}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="rule"
        names={deleting ? [deleting.name] : []}
        op="eventbridge:DeleteRule"
        confirmation="simple"
        warning="Deleting the rule removes all of its targets first, then the rule."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.eventsDeleteRule(region, busArg(bus), deleting!.name);
          rules.reload();
        }}
      />
    </SpaceBetween>
  );
}

// Create rule -------------------------------------------------------------------------------------

function TargetsStep({ targets, setTargets, draft, setDraft, note }: { targets: TargetDraft[]; setTargets: (t: TargetDraft[]) => void; draft: TargetDraft; setDraft: (d: TargetDraft) => void; note?: string }) {
  const gate = useGate("eventbridge:PutTargets");
  const [showErrors, setShowErrors] = useState(false);
  const errors = showErrors ? targetErrors(draft, targets.map((t) => t.id)) : {};
  const add = () => {
    if (hasErrors(targetErrors(draft, targets.map((t) => t.id)))) {
      setShowErrors(true);
      return;
    }
    setTargets([...targets, draft]);
    setDraft(newDraft());
    setShowErrors(false);
  };
  return (
    <SpaceBetween size="l">
      {!gate.enabled && (
        <Alert type="info" header="Targets can't be added now">
          {gate.reason}. The rule can still be created without targets, and targets can be added to it later.
        </Alert>
      )}
      {note && <Alert type="warning">{note}</Alert>}
      <Table
        variant="container"
        items={targets}
        trackBy="id"
        header={<Header variant="h2" counter={`(${targets.length})`}>Targets to add</Header>}
        empty={<Box textAlign="center" color="inherit"><b>No targets</b><Box variant="p" color="inherit">The rule is created without targets.</Box></Box>}
        columnDefinitions={[
          { id: "id", header: "Target ID", cell: (t) => t.id, isRowHeader: true },
          { id: "type", header: "Type", cell: (t) => arnKind(t.arn) },
          { id: "arn", header: "ARN", cell: (t) => t.arn },
          { id: "input", header: "Input", cell: (t) => inputKind(draftToTarget(t)) },
          { id: "remove", header: "", cell: (t) => <Button variant="inline-link" onClick={() => setTargets(targets.filter((x) => x.id !== t.id))}>Remove</Button> },
        ]}
      />
      <Container header={<Header variant="h2" description="Choose where the events that match the rule are sent.">Add target</Header>}>
        <SpaceBetween size="l">
          <TargetForm draft={draft} onChange={setDraft} disabled={!gate.enabled} errors={errors} />
          <GatedButton op="eventbridge:PutTargets" onClick={add}>
            Add target
          </GatedButton>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

function CreateRule({ bus: initialBus }: { bus: string }) {
  const region = useRegion();
  const buses = useBuses();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bus, setBus] = useState(initialBus || DEFAULT_BUS);
  const [type, setType] = useState<"pattern" | "schedule">("pattern");
  const [schedule, setSchedule] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [pattern, setPattern] = useState(PATTERN_SAMPLES[0].pattern);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [draft, setDraft] = useState<TargetDraft>(newDraft);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [detailErrors, setDetailErrors] = useState<Partial<Record<"name" | "description" | "schedule", string>>>({});
  const [patternErr, setPatternErr] = useState<string>();
  const [targetNote, setTargetNote] = useState<string>();

  const detailProblems = () => ({
    name: RULE_NAME.test(name) ? undefined : "Use 1 to 64 letters, numbers, periods (.), hyphens (-) and underscores (_).",
    description: description.length <= 512 ? undefined : "Use at most 512 characters.",
    schedule: type === "schedule" ? (scheduleError(schedule) ?? (bus !== DEFAULT_BUS ? "Scheduled rules can only be created on the default event bus." : undefined)) : undefined,
  });

  const stepDetail = {
    title: "Define rule detail",
    content: (
      <Container header={<Header variant="h2">Rule detail</Header>}>
        <SpaceBetween size="l">
          <FormField label="Name" errorText={detailErrors.name} constraintText="Maximum 64 characters. Letters, numbers, periods (.), hyphens (-) and underscores (_).">
            <Input value={name} placeholder="my-rule" onChange={({ detail }) => setName(detail.value)} />
          </FormField>
          <FormField label="Description - optional" errorText={detailErrors.description}>
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <BusField value={bus} options={buses.options} loading={buses.loading} onChange={setBus} description="The bus the rule receives events from." />
          <FormField label="Rule type">
            <Tiles
              value={type}
              onChange={({ detail }) => setType(detail.value as "pattern" | "schedule")}
              items={[
                { value: "pattern", label: "Rule with an event pattern", description: "Runs when an event that matches the pattern arrives on the bus." },
                { value: "schedule", label: "Schedule", description: "Runs at a fixed rate or at times given by a cron expression." },
              ]}
            />
          </FormField>
          {type === "schedule" && (
            <FormField label="Schedule expression" errorText={detailErrors.schedule} constraintText="For example rate(5 minutes) or cron(0 12 * * ? *). Scheduled rules belong to the default event bus.">
              <Input value={schedule} placeholder="rate(5 minutes)" onChange={({ detail }) => setSchedule(detail.value)} />
            </FormField>
          )}
          <Toggle checked={enabled} onChange={({ detail }) => setEnabled(detail.checked)} description="A disabled rule is kept but does not run.">
            Enable the rule
          </Toggle>
        </SpaceBetween>
      </Container>
    ),
    validate: () => {
      const e = detailProblems();
      setDetailErrors(e);
      return !e.name && !e.description && !e.schedule;
    },
  };

  const stepPattern = {
    title: "Build event pattern",
    content: <PatternEditor value={pattern} onChange={setPattern} error={patternErr} />,
    validate: () => {
      const e = patternError(pattern);
      setPatternErr(e);
      return !e;
    },
  };

  const stepTargets = {
    title: "Select target(s)",
    isOptional: true,
    content: <TargetsStep targets={targets} setTargets={setTargets} draft={draft} setDraft={setDraft} note={targetNote} />,
    validate: () => {
      if (draft.arn.trim()) {
        setTargetNote("Choose Add target to keep the target you filled in, or clear its ARN.");
        return false;
      }
      setTargetNote(undefined);
      return true;
    },
  };

  const stepTags = {
    title: "Configure tags",
    isOptional: true,
    content: (
      <Container header={<Header variant="h2" description="A tag is a label that you can assign to the rule.">Tags</Header>}>
        <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
      </Container>
    ),
  };

  const stepReview = {
    title: "Review and create",
    content: (
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Rule detail</Header>}>
          <KeyValuePairs
            columns={3}
            items={[
              { label: "Name", value: name || "-" },
              { label: "Event bus", value: bus },
              { label: "Status", value: <RuleStatus enabled={enabled} /> },
              { label: "Type", value: type === "schedule" ? "Scheduled" : "Standard" },
              { label: "Description", value: description || "-" },
              ...(type === "schedule" ? [{ label: "Schedule", value: schedule || "-" }] : []),
            ]}
          />
        </Container>
        {type === "pattern" && (
          <Container header={<Header variant="h2">Event pattern</Header>}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pattern}</pre>
          </Container>
        )}
        <Table
          variant="container"
          items={targets}
          trackBy="id"
          header={<Header variant="h2" counter={`(${targets.length})`}>Targets</Header>}
          empty={<Box color="text-status-inactive">No targets.</Box>}
          columnDefinitions={[
            { id: "id", header: "Target ID", cell: (t) => t.id, isRowHeader: true },
            { id: "type", header: "Type", cell: (t) => arnKind(t.arn) },
            { id: "arn", header: "ARN", cell: (t) => t.arn },
            { id: "input", header: "Input", cell: (t) => inputKind(draftToTarget(t)) },
          ]}
        />
        <Container header={<Header variant="h2" counter={`(${tagList(tags).length})`}>Tags</Header>}>
          {tagList(tags).length === 0 ? <Box color="text-status-inactive">No tags.</Box> : tagList(tags).map((t) => <div key={t.key}>{t.key}: {t.value || "-"}</div>)}
        </Container>
      </SpaceBetween>
    ),
  };

  return (
    <CreateWizard
      steps={type === "pattern" ? [stepDetail, stepPattern, stepTargets, stepTags, stepReview] : [stepDetail, stepTargets, stepTags, stepReview]}
      submitLabel="Create rule"
      op="eventbridge:PutRule"
      dirty={name !== "" || description !== "" || targets.length > 0}
      cancelHref={rulesHref(initialBus)}
      doneHref={ruleHref(bus, name)}
      onSubmit={async () => {
        const e = detailProblems();
        const problem = e.name ?? e.description ?? e.schedule ?? (type === "pattern" ? patternError(pattern) : undefined);
        if (problem) throw new Error(problem);
        const ruleArn = await commands.eventsPutRule(region, {
          name,
          bus: busArg(bus),
          description: description || null,
          event_pattern: type === "pattern" ? compactJson(pattern) : null,
          schedule_expression: type === "schedule" ? schedule.trim() : null,
          enabled,
          role_arn: null,
          tags: tagList(tags),
        });
        if (targets.length === 0) return;
        try {
          const payload = targets.map(draftToTarget);
          await grantQueues(region, ruleArn, payload);
          await commands.eventsPutTargets(region, busArg(bus), name, payload);
        } catch (err) {
          throw new Error(`The rule ${name} was created, but adding its targets failed: ${errorText(err)}. Add the targets from the Targets tab of the rule.`);
        }
      }}
    />
  );
}

// Rule details ------------------------------------------------------------------------------------

function RuleDetails({ bus, name }: { bus: string; name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const readTargets = useGate("eventbridge:ListTargetsByRule");
  const readTags = useGate("eventbridge:ListTagsForResource");
  const rule = useLoad(() => commands.eventsDescribeRule(region, busArg(bus), name), [bus, name]);
  const r = rule.data;
  const arn = r?.arn ?? "";
  const targets = useLoad(() => commands.eventsListTargets(region, busArg(bus), name), [bus, name], readTargets.enabled);
  const tags = useLoad(() => commands.eventsListTags(region, arn), [arn], !!arn && readTags.enabled);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editTags, setEditTags] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TargetDraft>(newDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const scheduled = !!r?.schedule_expression;
  const enabled = r?.state === "ENABLED";

  const setState = (on: boolean) =>
    run(async () => {
      await commands.eventsSetRuleState(region, busArg(bus), name, on);
      rule.reload();
    }, `Rule ${name} ${on ? "enabled" : "disabled"}`);

  const editError = scheduled ? scheduleError(editSchedule) : patternError(editPattern);
  const takenIds = (targets.data ?? []).map((t) => t.id);
  const columns: ResourceTableColumn<EventsTarget_Serialize>[] = [
    { id: "id", header: "Target ID", cell: (t) => t.id, sortingField: "id", isRowHeader: true, alwaysVisible: true },
    { id: "type", header: "Type", cell: (t) => arnKind(t.arn) },
    { id: "arn", header: "ARN", cell: (t) => t.arn, sortingField: "arn" },
    { id: "input", header: "Input", cell: (t) => inputKind(t) },
    { id: "role", header: "Execution role", cell: (t) => t.role_arn ?? "-", hidden: true },
    { id: "dlq", header: "Dead-letter queue", cell: (t) => t.dead_letter_arn ?? "-", hidden: true },
  ];

  return (
    <SpaceBetween size="m">
      <LoadError error={rule.error} onRetry={rule.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton
              op="eventbridge:PutRule"
              disabled={!r || !!r.managed_by}
              onClick={() => {
                setEditDescription(r?.description ?? "");
                setEditPattern(r?.event_pattern ? prettyJson(r.event_pattern) : "");
                setEditSchedule(r?.schedule_expression ?? "");
                setEditing(true);
              }}
            >
              Edit
            </GatedButton>
            <GatedDropdown
              items={[
                { id: "enable", text: "Enable", op: "eventbridge:EnableRule", disabled: !r || !!r.managed_by || enabled },
                { id: "disable", text: "Disable", op: "eventbridge:DisableRule", disabled: !r || !!r.managed_by || (!!r && !enabled) },
                { id: "delete", text: "Delete", op: "eventbridge:DeleteRule", disabled: !r || !!r.managed_by },
              ]}
              onItemClick={(id) => {
                if (id === "delete") setDeleting(true);
                else void setState(id === "enable");
              }}
            />
          </SpaceBetween>
        }
        overview={{
          title: "Details",
          columns: 3,
          items: [
            { label: "Name", value: name },
            { label: "ARN", value: r ? <Copyable value={r.arn} label="ARN" /> : "-" },
            { label: "Status", value: r ? <RuleStatus enabled={enabled} /> : "-" },
            { label: "Event bus", value: <Link href={rulesHref(bus || DEFAULT_BUS)}>{r?.event_bus_name ?? (bus || DEFAULT_BUS)}</Link> },
            { label: "Type", value: r ? (scheduled ? "Scheduled" : "Standard") : "-" },
            { label: scheduled ? "Schedule" : "Event pattern", value: r ? (scheduled ? r.schedule_expression : r.event_pattern ? "See the Event pattern tab" : "-") : "-" },
            { label: "Description", value: r?.description ?? "-" },
          ],
        }}
        sections={[
          {
            id: "targets",
            label: "Targets",
            content: (
              <SpaceBetween size="m">
                <LoadError error={targets.error} onRetry={targets.reload} />
                {!readTargets.enabled && <Box color="text-status-inactive">Targets: {readTargets.reason}.</Box>}
                <ResourceTable<EventsTarget_Serialize>
                  resourceName="Target"
                  title="Targets"
                  variant="container"
                  items={targets.data ?? []}
                  loading={targets.loading}
                  columns={columns}
                  filteringProperties={[textProperty("id", "Target ID"), textProperty("arn", "ARN")]}
                  trackBy="id"
                  preferencesKey="events.targets"
                  selectionType="multi"
                  onRefresh={targets.reload}
                  emptyAction={
                    <GatedButton
                      op="eventbridge:PutTargets"
                      onClick={() => {
                        setDraft(newDraft());
                        setShowErrors(false);
                        setAdding(true);
                      }}
                    >
                      Add target
                    </GatedButton>
                  }
                  actions={(sel) => (
                    <SpaceBetween direction="horizontal" size="xs">
                      <GatedButton op="eventbridge:RemoveTargets" disabled={sel.length === 0} onClick={() => setRemoving(sel.map((t) => t.id))}>
                        Remove
                      </GatedButton>
                      <GatedButton
                        variant="primary"
                        op="eventbridge:PutTargets"
                        onClick={() => {
                          setDraft(newDraft());
                          setShowErrors(false);
                          setAdding(true);
                        }}
                      >
                        Add target
                      </GatedButton>
                    </SpaceBetween>
                  )}
                />
              </SpaceBetween>
            ),
          },
          {
            id: "pattern",
            label: "Event pattern",
            content: scheduled ? (
              <Container header={<Header variant="h2">Event pattern</Header>}>
                <Box color="text-status-inactive">This rule runs on a schedule ({r?.schedule_expression}) and has no event pattern.</Box>
              </Container>
            ) : (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Event pattern</Header>}>
                  {r?.event_pattern ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(r.event_pattern)}</pre> : <Box color="text-status-inactive">The rule has no event pattern.</Box>}
                </Container>
                {r?.event_pattern && <TestPattern pattern={prettyJson(r.event_pattern)} />}
              </SpaceBetween>
            ),
          },
          {
            id: "tags",
            label: "Tags",
            content: (
              <>
                <LoadError error={tags.error} />
                <TagsTable tags={tags.data} loading={tags.loading} op="eventbridge:TagResource" onEdit={() => setEditTags(true)} />
              </>
            ),
          },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="rule"
        names={[name]}
        op="eventbridge:DeleteRule"
        confirmation="simple"
        warning="Deleting the rule removes all of its targets first, then the rule."
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.eventsDeleteRule(region, busArg(bus), name);
          navigate(rulesHref(bus || DEFAULT_BUS));
        }}
      />
      <FormModal
        visible={editing}
        size="large"
        header={`Edit ${name}`}
        op="eventbridge:PutRule"
        canSubmit={!editError}
        onDismiss={() => setEditing(false)}
        onSubmit={() =>
          run(async () => {
            await commands.eventsPutRule(region, {
              name,
              bus: busArg(bus),
              description: editDescription || null,
              event_pattern: scheduled ? null : compactJson(editPattern),
              schedule_expression: scheduled ? editSchedule.trim() : null,
              enabled,
              role_arn: r?.role_arn ?? null,
              tags: [],
            });
            rule.reload();
          }, "Rule updated")
        }
      >
        <SpaceBetween size="l">
          <FormField label="Description - optional" errorText={editDescription.length > 512 ? "Use at most 512 characters." : undefined}>
            <Input value={editDescription} onChange={({ detail }) => setEditDescription(detail.value)} />
          </FormField>
          {scheduled ? (
            <FormField label="Schedule expression" errorText={editError} constraintText="For example rate(5 minutes) or cron(0 12 * * ? *).">
              <Input value={editSchedule} onChange={({ detail }) => setEditSchedule(detail.value)} />
            </FormField>
          ) : (
            <JsonEditor label="Event pattern (JSON)" value={editPattern} onChange={setEditPattern} rows={14} allowEmpty={false} />
          )}
          <Box color="text-body-secondary">The targets of the rule are not changed.</Box>
        </SpaceBetween>
      </FormModal>
      <FormModal
        visible={adding}
        size="large"
        header="Add target"
        submitLabel="Add target"
        op="eventbridge:PutTargets"
        onDismiss={() => setAdding(false)}
        onSubmit={async () => {
          if (hasErrors(targetErrors(draft, takenIds))) {
            setShowErrors(true);
            return false;
          }
          return run(async () => {
            const payload = [draftToTarget(draft)];
            await grantQueues(region, rule.data?.arn ?? "", payload);
            await commands.eventsPutTargets(region, busArg(bus), name, payload);
            targets.reload();
          }, "Target added");
        }}
      >
        <TargetForm draft={draft} onChange={setDraft} errors={showErrors ? targetErrors(draft, takenIds) : {}} />
      </FormModal>
      <FormModal
        visible={removing !== null}
        header="Remove targets"
        submitLabel="Remove"
        op="eventbridge:RemoveTargets"
        onDismiss={() => setRemoving(null)}
        onSubmit={() =>
          run(async () => {
            await commands.eventsRemoveTargets(region, busArg(bus), name, removing ?? []);
            targets.reload();
          }, "Targets removed")
        }
      >
        <Box variant="span">
          Remove {removing && removing.length === 1 ? "target " : `${removing?.length ?? 0} targets: `}
          <Box variant="span" fontWeight="bold">
            {(removing ?? []).join(", ")}
          </Box>{" "}
          from the rule? The rule stops sending events to {removing && removing.length === 1 ? "it" : "them"}.
        </Box>
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={tags.data ?? []}
        op="eventbridge:TagResource"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.eventsUpdateTags(region, arn, set, remove);
            tags.reload();
          }, "Rule tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Event buses -------------------------------------------------------------------------------------

interface BusRow {
  name: string;
  arn: string;
  description: string;
  created: string | null;
  last_modified: string | null;
}

function BusesList() {
  const region = useRegion();
  const buses = useLoad(() => commands.eventsListBuses(region), []);
  const [deleting, setDeleting] = useState<BusRow | null>(null);
  const rows: BusRow[] = (buses.data ?? []).map((b) => ({ ...b, description: b.description ?? "" }));
  const columns: ResourceTableColumn<BusRow>[] = [
    { id: "name", header: "Name", cell: (b) => <Link href={rulesHref(b.name)}>{b.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "description", header: "Description", cell: (b) => b.description || "-", sortingField: "description" },
    { id: "arn", header: "ARN", cell: (b) => b.arn, sortingField: "arn" },
    { id: "created", header: "Created", cell: (b) => formatDate(b.created), hidden: true },
    { id: "modified", header: "Last modified", cell: (b) => formatDate(b.last_modified), hidden: true },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={buses.error} onRetry={buses.reload} />
      <ResourceTable<BusRow>
        resourceName="Event bus"
        title="Event buses"
        help={HELP}
        items={rows}
        loading={buses.loading}
        columns={columns}
        filteringProperties={[textProperty("name", "Name"), textProperty("description", "Description"), textProperty("arn", "ARN")]}
        trackBy="name"
        preferencesKey="events.buses"
        selectionType="single"
        onRefresh={buses.reload}
        emptyAction={
          <GatedButton op="eventbridge:CreateEventBus" href={href("/events/buses/create")}>
            Create event bus
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="eventbridge:DeleteEventBus" disabled={sel.length !== 1 || sel[0].name === DEFAULT_BUS} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="eventbridge:CreateEventBus" href={href("/events/buses/create")}>
              Create event bus
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="event bus"
        names={deleting ? [deleting.name] : []}
        op="eventbridge:DeleteEventBus"
        confirmation="typed"
        warning="Rules and archives that use the event bus stop working."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.eventsDeleteBus(region, deleting!.name);
          buses.reload();
        }}
      />
    </SpaceBetween>
  );
}

function CreateBus() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <CreateForm
      title="Create event bus"
      help={HELP}
      mode="create"
      submitLabel="Create event bus"
      op="eventbridge:CreateEventBus"
      dirty={name !== "" || description !== ""}
      cancelHref={BUSES_HREF}
      validate={() => {
        const e = {
          name: name === DEFAULT_BUS ? "The default event bus exists already." : /^[/.\-_A-Za-z0-9]{1,256}$/.test(name) ? undefined : "Use 1 to 256 letters, numbers, periods (.), hyphens (-), underscores (_) and slashes (/).",
          description: description.length <= 512 ? undefined : "Use at most 512 characters.",
        };
        setErrors(e);
        return !e.name && !e.description;
      }}
      onSubmit={async () => {
        await commands.eventsCreateBus(region, name, description || null);
        return rulesHref(name);
      }}
    >
      <Container header={<Header variant="h2">Event bus detail</Header>}>
        <SpaceBetween size="l">
          <FormField label="Name" errorText={errors.name} constraintText="Maximum 256 characters. Letters, numbers, periods (.), hyphens (-), underscores (_) and slashes (/).">
            <Input value={name} placeholder="my-bus" onChange={({ detail }) => setName(detail.value)} />
          </FormField>
          <FormField label="Description - optional" errorText={errors.description}>
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Container>
    </CreateForm>
  );
}

// Archives ----------------------------------------------------------------------------------------

interface ArchiveRow {
  name: string;
  source: string;
  state: string;
  retention: string;
  events: number | null;
  size: number | null;
  created: string | null;
}

function ArchivesList() {
  const region = useRegion();
  const archives = useLoad(() => commands.eventsListArchives(region, null), []);
  const [deleting, setDeleting] = useState<ArchiveRow | null>(null);
  const rows: ArchiveRow[] = (archives.data ?? []).map((a) => ({
    name: a.name,
    source: a.event_source_arn.slice(a.event_source_arn.lastIndexOf("/") + 1),
    state: a.state,
    retention: a.retention_days ? `${a.retention_days} days` : "Indefinite",
    events: a.event_count,
    size: a.size_bytes,
    created: a.created,
  }));
  const columns: ResourceTableColumn<ArchiveRow>[] = [
    { id: "name", header: "Name", cell: (a) => a.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
    { id: "source", header: "Event source", cell: (a) => <Link href={rulesHref(a.source)}>{a.source}</Link>, sortingField: "source" },
    { id: "state", header: "State", cell: (a) => <StatusIndicator type={a.state === "ENABLED" ? "success" : a.state.endsWith("FAILED") ? "error" : "pending"}>{a.state}</StatusIndicator>, sortingField: "state" },
    { id: "retention", header: "Retention", cell: (a) => a.retention, sortingField: "retention" },
    { id: "events", header: "Events", cell: (a) => a.events ?? "-" },
    { id: "size", header: "Size", cell: (a) => formatBytes(a.size) },
    { id: "created", header: "Created", cell: (a) => formatDate(a.created), hidden: true },
  ];
  return (
    <SpaceBetween size="m">
      <LoadError error={archives.error} onRetry={archives.reload} />
      <ResourceTable<ArchiveRow>
        resourceName="Archive"
        title="Archives"
        help={HELP}
        items={rows}
        loading={archives.loading}
        columns={columns}
        filteringProperties={[textProperty("name", "Name"), textProperty("source", "Event source"), textProperty("state", "State", "enum")]}
        trackBy="name"
        preferencesKey="events.archives"
        selectionType="single"
        onRefresh={archives.reload}
        emptyAction={
          <GatedButton op="eventbridge:CreateArchive" href={href("/events/archives/create")}>
            Create archive
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="eventbridge:DeleteArchive" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="eventbridge:CreateArchive" href={href("/events/archives/create")}>
              Create archive
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="archive"
        names={deleting ? [deleting.name] : []}
        op="eventbridge:DeleteArchive"
        confirmation="simple"
        warning="Deleting the archive deletes the events it holds."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.eventsDeleteArchive(region, deleting!.name);
          archives.reload();
        }}
      />
    </SpaceBetween>
  );
}

function CreateArchive() {
  const region = useRegion();
  const buses = useBuses();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [pattern, setPattern] = useState("");
  const [retention, setRetention] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const sourceArn = source || (buses.options.find((o) => o.value === DEFAULT_BUS)?.arn ?? "");
  return (
    <CreateForm
      title="Create archive"
      help={HELP}
      mode="create"
      submitLabel="Create archive"
      op="eventbridge:CreateArchive"
      dirty={name !== "" || description !== "" || pattern !== "" || retention !== ""}
      cancelHref={ARCHIVES_HREF}
      validate={() => {
        const days = retention.trim();
        const e = {
          name: /^[.\-_A-Za-z0-9]{1,48}$/.test(name) ? undefined : "Use 1 to 48 letters, numbers, periods (.), hyphens (-) and underscores (_).",
          source: sourceArn ? undefined : "Choose an event bus.",
          description: description.length <= 512 ? undefined : "Use at most 512 characters.",
          pattern: pattern.trim() ? patternError(pattern) : undefined,
          retention: days && !/^\d+$/.test(days) ? "Enter a whole number of days, or leave it empty to keep events indefinitely." : undefined,
        };
        setErrors(e);
        return !Object.values(e).some(Boolean);
      }}
      onSubmit={async () => {
        await commands.eventsCreateArchive(region, name, sourceArn, description || null, pattern.trim() ? compactJson(pattern) : null, retention.trim() ? Number(retention) : null);
        return ARCHIVES_HREF;
      }}
    >
      <SpaceBetween size="l">
        <LoadError error={buses.error} onRetry={buses.reload} />
        <Container header={<Header variant="h2">Archive detail</Header>}>
          <SpaceBetween size="l">
            <FormField label="Name" errorText={errors.name} constraintText="Maximum 48 characters. Letters, numbers, periods (.), hyphens (-) and underscores (_).">
              <Input value={name} placeholder="my-archive" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Source event bus" errorText={errors.source} description="The archive keeps the events of this bus.">
              <Select
                statusType={buses.loading ? "loading" : "finished"}
                filteringType="auto"
                placeholder="Choose an event bus"
                selectedOption={buses.options.find((o) => o.arn !== "" && o.arn === sourceArn) ? { value: sourceArn, label: buses.options.find((o) => o.arn === sourceArn)!.label } : null}
                options={buses.options.filter((o) => o.arn !== "").map((o) => ({ value: o.arn, label: o.label, description: o.arn }))}
                onChange={({ detail }) => setSource(detail.selectedOption.value ?? "")}
              />
            </FormField>
            <FormField label="Description - optional" errorText={errors.description}>
              <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
            </FormField>
            <FormField label="Retention period in days - optional" errorText={errors.retention} constraintText="Leave empty to keep the events indefinitely.">
              <Input value={retention} inputMode="numeric" onChange={({ detail }) => setRetention(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="Without an event pattern the archive keeps every event of the bus.">Event pattern - optional</Header>}>
          <JsonEditor label="Event pattern (JSON)" value={pattern} onChange={setPattern} rows={10} />
          {errors.pattern && <Box color="text-status-error">{errors.pattern}</Box>}
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Send events -------------------------------------------------------------------------------------

function SendEvents() {
  const region = useRegion();
  const buses = useBuses();
  const gate = useGate("eventbridge:PutEvents");
  const { run, busy } = useAction();
  const [bus, setBus] = useState(DEFAULT_BUS);
  const [source, setSource] = useState("");
  const [detailType, setDetailType] = useState("");
  const [detail, setDetail] = useState('{\n  "key": "value"\n}');
  const [resources, setResources] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [results, setResults] = useState<EventsPutResult_Serialize[] | null>(null);

  const send = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (!gate.enabled) return;
    let detailError = jsonError(detail, false);
    if (!detailError && (typeof JSON.parse(detail) !== "object" || Array.isArray(JSON.parse(detail)))) detailError = "The event detail is a JSON object.";
    const next = {
      source: source.trim() ? undefined : "Enter a source.",
      detailType: detailType.trim() ? undefined : "Enter a detail type.",
      detail: detailError,
    };
    setErrors(next);
    if (next.source || next.detailType || next.detail) return;
    await run(async () => {
      const entry = {
        bus: busArg(bus) || null,
        source: source.trim(),
        detail_type: detailType.trim(),
        detail: compactJson(detail),
        resources: resources.split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      };
      setResults(await commands.eventsPutEvents(region, [entry]));
    });
  };

  return (
    <form onSubmit={send}>
      <SpaceBetween size="l">
        <Header variant="h1" description="Send an event to an event bus, as an application would with PutEvents.">
          Send events
        </Header>
        <LoadError error={buses.error} onRetry={buses.reload} />
        <Container header={<Header variant="h2">Event</Header>}>
          <SpaceBetween size="l">
            <BusField value={bus} options={buses.options} loading={buses.loading} onChange={setBus} />
            <FormField label="Source" errorText={errors.source} description="Identifies the application that generated the event.">
              <Input value={source} placeholder="my.app" onChange={({ detail: d }) => setSource(d.value)} />
            </FormField>
            <FormField label="Detail type" errorText={errors.detailType} description="The kind of event, for example Order Placed.">
              <Input value={detailType} onChange={({ detail: d }) => setDetailType(d.value)} />
            </FormField>
            <JsonEditor label="Detail" description="The event detail as a JSON object." value={detail} onChange={setDetail} rows={10} allowEmpty={false} />
            {errors.detail && !jsonError(detail, false) && <Box color="text-status-error">{errors.detail}</Box>}
            <FormField label="Resources - optional" description="One ARN per line.">
              <Textarea value={resources} rows={3} onChange={({ detail: d }) => setResources(d.value)} />
            </FormField>
            <GatedButton variant="primary" op="eventbridge:PutEvents" loading={busy}>
              Send event
            </GatedButton>
          </SpaceBetween>
        </Container>
        {results && (
          <Table
            variant="container"
            items={results}
            header={<Header variant="h2">Result</Header>}
            columnDefinitions={[
              { id: "status", header: "Status", cell: (r) => <StatusIndicator type={r.event_id ? "success" : "error"}>{r.event_id ? "Sent" : "Failed"}</StatusIndicator>, isRowHeader: true },
              { id: "id", header: "Event ID", cell: (r) => r.event_id ?? "-" },
              { id: "error", header: "Error", cell: (r) => (r.error_code ? `${r.error_code}: ${r.error_message ?? ""}` : "-") },
            ]}
          />
        )}
      </SpaceBetween>
    </form>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The bus of the `bus` query parameter; absent means the default bus. */
const busOfQuery = (query: URLSearchParams) => query.get("bus") || DEFAULT_BUS;

/** The EventBridge page for a route path, or null when the path is not an EventBridge page. */
export function eventBridgePage(path: string, query: URLSearchParams): ReactNode | null {
  const rules = { text: "Rules", href: href("/events/rules") };
  const buses = { text: "Event buses", href: BUSES_HREF };
  const archives = { text: "Archives", href: ARCHIVES_HREF };
  if (path === "/events" || path === "/events/rules") {
    const bus = busOfQuery(query);
    return page([rules], <UiOnlyScope primaryOp="eventbridge:ListRules"><RulesList key={bus} bus={bus} /></UiOnlyScope>, "table");
  }
  if (path === "/events/rules/create") {
    const bus = busOfQuery(query);
    return page([rules, { text: "Create rule", href: createRuleHref(bus) }], <UiOnlyScope primaryOp="eventbridge:ListEventBuses"><CreateRule key={bus} bus={bus} /></UiOnlyScope>, "wizard");
  }
  if (path === "/events/rule") {
    const name = query.get("name");
    if (!name) return null;
    const bus = busOfQuery(query);
    return page([rules, { text: name, href: ruleHref(bus, name) }], <UiOnlyScope primaryOp="eventbridge:DescribeRule"><RuleDetails key={`${bus}/${name}`} bus={bus} name={name} /></UiOnlyScope>);
  }
  if (path === "/events/buses") return page([buses], <UiOnlyScope primaryOp="eventbridge:ListEventBuses"><BusesList /></UiOnlyScope>, "table");
  if (path === "/events/buses/create") return page([buses, { text: "Create event bus", href: href("/events/buses/create") }], <CreateBus />, "form");
  if (path === "/events/archives") return page([archives], <UiOnlyScope primaryOp="eventbridge:ListArchives"><ArchivesList /></UiOnlyScope>, "table");
  if (path === "/events/archives/create") return page([archives, { text: "Create archive", href: href("/events/archives/create") }], <UiOnlyScope primaryOp="eventbridge:ListEventBuses"><CreateArchive /></UiOnlyScope>, "form");
  if (path === "/events/send-events") return page([{ text: "Send events", href: href("/events/send-events") }], <UiOnlyScope primaryOp="eventbridge:ListEventBuses"><SendEvents /></UiOnlyScope>, "form");
  return null;
}
