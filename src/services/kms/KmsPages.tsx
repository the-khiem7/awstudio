// AWS Key Management Service console pages: customer and AWS managed keys, create key wizard and
// key details with policy, rotation, aliases, grants and tags.

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import Toggle from "@cloudscape-design/components/toggle";
import { useRef, useState, type ReactNode } from "react";
import { commands, type KmsAlias_Serialize, type KmsGrant_Serialize, type KmsKey_Serialize } from "../../bindings";
import { CreateWizard, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, UiOnlyScope, textProperty, type ResourceTableColumn } from "../../patterns";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { useNotifications } from "../../shell/notifications";
import { href, matchPath } from "../../shell/router";
import { Copyable, EditTagsModal, FormModal, formatDate, GatedDropdown, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useGates, useLoad, useRegion, type GatedItem } from "../common";

const NAV = {
  header: { text: "Key Management Service", href: href("/kms/keys") },
  items: [
    { type: "link" as const, text: "AWS managed keys", href: href("/kms/aws-managed-keys") },
    { type: "link" as const, text: "Customer managed keys", href: href("/kms/keys") },
  ],
};

const HELP: HelpContent = {
  header: "AWS Key Management Service",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Customer managed keys and AWS managed keys of the local emulator, in the Region of the region selector.</Box>
      <Box variant="p">Listing aliases and the cryptographic operations (sign, verify, generate data key, re-encrypt, public key, MAC) are only partly supported by the emulator, so the console does not offer them.</Box>
    </SpaceBetween>
  ),
};

const keyHref = (id: string, tab?: string) => href(`/kms/keys/${encodeURIComponent(id)}`, { tab });

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Key Management Service", href: href("/kms/keys") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

// Key model ---------------------------------------------------------------------------------------

const STATES: Record<string, { label: string; type: StatusIndicatorProps.Type }> = {
  Enabled: { label: "Enabled", type: "success" },
  Disabled: { label: "Disabled", type: "stopped" },
  PendingDeletion: { label: "Pending deletion", type: "warning" },
  PendingReplicaDeletion: { label: "Pending replica deletion", type: "warning" },
  PendingImport: { label: "Pending import", type: "pending" },
  Creating: { label: "Creating", type: "in-progress" },
  Updating: { label: "Updating", type: "in-progress" },
  Unavailable: { label: "Unavailable", type: "error" },
};

const stateLabel = (state: string) => STATES[state]?.label ?? state;

function KeyStatus({ state }: { state: string }) {
  return <StatusIndicator type={STATES[state]?.type ?? "info"}>{stateLabel(state)}</StatusIndicator>;
}

const keyType = (spec: string) => (spec === "SYMMETRIC_DEFAULT" || spec.startsWith("HMAC_") || spec === "SM4" ? "Symmetric" : "Asymmetric");
const regionality = (k: KmsKey_Serialize) => (k.multi_region ? "Multi-Region" : "Single-Region");
const isCustomer = (k: KmsKey_Serialize | null | undefined) => k?.key_manager === "CUSTOMER";

const ALIAS_RULE = /^[a-zA-Z0-9:/_-]{1,250}$/;
const ALIAS_HINT = "Maximum 250 characters. Can include letters, numbers, colons (:), slashes (/), hyphens (-) and underscores (_). Do not type the alias/ prefix, and do not start with aws/.";

function aliasError(name: string): string | undefined {
  if (name.startsWith("alias/")) return "Enter the alias without the alias/ prefix.";
  if (name.startsWith("aws/")) return 'Aliases that begin with "aws/" are reserved for AWS managed keys.';
  return ALIAS_RULE.test(name) ? undefined : ALIAS_HINT;
}

/** The Key actions dropdown entries; each is enabled only for the states in which KMS accepts the call. */
function keyActionItems(k: KmsKey_Serialize | null | undefined, withEdit: boolean): GatedItem[] {
  const customer = isCustomer(k);
  const state = k?.key_state;
  return [
    { id: "enable", text: "Enable", op: "kms:EnableKey", disabled: !customer || state !== "Disabled" },
    { id: "disable", text: "Disable", op: "kms:DisableKey", disabled: !customer || state !== "Enabled" },
    ...(withEdit ? [{ id: "edit-description", text: "Edit description", op: "kms:UpdateKeyDescription", disabled: !customer || state === "PendingDeletion" }] : []),
    { id: "schedule", text: "Schedule key deletion", op: "kms:ScheduleKeyDeletion", disabled: !customer || (state !== "Enabled" && state !== "Disabled") },
    { id: "cancel", text: "Cancel key deletion", op: "kms:CancelKeyDeletion", disabled: !customer || state !== "PendingDeletion" },
  ];
}

/** Enable, disable, schedule deletion and cancel deletion of a key, with the waiting-period modal. */
function useKeyActions(onChanged: () => void) {
  const region = useRegion();
  const { run } = useAction();
  const [scheduling, setScheduling] = useState<KmsKey_Serialize | null>(null);
  const [days, setDays] = useState("30");
  const n = Number(days);
  const daysError = Number.isInteger(n) && n >= 7 && n <= 30 ? undefined : "Enter a whole number from 7 to 30.";

  const act = (id: string, k: KmsKey_Serialize) => {
    if (id === "enable") void run(async () => { await commands.kmsEnableKey(region, k.key_id); onChanged(); }, `Key ${k.key_id} enabled`);
    else if (id === "disable") void run(async () => { await commands.kmsDisableKey(region, k.key_id); onChanged(); }, `Key ${k.key_id} disabled`);
    else if (id === "cancel") void run(async () => { await commands.kmsCancelKeyDeletion(region, k.key_id); onChanged(); }, `Deletion of key ${k.key_id} canceled. The key is disabled; enable it to use it again.`);
    else if (id === "schedule") {
      setDays("30");
      setScheduling(k);
    }
  };

  const modal = (
    <FormModal
      visible={scheduling !== null}
      header="Schedule key deletion"
      submitLabel="Schedule deletion"
      op="kms:ScheduleKeyDeletion"
      canSubmit={!daysError}
      onDismiss={() => setScheduling(null)}
      onSubmit={() => run(async () => { await commands.kmsScheduleKeyDeletion(region, scheduling!.key_id, n); onChanged(); }, `Key ${scheduling?.key_id} is scheduled for deletion in ${days} days`)}
    >
      <SpaceBetween size="m">
        <Alert type="warning" statusIconAriaLabel="Warning">
          The key becomes unusable at once and is deleted when the waiting period ends. Data encrypted under the key cannot be decrypted after that. Until then you can cancel the deletion.
        </Alert>
        <FormField label="Waiting period (in days)" constraintText="Between 7 and 30 days." errorText={daysError}>
          <Input type="number" inputMode="numeric" value={days} onChange={({ detail }) => setDays(detail.value)} />
        </FormField>
      </SpaceBetween>
    </FormModal>
  );
  return { act, modal };
}

// Key lists ---------------------------------------------------------------------------------------

type KeyRow = KmsKey_Serialize & { status: string; type: string; regionality: string };

const KEY_COLUMNS: ResourceTableColumn<KeyRow>[] = [
  { id: "key_id", header: "Key ID", cell: (k) => <Link href={keyHref(k.key_id)}>{k.key_id}</Link>, sortingField: "key_id", isRowHeader: true, alwaysVisible: true },
  { id: "status", header: "Status", cell: (k) => <KeyStatus state={k.key_state} />, sortingField: "status" },
  { id: "type", header: "Key type", cell: (k) => k.type, sortingField: "type" },
  { id: "key_spec", header: "Key spec", cell: (k) => k.key_spec, sortingField: "key_spec" },
  { id: "key_usage", header: "Key usage", cell: (k) => k.key_usage, sortingField: "key_usage" },
  { id: "regionality", header: "Regionality", cell: (k) => k.regionality, sortingField: "regionality" },
  { id: "creation_date", header: "Creation date", cell: (k) => formatDate(k.creation_date), sortingField: "creation_date" },
];

function KeysList({ manager }: { manager: "CUSTOMER" | "AWS" }) {
  const region = useRegion();
  const keys = useLoad(() => commands.kmsListKeys(region), []);
  const actions = useKeyActions(keys.reload);
  const customer = manager === "CUSTOMER";
  const rows: KeyRow[] = (keys.data ?? []).filter((k) => k.key_manager === manager).map((k) => ({ ...k, status: stateLabel(k.key_state), type: keyType(k.key_spec), regionality: regionality(k) }));
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={keys.error} onRetry={keys.reload} />
      <ResourceTable<KeyRow>
        resourceName="Key"
        title={customer ? "Customer managed keys" : "AWS managed keys"}
        description={customer ? "Keys that you create, own and manage." : "Keys that AWS services create in your account on your behalf."}
        help={HELP}
        items={rows}
        loading={keys.loading}
        columns={KEY_COLUMNS}
        filteringProperties={[textProperty("key_id", "Key ID"), textProperty("status", "Status", "enum"), textProperty("type", "Key type", "enum"), textProperty("key_spec", "Key spec"), textProperty("key_usage", "Key usage"), textProperty("regionality", "Regionality", "enum")]}
        trackBy="key_id"
        preferencesKey={customer ? "kms.customer-keys" : "kms.aws-keys"}
        selectionType={customer ? "single" : undefined}
        onRefresh={keys.reload}
        emptyAction={
          customer ? (
            <GatedButton op="kms:CreateKey" href={href("/kms/keys/create")}>
              Create key
            </GatedButton>
          ) : undefined
        }
        actions={
          customer
            ? (sel) => (
                <SpaceBetween direction="horizontal" size="xs">
                  <GatedDropdown label="Key actions" items={keyActionItems(sel.length === 1 ? sel[0] : null, false)} onItemClick={(id) => sel[0] && actions.act(id, sel[0])} />
                  <GatedButton variant="primary" op="kms:CreateKey" href={href("/kms/keys/create")}>
                    Create key
                  </GatedButton>
                </SpaceBetween>
              )
            : undefined
        }
      />
      {actions.modal}
    </SpaceBetween>
  );
}

// Create key --------------------------------------------------------------------------------------

const RSA_SPECS = ["RSA_2048", "RSA_3072", "RSA_4096"];
const ECC_SPECS = ["ECC_NIST_P256", "ECC_NIST_P384", "ECC_NIST_P521", "ECC_SECG_P256K1"];

/** RSA keys encrypt or sign; elliptic curve keys only sign. */
function specsFor(type: string, usage: string): string[] {
  if (type === "symmetric") return ["SYMMETRIC_DEFAULT"];
  return usage === "SIGN_VERIFY" ? [...RSA_SPECS, ...ECC_SPECS] : RSA_SPECS;
}

const USAGES = [
  { value: "ENCRYPT_DECRYPT", label: "Encrypt and decrypt", description: "Encrypt data and decrypt ciphertext." },
  { value: "SIGN_VERIFY", label: "Sign and verify", description: "Sign messages and verify signatures." },
];

const fail = (message: string): never => {
  throw message;
};

function CreateKey() {
  const region = useRegion();
  const { notify } = useNotifications();
  const [type, setType] = useState("symmetric");
  const [usage, setUsage] = useState("ENCRYPT_DECRYPT");
  const [spec, setSpec] = useState("SYMMETRIC_DEFAULT");
  const [multi, setMulti] = useState(false);
  const [alias, setAlias] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [policy, setPolicy] = useState("");
  const [aliasMessage, setAliasMessage] = useState<string>();
  // A key created by an earlier submit whose alias step failed: a retry only adds the alias.
  const created = useRef<string | null>(null);

  const labelsError = () => (alias ? aliasError(alias) : undefined) ?? (description.length > 8192 ? "The description can have at most 8192 characters." : undefined);
  const checkLabels = () => {
    const e = alias ? aliasError(alias) : undefined;
    setAliasMessage(e);
    return !e && description.length <= 8192;
  };
  const cleanTags = tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value }));

  const changeType = (next: string) => {
    setType(next);
    setUsage("ENCRYPT_DECRYPT");
    setSpec(next === "symmetric" ? "SYMMETRIC_DEFAULT" : "RSA_2048");
  };
  const changeUsage = (next: string) => {
    setUsage(next);
    if (!specsFor(type, next).includes(spec)) setSpec("RSA_2048");
  };

  return (
    <SpaceBetween size="m">
      <Header variant="h1">Create key</Header>
      <CreateWizard
        submitLabel="Create key"
        op="kms:CreateKey"
        dirty={alias !== "" || description !== "" || tags.length > 0 || policy !== "" || type !== "symmetric" || multi}
        cancelHref={href("/kms/keys")}
        doneHref={href("/kms/keys")}
        onSubmit={async () => {
          const e = labelsError() ?? jsonError(policy);
          if (e) fail(e);
          let id = created.current;
          if (!id) {
            const key = await commands.kmsCreateKey(region, { description, key_usage: usage, key_spec: spec, multi_region: multi, policy: policy.trim() ? JSON.stringify(JSON.parse(policy)) : null, tags: cleanTags });
            id = key.key_id;
            created.current = id;
          }
          if (alias) {
            try {
              await commands.kmsCreateAlias(region, `alias/${alias}`, id);
            } catch (err) {
              fail(`The key ${id} was created, but creating the alias failed: ${errorText(err)} Choose Create key again to retry the alias only, or add the alias later on the Aliases tab of the key.`);
            }
          }
          created.current = null;
          notify({ type: "success", content: `Key ${id} created${alias ? ` with alias alias/${alias}` : ""}` });
        }}
        steps={[
          {
            title: "Configure key",
            description: "Choose the type of key, how it is used and its specification.",
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Key type</Header>}>
                  <FormField description="The key type and key spec can't be changed after the key is created.">
                    <Tiles
                      value={type}
                      onChange={({ detail }) => changeType(detail.value)}
                      items={[
                        { value: "symmetric", label: "Symmetric", description: "A single key for both encryption and decryption. Recommended for most uses." },
                        { value: "asymmetric", label: "Asymmetric", description: "A public and private key pair, for encryption and decryption or for signing and verification." },
                      ]}
                    />
                  </FormField>
                </Container>
                <Container header={<Header variant="h2">Key usage</Header>}>
                  <RadioGroup value={usage} onChange={({ detail }) => changeUsage(detail.value)} items={type === "symmetric" ? USAGES.slice(0, 1) : USAGES} />
                </Container>
                <Container header={<Header variant="h2">Key spec</Header>}>
                  <FormField label="Key spec" description={type === "symmetric" ? "Symmetric keys use the SYMMETRIC_DEFAULT spec." : usage === "SIGN_VERIFY" ? "RSA and elliptic curve specs can sign." : "Only RSA specs can encrypt. Choose Sign and verify to use an elliptic curve."}>
                    <Select
                      selectedOption={{ value: spec, label: spec }}
                      options={specsFor(type, usage).map((s) => ({ value: s, label: s }))}
                      disabled={type === "symmetric"}
                      onChange={({ detail }) => setSpec(detail.selectedOption.value!)}
                    />
                  </FormField>
                </Container>
                <Container header={<Header variant="h2">Regionality</Header>}>
                  <Toggle checked={multi} onChange={({ detail }) => setMulti(detail.checked)} description="A multi-Region primary key can be replicated to other Regions. This can't be changed after the key is created.">
                    Multi-Region key
                  </Toggle>
                </Container>
              </SpaceBetween>
            ),
          },
          {
            title: "Add labels",
            description: "Aliases, a description and tags make the key easier to find.",
            validate: checkLabels,
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Alias and description</Header>}>
                  <SpaceBetween size="l">
                    <FormField label="Alias - optional" description="The alias is shown as alias/<name>." errorText={aliasMessage} constraintText={ALIAS_HINT}>
                      <Input value={alias} placeholder="my-key" onChange={({ detail }) => setAlias(detail.value)} />
                    </FormField>
                    <FormField label="Description - optional" constraintText="Maximum 8192 characters." errorText={description.length > 8192 ? "The description is too long." : undefined}>
                      <Textarea value={description} rows={3} onChange={({ detail }) => setDescription(detail.value)} />
                    </FormField>
                  </SpaceBetween>
                </Container>
                <Container header={<Header variant="h2" description="A tag is a metadata label that you can assign to a key.">Tags - optional</Header>}>
                  <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
                </Container>
              </SpaceBetween>
            ),
          },
          {
            title: "Key policy",
            description: "The key policy controls who can use and manage the key.",
            isOptional: true,
            validate: () => !jsonError(policy),
            content: (
              <Container header={<Header variant="h2" description="Leave it empty to apply the default key policy, which gives the account's IAM policies control of the key.">Key policy - optional</Header>}>
                <JsonEditor label="Key policy (JSON)" value={policy} onChange={setPolicy} rows={16} />
              </Container>
            ),
          },
          {
            title: "Review",
            content: (
              <Container header={<Header variant="h2">Review key configuration</Header>}>
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: "Key type", value: type === "symmetric" ? "Symmetric" : "Asymmetric" },
                    { label: "Key usage", value: USAGES.find((u) => u.value === usage)?.label ?? usage },
                    { label: "Key spec", value: spec },
                    { label: "Regionality", value: multi ? "Multi-Region" : "Single-Region" },
                    { label: "Alias", value: alias ? `alias/${alias}` : "-" },
                    { label: "Description", value: description || "-" },
                    { label: "Tags", value: cleanTags.length ? cleanTags.map((t) => `${t.key}=${t.value}`).join(", ") : "-" },
                    { label: "Key policy", value: policy.trim() ? "Custom policy" : "Default key policy" },
                  ]}
                />
              </Container>
            ),
          },
        ]}
      />
    </SpaceBetween>
  );
}

// Key details: policy -----------------------------------------------------------------------------

function PolicyTab({ keyId }: { keyId: string }) {
  const region = useRegion();
  const { run } = useAction();
  const gate = useGates(["kms:GetKeyPolicy"])["kms:GetKeyPolicy"];
  const policy = useLoad(() => commands.kmsGetKeyPolicy(region, keyId), [keyId], gate.enabled);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <SpaceBetween size="m">
      <LoadError error={policy.error} onRetry={policy.reload} />
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <GatedButton
                op="kms:PutKeyPolicy"
                disabled={policy.data === null}
                onClick={() => {
                  setText(prettyJson(policy.data));
                  setEditing(true);
                }}
              >
                Edit
              </GatedButton>
            }
          >
            Key policy
          </Header>
        }
      >
        {policy.data ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy.data)}</pre> : <Box color="text-status-inactive">{gate.enabled ? (policy.loading ? "Loading the key policy" : "No key policy.") : `${gate.reason}.`}</Box>}
      </Container>
      <FormModal
        visible={editing}
        size="large"
        header="Edit key policy"
        op="kms:PutKeyPolicy"
        canSubmit={!jsonError(text, false)}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.kmsPutKeyPolicy(region, keyId, JSON.stringify(JSON.parse(text))); policy.reload(); }, "Key policy updated")}
      >
        <JsonEditor label="Key policy (JSON)" value={text} onChange={setText} rows={18} allowEmpty={false} />
      </FormModal>
    </SpaceBetween>
  );
}

// Key details: rotation ---------------------------------------------------------------------------

function RotationTab({ k }: { k: KmsKey_Serialize | null }) {
  const region = useRegion();
  const { run } = useAction();
  const keyId = k?.key_id ?? "";
  const gate = useGates(["kms:GetKeyRotationStatus"])["kms:GetKeyRotationStatus"];
  const symmetric = k?.key_spec === "SYMMETRIC_DEFAULT";
  const rotation = useLoad(() => commands.kmsGetRotationStatus(region, keyId), [keyId], gate.enabled && symmetric);
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [period, setPeriod] = useState("365");
  const n = Number(period);
  const periodError = enabled && !(Number.isInteger(n) && n >= 90 && n <= 2560) ? "Enter a whole number from 90 to 2560." : undefined;
  const r = rotation.data;
  const manageable = isCustomer(k);
  const usable = manageable && k?.key_state === "Enabled" && r !== null;
  return (
    <SpaceBetween size="m">
      <LoadError error={rotation.error} onRetry={rotation.reload} />
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton
                  op="kms:RotateKeyOnDemand"
                  disabled={!usable}
                  onClick={() => void run(async () => { await commands.kmsRotateOnDemand(region, keyId); rotation.reload(); }, "Key material rotation started")}
                >
                  Rotate key on demand
                </GatedButton>
                <GatedButton
                  variant="primary"
                  op="kms:EnableKeyRotation"
                  disabled={!usable}
                  onClick={() => {
                    setEnabled(r?.enabled ?? false);
                    setPeriod(String(r?.period_in_days ?? 365));
                    setEditing(true);
                  }}
                >
                  Edit
                </GatedButton>
              </SpaceBetween>
            }
          >
            Key rotation
          </Header>
        }
      >
        {k && !symmetric ? (
          <Box color="text-status-inactive">Automatic rotation is available for symmetric encryption keys only.</Box>
        ) : !gate.enabled ? (
          <Box color="text-status-inactive">{gate.reason}.</Box>
        ) : (
          <KeyValuePairs
            columns={3}
            items={[
              { label: "Automatic key rotation", value: r ? <StatusIndicator type={r.enabled ? "success" : "stopped"}>{r.enabled ? "Enabled" : "Disabled"}</StatusIndicator> : "-" },
              { label: "Rotation period", value: r?.enabled && r.period_in_days ? `${r.period_in_days} days` : "-" },
              { label: "Next rotation date", value: r?.enabled ? formatDate(r.next_rotation_date) : "-" },
            ]}
          />
        )}
      </Container>
      <FormModal
        visible={editing}
        header="Edit automatic key rotation"
        op={enabled ? "kms:EnableKeyRotation" : "kms:DisableKeyRotation"}
        canSubmit={!periodError}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.kmsSetRotation(region, keyId, enabled, enabled ? n : null); rotation.reload(); }, enabled ? "Automatic key rotation enabled" : "Automatic key rotation disabled")}
      >
        <SpaceBetween size="l">
          <Toggle checked={enabled} onChange={({ detail }) => setEnabled(detail.checked)}>
            Automatically rotate this KMS key
          </Toggle>
          {enabled && (
            <FormField label="Rotation period (in days)" constraintText="Between 90 and 2560 days." errorText={periodError}>
              <Input type="number" inputMode="numeric" value={period} onChange={({ detail }) => setPeriod(detail.value)} />
            </FormField>
          )}
        </SpaceBetween>
      </FormModal>
    </SpaceBetween>
  );
}

// Key details: aliases ----------------------------------------------------------------------------

function AliasesTab({ keyId, listable, reason, aliases, onChanged }: { keyId: string; listable: boolean; reason: string; aliases: { data: KmsAlias_Serialize[] | null; loading: boolean; error: string | null; reload: () => void }; onChanged: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [byName, setByName] = useState("");
  const createError = name ? aliasError(name) : "Enter an alias name.";
  const changed = () => {
    aliases.reload();
    onChanged();
  };
  const columns: ResourceTableColumn<KmsAlias_Serialize>[] = [
    { id: "alias_name", header: "Alias name", cell: (a) => a.alias_name, sortingField: "alias_name", isRowHeader: true, alwaysVisible: true },
    { id: "alias_arn", header: "Alias ARN", cell: (a) => <Copyable value={a.alias_arn} label="alias ARN" />, sortingField: "alias_arn" },
  ];
  const createButton = (
    <GatedButton
      variant="primary"
      op="kms:CreateAlias"
      onClick={() => {
        setName("");
        setCreating(true);
      }}
    >
      Create alias
    </GatedButton>
  );
  return (
    <SpaceBetween size="m">
      {listable ? (
        <>
          <LoadError error={aliases.error} onRetry={aliases.reload} />
          <ResourceTable<KmsAlias_Serialize>
            variant="container"
            resourceName="Alias"
            title="Aliases"
            items={aliases.data ?? []}
            loading={aliases.loading}
            columns={columns}
            filteringProperties={[textProperty("alias_name", "Alias name")]}
            trackBy="alias_name"
            preferencesKey="kms.aliases"
            selectionType="single"
            onRefresh={aliases.reload}
            emptyAction={createButton}
            actions={(sel) => (
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="kms:DeleteAlias" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0].alias_name)}>
                  Delete
                </GatedButton>
                {createButton}
              </SpaceBetween>
            )}
          />
        </>
      ) : (
        <>
          <Container header={<Header variant="h2" actions={createButton}>Aliases</Header>}>
            <Box color="text-status-inactive">Aliases cannot be listed: {reason}.</Box>
          </Container>
          <Container header={<Header variant="h2" description="Deletes an alias by its name, whichever key it points to.">Delete alias by name</Header>}>
            <SpaceBetween direction="horizontal" size="xs" alignItems="end">
              <FormField label="Alias name" constraintText="Without the alias/ prefix.">
                <Input value={byName} placeholder="my-key" onChange={({ detail }) => setByName(detail.value)} />
              </FormField>
              <GatedButton op="kms:DeleteAlias" disabled={!byName || !!aliasError(byName)} onClick={() => setDeleting(`alias/${byName}`)}>
                Delete alias
              </GatedButton>
            </SpaceBetween>
          </Container>
        </>
      )}
      <FormModal
        visible={creating}
        header="Create alias"
        submitLabel="Create alias"
        op="kms:CreateAlias"
        canSubmit={!createError}
        onDismiss={() => setCreating(false)}
        onSubmit={() => run(async () => { await commands.kmsCreateAlias(region, `alias/${name}`, keyId); changed(); }, `Alias alias/${name} created`)}
      >
        <FormField label="Alias name" description="The alias is shown as alias/<name>." constraintText={ALIAS_HINT} errorText={name ? createError : undefined}>
          <Input value={name} placeholder="my-key" onChange={({ detail }) => setName(detail.value)} />
        </FormField>
      </FormModal>
      <DeleteModal
        visible={deleting !== null}
        resourceKind="alias"
        names={deleting ? [deleting] : []}
        op="kms:DeleteAlias"
        confirmation="simple"
        warning="Applications that use the alias stop resolving the key. The key itself is not deleted."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.kmsDeleteAlias(region, deleting!);
          setByName("");
          changed();
        }}
      />
    </SpaceBetween>
  );
}

// Key details: grants -----------------------------------------------------------------------------

const GRANT_COLUMNS: ResourceTableColumn<KmsGrant_Serialize>[] = [
  { id: "grant_id", header: "Grant ID", cell: (g) => g.grant_id, sortingField: "grant_id", isRowHeader: true, alwaysVisible: true },
  { id: "name", header: "Name", cell: (g) => g.name || "-", sortingField: "name" },
  { id: "grantee_principal", header: "Grantee principal", cell: (g) => g.grantee_principal, sortingField: "grantee_principal" },
  { id: "retiring_principal", header: "Retiring principal", cell: (g) => g.retiring_principal || "-", sortingField: "retiring_principal" },
  { id: "operations", header: "Operations", cell: (g) => g.operations.join(", ") || "-" },
  { id: "creation_date", header: "Creation date", cell: (g) => formatDate(g.creation_date), sortingField: "creation_date" },
];

function GrantsTab({ keyId }: { keyId: string }) {
  const region = useRegion();
  const { run } = useAction();
  const gate = useGates(["kms:ListGrants"])["kms:ListGrants"];
  const grants = useLoad(() => commands.kmsListGrants(region, keyId), [keyId], gate.enabled);
  const [revoking, setRevoking] = useState<KmsGrant_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      {!gate.enabled && <Box color="text-status-inactive">Grants cannot be listed: {gate.reason}.</Box>}
      <LoadError error={grants.error} onRetry={grants.reload} />
      <ResourceTable<KmsGrant_Serialize>
        variant="container"
        resourceName="Grant"
        title="Grants"
        items={grants.data ?? []}
        loading={grants.loading}
        columns={GRANT_COLUMNS}
        filteringProperties={[textProperty("grant_id", "Grant ID"), textProperty("name", "Name"), textProperty("grantee_principal", "Grantee principal")]}
        trackBy="grant_id"
        preferencesKey="kms.grants"
        selectionType="single"
        onRefresh={grants.reload}
        actions={(sel) => (
          <GatedButton op="kms:RevokeGrant" disabled={sel.length !== 1} onClick={() => setRevoking(sel[0])}>
            Revoke
          </GatedButton>
        )}
      />
      <FormModal
        visible={revoking !== null}
        header="Revoke grant"
        submitLabel="Revoke"
        op="kms:RevokeGrant"
        onDismiss={() => setRevoking(null)}
        onSubmit={() => run(async () => { await commands.kmsRevokeGrant(region, keyId, revoking!.grant_id); grants.reload(); }, "Grant revoked")}
      >
        <Box variant="span">
          Revoke grant{" "}
          <Box variant="span" fontWeight="bold">
            {revoking?.grant_id}
          </Box>
          ? The grantee principal loses the permissions of the grant at once.
        </Box>
      </FormModal>
    </SpaceBetween>
  );
}

// Key details: tags -------------------------------------------------------------------------------

function TagsTab({ keyId }: { keyId: string }) {
  const region = useRegion();
  const { run } = useAction();
  const gate = useGates(["kms:ListResourceTags"])["kms:ListResourceTags"];
  const tags = useLoad(() => commands.kmsListTags(region, keyId), [keyId], gate.enabled);
  const [editing, setEditing] = useState(false);
  return (
    <SpaceBetween size="m">
      <LoadError error={tags.error} onRetry={tags.reload} />
      <TagsTable tags={tags.data} loading={tags.loading} op="kms:TagResource" onEdit={() => setEditing(true)} />
      <EditTagsModal
        visible={editing}
        tags={tags.data ?? []}
        op="kms:TagResource"
        onDismiss={() => setEditing(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.kmsUpdateTags(region, keyId, set, remove);
            tags.reload();
          }, "Key tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Key details -------------------------------------------------------------------------------------

function KeyDetails({ id }: { id: string }) {
  const region = useRegion();
  const { run } = useAction();
  const aliasGate = useGates(["kms:ListAliases"])["kms:ListAliases"];
  const key = useLoad(() => commands.kmsDescribeKey(region, id), [id]);
  const aliases = useLoad(() => commands.kmsListAliases(region, id), [id], aliasGate.enabled);
  const actions = useKeyActions(key.reload);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const k = key.data;
  const aliasValue = aliasGate.enabled ? (aliases.data?.map((a) => a.alias_name).join(", ") || "-") : (
    <SpaceBetween size="xxs">
      <span>-</span>
      <Box color="text-status-inactive" fontSize="body-s">
        Aliases cannot be listed: {aliasGate.reason}.
      </Box>
    </SpaceBetween>
  );
  return (
    <SpaceBetween size="m">
      <LoadError error={key.error} onRetry={key.reload} />
      {k?.key_state === "PendingDeletion" && (
        <Alert type="warning" header="This key is pending deletion">
          The key is deleted on {formatDate(k.deletion_date)}. Cancel the deletion before then to keep it.
        </Alert>
      )}
      <DetailsPage
        title={id}
        help={HELP}
        layout="tabs"
        actions={
          <GatedDropdown
            variant="primary"
            items={keyActionItems(k, true)}
            onItemClick={(item) => {
              if (!k) return;
              if (item === "edit-description") {
                setText(k.description);
                setEditing(true);
              } else actions.act(item, k);
            }}
          />
        }
        overview={{
          title: "General configuration",
          columns: 3,
          items: [
            { label: "Alias", value: aliasValue },
            { label: "Status", value: k ? <KeyStatus state={k.key_state} /> : "-" },
            { label: "ARN", value: k ? <Copyable value={k.arn} label="ARN" /> : "-" },
            { label: "Creation date", value: formatDate(k?.creation_date) },
            { label: "Description", value: k?.description || "-" },
            { label: "Regionality", value: k ? regionality(k) : "-" },
            { label: "Key spec", value: k?.key_spec ?? "-" },
            { label: "Key usage", value: k?.key_usage ?? "-" },
            { label: "Origin", value: k?.origin ?? "-" },
            { label: "Deletion date", value: formatDate(k?.deletion_date) },
          ],
        }}
        sections={[
          { id: "policy", label: "Key policy", content: <PolicyTab keyId={id} /> },
          { id: "rotation", label: "Key rotation", content: <RotationTab k={k} /> },
          { id: "aliases", label: "Aliases", content: <AliasesTab keyId={id} listable={aliasGate.enabled} reason={aliasGate.reason} aliases={aliases} onChanged={aliases.reload} /> },
          { id: "grants", label: "Grants", content: <GrantsTab keyId={id} /> },
          { id: "tags", label: "Tags", content: <TagsTab keyId={id} /> },
        ]}
      />
      {actions.modal}
      <FormModal
        visible={editing}
        header="Edit key description"
        op="kms:UpdateKeyDescription"
        canSubmit={text.length <= 8192}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.kmsUpdateDescription(region, id, text); key.reload(); }, "Key description updated")}
      >
        <FormField label="Description" constraintText="Maximum 8192 characters." errorText={text.length > 8192 ? "The description is too long." : undefined}>
          <Textarea value={text} rows={4} onChange={({ detail }) => setText(detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The KMS page for a route path, or null when the path is not a KMS page. */
export function kmsPage(path: string, _query: URLSearchParams): ReactNode | null {
  const customer = { text: "Customer managed keys", href: href("/kms/keys") };
  if (path === "/kms" || path === "/kms/keys") return page([customer], <UiOnlyScope primaryOp="kms:ListKeys"><KeysList manager="CUSTOMER" /></UiOnlyScope>, "table");
  if (path === "/kms/aws-managed-keys") return page([{ text: "AWS managed keys", href: href("/kms/aws-managed-keys") }], <UiOnlyScope primaryOp="kms:ListKeys"><KeysList manager="AWS" /></UiOnlyScope>, "table");
  if (path === "/kms/keys/create") return page([customer, { text: "Create key", href: href("/kms/keys/create") }], <CreateKey />, "form");
  const key = matchPath("/kms/keys/:id", path);
  if (key) {
    return page([customer, { text: key.id, href: keyHref(key.id) }], <UiOnlyScope primaryOp="kms:DescribeKey"><KeyDetails key={key.id} id={key.id} /></UiOnlyScope>);
  }
  return null;
}
