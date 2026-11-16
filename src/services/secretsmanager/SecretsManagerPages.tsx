// AWS Secrets Manager console pages: secrets list, store a new secret and secret details with the
// value, rotation, versions, resource permissions and tags.

import Alert from "@cloudscape-design/components/alert";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import Toggle from "@cloudscape-design/components/toggle";
import { useEffect, useState, type ReactNode } from "react";
import { commands, type SmSecretDetails_Serialize, type SmSecretSummary_Serialize } from "../../bindings";
import { CreateWizard, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, textProperty, UiOnlyScope, type ResourceTableColumn } from "../../patterns";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, navigate, useLocation } from "../../shell/router";
import { Copyable, EditTagsModal, formatDate, FormModal, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useGates, useLoad, useRegion } from "../common";

const NAV = {
  header: { text: "AWS Secrets Manager", href: href("/secretsmanager/listsecrets") },
  items: [{ type: "link" as const, text: "Secrets", href: href("/secretsmanager/listsecrets") }],
};

const HELP: HelpContent = {
  header: "AWS Secrets Manager",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Secrets of the local emulator, in the Region of the region selector. A secret value is read only when you ask for it and is cleared when you leave the tab.</Box>
      <Box variant="p">Rotation needs a Lambda function that implements the rotation steps; the emulator runs the function you name.</Box>
      <Box variant="p">Replication and replica secrets are not available in the emulator.</Box>
    </SpaceBetween>
  ),
};

const LIST_HREF = href("/secretsmanager/listsecrets");
const NEW_HREF = href("/secretsmanager/newsecret");
const secretHref = (name: string, tab?: string) => href("/secretsmanager/secret", { name, tab });

const NAME_RULE = /^[A-Za-z0-9/_+=.@-]{1,512}$/;
const DELETE_WINDOW_MIN = 7;
const DELETE_WINDOW_MAX = 30;

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "wizard" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Secrets Manager", href: LIST_HREF }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

function SecretStatus({ deleted }: { deleted: string | null | undefined }) {
  return deleted ? <StatusIndicator type="warning">Scheduled for deletion on {formatDate(deleted)}</StatusIndicator> : <StatusIndicator type="success">Active</StatusIndicator>;
}

const rotationText = (enabled: boolean) => (enabled ? "Enabled" : "Disabled");

// Secret value editing -----------------------------------------------------------------------------

interface KvRow {
  key: string;
  value: string;
}

interface ValueDraft {
  plain: boolean;
  rows: KvRow[];
  text: string;
}

const emptyDraft = (): ValueDraft => ({ plain: false, rows: [{ key: "", value: "" }], text: "" });

/** A key/value draft is stored as a JSON object whose values are strings, as the console does. */
function serializeDraft(d: ValueDraft): string {
  if (d.plain) return d.text;
  const object: Record<string, string> = {};
  for (const r of d.rows) if (r.key) object[r.key] = r.value;
  return JSON.stringify(object);
}

function draftError(d: ValueDraft): string | undefined {
  if (d.plain) return d.text ? undefined : "Enter the secret value.";
  if (d.rows.some((r) => !r.key && r.value)) return "Every value needs a key.";
  const keys = d.rows.map((r) => r.key).filter(Boolean);
  if (keys.length === 0) return "Add at least one key.";
  if (new Set(keys).size !== keys.length) return "Keys must be unique.";
  return undefined;
}

/** The text as a flat JSON object (no nested objects or arrays), or null. */
function parseFlat(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x !== "object")) return v as Record<string, unknown>;
  } catch {
    // not JSON: shown as plaintext
  }
  return null;
}

/** A draft of an existing value; a value that is not a flat object of strings is edited as plaintext so no type is changed. */
function draftOf(text: string): ValueDraft {
  const flat = parseFlat(text);
  if (flat && Object.values(flat).every((x) => typeof x === "string")) {
    const rows = Object.entries(flat).map(([key, value]) => ({ key, value: value as string }));
    return { plain: false, rows: rows.length ? rows : [{ key: "", value: "" }], text: "" };
  }
  return { plain: true, rows: [{ key: "", value: "" }], text };
}

function ValueEditor({ draft, onChange, error }: { draft: ValueDraft; onChange: (d: ValueDraft) => void; error?: string }) {
  return (
    <SpaceBetween size="m">
      <Toggle checked={draft.plain} onChange={({ detail }) => onChange({ ...draft, plain: detail.checked })} description="Enter the raw text instead of key/value pairs.">
        Plaintext
      </Toggle>
      {draft.plain ? (
        <FormField label="Secret value" errorText={error} stretch>
          <Textarea value={draft.text} rows={8} spellcheck={false} onChange={({ detail }) => onChange({ ...draft, text: detail.value })} />
        </FormField>
      ) : (
        <FormField label="Key/value pairs" errorText={error} description="The pairs are stored as one JSON object." stretch>
          <AttributeEditor<KvRow>
            items={draft.rows}
            addButtonText="Add row"
            removeButtonText="Remove"
            empty="No key/value pairs."
            onAddButtonClick={() => onChange({ ...draft, rows: [...draft.rows, { key: "", value: "" }] })}
            onRemoveButtonClick={({ detail }) => onChange({ ...draft, rows: draft.rows.filter((_, i) => i !== detail.itemIndex) })}
            definition={[
              { label: "Key", control: (x, i) => <Input value={x.key} placeholder="Key" onChange={({ detail }) => onChange({ ...draft, rows: draft.rows.map((y, j) => (j === i ? { ...y, key: detail.value } : y)) })} /> },
              { label: "Value", control: (x, i) => <Input value={x.value} placeholder="Value" onChange={({ detail }) => onChange({ ...draft, rows: draft.rows.map((y, j) => (j === i ? { ...y, value: detail.value } : y)) })} /> },
            ]}
          />
        </FormField>
      )}
    </SpaceBetween>
  );
}

// Delete -------------------------------------------------------------------------------------------

function DeleteSecretModal({ visible, name, onDismiss, onDeleted }: { visible: boolean; name: string; onDismiss: () => void; onDeleted: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [days, setDays] = useState("30");
  const [force, setForce] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (visible) {
      setDays("30");
      setForce(false);
      setTyped("");
    }
  }, [visible]);
  const n = Number(days);
  const daysOk = days.trim() !== "" && Number.isInteger(n) && n >= DELETE_WINDOW_MIN && n <= DELETE_WINDOW_MAX;
  return (
    <FormModal
      visible={visible}
      header="Delete secret"
      op="secrets-manager:DeleteSecret"
      submitLabel={force ? "Delete permanently" : "Schedule deletion"}
      canSubmit={force ? typed === name : daysOk}
      onDismiss={onDismiss}
      onSubmit={async () => {
        const ok = await run(() => commands.smDeleteSecret(region, name, force ? null : n, force), force ? "Secret deleted" : "Secret scheduled for deletion");
        if (ok) onDeleted();
        return ok;
      }}
    >
      <SpaceBetween size="m">
        <Box variant="span">
          Delete secret <b>{name}</b>?
        </Box>
        {force ? (
          <Alert type="warning" statusIconAriaLabel="Warning">
            The secret and all of its versions are deleted at once. You can't undo this action.
          </Alert>
        ) : (
          <FormField label="Waiting period" description="The secret can be restored until the waiting period ends." constraintText={`${DELETE_WINDOW_MIN} to ${DELETE_WINDOW_MAX} days.`} errorText={daysOk ? undefined : `Enter a whole number from ${DELETE_WINDOW_MIN} to ${DELETE_WINDOW_MAX}.`}>
            <Input type="number" inputMode="numeric" value={days} onChange={({ detail }) => setDays(detail.value)} />
          </FormField>
        )}
        <Toggle checked={force} onChange={({ detail }) => setForce(detail.checked)} description="Skips the waiting period. The secret can't be restored.">
          Delete immediately
        </Toggle>
        {force && (
          <FormField label={`To confirm this deletion, type "${name}".`}>
            <Input placeholder={name} value={typed} onChange={({ detail }) => setTyped(detail.value)} />
          </FormField>
        )}
      </SpaceBetween>
    </FormModal>
  );
}

// Secrets list -------------------------------------------------------------------------------------

type SecretRow = SmSecretSummary_Serialize & { status: string; rotation: string };

const SECRET_COLUMNS: ResourceTableColumn<SecretRow>[] = [
  { id: "name", header: "Secret name", cell: (s) => <Link href={secretHref(s.name)}>{s.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "description", header: "Description", cell: (s) => s.description || "-", sortingField: "description" },
  { id: "accessed", header: "Last retrieved", cell: (s) => formatDate(s.last_accessed), sortingField: "last_accessed" },
  { id: "changed", header: "Last changed", cell: (s) => formatDate(s.last_changed), sortingField: "last_changed" },
  { id: "rotation", header: "Rotation", cell: (s) => s.rotation, sortingField: "rotation" },
  { id: "status", header: "Status", cell: (s) => <SecretStatus deleted={s.deleted} />, sortingField: "status" },
  { id: "arn", header: "ARN", cell: (s) => s.arn, sortingField: "arn", hidden: true },
];

function SecretsList() {
  const region = useRegion();
  const { run } = useAction();
  const secrets = useLoad(() => commands.smListSecrets(region), []);
  const [deleting, setDeleting] = useState<SecretRow | null>(null);
  const rows: SecretRow[] = (secrets.data ?? []).map((s) => ({ ...s, status: s.deleted ? `Scheduled for deletion on ${formatDate(s.deleted)}` : "Active", rotation: rotationText(s.rotation_enabled) }));
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={secrets.error} onRetry={secrets.reload} />
      <ResourceTable<SecretRow>
        resourceName="Secret"
        title="Secrets"
        help={HELP}
        items={rows}
        loading={secrets.loading}
        columns={SECRET_COLUMNS}
        filteringProperties={[textProperty("name", "Secret name"), textProperty("description", "Description"), textProperty("rotation", "Rotation", "enum"), textProperty("arn", "ARN")]}
        trackBy="arn"
        preferencesKey="secretsmanager.secrets"
        selectionType="single"
        onRefresh={secrets.reload}
        emptyAction={
          <GatedButton op="secrets-manager:CreateSecret" href={NEW_HREF}>
            Store a new secret
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="secrets-manager:RestoreSecret" disabled={sel.length !== 1 || !sel[0].deleted} onClick={() => run(async () => { await commands.smRestoreSecret(region, sel[0].name); secrets.reload(); }, "Secret restored")}>
              Restore
            </GatedButton>
            <GatedButton op="secrets-manager:DeleteSecret" disabled={sel.length !== 1 || !!sel[0].deleted} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="secrets-manager:CreateSecret" href={NEW_HREF}>
              Store a new secret
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteSecretModal visible={deleting !== null} name={deleting?.name ?? ""} onDismiss={() => setDeleting(null)} onDeleted={secrets.reload} />
    </SpaceBetween>
  );
}

// Store a new secret -------------------------------------------------------------------------------

function NewSecret() {
  const region = useRegion();
  const { run } = useAction();
  const gates = useGates(["secrets-manager:RotateSecret"]);
  const rotationOn = gates["secrets-manager:RotateSecret"].enabled;
  const [draft, setDraft] = useState<ValueDraft>(emptyDraft);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kms, setKms] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [lambdaArn, setLambdaArn] = useState("");
  const [days, setDays] = useState("30");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const cleanTags = tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value }));
  const daysNumber = Number(days);
  const rotating = rotationOn && lambdaArn.trim() !== "";
  return (
    <CreateWizard
      submitLabel="Store"
      op="secrets-manager:CreateSecret"
      dirty={name !== "" || description !== "" || kms !== "" || tags.length > 0 || lambdaArn !== "" || draft.text !== "" || draft.rows.some((r) => r.key || r.value)}
      cancelHref={LIST_HREF}
      doneHref={secretHref(name)}
      onSubmit={async () => {
        await commands.smCreateSecret(region, { name, description: description || null, kms_key_id: kms.trim() || null, secret_string: serializeDraft(draft), secret_binary_base64: null, tags: cleanTags });
        // The secret exists from here on, so a rotation failure is reported without failing the wizard.
        if (rotating) await run(() => commands.smRotateSecret(region, name, lambdaArn.trim(), daysNumber, false));
      }}
      steps={[
        {
          title: "Choose secret type",
          validate: () => {
            const e = draftError(draft);
            setErrors((x) => ({ ...x, value: e }));
            return !e;
          },
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Secret type</Header>}>
                <Tiles value="other" onChange={() => undefined} items={[{ value: "other", label: "Other type of secret", description: "API key, token or any other value you keep as text." }]} />
              </Container>
              <Container header={<Header variant="h2">Key/value pairs</Header>}>
                <ValueEditor draft={draft} onChange={setDraft} error={errors.value} />
              </Container>
            </SpaceBetween>
          ),
        },
        {
          title: "Configure secret",
          validate: () => {
            const e = {
              name: NAME_RULE.test(name) ? undefined : "Use 1 to 512 letters, numbers and the characters / _ + = . @ -",
              description: description.length > 2048 ? "Use at most 2048 characters." : undefined,
            };
            setErrors((x) => ({ ...x, ...e }));
            return !e.name && !e.description;
          },
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Secret name and description</Header>}>
                <SpaceBetween size="l">
                  <FormField label="Secret name" errorText={errors.name} constraintText="1 to 512 characters. Letters, numbers and the characters / _ + = . @ -">
                    <Input value={name} placeholder="Enter a name for the secret" onChange={({ detail }) => setName(detail.value)} />
                  </FormField>
                  <FormField label="Description - optional" errorText={errors.description} constraintText="Maximum 2048 characters.">
                    <Textarea value={description} rows={3} onChange={({ detail }) => setDescription(detail.value)} />
                  </FormField>
                </SpaceBetween>
              </Container>
              <Container header={<Header variant="h2">Encryption key</Header>}>
                <FormField label="Encryption key - optional" description="The KMS key ID, ARN or alias that encrypts the secret. Leave empty for the default key.">
                  <Input value={kms} placeholder="aws/secretsmanager" onChange={({ detail }) => setKms(detail.value)} />
                </FormField>
              </Container>
              <Container header={<Header variant="h2" description="A tag is a metadata label that you can assign to a secret.">Tags - optional</Header>}>
                <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
              </Container>
            </SpaceBetween>
          ),
        },
        {
          title: "Configure rotation",
          isOptional: true,
          validate: () => {
            if (!rotating) return true;
            const e = {
              lambda: lambdaArn.trim().startsWith("arn:") ? undefined : "Enter the ARN of the rotation function.",
              days: days.trim() !== "" && Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 1000 ? undefined : "Enter a whole number from 1 to 1000.",
            };
            setErrors((x) => ({ ...x, ...e }));
            return !e.lambda && !e.days;
          },
          content: (
            <Container header={<Header variant="h2">Rotation configuration</Header>}>
              <SpaceBetween size="l">
                <Alert type="info">Rotation needs a Lambda function that performs the rotation steps. Leave the function empty to store the secret without rotation; you can configure it later on the secret.</Alert>
                {!rotationOn && <Box color="text-status-inactive">Rotation is not available: {gates["secrets-manager:RotateSecret"].reason}.</Box>}
                <FormField label="Rotation function ARN - optional" errorText={errors.lambda}>
                  <Input value={lambdaArn} disabled={!rotationOn} placeholder="arn:aws:lambda:us-east-1:000000000000:function:my-rotation" onChange={({ detail }) => setLambdaArn(detail.value)} />
                </FormField>
                <FormField label="Rotation schedule" errorText={errors.days} constraintText="Rotate every N days (1 to 1000)." >
                  <Input type="number" inputMode="numeric" value={days} disabled={!rotationOn || lambdaArn.trim() === ""} onChange={({ detail }) => setDays(detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Review",
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Secret</Header>}>
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: "Secret type", value: "Other type of secret" },
                    { label: "Secret value", value: draft.plain ? "Plaintext" : `${draft.rows.filter((r) => r.key).length} key/value pair(s)` },
                    { label: "Secret name", value: name || "-" },
                    { label: "Description", value: description || "-" },
                    { label: "Encryption key", value: kms.trim() || "aws/secretsmanager (default)" },
                    { label: "Tags", value: cleanTags.length ? cleanTags.map((t) => t.key).join(", ") : "-" },
                  ]}
                />
              </Container>
              <Container header={<Header variant="h2">Rotation</Header>}>
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: "Rotation", value: rotating ? "Enabled" : "Disabled" },
                    { label: "Rotation function", value: rotating ? lambdaArn.trim() : "-" },
                    { label: "Schedule", value: rotating ? `Every ${daysNumber} days` : "-" },
                  ]}
                />
              </Container>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Secret details -----------------------------------------------------------------------------------

function EditValueModal({ visible, name, current, onDismiss, onSaved }: { visible: boolean; name: string; current: string | null; onDismiss: () => void; onSaved: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [draft, setDraft] = useState<ValueDraft>(emptyDraft);
  // The draft holds the secret only while the modal is open.
  useEffect(() => {
    setDraft(visible && current !== null ? draftOf(current) : emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const error = draftError(draft);
  return (
    <FormModal
      visible={visible}
      size="large"
      header="Edit secret value"
      op="secrets-manager:PutSecretValue"
      submitLabel="Save"
      canSubmit={!error}
      onDismiss={onDismiss}
      onSubmit={async () => {
        const ok = await run(() => commands.smPutSecretValue(region, name, serializeDraft(draft), null), "New secret version stored");
        if (ok) onSaved();
        return ok;
      }}
    >
      <SpaceBetween size="m">
        {current === null && <Alert type="info">The current value is not loaded. The value you enter replaces it as a new version.</Alert>}
        <ValueEditor draft={draft} onChange={setDraft} />
      </SpaceBetween>
    </FormModal>
  );
}

function SecretValue({ name, deleted, onChanged }: { name: string; deleted: string | null | undefined; onChanged: () => void }) {
  const region = useRegion();
  const { run, busy } = useAction();
  const { query } = useLocation();
  const tab = query.get("tab");
  // The value lives in this state only while shown.
  const [shown, setShown] = useState<{ text: string; binary: boolean } | null>(null);
  const [view, setView] = useState("kv");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setShown(null);
    setEditing(false);
    return () => setShown(null);
  }, [name, region, tab]);

  const retrieve = () =>
    run(async () => {
      const v = await commands.smGetSecretValue(region, name, null, null);
      setView("kv");
      setShown({ text: v.secret_string ?? "", binary: v.secret_string === null && v.secret_binary_base64 !== null });
    });

  const flat = shown && !shown.binary ? parseFlat(shown.text) : null;
  const asTable = flat !== null && view === "kv";
  return (
    <Container
      header={
        <Header
          variant="h2"
          description="The value is read from the emulator only when you retrieve it."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <GatedButton op="secrets-manager:PutSecretValue" disabled={!!deleted} onClick={() => setEditing(true)}>
                Edit secret value
              </GatedButton>
              {shown ? (
                <GatedButton op="secrets-manager:GetSecretValue" onClick={() => setShown(null)}>
                  Hide secret value
                </GatedButton>
              ) : (
                <GatedButton variant="primary" op="secrets-manager:GetSecretValue" loading={busy} disabled={!!deleted} onClick={retrieve}>
                  Retrieve secret value
                </GatedButton>
              )}
            </SpaceBetween>
          }
        >
          Secret value
        </Header>
      }
    >
      <SpaceBetween size="m">
        {deleted && <Box color="text-status-inactive">The value of a secret scheduled for deletion can't be retrieved. Restore the secret first.</Box>}
        {!shown && !deleted && <Box color="text-status-inactive">Choose Retrieve secret value to read the current value.</Box>}
        {shown?.binary && <Box color="text-status-inactive">This secret holds a binary value, which can't be shown here.</Box>}
        {flat !== null && (
          <SegmentedControl
            selectedId={view}
            onChange={({ detail }) => setView(detail.selectedId)}
            options={[
              { id: "kv", text: "Key/value" },
              { id: "plain", text: "Plaintext" },
            ]}
          />
        )}
        {asTable && (
          <Table
            variant="embedded"
            items={Object.entries(flat).map(([key, value]) => ({ key, value: value === null ? "" : String(value) }))}
            trackBy="key"
            columnDefinitions={[
              { id: "key", header: "Secret key", cell: (x) => x.key, isRowHeader: true },
              { id: "value", header: "Secret value", cell: (x) => x.value || "-" },
            ]}
            empty={<Box color="text-status-inactive">The value is an empty object.</Box>}
          />
        )}
        {shown && !shown.binary && !asTable && <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{shown.text}</pre>}
      </SpaceBetween>
      <EditValueModal
        visible={editing}
        name={name}
        current={shown && !shown.binary ? shown.text : null}
        onDismiss={() => setEditing(false)}
        onSaved={() => {
          setShown(null);
          onChanged();
        }}
      />
    </Container>
  );
}

function RotationTab({ details, name, onChanged }: { details: SmSecretDetails_Serialize | null; name: string; onChanged: () => void }) {
  const region = useRegion();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [lambdaArn, setLambdaArn] = useState("");
  const [days, setDays] = useState("30");
  const configured = !!details?.rotation_lambda_arn;
  const n = Number(days);
  const valid = lambdaArn.trim().startsWith("arn:") && days.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 1000;
  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Rotation runs the Lambda function that updates the secret and the service that uses it."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <GatedButton
                op="secrets-manager:RotateSecret"
                onClick={() => {
                  setLambdaArn(details?.rotation_lambda_arn ?? "");
                  setDays(String(details?.automatically_after_days ?? 30));
                  setEditing(true);
                }}
              >
                Edit rotation
              </GatedButton>
              <GatedButton
                variant="primary"
                op="secrets-manager:RotateSecret"
                loading={busy}
                disabled={!configured || !!details?.summary.deleted}
                onClick={() => run(async () => { await commands.smRotateSecret(region, name, details!.rotation_lambda_arn ?? null, details!.automatically_after_days ?? null, true); onChanged(); }, "Rotation started")}
              >
                Rotate secret immediately
              </GatedButton>
            </SpaceBetween>
          }
        >
          Rotation configuration
        </Header>
      }
    >
      <KeyValuePairs
        columns={3}
        items={[
          { label: "Rotation status", value: details ? rotationText(details.summary.rotation_enabled) : "-" },
          { label: "Rotation function", value: details?.rotation_lambda_arn ?? "-" },
          { label: "Schedule", value: details?.automatically_after_days ? `Every ${details.automatically_after_days} days` : "-" },
          { label: "Last rotated", value: formatDate(details?.last_rotated) },
          { label: "Next rotation", value: formatDate(details?.next_rotation) },
        ]}
      />
      <FormModal
        visible={editing}
        size="medium"
        header="Edit rotation configuration"
        op="secrets-manager:RotateSecret"
        canSubmit={valid}
        onDismiss={() => setEditing(false)}
        onSubmit={async () => {
          const ok = await run(() => commands.smRotateSecret(region, name, lambdaArn.trim(), n, false), "Rotation configuration saved");
          if (ok) onChanged();
          return ok;
        }}
      >
        <SpaceBetween size="l">
          <FormField label="Rotation function ARN" description="The Lambda function that rotates the secret.">
            <Input value={lambdaArn} placeholder="arn:aws:lambda:us-east-1:000000000000:function:my-rotation" onChange={({ detail }) => setLambdaArn(detail.value)} />
          </FormField>
          <FormField label="Rotation schedule" constraintText="Rotate every N days (1 to 1000).">
            <Input type="number" inputMode="numeric" value={days} onChange={({ detail }) => setDays(detail.value)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
    </Container>
  );
}

function VersionsTab({ name }: { name: string }) {
  const region = useRegion();
  const gates = useGates(["secrets-manager:ListSecretVersionIds"]);
  const enabled = gates["secrets-manager:ListSecretVersionIds"].enabled;
  const versions = useLoad(() => commands.smListSecretVersions(region, name), [name], enabled);
  return (
    <SpaceBetween size="m">
      <LoadError error={versions.error} onRetry={versions.reload} />
      {!enabled && <Box color="text-status-inactive">Versions: {gates["secrets-manager:ListSecretVersionIds"].reason}.</Box>}
      <Table
        variant="container"
        loading={versions.loading}
        loadingText="Loading versions"
        items={versions.data ?? []}
        trackBy="version_id"
        columnDefinitions={[
          { id: "id", header: "Version ID", cell: (v) => v.version_id, isRowHeader: true },
          { id: "stages", header: "Staging labels", cell: (v) => v.stages.join(", ") || "-" },
          { id: "created", header: "Created", cell: (v) => formatDate(v.created) },
          { id: "accessed", header: "Last accessed", cell: (v) => formatDate(v.last_accessed) },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <b>No versions</b>
          </Box>
        }
        header={<Header variant="h2" counter={versions.data ? `(${versions.data.length})` : undefined} description="Staging labels such as AWSCURRENT and AWSPREVIOUS mark the versions in use.">Versions</Header>}
      />
    </SpaceBetween>
  );
}

function PermissionsTab({ name, deleted }: { name: string; deleted: boolean }) {
  const region = useRegion();
  const { run } = useAction();
  const gates = useGates(["secrets-manager:GetResourcePolicy"]);
  const enabled = gates["secrets-manager:GetResourcePolicy"].enabled;
  const policy = useLoad(() => commands.smGetResourcePolicy(region, name), [name], enabled);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState("");
  return (
    <SpaceBetween size="m">
      <LoadError error={policy.error} onRetry={policy.reload} />
      <Container
        header={
          <Header
            variant="h2"
            description="A resource policy controls which principals can access the secret."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="secrets-manager:DeleteResourcePolicy" disabled={!policy.data || deleted} onClick={() => setDeleting(true)}>
                  Delete policy
                </GatedButton>
                <GatedButton
                  variant="primary"
                  op="secrets-manager:PutResourcePolicy"
                  disabled={deleted}
                  onClick={() => {
                    setText(prettyJson(policy.data));
                    setEditing(true);
                  }}
                >
                  Edit permissions
                </GatedButton>
              </SpaceBetween>
            }
          >
            Resource permissions
          </Header>
        }
      >
        {!enabled && <Box color="text-status-inactive">Resource permissions: {gates["secrets-manager:GetResourcePolicy"].reason}.</Box>}
        {enabled && policy.data && <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy.data)}</pre>}
        {enabled && !policy.data && <Box color="text-status-inactive">{policy.loading ? "Loading the resource policy." : "The secret has no resource policy."}</Box>}
      </Container>
      <FormModal
        visible={editing}
        size="large"
        header="Edit resource permissions"
        op="secrets-manager:PutResourcePolicy"
        canSubmit={!jsonError(text, false)}
        onDismiss={() => setEditing(false)}
        onSubmit={() =>
          run(async () => {
            await commands.smPutResourcePolicy(region, name, JSON.stringify(JSON.parse(text)), false);
            policy.reload();
          }, "Resource policy saved")
        }
      >
        <JsonEditor label="Resource policy (JSON)" value={text} onChange={setText} rows={18} allowEmpty={false} />
      </FormModal>
      <DeleteModal
        visible={deleting}
        resourceKind="resource policy of secret"
        names={[name]}
        op="secrets-manager:DeleteResourcePolicy"
        confirmation="simple"
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.smDeleteResourcePolicy(region, name);
          policy.reload();
        }}
      />
    </SpaceBetween>
  );
}

function SecretDetails({ name }: { name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const secret = useLoad(() => commands.smDescribeSecret(region, name), [name]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [kms, setKms] = useState("");
  const [editTags, setEditTags] = useState(false);
  const d = secret.data;
  const s = d?.summary;
  const deleted = s?.deleted ?? null;
  const restore = () => run(async () => { await commands.smRestoreSecret(region, name); secret.reload(); }, "Secret restored");
  const kmsChanged = kms.trim() !== "" && kms.trim() !== (s?.kms_key_id ?? "");
  const descriptionChanged = description !== (s?.description ?? "");
  return (
    <SpaceBetween size="m">
      <LoadError error={secret.error} onRetry={secret.reload} />
      {deleted && (
        <Alert
          type="warning"
          header="Scheduled for deletion"
          action={
            <GatedButton op="secrets-manager:RestoreSecret" onClick={restore}>
              Restore secret
            </GatedButton>
          }
        >
          This secret is scheduled for deletion on {formatDate(deleted)}. Restore it to cancel the deletion.
        </Alert>
      )}
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton
              op="secrets-manager:UpdateSecret"
              disabled={!!deleted}
              onClick={() => {
                setDescription(s?.description ?? "");
                setKms("");
                setEditing(true);
              }}
            >
              Edit
            </GatedButton>
            <GatedButton op="secrets-manager:RestoreSecret" disabled={!deleted} onClick={restore}>
              Restore
            </GatedButton>
            <GatedButton op="secrets-manager:DeleteSecret" disabled={!!deleted} onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
          </SpaceBetween>
        }
        overview={{
          title: "Secret details",
          columns: 3,
          items: [
            { label: "Secret name", value: name },
            { label: "Secret ARN", value: s ? <Copyable value={s.arn} label="ARN" /> : "-" },
            { label: "Description", value: s?.description || "-" },
            { label: "Encryption key", value: s ? (s.kms_key_id ?? "aws/secretsmanager (default)") : "-" },
            { label: "Last changed", value: formatDate(s?.last_changed) },
            { label: "Last retrieved", value: formatDate(s?.last_accessed) },
            { label: "Rotation status", value: s ? rotationText(s.rotation_enabled) : "-" },
            { label: "Status", value: s ? <SecretStatus deleted={deleted} /> : "-" },
          ],
        }}
        sections={[
          { id: "overview", label: "Overview", content: <SecretValue name={name} deleted={deleted} onChanged={secret.reload} /> },
          { id: "rotation", label: "Rotation", content: <RotationTab details={d} name={name} onChanged={secret.reload} /> },
          { id: "versions", label: "Versions", content: <VersionsTab name={name} /> },
          { id: "permissions", label: "Resource permissions", content: <PermissionsTab name={name} deleted={!!deleted} /> },
          { id: "tags", label: "Tags", content: <TagsTable tags={s?.tags ?? null} loading={secret.loading} op="secrets-manager:TagResource" onEdit={() => setEditTags(true)} description="Track cost or other criteria by tagging the secret." /> },
        ]}
      />
      <DeleteSecretModal visible={deleting} name={name} onDismiss={() => setDeleting(false)} onDeleted={() => navigate(LIST_HREF)} />
      <FormModal
        visible={editing}
        header={`Edit ${name}`}
        op="secrets-manager:UpdateSecret"
        canSubmit={descriptionChanged || kmsChanged}
        onDismiss={() => setEditing(false)}
        onSubmit={() =>
          run(async () => {
            await commands.smUpdateSecret(region, name, descriptionChanged ? description : null, kmsChanged ? kms.trim() : null);
            secret.reload();
          }, "Secret updated")
        }
      >
        <SpaceBetween size="l">
          <FormField label="Description - optional" constraintText="Maximum 2048 characters.">
            <Textarea value={description} rows={3} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <FormField label="Encryption key" description={`Current key: ${s?.kms_key_id ?? "aws/secretsmanager (default)"}. Enter a KMS key ID, ARN or alias to change it; leave empty to keep it.`}>
            <Input value={kms} onChange={({ detail }) => setKms(detail.value)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={s?.tags ?? []}
        op="secrets-manager:TagResource"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = s?.tags ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.smUpdateTags(region, name, set, remove);
            secret.reload();
          }, "Secret tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Routes -------------------------------------------------------------------------------------------

/** The Secrets Manager page for a route path, or null when the path is not a Secrets Manager page. */
export function secretsManagerPage(path: string, query: URLSearchParams): ReactNode | null {
  const secrets = { text: "Secrets", href: LIST_HREF };
  if (path === "/secretsmanager" || path === "/secretsmanager/listsecrets") return page([secrets], <UiOnlyScope primaryOp="secrets-manager:ListSecrets"><SecretsList /></UiOnlyScope>, "table");
  if (path === "/secretsmanager/newsecret") return page([secrets, { text: "Store a new secret", href: NEW_HREF }], <NewSecret />, "wizard");
  if (path === "/secretsmanager/secret") {
    const name = query.get("name");
    if (!name) return page([secrets], <Alert type="error" header="No secret chosen">Open a secret from the <Link href={LIST_HREF}>list of secrets</Link>.</Alert>);
    return page([secrets, { text: name, href: secretHref(name) }], <UiOnlyScope primaryOp="secrets-manager:DescribeSecret"><SecretDetails key={name} name={name} /></UiOnlyScope>);
  }
  return null;
}
