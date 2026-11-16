// Systems Manager Parameter Store console pages: parameters list, create parameter and parameter
// details with overview, history and tags.

import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Multiselect from "@cloudscape-design/components/multiselect";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import { useEffect, useState, type ReactNode } from "react";
import { commands, type SsmParameterMeta_Serialize, type SsmParameterVersion_Serialize } from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, textProperty, UiOnlyScope, type ResourceTableColumn } from "../../patterns";
import { navigate, useLocation } from "../../shell/router";
import { Copyable, EditTagsModal, formatDate, FormModal, LoadError, TagsTable, type Loaded, useAction, useLoad, useRegion } from "../common";
import { SSM_HELP, ssmHref, ssmPage } from "./shell";

const MASK = "********";
const PARAMETERS = "/systems-manager/parameters";

const parametersHref = () => ssmHref("/parameters");
const createHref = () => ssmHref("/parameters/create");
const parameterHref = (name: string, tab?: string) => ssmHref("/parameters/detail", { name, tab });

const TYPES = [
  { value: "String", label: "String", description: "Any string value." },
  { value: "StringList", label: "StringList", description: "Comma-separated list of values." },
  { value: "SecureString", label: "SecureString", description: "Value encrypted with an AWS KMS key." },
];
const DATA_TYPES = [
  { value: "text", label: "text" },
  { value: "aws:ec2:image", label: "aws:ec2:image" },
];
const NAME_PATTERN = /^[a-zA-Z0-9_.\-/]+$/;
const LABEL_PATTERN = /^[a-zA-Z0-9_.\-]{1,100}$/;

// Parameters list ---------------------------------------------------------------------------------

const COLUMNS: ResourceTableColumn<SsmParameterMeta_Serialize>[] = [
  { id: "name", header: "Name", cell: (p) => <Link href={parameterHref(p.name)}>{p.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "tier", header: "Tier", cell: (p) => p.tier || "-", sortingField: "tier" },
  { id: "type", header: "Type", cell: (p) => p.param_type, sortingField: "param_type" },
  { id: "modified", header: "Last modified", cell: (p) => formatDate(p.last_modified), sortingField: "last_modified" },
  { id: "version", header: "Version", cell: (p) => p.version ?? "-", sortingField: "version" },
  { id: "description", header: "Description", cell: (p) => p.description || "-", sortingField: "description" },
  { id: "datatype", header: "Data type", cell: (p) => p.data_type || "-", sortingField: "data_type", hidden: true },
  { id: "arn", header: "ARN", cell: (p) => p.arn || "-", sortingField: "arn", hidden: true },
];

function ParametersList() {
  const region = useRegion();
  const params = useLoad(() => commands.ssmDescribeParameters(region), []);
  const [deleting, setDeleting] = useState<SsmParameterMeta_Serialize[]>([]);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={params.error} onRetry={params.reload} />
      <ResourceTable<SsmParameterMeta_Serialize>
        resourceName="Parameter"
        title="My parameters"
        help={SSM_HELP}
        items={params.data ?? []}
        loading={params.loading}
        columns={COLUMNS}
        filteringProperties={[textProperty("name", "Name"), textProperty("tier", "Tier", "enum"), textProperty("param_type", "Type", "enum"), textProperty("description", "Description")]}
        trackBy="name"
        preferencesKey="ssm.parameters"
        selectionType="multi"
        onRefresh={params.reload}
        emptyAction={
          <GatedButton op="ssm:PutParameter" href={createHref()}>
            Create parameter
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="ssm:DeleteParameters" disabled={sel.length === 0} onClick={() => setDeleting([...sel])}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="ssm:PutParameter" href={createHref()}>
              Create parameter
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting.length > 0}
        resourceKind="parameter"
        names={deleting.map((p) => p.name)}
        op="ssm:DeleteParameters"
        confirmation={deleting.length > 1 ? "typed" : "simple"}
        warning={deleting.length > 1 ? "Deleting parameters cannot be undone. Applications that read them will fail." : undefined}
        onDismiss={() => setDeleting([])}
        onDelete={async () => {
          await commands.ssmDeleteParameters(region, deleting.map((p) => p.name));
          params.reload();
        }}
      />
    </SpaceBetween>
  );
}

// Create parameter --------------------------------------------------------------------------------

function CreateParameter() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState("Standard");
  const [type, setType] = useState("String");
  const [dataType, setDataType] = useState("text");
  const [keyId, setKeyId] = useState("");
  const [value, setValue] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});
  const limit = tier === "Advanced" ? 8192 : 4096;
  return (
    <CreateForm
      title="Create parameter"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create parameter"
      op="ssm:PutParameter"
      dirty={name !== "" || description !== "" || value !== ""}
      cancelHref={parametersHref()}
      validate={() => {
        const e: { name?: string; value?: string } = {};
        if (!name) e.name = "Enter a name.";
        else if (name.length > 2048) e.name = "The name can have at most 2048 characters.";
        else if (!NAME_PATTERN.test(name)) e.name = "Use letters, numbers and the symbols . - _ /";
        else if (name.endsWith("/")) e.name = "The name can't end with a slash.";
        if (!value) e.value = "Enter a value.";
        else if (value.length > limit) e.value = `A ${tier} parameter value can have at most ${limit} characters.`;
        setErrors(e);
        return !e.name && !e.value;
      }}
      onSubmit={async () => {
        await commands.ssmPutParameter(region, {
          name,
          description: description || null,
          value,
          param_type: type,
          key_id: type === "SecureString" && keyId ? keyId : null,
          overwrite: false,
          tier,
          data_type: type === "String" ? dataType : null,
          tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })),
        });
        return parameterHref(name);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Parameter details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Name" errorText={errors.name} constraintText="Letters, numbers and the symbols . - _ / . Use slashes to build a hierarchy, for example /Dev/Db/Password.">
              <Input value={name} placeholder="/my-app/dev/database-url" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Description - optional">
              <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
            </FormField>
            <FormField label="Tier" description="Advanced parameters allow values up to 8 KB and parameter policies.">
              <RadioGroup
                value={tier}
                onChange={({ detail }) => setTier(detail.value)}
                items={[
                  { value: "Standard", label: "Standard", description: "Value up to 4 KB. No additional charge." },
                  { value: "Advanced", label: "Advanced", description: "Value up to 8 KB. Parameter policies." },
                ]}
              />
            </FormField>
            <FormField label="Type">
              <Tiles value={type} onChange={({ detail }) => setType(detail.value)} items={TYPES} columns={3} />
            </FormField>
            {type === "String" && (
              <FormField label="Data type">
                <Select selectedOption={DATA_TYPES.find((d) => d.value === dataType) ?? DATA_TYPES[0]} options={DATA_TYPES} onChange={({ detail }) => setDataType(detail.selectedOption.value!)} />
              </FormField>
            )}
            {type === "SecureString" && (
              <FormField label="KMS key ID - optional" description="The key that encrypts the value. Leave empty for the default key alias/aws/ssm.">
                <Input value={keyId} placeholder="alias/aws/ssm" onChange={({ detail }) => setKeyId(detail.value)} />
              </FormField>
            )}
            <FormField label="Value" errorText={errors.value} constraintText={type === "StringList" ? "Separate the items with commas, without spaces." : `Up to ${limit} characters.`} stretch>
              <Textarea value={value} rows={6} spellcheck={false} onChange={({ detail }) => setValue(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="A tag is a metadata label that you can assign to a parameter.">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Parameter details -------------------------------------------------------------------------------

type HistoryTarget = { mode: "label" | "unlabel"; version: number | null; labels: string[] };

function HistoryTab({ name, secure, history, revealed, onReveal, onHide, onChanged }: { name: string; secure: boolean; history: Loaded<SsmParameterVersion_Serialize[]>; revealed: SsmParameterVersion_Serialize[] | null; onReveal: () => void; onHide: () => void; onChanged: () => void }) {
  const region = useRegion();
  const { run } = useAction();
  const [target, setTarget] = useState<HistoryTarget | null>(null);
  const [labelText, setLabelText] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const valueOf = (v: SsmParameterVersion_Serialize) => {
    if (v.param_type !== "SecureString") return v.value;
    return revealed?.find((r) => r.version === v.version)?.value ?? MASK;
  };
  const columns: ResourceTableColumn<SsmParameterVersion_Serialize>[] = [
    { id: "version", header: "Version", cell: (v) => v.version ?? "-", sortingField: "version", isRowHeader: true, alwaysVisible: true },
    { id: "value", header: "Value", cell: (v) => <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{valueOf(v)}</span> },
    { id: "type", header: "Type", cell: (v) => v.param_type, sortingField: "param_type" },
    { id: "labels", header: "Labels", cell: (v) => (v.labels.length ? v.labels.join(", ") : "-") },
    { id: "modified", header: "Last modified", cell: (v) => formatDate(v.last_modified), sortingField: "last_modified" },
    { id: "user", header: "Last modified by", cell: (v) => v.last_modified_user || "-", sortingField: "last_modified_user", hidden: true },
    { id: "description", header: "Description", cell: (v) => v.description || "-", sortingField: "description" },
  ];
  const labelError = (() => {
    const labels = labelText.split(/[\s,]+/).filter(Boolean);
    if (labels.length === 0) return "Enter at least one label.";
    return labels.every((l) => LABEL_PATTERN.test(l)) ? undefined : "A label has 1 to 100 letters, numbers and the symbols . - _";
  })();
  return (
    <>
      <LoadError error={history.error} onRetry={history.reload} />
      <ResourceTable<SsmParameterVersion_Serialize>
        resourceName="Version"
        title="History"
        variant="container"
        items={history.data ?? []}
        loading={history.loading}
        columns={columns}
        filteringProperties={[textProperty("version", "Version"), textProperty("description", "Description")]}
        trackBy="version"
        preferencesKey="ssm.parameter-history"
        selectionType="single"
        onRefresh={history.reload}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            {secure && (revealed ? (
              <GatedButton op="ssm:GetParameterHistory" onClick={onHide}>
                Hide decrypted values
              </GatedButton>
            ) : (
              <GatedButton op="ssm:GetParameterHistory" onClick={onReveal}>
                Show decrypted values
              </GatedButton>
            ))}
            <GatedButton op="ssm:UnlabelParameterVersion" disabled={sel.length !== 1 || sel[0].labels.length === 0} onClick={() => { setRemoving([]); setTarget({ mode: "unlabel", version: sel[0].version, labels: sel[0].labels }); }}>
              Remove label
            </GatedButton>
            <GatedButton op="ssm:LabelParameterVersion" disabled={sel.length !== 1} onClick={() => { setLabelText(""); setTarget({ mode: "label", version: sel[0].version, labels: sel[0].labels }); }}>
              Label version
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={target?.mode === "label"}
        header={`Label version ${target?.version ?? ""}`}
        op="ssm:LabelParameterVersion"
        submitLabel="Label version"
        canSubmit={!labelError}
        onDismiss={() => setTarget(null)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmLabelVersion(region, name, target!.version, labelText.split(/[\s,]+/).filter(Boolean));
            onChanged();
          }, "Version labeled")
        }
      >
        <FormField label="Labels" description="Separate several labels with commas or spaces." errorText={labelText ? labelError : undefined} constraintText="A label has 1 to 100 letters, numbers and the symbols . - _ and can't start with a number or with aws or ssm.">
          <Input value={labelText} onChange={({ detail }) => setLabelText(detail.value)} />
        </FormField>
      </FormModal>
      <FormModal
        visible={target?.mode === "unlabel"}
        header={`Remove labels from version ${target?.version ?? ""}`}
        op="ssm:UnlabelParameterVersion"
        submitLabel="Remove labels"
        canSubmit={removing.length > 0}
        onDismiss={() => setTarget(null)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmUnlabelVersion(region, name, target!.version, removing);
            onChanged();
          }, "Labels removed")
        }
      >
        <FormField label="Labels to remove">
          <Multiselect
            placeholder="Choose labels"
            selectedOptions={removing.map((l) => ({ value: l, label: l }))}
            options={(target?.labels ?? []).map((l) => ({ value: l, label: l }))}
            onChange={({ detail }) => setRemoving(detail.selectedOptions.map((o) => o.value!))}
            keepOpen
          />
        </FormField>
      </FormModal>
    </>
  );
}

function ParameterDetails({ name }: { name: string }) {
  const region = useRegion();
  const { run } = useAction();
  const tab = useLocation().query.get("tab");
  const param = useLoad(() => commands.ssmGetParameter(region, name, false), [name]);
  const history = useLoad(() => commands.ssmGetParameterHistory(region, name, false), [name]);
  const tags = useLoad(() => commands.ssmListTags(region, "Parameter", name), [name]);
  // Decrypted values live only here, only while shown: cleared on hide, tab change, Region change and unmount.
  const [shown, setShown] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<SsmParameterVersion_Serialize[] | null>(null);
  useEffect(
    () => () => {
      setShown(null);
      setRevealed(null);
    },
    [tab, region, name],
  );
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const p = param.data;
  const secure = p?.param_type === "SecureString";
  const latest = (history.data ?? []).reduce<SsmParameterVersion_Serialize | null>((a, v) => (!a || (v.version ?? 0) > (a.version ?? 0) ? v : a), null);

  const reloadAll = () => {
    setShown(null);
    setRevealed(null);
    param.reload();
    history.reload();
  };
  const showValue = () =>
    run(async () => {
      setShown((await commands.ssmGetParameter(region, name, true)).value);
    });
  const showHistory = () =>
    run(async () => {
      setRevealed(await commands.ssmGetParameterHistory(region, name, true));
    });

  let valueView: ReactNode = "-";
  if (p) {
    if (secure) {
      valueView = (
        <SpaceBetween size="xs">
          <span style={{ fontFamily: "monospace", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{shown ?? MASK}</span>
          {shown === null ? (
            <GatedButton op="ssm:GetParameter" onClick={showValue}>
              Show decrypted value
            </GatedButton>
          ) : (
            <GatedButton op="ssm:GetParameter" onClick={() => setShown(null)}>
              Hide decrypted value
            </GatedButton>
          )}
        </SpaceBetween>
      );
    } else {
      valueView = <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{p.value}</pre>;
    }
  }

  return (
    <SpaceBetween size="m">
      <LoadError error={param.error} onRetry={param.reload} />
      <LoadError error={history.error} onRetry={history.reload} />
      <DetailsPage
        title={name}
        help={SSM_HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton
              op="ssm:PutParameter"
              disabled={!p}
              onClick={() => {
                setValue(secure ? "" : (p?.value ?? ""));
                setDescription(latest?.description ?? "");
                setEditing(true);
              }}
            >
              Edit
            </GatedButton>
            <GatedButton op="ssm:DeleteParameters" onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
          </SpaceBetween>
        }
        sections={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <Container header={<Header variant="h2">Details</Header>}>
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: "Name", value: name },
                    { label: "ARN", value: p?.arn ? <Copyable value={p.arn} label="ARN" /> : "-" },
                    { label: "Type", value: p?.param_type ?? "-" },
                    { label: "Tier", value: latest?.tier ?? "-" },
                    { label: "Data type", value: p?.data_type ?? "-" },
                    { label: "Version", value: p?.version ?? "-" },
                    { label: "Last modified", value: formatDate(p?.last_modified) },
                    { label: "Description", value: latest?.description || "-" },
                    ...(secure ? [{ label: "KMS key ID", value: latest?.key_id || "alias/aws/ssm" }] : []),
                    { label: "Value", value: valueView },
                  ]}
                />
              </Container>
            ),
          },
          {
            id: "history",
            label: "History",
            content: <HistoryTab name={name} secure={secure} history={history} revealed={revealed} onReveal={showHistory} onHide={() => setRevealed(null)} onChanged={reloadAll} />,
          },
          {
            id: "tags",
            label: "Tags",
            content: (
              <>
                <LoadError error={tags.error} />
                <TagsTable tags={tags.data} loading={tags.loading} op="ssm:AddTagsToResource" onEdit={() => setEditTags(true)} />
              </>
            ),
          },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="parameter"
        names={[name]}
        op="ssm:DeleteParameters"
        confirmation="simple"
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.ssmDeleteParameters(region, [name]);
          navigate(parametersHref());
        }}
      />
      <FormModal
        visible={editing}
        size="large"
        header={`Edit ${name}`}
        op="ssm:PutParameter"
        canSubmit={value !== ""}
        onDismiss={() => {
          setEditing(false);
          setValue("");
        }}
        onSubmit={async () => {
          const ok = await run(async () => {
            await commands.ssmPutParameter(region, {
              name,
              description: description || null,
              value,
              param_type: p!.param_type,
              key_id: secure ? (latest?.key_id ?? null) : null,
              overwrite: true,
              tier: latest?.tier ?? null,
              data_type: p!.data_type,
              tags: [],
            });
            reloadAll();
          }, "Parameter updated");
          if (ok) setValue("");
          return ok;
        }}
      >
        <SpaceBetween size="l">
          <FormField label="Description - optional">
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <FormField label="Value" description={secure ? "The current value is not shown. Enter the new value." : undefined} constraintText={p?.param_type === "StringList" ? "Separate the items with commas, without spaces." : undefined} stretch>
            <Textarea value={value} rows={6} spellcheck={false} onChange={({ detail }) => setValue(detail.value)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={tags.data ?? []}
        op="ssm:AddTagsToResource"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            const set = next.filter((x) => before.find((b) => b.key === x.key)?.value !== x.value);
            const remove = before.filter((b) => !next.some((x) => x.key === b.key)).map((b) => b.key);
            await commands.ssmUpdateTags(region, "Parameter", name, set, remove);
            tags.reload();
          }, "Parameter tags updated")
        }
      />
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The Parameter Store page for a route path, or null when the path is not one of its pages. */
export function parameterStorePages(path: string, query: URLSearchParams): ReactNode | null {
  const list = { text: "Parameter Store", href: parametersHref() };
  if (path === PARAMETERS) {
    return ssmPage(
      [list],
      <UiOnlyScope primaryOp="ssm:DescribeParameters">
        <ParametersList />
      </UiOnlyScope>,
      "table",
    );
  }
  if (path === `${PARAMETERS}/create`) return ssmPage([list, { text: "Create parameter", href: createHref() }], <CreateParameter />, "form");
  if (path === `${PARAMETERS}/detail`) {
    const name = query.get("name") ?? "";
    return ssmPage(
      [list, { text: name || "Parameter", href: parameterHref(name) }],
      name ? (
        <UiOnlyScope primaryOp="ssm:GetParameter">
          <ParameterDetails key={name} name={name} />
        </UiOnlyScope>
      ) : (
        <Box color="text-status-inactive">No parameter is selected. Choose one from the parameters list.</Box>
      ),
    );
  }
  return null;
}
