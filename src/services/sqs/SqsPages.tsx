// Amazon SQS console pages: queues, create and edit queue, queue details with its tabs, and send
// and receive messages. A queue is addressed by its URL, as the console's routes do.

import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import Toggle from "@cloudscape-design/components/toggle";
import { useEffect, useState, type ReactNode } from "react";
import { commands, type MessageAttribute, type SqsMessage_Serialize, type SqsQueue_Serialize } from "../../bindings";
import { useReportUnsupported } from "../../capability";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceTable, textProperty, ScopeBanner, UiOnlyScope, useUiOnly, type ResourceTableColumn } from "../../patterns";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, matchPath, navigate } from "../../shell/router";
import { Copyable, EditTagsModal, formatBytes, formatDate, FormModal, GatedDropdown, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "Amazon SQS", href: href("/sqs/queues") },
  items: [{ type: "link" as const, text: "Queues", href: href("/sqs/queues") }],
};

const HELP: HelpContent = {
  header: "Amazon SQS",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Queues of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">The emulator answers with queue URLs on real AWS host names; the app still sends every request to the local emulator.</Box>
    </SpaceBetween>
  ),
};

export const queueHref = (url: string, suffix = "", tab?: string) => href(`/sqs/queues/${encodeURIComponent(url)}${suffix}`, { tab });
const queueName = (url: string) => url.slice(url.lastIndexOf("/") + 1);

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Amazon SQS", href: href("/sqs/queues") }, { text: "Queues", href: href("/sqs/queues") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

function duration(seconds: string | undefined): string {
  if (seconds === undefined) return "-";
  const s = Number(seconds);
  if (s >= 86400 && s % 86400 === 0) return `${s / 86400} day${s === 86400 ? "" : "s"}`;
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? "" : "s"}`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? "" : "s"}`;
  return `${s} second${s === 1 ? "" : "s"}`;
}

function redrive(attrs: Record<string, string> | undefined): { arn: string; max: number } | null {
  try {
    const r = JSON.parse(attrs?.RedrivePolicy ?? "");
    return r?.deadLetterTargetArn ? { arn: r.deadLetterTargetArn, max: Number(r.maxReceiveCount) } : null;
  } catch {
    return null;
  }
}

// Queues ------------------------------------------------------------------------------------------

type QueueRow = SqsQueue_Serialize & { type: string; available: number; inFlight: number; createdAt: Date | null };

const COLUMNS: ResourceTableColumn<QueueRow>[] = [
  { id: "name", header: "Name", cell: (q) => <Link href={queueHref(q.url)}>{q.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "type", header: "Type", cell: (q) => q.type, sortingField: "type" },
  { id: "created", header: "Created", cell: (q) => formatDate(q.created), sortingField: "createdAt" },
  { id: "available", header: "Messages available", cell: (q) => q.available, sortingField: "available" },
  { id: "inFlight", header: "Messages in flight", cell: (q) => q.inFlight, sortingField: "inFlight" },
  { id: "encryption", header: "Encryption", cell: (q) => q.encryption ?? "Disabled" },
  { id: "dedup", header: "Content-based deduplication", cell: (q) => (q.fifo ? (q.content_based_deduplication ? "Enabled" : "Disabled") : "-") },
];

function QueuesList() {
  const region = useRegion();
  const queues = useLoad(() => commands.sqsListQueues(region), []);
  const { run } = useAction();
  const [deleting, setDeleting] = useState<QueueRow | null>(null);
  const [purging, setPurging] = useState<QueueRow | null>(null);
  const rows: QueueRow[] = (queues.data ?? []).map((q) => ({ ...q, type: q.fifo ? "FIFO" : "Standard", available: q.messages_available ?? 0, inFlight: q.messages_in_flight ?? 0, createdAt: q.created ? new Date(q.created) : null }));
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={queues.error} onRetry={queues.reload} />
      <ResourceTable<QueueRow>
        resourceName="Queue"
        title="Queues"
        help={HELP}
        items={rows}
        loading={queues.loading}
        columns={COLUMNS}
        filteringProperties={[textProperty("name", "Name"), textProperty("type", "Type", "enum")]}
        trackBy="url"
        preferencesKey="sqs.queues"
        selectionType="single"
        onRefresh={queues.reload}
        emptyAction={
          <GatedButton op="sqs:CreateQueue" href={href("/sqs/queues/create")}>
            Create queue
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sqs:SetQueueAttributes" disabled={sel.length !== 1} href={sel[0] ? queueHref(sel[0].url, "/edit") : undefined}>
              Edit
            </GatedButton>
            <GatedButton op="sqs:DeleteQueue" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedDropdown
              items={[
                { id: "send", text: "Send and receive messages", op: "sqs:SendMessage", disabled: sel.length !== 1 },
                { id: "purge", text: "Purge", op: "sqs:PurgeQueue", disabled: sel.length !== 1 },
              ]}
              onItemClick={(id) => (id === "send" ? navigate(queueHref(sel[0].url, "/send-receive")) : setPurging(sel[0]))}
            />
            <GatedButton variant="primary" op="sqs:CreateQueue" href={href("/sqs/queues/create")}>
              Create queue
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="queue" names={deleting ? [deleting.name] : []} op="sqs:DeleteQueue" confirmation="typed" warning="Deleting the queue deletes every message in it." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.sqsDeleteQueue(region, deleting!.url); queues.reload(); }} />
      <PurgeModal url={purging?.url ?? null} onDismiss={() => setPurging(null)} onPurge={(url) => run(async () => { await commands.sqsPurgeQueue(region, url); queues.reload(); }, `Queue ${queueName(purging!.url)} purged`)} />
    </SpaceBetween>
  );
}

function PurgeModal({ url, onDismiss, onPurge }: { url: string | null; onDismiss: () => void; onPurge: (url: string) => Promise<boolean> }) {
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [url]);
  return (
    <FormModal visible={url !== null} header="Purge queue" op="sqs:PurgeQueue" submitLabel="Purge" canSubmit={typed === "purge"} onDismiss={onDismiss} onSubmit={() => onPurge(url!)}>
      <SpaceBetween size="m">
        <Box variant="p">Purging queue {url ? queueName(url) : ""} deletes all of its messages. You can't undo this action.</Box>
        <FormField label='To confirm, enter "purge" in the text input field.'>
          <Input value={typed} placeholder="purge" onChange={({ detail }) => setTyped(detail.value)} />
        </FormField>
      </SpaceBetween>
    </FormModal>
  );
}

// Create and edit queue ---------------------------------------------------------------------------

interface QueueDraft {
  fifo: boolean;
  name: string;
  visibility: string;
  retention: string;
  delay: string;
  maxSize: string;
  wait: string;
  dedup: boolean;
  sse: boolean;
  policy: string;
  dlq: boolean;
  dlqArn: string;
  maxReceive: string;
}

const DEFAULTS: QueueDraft = { fifo: false, name: "", visibility: "30", retention: "345600", delay: "0", maxSize: "1048576", wait: "0", dedup: false, sse: true, policy: "", dlq: false, dlqArn: "", maxReceive: "10" };

function draftOf(url: string, a: Record<string, string>): QueueDraft {
  const r = redrive(a);
  return {
    fifo: a.FifoQueue === "true",
    name: queueName(url),
    visibility: a.VisibilityTimeout ?? DEFAULTS.visibility,
    retention: a.MessageRetentionPeriod ?? DEFAULTS.retention,
    delay: a.DelaySeconds ?? DEFAULTS.delay,
    maxSize: a.MaximumMessageSize ?? DEFAULTS.maxSize,
    wait: a.ReceiveMessageWaitTimeSeconds ?? DEFAULTS.wait,
    dedup: a.ContentBasedDeduplication === "true",
    sse: a.SqsManagedSseEnabled === "true",
    policy: prettyJson(a.Policy),
    dlq: r !== null,
    dlqArn: r?.arn ?? "",
    maxReceive: r ? String(r.max) : DEFAULTS.maxReceive,
  };
}

function attributesOf(d: QueueDraft, create: boolean): Record<string, string> {
  const a: Record<string, string> = {
    VisibilityTimeout: d.visibility,
    MessageRetentionPeriod: d.retention,
    DelaySeconds: d.delay,
    MaximumMessageSize: d.maxSize,
    ReceiveMessageWaitTimeSeconds: d.wait,
    SqsManagedSseEnabled: String(d.sse),
    Policy: d.policy.trim() ? JSON.stringify(JSON.parse(d.policy)) : "",
    RedrivePolicy: d.dlq ? JSON.stringify({ deadLetterTargetArn: d.dlqArn, maxReceiveCount: Number(d.maxReceive) }) : "",
  };
  if (d.fifo) {
    if (create) a.FifoQueue = "true";
    a.ContentBasedDeduplication = String(d.dedup);
  }
  // An empty value on create means "not set"; on edit it clears the attribute.
  if (create) for (const k of Object.keys(a)) if (a[k] === "") delete a[k];
  return a;
}

const RANGES: [keyof QueueDraft, string, string, number, number][] = [
  ["visibility", "Visibility timeout", "Seconds a received message stays hidden from other consumers, 0 to 43200.", 0, 43200],
  ["retention", "Message retention period", "Seconds a message is kept, 60 to 1209600 (14 days).", 60, 1209600],
  ["delay", "Delivery delay", "Seconds a new message stays hidden, 0 to 900.", 0, 900],
  ["maxSize", "Maximum message size", "Bytes, 1024 to 1048576 (1 MiB).", 1024, 1048576],
  ["wait", "Receive message wait time", "Seconds a receive waits for a message (long polling), 0 to 20.", 0, 20],
];

function QueueForm({ url }: { url: string | null }) {
  const region = useRegion();
  const editing = url !== null;
  const existing = useLoad(() => commands.sqsGetQueue(region, url!), [url], editing);
  const [draft, setDraft] = useState<QueueDraft>(DEFAULTS);
  const [initial, setInitial] = useState<QueueDraft>(DEFAULTS);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (existing.data) {
      const d = draftOf(url!, existing.data.attributes);
      setDraft(d);
      setInitial(d);
    }
  }, [existing.data, url]);
  const set = <K extends keyof QueueDraft>(k: K, v: QueueDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const validate = () => {
    const e: Record<string, string | undefined> = {};
    const base = draft.fifo ? draft.name.replace(/\.fifo$/, "") : draft.name;
    if (!editing && !/^[a-zA-Z0-9_-]{1,80}$/.test(base)) e.name = "Use 1 to 80 letters, numbers, hyphens (-) and underscores (_).";
    if (!editing && draft.fifo && !draft.name.endsWith(".fifo")) e.name = 'The name of a FIFO queue must end with the ".fifo" suffix.';
    for (const [k, , , min, max] of RANGES) {
      const n = Number(draft[k]);
      if (!Number.isInteger(n) || n < min || n > max) e[k] = `Enter a whole number from ${min} to ${max}.`;
    }
    e.policy = jsonError(draft.policy);
    if (draft.dlq && !draft.dlqArn.startsWith("arn:")) e.dlqArn = "Enter the ARN of the dead-letter queue.";
    setErrors(e);
    return Object.values(e).every((x) => !x);
  };

  return (
    <CreateForm
      title={editing ? `Edit ${queueName(url)}` : "Create queue"}
      help={HELP}
      mode={editing ? "edit" : "create"}
      submitLabel={editing ? "Save" : "Create queue"}
      op={editing ? "sqs:SetQueueAttributes" : "sqs:CreateQueue"}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial) || tags.length > 0}
      cancelHref={editing ? queueHref(url) : href("/sqs/queues")}
      validate={validate}
      onSubmit={async () => {
        if (editing) {
          await commands.sqsSetQueueAttributes(region, url, attributesOf(draft, false));
          return queueHref(url);
        }
        const created = await commands.sqsCreateQueue(region, { name: draft.name, attributes: attributesOf(draft, true), tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })) });
        return queueHref(created);
      }}
    >
      <SpaceBetween size="l">
        <LoadError error={existing.error} />
        <Container header={<Header variant="h2">Details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Type" description="You can't change the queue type after you create a queue.">
              <Tiles
                value={draft.fifo ? "fifo" : "standard"}
                onChange={({ detail }) => {
                  const fifo = detail.value === "fifo";
                  setDraft((d) => ({ ...d, fifo, name: fifo && d.name && !d.name.endsWith(".fifo") ? `${d.name}.fifo` : !fifo ? d.name.replace(/\.fifo$/, "") : d.name }));
                }}
                items={[
                  { value: "standard", label: "Standard", description: "At-least-once delivery, message ordering isn't preserved.", disabled: editing },
                  { value: "fifo", label: "FIFO", description: "First-in-first-out delivery, message ordering is preserved.", disabled: editing },
                ]}
              />
            </FormField>
            <FormField label="Name" errorText={errors.name} constraintText={`A queue name is case-sensitive and can have up to 80 characters.${draft.fifo ? ' The name of a FIFO queue must end with the ".fifo" suffix.' : ""}`}>
              <Input value={draft.name} disabled={editing} placeholder="Enter a name for the queue" onChange={({ detail }) => set("name", detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Configuration</Header>}>
          <ColumnLayout columns={2}>
            {RANGES.map(([k, label, constraint]) => (
              <FormField key={k} label={label} constraintText={constraint} errorText={errors[k]}>
                <Input type="number" value={draft[k] as string} onChange={({ detail }) => set(k, detail.value)} />
              </FormField>
            ))}
            {draft.fifo && (
              <FormField label="Content-based deduplication" description="Uses a SHA-256 hash of the message body as the deduplication ID.">
                <Toggle checked={draft.dedup} onChange={({ detail }) => set("dedup", detail.checked)}>
                  Enabled
                </Toggle>
              </FormField>
            )}
          </ColumnLayout>
        </Container>
        <Container header={<Header variant="h2" description="Amazon SQS provides in-transit encryption by default. To add at-rest encryption to your queue, enable server-side encryption.">Encryption</Header>}>
          <Toggle checked={draft.sse} onChange={({ detail }) => set("sse", detail.checked)} description="Amazon SQS key (SSE-SQS)">
            Server-side encryption
          </Toggle>
        </Container>
        <Container header={<Header variant="h2" description="Define who can access your queue. An empty policy removes it.">Access policy</Header>}>
          <JsonEditor label="Access policy (JSON)" value={draft.policy} onChange={(v) => set("policy", v)} rows={10} />
        </Container>
        <Container header={<Header variant="h2" description="Send undeliverable messages to a dead-letter queue.">Dead-letter queue</Header>}>
          <SpaceBetween size="m">
            <Toggle checked={draft.dlq} onChange={({ detail }) => set("dlq", detail.checked)}>
              Enabled
            </Toggle>
            {draft.dlq && (
              <ColumnLayout columns={2}>
                <FormField label="Dead-letter queue ARN" errorText={errors.dlqArn} description="The queue must be of the same type as this queue.">
                  <Input value={draft.dlqArn} placeholder="arn:aws:sqs:us-east-1:000000000000:my-dlq" onChange={({ detail }) => set("dlqArn", detail.value)} />
                </FormField>
                <FormField label="Maximum receives" constraintText="1 to 1000.">
                  <Input type="number" value={draft.maxReceive} onChange={({ detail }) => set("maxReceive", detail.value)} />
                </FormField>
              </ColumnLayout>
            )}
          </SpaceBetween>
        </Container>
        {!editing && (
          <Container header={<Header variant="h2" description="A tag is a label assigned to an AWS resource.">Tags - optional</Header>}>
            <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
          </Container>
        )}
      </SpaceBetween>
    </CreateForm>
  );
}

// Queue details -----------------------------------------------------------------------------------

/** The emulator's queue URL for an SQS ARN: `https://sqs.<region>.amazonaws.com/<account>/<name>`. */
export function queueUrlOfArn(arn: string): string {
  const p = arn.split(":");
  return `https://sqs.${p[3]}.amazonaws.com/${p[4]}/${p[5]}`;
}

/** Adds a statement that lets `topicArn` send to the queue, keeping every existing statement. */
export function allowTopic(policy: string | undefined, queueArn: string, topicArn: string): string {
  let doc: { Version?: string; Statement?: unknown[] } = {};
  try {
    doc = policy ? JSON.parse(policy) : {};
  } catch {
    doc = {};
  }
  const statements = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement ? [doc.Statement] : [];
  const sid = `topic-subscription-${topicArn}`;
  const statement = {
    Sid: sid,
    Effect: "Allow",
    Principal: { Service: "sns.amazonaws.com" },
    Action: "SQS:SendMessage",
    Resource: queueArn,
    Condition: { ArnLike: { "aws:SourceArn": topicArn } },
  };
  return JSON.stringify({ Version: doc.Version ?? "2012-10-17", Statement: [...statements.filter((s) => (s as { Sid?: string }).Sid !== sid), statement] });
}

function SnsSubscriptionsTab({ arn }: { arn: string }) {
  const region = useRegion();
  const { run } = useAction();
  const subs = useLoad(async () => (await commands.snsListSubscriptions(region)).filter((s) => s.endpoint === arn), [arn]);
  const [subscribing, setSubscribing] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const { uiOnly } = useUiOnly();
  const topicList = useLoad(() => commands.snsListTopics(region), [subscribing], subscribing);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={subs.error ?? topicList.error} />
      <Table
        variant="container"
        items={uiOnly ? [] : (subs.data ?? [])}
        loading={subs.loading}
        trackBy="arn"
        columnDefinitions={[
          { id: "arn", header: "Subscription ARN", cell: (s) => <Link href={href(`/sns/subscription/${encodeURIComponent(s.arn)}`)}>{s.arn}</Link>, isRowHeader: true },
          { id: "topic", header: "Topic ARN", cell: (s) => <Link href={href(`/sns/topic/${encodeURIComponent(s.topic_arn)}`)}>{s.topic_arn}</Link> },
          { id: "status", header: "Status", cell: (s) => s.status },
        ]}
        empty={<Box textAlign="center" color="inherit">No subscriptions. Subscribe this queue to an Amazon SNS topic to receive its messages.</Box>}
        header={
          <Header variant="h2" counter={`(${uiOnly ? 0 : (subs.data?.length ?? 0)})`} actions={<GatedButton op="sns:Subscribe" onClick={() => setSubscribing(true)}>Subscribe to Amazon SNS topic</GatedButton>}>
            Amazon SNS subscriptions
          </Header>
        }
      />
      <FormModal
        visible={subscribing}
        header="Subscribe to Amazon SNS topic"
        op="sns:Subscribe"
        submitLabel="Save"
        canSubmit={topic !== null}
        onDismiss={() => setSubscribing(false)}
        onSubmit={() =>
          run(async () => {
            // As the console does: grant the topic SendMessage in the queue policy, without which
            // SNS (and the emulator) drops every delivery to the queue.
            const current = (await commands.sqsGetQueue(region, queueUrlOfArn(arn))).attributes.Policy;
            await commands.sqsSetQueueAttributes(region, queueUrlOfArn(arn), { Policy: allowTopic(current, arn, topic!) });
            await commands.snsSubscribe(region, { topic_arn: topic!, protocol: "sqs", endpoint: arn, attributes: {} });
            subs.reload();
          }, "Subscribed the queue to the topic")
        }
      >
        <FormField label="Specify an Amazon SNS topic available for this queue">
          <Select placeholder="Choose a topic" statusType={topicList.loading ? "loading" : "finished"} selectedOption={topic ? { value: topic, label: topic } : null} options={(topicList.data ?? []).map((t) => ({ value: t.arn, label: t.arn }))} onChange={({ detail }) => setTopic(detail.selectedOption.value ?? null)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

function DeadLetterTab({ url, attrs }: { url: string; attrs: Record<string, string> }) {
  const region = useRegion();
  const r = redrive(attrs);
  const sources = useLoad(() => commands.sqsListDeadLetterSources(region, url), [url]);
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="Messages that this queue's consumers fail to process go to the dead-letter queue.">Dead-letter queue</Header>}>
        <KeyValuePairs columns={2} items={[{ label: "Dead-letter queue", value: r ? r.arn : "Disabled" }, { label: "Maximum receives", value: r ? r.max : "-" }]} />
      </Container>
      <UiOnlyScope primaryOp="sqs:ListDeadLetterSourceQueues">
        <SourcesTable items={uiOnly ? [] : (sources.data ?? [])} loading={sources.loading} error={sources.error} />
      </UiOnlyScope>
    </SpaceBetween>
  );
}

function SourcesTable({ items, loading, error }: { items: string[]; loading: boolean; error: string | null }) {
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="s">
      <ScopeBanner />
      <LoadError error={uiOnly ? null : error} />
      <Table
        variant="container"
        items={uiOnly ? [] : items.map((u) => ({ url: u }))}
        loading={loading && !uiOnly}
        trackBy="url"
        columnDefinitions={[{ id: "name", header: "Name", cell: (s) => <Link href={queueHref(s.url)}>{queueName(s.url)}</Link>, isRowHeader: true }, { id: "url", header: "URL", cell: (s) => s.url }]}
        empty={<Box textAlign="center" color="inherit">No queues use this queue as their dead-letter queue.</Box>}
        header={<Header variant="h2" description="Queues whose redrive policy names this queue.">Source queues</Header>}
      />
    </SpaceBetween>
  );
}

function QueueDetails({ url }: { url: string }) {
  const region = useRegion();
  const { run } = useAction();
  const queue = useLoad(() => commands.sqsGetQueue(region, url), [url]);
  const tags = useLoad(() => commands.sqsListTags(region, url), [url]);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const q = queue.data?.queue;
  const a = queue.data?.attributes ?? {};
  const arn = q?.arn ?? "";
  return (
    <SpaceBetween size="m">
      <LoadError error={queue.error} onRetry={queue.reload} />
      <DetailsPage
        title={queueName(url)}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sqs:SetQueueAttributes" href={queueHref(url, "/edit")}>
              Edit
            </GatedButton>
            <GatedButton op="sqs:DeleteQueue" onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
            <GatedButton op="sqs:PurgeQueue" onClick={() => setPurging(true)}>
              Purge
            </GatedButton>
            <GatedButton variant="primary" op="sqs:SendMessage" href={queueHref(url, "/send-receive")}>
              Send and receive messages
            </GatedButton>
          </SpaceBetween>
        }
        overview={{
          title: "Details",
          columns: 3,
          items: [
            { label: "Name", value: queueName(url) },
            { label: "Type", value: q ? (q.fifo ? "FIFO" : "Standard") : "-" },
            { label: "ARN", value: arn ? <Copyable value={arn} label="ARN" /> : "-" },
            { label: "Encryption", value: q?.encryption ?? "Disabled" },
            { label: "URL", value: <Copyable value={url} label="URL" /> },
            { label: "Dead-letter queue", value: redrive(a)?.arn ?? "-" },
            { label: "Created", value: formatDate(q?.created) },
            { label: "Messages available", value: q?.messages_available ?? "-" },
            { label: "Messages in flight", value: q?.messages_in_flight ?? "-" },
            { label: "Maximum message size", value: a.MaximumMessageSize ? formatBytes(Number(a.MaximumMessageSize)) : "-" },
            { label: "Message retention period", value: duration(a.MessageRetentionPeriod) },
            { label: "Default visibility timeout", value: duration(a.VisibilityTimeout) },
            { label: "Delivery delay", value: duration(a.DelaySeconds) },
            { label: "Receive message wait time", value: duration(a.ReceiveMessageWaitTimeSeconds) },
            { label: "Content-based deduplication", value: q?.fifo ? (q.content_based_deduplication ? "Enabled" : "Disabled") : "-" },
          ],
        }}
        sections={[
          { id: "sns", label: "SNS subscriptions", content: arn ? <UiOnlyScope primaryOp="sns:ListSubscriptions"><SnsSubscriptionsTab arn={arn} /></UiOnlyScope> : null },
          {
            id: "lambda",
            label: "Lambda triggers",
            content: (
              <Container header={<Header variant="h2">Lambda triggers</Header>}>
                <Box color="text-status-inactive">Lambda function triggers are not available in this version of AWStudio.</Box>
              </Container>
            ),
          },
          { id: "dlq", label: "Dead-letter queue", content: <DeadLetterTab url={url} attrs={a} /> },
          { id: "tagging", label: "Tagging", content: <TagsTable tags={tags.data} loading={tags.loading} op="sqs:TagQueue" onEdit={() => setEditTags(true)} /> },
          {
            id: "policy",
            label: "Access policy",
            content: <Container header={<Header variant="h2">Access policy</Header>}>{a.Policy ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(a.Policy)}</pre> : <Box color="text-status-inactive">No access policy.</Box>}</Container>,
          },
          {
            id: "encryption",
            label: "Encryption",
            content: <Container header={<Header variant="h2">Encryption</Header>}><KeyValuePairs columns={2} items={[{ label: "Server-side encryption", value: q?.encryption ? "Enabled" : "Disabled" }, { label: "Encryption key type", value: q?.encryption === "SSE-KMS" ? `AWS KMS key ${a.KmsMasterKeyId}` : q?.encryption === "SSE-SQS" ? "Amazon SQS key (SSE-SQS)" : "-" }]} /></Container>,
          },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="queue" names={[queueName(url)]} op="sqs:DeleteQueue" confirmation="typed" warning="Deleting the queue deletes every message in it." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.sqsDeleteQueue(region, url); navigate(href("/sqs/queues")); }} />
      <PurgeModal url={purging ? url : null} onDismiss={() => setPurging(false)} onPurge={() => run(async () => { await commands.sqsPurgeQueue(region, url); queue.reload(); }, `Queue ${queueName(url)} purged`)} />
      <EditTagsModal
        visible={editTags}
        tags={tags.data ?? []}
        op="sqs:TagQueue"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((t) => before.find((b) => b.key === t.key)?.value !== t.value);
            const remove = before.filter((b) => !next.some((t) => t.key === b.key)).map((b) => b.key);
            await commands.sqsUpdateTags(region, url, set, remove);
            tags.reload();
          }, "Queue tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Send and receive --------------------------------------------------------------------------------

const ATTRIBUTE_TYPES = ["String", "Number", "Binary"].map((t) => ({ value: t, label: t }));

function SendReceive({ url }: { url: string }) {
  const region = useRegion();
  const report = useReportUnsupported();
  const { run } = useAction();
  const queue = useLoad(() => commands.sqsGetQueue(region, url), [url]);
  const fifo = queue.data?.queue.fifo ?? url.endsWith(".fifo");
  const [body, setBody] = useState("");
  const [delay, setDelay] = useState("0");
  const [groupId, setGroupId] = useState("");
  const [dedupId, setDedupId] = useState("");
  const [attributes, setAttributes] = useState<MessageAttribute[]>([]);
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useState("20");
  const [max, setMax] = useState("10");
  const [polling, setPolling] = useState(false);
  const [messages, setMessages] = useState<SqsMessage_Serialize[]>([]);
  const [selected, setSelected] = useState<SqsMessage_Serialize[]>([]);
  const [viewing, setViewing] = useState<SqsMessage_Serialize | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    const ok = await run(
      () => commands.sqsSendMessage(region, url, { body, delay_seconds: fifo ? null : Number(delay) || 0, group_id: fifo ? groupId : null, deduplication_id: fifo ? dedupId : null, attributes: attributes.filter((a) => a.name) }),
      `Your message has been sent and is ready to be received.`,
    );
    setSending(false);
    if (ok) {
      setBody("");
      setDedupId("");
      queue.reload();
    }
  };

  const poll = async () => {
    setPolling(true);
    setPollError(null);
    try {
      const got = await commands.sqsReceiveMessages(region, url, Number(max) || 10, Number(wait) || 0, null);
      setMessages((prev) => [...got, ...prev.filter((p) => !got.some((g) => g.message_id === p.message_id))]);
      queue.reload();
    } catch (e) {
      report(e);
      setPollError(errorText(e));
    } finally {
      setPolling(false);
    }
  };

  const remove = async () => {
    for (const m of selected) {
      if (!(await run(() => commands.sqsDeleteMessage(region, url, m.receipt_handle)))) return;
    }
    setMessages((prev) => prev.filter((p) => !selected.some((s) => s.message_id === p.message_id)));
    setSelected([]);
    queue.reload();
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`Send messages to and receive messages from ${queueName(url)}.`}>
        Send and receive messages
      </Header>
      <LoadError error={queue.error} />
      <Container header={<Header variant="h2" actions={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => { setBody(""); setAttributes([]); }}>Clear content</Button><GatedButton variant="primary" op="sqs:SendMessage" loading={sending} disabled={!body || (fifo && !groupId) || (fifo && !queue.data?.queue.content_based_deduplication && !dedupId)} onClick={send}>Send message</GatedButton></SpaceBetween>}>Send message</Header>}>
        <SpaceBetween size="l">
          <FormField label="Message body" stretch>
            <Textarea value={body} rows={6} placeholder="Enter message body" onChange={({ detail }) => setBody(detail.value)} />
          </FormField>
          {fifo ? (
            <ColumnLayout columns={2}>
              <FormField label="Message group ID" description="Messages of one group are delivered in order.">
                <Input value={groupId} onChange={({ detail }) => setGroupId(detail.value)} />
              </FormField>
              <FormField label="Message deduplication ID" description={queue.data?.queue.content_based_deduplication ? "Optional: content-based deduplication is on." : "Required: content-based deduplication is off."}>
                <Input value={dedupId} onChange={({ detail }) => setDedupId(detail.value)} />
              </FormField>
            </ColumnLayout>
          ) : (
            <FormField label="Delivery delay" constraintText="Seconds, 0 to 900.">
              <Input type="number" value={delay} onChange={({ detail }) => setDelay(detail.value)} />
            </FormField>
          )}
          <FormField label="Message attributes - optional" stretch>
            <AttributeEditor<MessageAttribute>
              items={attributes}
              addButtonText="Add new attribute"
              removeButtonText="Remove"
              empty="No message attributes."
              onAddButtonClick={() => setAttributes([...attributes, { name: "", data_type: "String", value: "" }])}
              onRemoveButtonClick={({ detail }) => setAttributes(attributes.filter((_, i) => i !== detail.itemIndex))}
              definition={[
                { label: "Name", control: (a, i) => <Input value={a.name} onChange={({ detail }) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, name: detail.value } : x)))} /> },
                { label: "Type", control: (a, i) => <Select selectedOption={ATTRIBUTE_TYPES.find((t) => t.value === a.data_type) ?? ATTRIBUTE_TYPES[0]} options={ATTRIBUTE_TYPES} onChange={({ detail }) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, data_type: detail.selectedOption.value! } : x)))} /> },
                { label: "Value", control: (a, i) => <Input value={a.value} placeholder={a.data_type === "Binary" ? "Base64 text" : ""} onChange={({ detail }) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, value: detail.value } : x)))} /> },
              ]}
            />
          </FormField>
        </SpaceBetween>
      </Container>
      <Container header={<Header variant="h2" description={`Messages available: ${queue.data?.queue.messages_available ?? "-"}`}>Receive messages</Header>}>
        <ColumnLayout columns={3}>
          <FormField label="Polling duration" constraintText="Seconds a poll waits for messages, 0 to 20.">
            <Input type="number" value={wait} onChange={({ detail }) => setWait(detail.value)} />
          </FormField>
          <FormField label="Maximum message count" constraintText="1 to 10.">
            <Input type="number" value={max} onChange={({ detail }) => setMax(detail.value)} />
          </FormField>
          <FormField label="Poll">
            <GatedButton variant="primary" op="sqs:ReceiveMessage" loading={polling} onClick={poll}>
              Poll for messages
            </GatedButton>
          </FormField>
        </ColumnLayout>
      </Container>
      {pollError && <LoadError error={pollError} />}
      <Table<SqsMessage_Serialize>
        variant="container"
        items={messages}
        trackBy="message_id"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        columnDefinitions={[
          { id: "id", header: "ID", cell: (m) => <Link onFollow={(e) => { e.preventDefault(); setViewing(m); }}>{m.message_id}</Link>, isRowHeader: true },
          { id: "sent", header: "Sent", cell: (m) => formatDate(m.sent) },
          { id: "size", header: "Size", cell: (m) => formatBytes(new TextEncoder().encode(m.body).length) },
          { id: "count", header: "Receive count", cell: (m) => m.receive_count ?? 0 },
          ...(fifo ? [{ id: "group", header: "Message group ID", cell: (m: SqsMessage_Serialize) => m.group_id ?? "-" }] : []),
        ]}
        empty={<Box textAlign="center" color="inherit">No messages. Poll for messages to see what is available in the queue.</Box>}
        header={
          <Header variant="h2" counter={`(${messages.length})`} description="Received messages become visible to other consumers again after the visibility timeout unless you delete them." actions={<GatedButton op="sqs:DeleteMessage" disabled={!selected.length} onClick={remove}>Delete</GatedButton>}>
            Messages
          </Header>
        }
      />
      <Modal visible={viewing !== null} size="large" header={viewing ? `Message: ${viewing.message_id}` : ""} onDismiss={() => setViewing(null)} closeAriaLabel="Close dialog" footer={<Box float="right"><Button variant="primary" onClick={() => setViewing(null)}>Done</Button></Box>}>
        {viewing && (
          <SpaceBetween size="l">
            <KeyValuePairs columns={3} items={[{ label: "Message ID", value: viewing.message_id }, { label: "MD5 of message body", value: viewing.md5_of_body ?? "-" }, { label: "Sent", value: formatDate(viewing.sent) }, { label: "First received", value: formatDate(viewing.first_received) }, { label: "Receive count", value: viewing.receive_count ?? 0 }, { label: "Message group ID", value: viewing.group_id ?? "-" }]} />
            <FormField label="Body" stretch>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(viewing.body)}</pre>
            </FormField>
            <Table
              variant="embedded"
              items={viewing.attributes}
              trackBy="name"
              columnDefinitions={[{ id: "name", header: "Name", cell: (a) => a.name }, { id: "type", header: "Type", cell: (a) => a.data_type }, { id: "value", header: "Value", cell: (a) => a.value }]}
              empty={<Box textAlign="center" color="inherit">No message attributes.</Box>}
              header={<Header variant="h3">Attributes</Header>}
            />
            <StatusIndicator type="info">Deleting the message removes it from the queue.</StatusIndicator>
          </SpaceBetween>
        )}
      </Modal>
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The SQS page for a route path, or null when the path is not an SQS page. */
export function sqsPage(path: string): ReactNode | null {
  if (path === "/sqs" || path === "/sqs/queues") return ( <ConsolePage breadcrumbs={[{ text: "Amazon SQS", href: href("/sqs/queues") }, { text: "Queues", href: href("/sqs/queues") }]} navigation={NAV} help={HELP} contentType="table" content={<UiOnlyScope primaryOp="sqs:ListQueues"><QueuesList /></UiOnlyScope>} /> );
  if (path === "/sqs/queues/create") return page([{ text: "Create queue", href: href("/sqs/queues/create") }], <QueueForm url={null} />, "form");
  const sub = matchPath("/sqs/queues/:url/:view", path);
  if (sub?.view === "edit") return page([{ text: queueName(sub.url), href: queueHref(sub.url) }, { text: "Edit", href: queueHref(sub.url, "/edit") }], <UiOnlyScope primaryOp="sqs:GetQueueAttributes"><QueueForm key={sub.url} url={sub.url} /></UiOnlyScope>, "form");
  if (sub?.view === "send-receive") return page([{ text: queueName(sub.url), href: queueHref(sub.url) }, { text: "Send and receive messages", href: queueHref(sub.url, "/send-receive") }], <UiOnlyScope primaryOp="sqs:GetQueueAttributes"><SendReceive key={sub.url} url={sub.url} /></UiOnlyScope>);
  const details = matchPath("/sqs/queues/:url", path);
  if (details) return page([{ text: queueName(details.url), href: queueHref(details.url) }], <UiOnlyScope primaryOp="sqs:GetQueueAttributes"><QueueDetails key={details.url} url={details.url} /></UiOnlyScope>);
  return null;
}
