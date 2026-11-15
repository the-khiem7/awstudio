// Amazon SNS console pages: dashboard, topics, create topic, topic details, publish message,
// subscriptions, create subscription and subscription details.

import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
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
import { useState, type ReactNode } from "react";
import { commands, type MessageAttribute, type SnsSubscription, type SnsTopic_Serialize } from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceCounts, ResourceTable, ServiceDashboard, textProperty, ScopeBanner, UiOnlyScope, type ResourceTableColumn } from "../../patterns";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, matchPath, navigate } from "../../shell/router";
import { Copyable, EditTagsModal, FormModal, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useGates, useLoad, useRegion } from "../common";
import { allowTopic, queueHref, queueUrlOfArn } from "../sqs/SqsPages";

const NAV = {
  header: { text: "Amazon SNS", href: href("/sns/dashboard") },
  items: [
    { type: "link" as const, text: "Dashboard", href: href("/sns/dashboard") },
    { type: "link" as const, text: "Topics", href: href("/sns/topics") },
    { type: "link" as const, text: "Subscriptions", href: href("/sns/subscriptions") },
  ],
};

const HELP: HelpContent = {
  header: "Amazon SNS",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Topics and subscriptions of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">Publishing to phone numbers and to platform application endpoints is not supported by the emulator.</Box>
    </SpaceBetween>
  ),
};

const topicHref = (arn: string, tab?: string) => href(`/sns/topic/${encodeURIComponent(arn)}`, { tab });
const subscriptionHref = (arn: string) => href(`/sns/subscription/${encodeURIComponent(arn)}`);
const publishHref = (arn: string) => href(`/sns/publish/${encodeURIComponent(arn)}`);
const createSubscriptionHref = (topic?: string) => href("/sns/create-subscription", { topic });
const nameOf = (arn: string) => arn.slice(arn.lastIndexOf(":") + 1);

function queueUrlOf(arn: string): string | null {
  const p = arn.split(":");
  return p.length === 6 && p[2] === "sqs" ? queueUrlOfArn(arn) : null;
}

function Endpoint({ s }: { s: SnsSubscription }) {
  const url = s.protocol === "sqs" ? queueUrlOf(s.endpoint) : null;
  return url ? <Link href={queueHref(url)}>{s.endpoint}</Link> : <>{s.endpoint}</>;
}

function SubscriptionStatus({ status }: { status: string }) {
  return <StatusIndicator type={status === "Confirmed" ? "success" : "pending"}>{status}</StatusIndicator>;
}

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Amazon SNS", href: href("/sns/dashboard") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

// Dashboard ---------------------------------------------------------------------------------------

function Dashboard() {
  const region = useRegion();
  const gates = useGates(["sns:ListSubscriptions"]);
  const topics = useLoad(() => commands.snsListTopics(region), []);
  const subs = useLoad(() => commands.snsListSubscriptions(region), [], gates["sns:ListSubscriptions"].enabled);
  return (
    <ServiceDashboard
      title="Dashboard"
      help={HELP}
      actions={
        <GatedButton variant="primary" op="sns:CreateTopic" href={href("/sns/create-topic")}>
          Create topic
        </GatedButton>
      }
      widgets={[
        {
          id: "resources",
          title: "Resources",
          span: 8,
          content: (
            <SpaceBetween size="m">
              <LoadError error={topics.error ?? subs.error} />
              <ResourceCounts
                items={[
                  { label: "Topics", count: topics.data?.length ?? null, href: href("/sns/topics") },
                  { label: "Subscriptions", count: subs.data?.length ?? null, href: href("/sns/subscriptions") },
                ]}
              />
              {!gates["sns:ListSubscriptions"].enabled && <Box color="text-status-inactive">Subscriptions: {gates["sns:ListSubscriptions"].reason}.</Box>}
            </SpaceBetween>
          ),
        },
        {
          id: "start",
          title: "Get started",
          span: 4,
          content: (
            <SpaceBetween size="s">
              <Box variant="p">Create a topic, subscribe an endpoint such as an SQS queue, then publish a message to it.</Box>
              <GatedButton op="sns:CreateTopic" href={href("/sns/create-topic")}>
                Create topic
              </GatedButton>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Topics ------------------------------------------------------------------------------------------

type TopicRow = SnsTopic_Serialize & { type: string; display: string };

const TOPIC_COLUMNS: ResourceTableColumn<TopicRow>[] = [
  { id: "name", header: "Name", cell: (t) => <Link href={topicHref(t.arn)}>{t.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "type", header: "Type", cell: (t) => t.type, sortingField: "type" },
  { id: "arn", header: "ARN", cell: (t) => t.arn, sortingField: "arn" },
  { id: "display", header: "Display name", cell: (t) => t.display || "-", sortingField: "display", hidden: true },
  { id: "subs", header: "Subscriptions", cell: (t) => (t.subscriptions_confirmed ?? 0) + (t.subscriptions_pending ?? 0) },
];

function TopicsList() {
  const region = useRegion();
  const topics = useLoad(() => commands.snsListTopics(region), []);
  const [deleting, setDeleting] = useState<TopicRow | null>(null);
  const rows: TopicRow[] = (topics.data ?? []).map((t) => ({ ...t, type: t.fifo ? "FIFO" : "Standard", display: t.display_name ?? "" }));
  return (
    <SpaceBetween size="m">
      <LoadError error={topics.error} onRetry={topics.reload} />
      <ResourceTable<TopicRow>
        resourceName="Topic"
        title="Topics"
        help={HELP}
        items={rows}
        loading={topics.loading}
        columns={TOPIC_COLUMNS}
        filteringProperties={[textProperty("name", "Name"), textProperty("type", "Type", "enum"), textProperty("arn", "ARN")]}
        trackBy="arn"
        preferencesKey="sns.topics"
        selectionType="single"
        onRefresh={topics.reload}
        emptyAction={
          <GatedButton op="sns:CreateTopic" href={href("/sns/create-topic")}>
            Create topic
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sns:DeleteTopic" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton op="sns:Publish" disabled={sel.length !== 1} href={sel[0] ? publishHref(sel[0].arn) : undefined}>
              Publish message
            </GatedButton>
            <GatedButton variant="primary" op="sns:CreateTopic" href={href("/sns/create-topic")}>
              Create topic
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="topic" names={deleting ? [deleting.name] : []} op="sns:DeleteTopic" confirmation="typed" warning="Deleting the topic deletes all of its subscriptions." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.snsDeleteTopic(region, deleting!.arn); topics.reload(); }} />
    </SpaceBetween>
  );
}

// Create topic ------------------------------------------------------------------------------------

function CreateTopic() {
  const region = useRegion();
  const [fifo, setFifo] = useState(false);
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [dedup, setDedup] = useState(false);
  const [policy, setPolicy] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [nameError, setNameError] = useState<string>();
  return (
    <CreateForm
      title="Create topic"
      help={HELP}
      mode="create"
      submitLabel="Create topic"
      op="sns:CreateTopic"
      dirty={name !== "" || display !== "" || policy !== ""}
      cancelHref={href("/sns/topics")}
      validate={() => {
        const base = fifo ? name.replace(/\.fifo$/, "") : name;
        let e = /^[a-zA-Z0-9_-]{1,256}$/.test(base) ? undefined : "Use 1 to 256 letters, numbers, hyphens (-) and underscores (_).";
        if (!e && fifo && !name.endsWith(".fifo")) e = 'The name of a FIFO topic must end with ".fifo".';
        setNameError(e);
        return !e && !jsonError(policy);
      }}
      onSubmit={async () => {
        const attributes: Record<string, string> = {};
        if (fifo) {
          attributes.FifoTopic = "true";
          attributes.ContentBasedDeduplication = String(dedup);
        }
        if (display) attributes.DisplayName = display;
        if (policy.trim()) attributes.Policy = JSON.stringify(JSON.parse(policy));
        const arn = await commands.snsCreateTopic(region, { name, attributes, tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })) });
        return topicHref(arn);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Type" description="Topic type can't be modified after the topic is created.">
              <Tiles
                value={fifo ? "fifo" : "standard"}
                onChange={({ detail }) => {
                  const f = detail.value === "fifo";
                  setFifo(f);
                  setName((n) => (f && n && !n.endsWith(".fifo") ? `${n}.fifo` : !f ? n.replace(/\.fifo$/, "") : n));
                }}
                items={[
                  { value: "fifo", label: "FIFO (first-in, first-out)", description: "Strictly-preserved message ordering, exactly-once message delivery. Subscription protocol: SQS." },
                  { value: "standard", label: "Standard", description: "Best-effort message ordering, at-least-once message delivery. Subscription protocols: SQS, Lambda, HTTP, SMS, email, mobile application endpoints." },
                ]}
              />
            </FormField>
            <FormField label="Name" errorText={nameError} constraintText={`Maximum 256 characters. Can include alphanumeric characters, hyphens (-) and underscores (_).${fifo ? ' Must end with ".fifo".' : ""}`}>
              <Input value={name} placeholder="MyTopic" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Display name - optional" description="To use this topic with SMS subscriptions, enter a display name.">
              <Input value={display} onChange={({ detail }) => setDisplay(detail.value)} />
            </FormField>
            {fifo && (
              <Toggle checked={dedup} onChange={({ detail }) => setDedup(detail.checked)} description="Uses a SHA-256 hash of the message body as the deduplication ID.">
                Content-based message deduplication
              </Toggle>
            )}
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="This policy defines who can access your topic. Leave it empty for the default policy.">Access policy - optional</Header>}>
          <JsonEditor label="Access policy (JSON)" value={policy} onChange={setPolicy} rows={10} />
        </Container>
        <Container header={<Header variant="h2" description="A tag is a metadata label that you can assign to an Amazon SNS topic.">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Topic details -----------------------------------------------------------------------------------

function SubscriptionsTable({ items, loading, onRefresh, onDeleted, topic, variant = "container" }: { items: SnsSubscription[]; loading: boolean; onRefresh: () => void; onDeleted: () => void; topic?: string; variant?: "container" | "full-page" }) {
  const region = useRegion();
  const [deleting, setDeleting] = useState<SnsSubscription | null>(null);
  const columns: ResourceTableColumn<SnsSubscription>[] = [
    { id: "id", header: "ID", cell: (s) => (s.arn.startsWith("arn:") ? <Link href={subscriptionHref(s.arn)}>{nameOf(s.arn)}</Link> : s.arn), isRowHeader: true, alwaysVisible: true, sortingField: "arn" },
    { id: "endpoint", header: "Endpoint", cell: (s) => <Endpoint s={s} />, sortingField: "endpoint" },
    { id: "status", header: "Status", cell: (s) => <SubscriptionStatus status={s.status} />, sortingField: "status" },
    { id: "protocol", header: "Protocol", cell: (s) => s.protocol.toUpperCase(), sortingField: "protocol" },
    ...(topic ? [] : [{ id: "topic", header: "Topic", cell: (s: SnsSubscription) => <Link href={topicHref(s.topic_arn)}>{nameOf(s.topic_arn)}</Link>, sortingField: "topic_arn" }]),
  ];
  return (
    <>
      <ResourceTable<SnsSubscription>
        resourceName="Subscription"
        title="Subscriptions"
        variant={variant}
        items={items}
        loading={loading}
        columns={columns}
        filteringProperties={[textProperty("endpoint", "Endpoint"), textProperty("protocol", "Protocol", "enum"), textProperty("status", "Status", "enum")]}
        trackBy="arn"
        preferencesKey={topic ? "sns.topic-subscriptions" : "sns.subscriptions"}
        selectionType="single"
        onRefresh={onRefresh}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sns:Unsubscribe" disabled={sel.length !== 1 || !sel[0].arn.startsWith("arn:")} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton op="sns:ConfirmSubscription" disabled={sel.length !== 1 || sel[0].status === "Confirmed"}>
              Request confirmation
            </GatedButton>
            <GatedButton variant="primary" op="sns:Subscribe" href={createSubscriptionHref(topic)}>
              Create subscription
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="subscription" names={deleting ? [nameOf(deleting.arn)] : []} op="sns:Unsubscribe" confirmation="simple" onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.snsUnsubscribe(region, deleting!.arn); onDeleted(); }} />
    </>
  );
}

function TopicDetails({ arn }: { arn: string }) {
  const region = useRegion();
  const { run } = useAction();
  const topic = useLoad(() => commands.snsGetTopic(region, arn), [arn]);
  const subs = useLoad(() => commands.snsListSubscriptionsByTopic(region, arn), [arn]);
  const tags = useLoad(() => commands.snsListTags(region, arn), [arn]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<"display" | "policy" | null>(null);
  const [text, setText] = useState("");
  const [editTags, setEditTags] = useState(false);
  const t = topic.data?.topic;
  const a = topic.data?.attributes ?? {};
  return (
    <SpaceBetween size="m">
      <LoadError error={topic.error} onRetry={topic.reload} />
      <DetailsPage
        title={nameOf(arn)}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sns:SetTopicAttributes" onClick={() => { setText(a.DisplayName ?? ""); setEditing("display"); }}>
              Edit
            </GatedButton>
            <GatedButton op="sns:DeleteTopic" onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="sns:Publish" href={publishHref(arn)}>
              Publish message
            </GatedButton>
          </SpaceBetween>
        }
        overview={{
          title: "Details",
          columns: 3,
          items: [
            { label: "Name", value: nameOf(arn) },
            { label: "ARN", value: <Copyable value={arn} label="ARN" /> },
            { label: "Type", value: t ? (t.fifo ? "FIFO" : "Standard") : "-" },
            { label: "Display name", value: t?.display_name ?? "-" },
            { label: "Topic owner", value: a.Owner ?? "-" },
            { label: "Content-based message deduplication", value: t?.fifo ? (a.ContentBasedDeduplication === "true" ? "Enabled" : "Disabled") : "-" },
          ],
        }}
        sections={[
          { id: "subscriptions", label: "Subscriptions", content: <><LoadError error={subs.error} /><SubscriptionsTable items={subs.data ?? []} loading={subs.loading} onRefresh={subs.reload} onDeleted={subs.reload} topic={arn} /></> },
          {
            id: "policy",
            label: "Access policy",
            content: (
              <Container header={<Header variant="h2" actions={<GatedButton op="sns:SetTopicAttributes" onClick={() => { setText(prettyJson(a.Policy)); setEditing("policy"); }}>Edit</GatedButton>}>Access policy</Header>}>
                {a.Policy ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(a.Policy)}</pre> : <Box color="text-status-inactive">No access policy.</Box>}
              </Container>
            ),
          },
          { id: "tags", label: "Tags", content: <><LoadError error={tags.error} /><TagsTable tags={tags.data} loading={tags.loading} op="sns:TagResource" onEdit={() => setEditTags(true)} /></> },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="topic" names={[nameOf(arn)]} op="sns:DeleteTopic" confirmation="typed" warning="Deleting the topic deletes all of its subscriptions." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.snsDeleteTopic(region, arn); navigate(href("/sns/topics")); }} />
      <FormModal
        visible={editing !== null}
        size={editing === "policy" ? "large" : "medium"}
        header={editing === "policy" ? "Edit access policy" : `Edit ${nameOf(arn)}`}
        op="sns:SetTopicAttributes"
        canSubmit={editing !== "policy" || !jsonError(text, false)}
        onDismiss={() => setEditing(null)}
        onSubmit={() =>
          run(async () => {
            await commands.snsSetTopicAttribute(region, arn, editing === "policy" ? "Policy" : "DisplayName", editing === "policy" ? JSON.stringify(JSON.parse(text)) : text);
            topic.reload();
          }, "Topic updated")
        }
      >
        {editing === "policy" ? (
          <JsonEditor label="Access policy (JSON)" value={text} onChange={setText} rows={18} allowEmpty={false} />
        ) : (
          <FormField label="Display name" description="To use this topic with SMS subscriptions, enter a display name.">
            <Input value={text} onChange={({ detail }) => setText(detail.value)} />
          </FormField>
        )}
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={tags.data ?? []}
        op="sns:TagResource"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.snsUpdateTags(region, arn, set, remove);
            tags.reload();
          }, "Topic tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Publish message ---------------------------------------------------------------------------------

const ATTRIBUTE_TYPES = ["String", "String.Array", "Number", "Binary"].map((t) => ({ value: t, label: t }));

function Publish({ arn }: { arn: string }) {
  const region = useRegion();
  const topic = useLoad(() => commands.snsGetTopic(region, arn), [arn]);
  const fifo = topic.data?.topic.fifo ?? arn.endsWith(".fifo");
  const [subject, setSubject] = useState("");
  const [structure, setStructure] = useState("identical");
  const [message, setMessage] = useState("");
  const [groupId, setGroupId] = useState("");
  const [dedupId, setDedupId] = useState("");
  const [attributes, setAttributes] = useState<MessageAttribute[]>([]);
  const [error, setError] = useState<string>();
  return (
    <CreateForm
      title="Publish message"
      help={HELP}
      mode="create"
      submitLabel="Publish message"
      op="sns:Publish"
      dirty={message !== "" || subject !== ""}
      cancelHref={topicHref(arn)}
      doneHref={topicHref(arn)}
      validate={() => {
        let e = message ? undefined : "Enter a message body.";
        if (!e && structure === "custom") {
          e = jsonError(message, false);
          if (!e && typeof JSON.parse(message).default !== "string") e = 'A custom payload needs a "default" key with a string value.';
        }
        if (!e && fifo && !groupId) e = "A FIFO topic needs a message group ID.";
        setError(e);
        return !e;
      }}
      onSubmit={async () => {
        await commands.snsPublish(region, { topic_arn: arn, subject: subject || null, message, per_protocol: structure === "custom", group_id: fifo ? groupId : null, deduplication_id: fifo ? dedupId : null, attributes: attributes.filter((x) => x.name) });
      }}
    >
      <SpaceBetween size="l">
        <LoadError error={topic.error} />
        <Container header={<Header variant="h2">Message details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Topic ARN">
              <Box>{arn}</Box>
            </FormField>
            <FormField label="Subject - optional" constraintText="Up to 100 printable ASCII characters.">
              <Input value={subject} onChange={({ detail }) => setSubject(detail.value)} />
            </FormField>
            {fifo && (
              <ColumnLayout columns={2}>
                <FormField label="Message group ID" description="Messages of one group are delivered in order.">
                  <Input value={groupId} onChange={({ detail }) => setGroupId(detail.value)} />
                </FormField>
                <FormField label="Message deduplication ID - optional">
                  <Input value={dedupId} onChange={({ detail }) => setDedupId(detail.value)} />
                </FormField>
              </ColumnLayout>
            )}
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Message body</Header>}>
          <SpaceBetween size="l">
            <FormField label="Message structure">
              <RadioGroup
                value={structure}
                onChange={({ detail }) => setStructure(detail.value)}
                items={[
                  { value: "identical", label: "Identical payload for all delivery protocols.", description: "The same payload is sent to endpoints subscribed to the topic, regardless of their delivery protocol." },
                  { value: "custom", label: "Custom payload for each delivery protocol.", description: 'A JSON object with one message per protocol and a "default" message.' },
                ]}
              />
            </FormField>
            <FormField label="Message body to send to the endpoint" errorText={error} stretch>
              <Textarea value={message} rows={8} onChange={({ detail }) => setMessage(detail.value)} placeholder={structure === "custom" ? '{"default": "Sample fallback message", "sqs": "Sample message for SQS endpoints"}' : ""} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="Message attributes let subscribers filter the messages they receive.">Message attributes</Header>}>
          <AttributeEditor<MessageAttribute>
            items={attributes}
            addButtonText="Add attribute"
            removeButtonText="Remove"
            empty="No message attributes."
            onAddButtonClick={() => setAttributes([...attributes, { name: "", data_type: "String", value: "" }])}
            onRemoveButtonClick={({ detail }) => setAttributes(attributes.filter((_, i) => i !== detail.itemIndex))}
            definition={[
              { label: "Type", control: (x, i) => <Select selectedOption={ATTRIBUTE_TYPES.find((t) => t.value === x.data_type) ?? ATTRIBUTE_TYPES[0]} options={ATTRIBUTE_TYPES} onChange={({ detail }) => setAttributes(attributes.map((y, j) => (j === i ? { ...y, data_type: detail.selectedOption.value! } : y)))} /> },
              { label: "Name", control: (x, i) => <Input value={x.name} onChange={({ detail }) => setAttributes(attributes.map((y, j) => (j === i ? { ...y, name: detail.value } : y)))} /> },
              { label: "Value", control: (x, i) => <Input value={x.value} onChange={({ detail }) => setAttributes(attributes.map((y, j) => (j === i ? { ...y, value: detail.value } : y)))} /> },
            ]}
          />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Subscriptions -----------------------------------------------------------------------------------

function SubscriptionsList() {
  const region = useRegion();
  const subs = useLoad(() => commands.snsListSubscriptions(region), []);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={subs.error} onRetry={subs.reload} />
      <SubscriptionsTable items={subs.data ?? []} loading={subs.loading} onRefresh={subs.reload} onDeleted={subs.reload} variant="full-page" />
    </SpaceBetween>
  );
}

const PROTOCOLS = [
  { value: "sqs", label: "Amazon SQS" },
  { value: "lambda", label: "AWS Lambda" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "email", label: "Email" },
  { value: "email-json", label: "Email-JSON" },
  { value: "firehose", label: "Amazon Data Firehose" },
  { value: "application", label: "Platform application endpoint" },
  { value: "sms", label: "SMS" },
];

const ENDPOINT_HINT: Record<string, string> = {
  sqs: "arn:aws:sqs:us-east-1:000000000000:my-queue",
  lambda: "arn:aws:lambda:us-east-1:000000000000:function:my-function",
  http: "http://www.example.com",
  https: "https://www.example.com",
  email: "user@example.com",
  "email-json": "user@example.com",
  firehose: "arn:aws:firehose:us-east-1:000000000000:deliverystream/my-stream",
  application: "arn:aws:sns:us-east-1:000000000000:endpoint/APNS/my-app/id",
  sms: "+1 555 555 0100",
};

function CreateSubscription({ topic: initial }: { topic: string | null }) {
  const region = useRegion();
  const topics = useLoad(() => commands.snsListTopics(region), []);
  const [topic, setTopic] = useState(initial ?? "");
  const [protocol, setProtocol] = useState("sqs");
  const [endpoint, setEndpoint] = useState("");
  const [filter, setFilter] = useState("");
  const [raw, setRaw] = useState(false);
  const [grant, setGrant] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <CreateForm
      title="Create subscription"
      help={HELP}
      mode="create"
      submitLabel="Create subscription"
      op="sns:Subscribe"
      dirty={endpoint !== "" || filter !== ""}
      cancelHref={initial ? topicHref(initial) : href("/sns/subscriptions")}
      validate={() => {
        const e = { topic: topic ? undefined : "Choose a topic.", endpoint: endpoint ? undefined : "Enter an endpoint.", filter: jsonError(filter) };
        setErrors(e);
        return !e.topic && !e.endpoint && !e.filter;
      }}
      onSubmit={async () => {
        const attributes: Record<string, string> = {};
        if (filter.trim()) attributes.FilterPolicy = JSON.stringify(JSON.parse(filter));
        if (raw && ["sqs", "http", "https", "firehose"].includes(protocol)) attributes.RawMessageDelivery = "true";
        const queueUrl = protocol === "sqs" ? queueUrlOf(endpoint) : null;
        if (queueUrl && grant) {
          const current = (await commands.sqsGetQueue(region, queueUrl)).attributes.Policy;
          await commands.sqsSetQueueAttributes(region, queueUrl, { Policy: allowTopic(current, endpoint, topic) });
        }
        const arn = await commands.snsSubscribe(region, { topic_arn: topic, protocol, endpoint, attributes });
        return arn.startsWith("arn:") ? subscriptionHref(arn) : topicHref(topic);
      }}
    >
      <SpaceBetween size="l">
        <LoadError error={topics.error} />
        <Container header={<Header variant="h2">Details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Topic ARN" errorText={errors.topic}>
              <Select placeholder="Choose a topic" statusType={topics.loading ? "loading" : "finished"} filteringType="auto" selectedOption={topic ? { value: topic, label: topic } : null} options={(topics.data ?? []).map((t) => ({ value: t.arn, label: t.arn }))} onChange={({ detail }) => setTopic(detail.selectedOption.value ?? "")} />
            </FormField>
            <FormField label="Protocol" description="The type of endpoint to subscribe.">
              <Select selectedOption={PROTOCOLS.find((p) => p.value === protocol)!} options={PROTOCOLS} onChange={({ detail }) => setProtocol(detail.selectedOption.value!)} />
            </FormField>
            <FormField label="Endpoint" errorText={errors.endpoint}>
              <Input value={endpoint} placeholder={ENDPOINT_HINT[protocol]} onChange={({ detail }) => setEndpoint(detail.value)} />
            </FormField>
            {protocol === "sqs" && (
              <Toggle checked={grant} onChange={({ detail }) => setGrant(detail.checked)} description="Adds a statement to the queue's access policy that lets this topic send messages to it. Without it, deliveries to the queue are dropped.">
                Allow the topic to send messages to the queue
              </Toggle>
            )}
            {["sqs", "http", "https", "firehose"].includes(protocol) && (
              <Toggle checked={raw} onChange={({ detail }) => setRaw(detail.checked)} description="Deliver the message body without the SNS JSON envelope.">
                Enable raw message delivery
              </Toggle>
            )}
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="A filter policy makes the subscription receive only the messages whose attributes match.">Subscription filter policy - optional</Header>}>
          <JsonEditor label="Filter policy (JSON)" value={filter} onChange={setFilter} rows={8} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

function SubscriptionDetails({ arn }: { arn: string }) {
  const region = useRegion();
  const { run } = useAction();
  const attrs = useLoad(() => commands.snsGetSubscription(region, arn), [arn]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const a = attrs.data ?? {};
  const sub: SnsSubscription = { arn, topic_arn: a.TopicArn ?? "", protocol: a.Protocol ?? "", endpoint: a.Endpoint ?? "", status: a.PendingConfirmation === "true" ? "Pending confirmation" : "Confirmed" };
  return (
    <SpaceBetween size="m">
      <LoadError error={attrs.error} onRetry={attrs.reload} />
      <DetailsPage
        title={`Subscription: ${nameOf(arn)}`}
        help={HELP}
        layout="tabs"
        actions={
          <GatedButton op="sns:Unsubscribe" onClick={() => setDeleting(true)}>
            Delete
          </GatedButton>
        }
        overview={{
          title: "Details",
          columns: 3,
          items: [
            { label: "ARN", value: <Copyable value={arn} label="ARN" /> },
            { label: "Endpoint", value: <Endpoint s={sub} /> },
            { label: "Topic", value: sub.topic_arn ? <Link href={topicHref(sub.topic_arn)}>{nameOf(sub.topic_arn)}</Link> : "-" },
            { label: "Status", value: <SubscriptionStatus status={sub.status} /> },
            { label: "Protocol", value: sub.protocol.toUpperCase() || "-" },
            { label: "Raw message delivery", value: a.RawMessageDelivery === "true" ? "Enabled" : "Disabled" },
          ],
        }}
        sections={[
          {
            id: "filter",
            label: "Subscription filter policy",
            content: (
              <Container header={<Header variant="h2" actions={<GatedButton op="sns:SetSubscriptionAttributes" onClick={() => { setText(prettyJson(a.FilterPolicy)); setEditing(true); }}>Edit</GatedButton>}>Subscription filter policy</Header>}>
                {a.FilterPolicy ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(a.FilterPolicy)}</pre> : <Box color="text-status-inactive">No filter policy. This subscription receives every message published to the topic.</Box>}
              </Container>
            ),
          },
          {
            id: "attributes",
            label: "Attributes",
            content: (
              <Table
                variant="container"
                items={Object.entries(a).map(([name, value]) => ({ name, value }))}
                trackBy="name"
                columnDefinitions={[{ id: "name", header: "Name", cell: (x) => x.name, isRowHeader: true }, { id: "value", header: "Value", cell: (x) => x.value }]}
                header={<Header variant="h2">Attributes</Header>}
              />
            ),
          },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="subscription" names={[nameOf(arn)]} op="sns:Unsubscribe" confirmation="simple" onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.snsUnsubscribe(region, arn); navigate(sub.topic_arn ? topicHref(sub.topic_arn) : href("/sns/topics")); }} />
      <FormModal
        visible={editing}
        size="large"
        header="Edit subscription filter policy"
        op="sns:SetSubscriptionAttributes"
        canSubmit={!jsonError(text)}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.snsSetSubscriptionAttribute(region, arn, "FilterPolicy", text.trim() ? JSON.stringify(JSON.parse(text)) : ""); attrs.reload(); }, "Filter policy updated")}
      >
        <JsonEditor label="Filter policy (JSON)" description="An empty policy removes the filter." value={text} onChange={setText} rows={14} />
      </FormModal>
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The SNS page for a route path, or null when the path is not an SNS page. */
export function snsPage(path: string, query: URLSearchParams): ReactNode | null {
  const topics = { text: "Topics", href: href("/sns/topics") };
  const subscriptions = { text: "Subscriptions", href: href("/sns/subscriptions") };
  if (path === "/sns" || path === "/sns/dashboard") return page([{ text: "Dashboard", href: href("/sns/dashboard") }], <UiOnlyScope primaryOp="sns:ListTopics"><Dashboard /></UiOnlyScope>);
  if (path === "/sns/topics") return page([topics], <UiOnlyScope primaryOp="sns:ListTopics"><TopicsList /></UiOnlyScope>, "table");
  if (path === "/sns/create-topic") return page([topics, { text: "Create topic", href: href("/sns/create-topic") }], <CreateTopic />, "form");
  if (path === "/sns/subscriptions") return page([subscriptions], <UiOnlyScope primaryOp="sns:ListSubscriptions"><SubscriptionsList /></UiOnlyScope>, "table");
  if (path === "/sns/create-subscription") return page([subscriptions, { text: "Create subscription", href: createSubscriptionHref() }], <CreateSubscription key={query.get("topic") ?? ""} topic={query.get("topic")} />, "form");
  const topic = matchPath("/sns/topic/:arn", path);
  if (topic) return page([topics, { text: nameOf(topic.arn), href: topicHref(topic.arn) }], <UiOnlyScope primaryOp="sns:GetTopicAttributes"><TopicDetails key={topic.arn} arn={topic.arn} /></UiOnlyScope>);
  const publish = matchPath("/sns/publish/:arn", path);
  if (publish) return page([topics, { text: nameOf(publish.arn), href: topicHref(publish.arn) }, { text: "Publish message", href: publishHref(publish.arn) }], <Publish key={publish.arn} arn={publish.arn} />, "form");
  const sub = matchPath("/sns/subscription/:arn", path);
  if (sub) return page([subscriptions, { text: nameOf(sub.arn), href: subscriptionHref(sub.arn) }], <UiOnlyScope primaryOp="sns:GetSubscriptionAttributes"><SubscriptionDetails key={sub.arn} arn={sub.arn} /></UiOnlyScope>);
  return null;
}
