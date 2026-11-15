// AWS IAM console pages: dashboard, users, user groups, roles and policies with their create
// flows, JSON policy editor and access keys. IAM is global, so no page takes a Region.

import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Multiselect from "@cloudscape-design/components/multiselect";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import TextFilter from "@cloudscape-design/components/text-filter";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import { useState, type ReactNode } from "react";
import { commands, type AccessKeyInfo_Serialize, type AttachedPolicy, type IamGroup_Serialize, type IamPolicy_Serialize, type IamRole_Serialize, type IamUser_Serialize, type PrincipalKind } from "../../bindings";
import { CreateForm, CreateWizard, DeleteModal, DetailsPage, GatedButton, ResourceCounts, ResourceTable, ScopeBanner, ServiceDashboard, textProperty, UiOnlyScope, useUiOnly, type ResourceTableColumn } from "../../patterns";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href, matchPath } from "../../shell/router";
import { Copyable, EditTagsModal, formatDate, FormModal, JsonEditor, jsonError, LoadError, prettyJson, TagsTable, useAction, useLoad } from "../common";

const NAV = {
  header: { text: "Identity and Access Management (IAM)", href: href("/iam/dashboard") },
  items: [
    { type: "link" as const, text: "Dashboard", href: href("/iam/dashboard") },
    {
      type: "section" as const,
      text: "Access management",
      defaultExpanded: true,
      items: [
        { type: "link" as const, text: "User groups", href: href("/iam/groups") },
        { type: "link" as const, text: "Users", href: href("/iam/users") },
        { type: "link" as const, text: "Roles", href: href("/iam/roles") },
        { type: "link" as const, text: "Policies", href: href("/iam/policies") },
      ],
    },
  ],
};

const HELP: HelpContent = {
  header: "Identity and Access Management (IAM)",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Users, groups, roles and policies of the local emulator. IAM is global: the region selector does not apply here.</Box>
      <Box variant="p">The emulator does not evaluate these policies when it authorizes a request. Do not use it to test IAM policies.</Box>
    </SpaceBetween>
  ),
};

const userHref = (name: string, tab?: string) => href(`/iam/users/${encodeURIComponent(name)}`, { tab });
const groupHref = (name: string, tab?: string) => href(`/iam/groups/${encodeURIComponent(name)}`, { tab });
const roleHref = (name: string, tab?: string) => href(`/iam/roles/${encodeURIComponent(name)}`, { tab });
export const policyHref = (arn: string, tab?: string) => href(`/iam/policies/${encodeURIComponent(arn)}`, { tab });

function page(section: string, sectionHref: string, rest: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "IAM", href: href("/iam/dashboard") }, ...(section ? [{ text: section, href: sectionHref }] : []), ...rest]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

const NAME_RULE = /^[\w+=,.@-]{1,64}$/;
const NAME_HINT = "Use 1 to 64 letters, numbers and + = , . @ _ - characters.";
const kindLabel = (k: string) => k[0].toUpperCase() + k.slice(1);

// Pickers -----------------------------------------------------------------------------------------

/** Choose managed policies from the AWS managed and customer managed ones. */
function PolicyPicker({ selected, onChange, exclude = [] }: { selected: readonly IamPolicy_Serialize[]; onChange: (p: IamPolicy_Serialize[]) => void; exclude?: string[] }) {
  return (
    <UiOnlyScope primaryOp="iam:ListPolicies">
      <PolicyPickerTable selected={selected} onChange={onChange} exclude={exclude} />
    </UiOnlyScope>
  );
}

function PolicyPickerTable({ selected, onChange, exclude }: { selected: readonly IamPolicy_Serialize[]; onChange: (p: IamPolicy_Serialize[]) => void; exclude: string[] }) {
  const policies = useLoad(() => commands.iamListPolicies("all", false), []);
  const { uiOnly } = useUiOnly();
  const rows = (policies.data ?? []).filter((p) => !exclude.includes(p.arn));
  const { items, filterProps, paginationProps, filteredItemsCount, collectionProps } = useCollection(rows, {
    filtering: { fields: ["name", "kind"], empty: "No policies", noMatch: "No policies match the filter" },
    pagination: { pageSize: 10 },
    sorting: { defaultState: { sortingColumn: { sortingField: "name" } } },
  });
  return (
    <SpaceBetween size="s">
      <ScopeBanner />
      <LoadError error={policies.error} onRetry={policies.reload} />
      <Table
        {...collectionProps}
        variant="container"
        items={uiOnly ? [] : items}
        loading={policies.loading}
        loadingText="Loading policies"
        trackBy="arn"
        selectionType="multi"
        selectedItems={[...selected]}
        onSelectionChange={({ detail }) => onChange(detail.selectedItems)}
        columnDefinitions={[
          { id: "name", header: "Policy name", cell: (p) => p.name, sortingField: "name", isRowHeader: true },
          { id: "kind", header: "Type", cell: (p) => p.kind, sortingField: "kind" },
          { id: "attached", header: "Attached entities", cell: (p) => p.attachment_count },
        ]}
        filter={<TextFilter {...filterProps} filteringPlaceholder="Filter policies" countText={`${filteredItemsCount ?? 0} matches`} />}
        pagination={<Pagination {...paginationProps} />}
        header={<Header variant="h2" counter={`(${selected.length}/${rows.length})`}>Permissions policies</Header>}
      />
    </SpaceBetween>
  );
}

function usersOptions(users: IamUser_Serialize[] | null) {
  return (users ?? []).map((u) => ({ value: u.name, label: u.name }));
}

// Dashboard ---------------------------------------------------------------------------------------

function Dashboard() {
  const summary = useLoad(() => commands.iamAccountSummary(), []);
  const s = summary.data;
  return (
    <ServiceDashboard
      title="IAM Dashboard"
      help={HELP}
      widgets={[
        {
          id: "resources",
          title: "IAM resources",
          span: 8,
          content: (
            <SpaceBetween size="m">
              <LoadError error={summary.error} onRetry={summary.reload} />
              <ResourceCounts
                items={[
                  { label: "User groups", count: s ? s.Groups : null, href: href("/iam/groups") },
                  { label: "Users", count: s ? s.Users : null, href: href("/iam/users") },
                  { label: "Roles", count: s ? s.Roles : null, href: href("/iam/roles") },
                  { label: "Customer managed policies", count: s ? s.Policies : null, href: href("/iam/policies") },
                ]}
              />
            </SpaceBetween>
          ),
        },
        {
          id: "start",
          title: "Get started",
          span: 4,
          content: (
            <SpaceBetween size="s">
              <Box variant="p">Create a user, a group or a role, then give them permissions by attaching managed policies or adding inline policies.</Box>
              <GatedButton op="iam:CreateUser" href={href("/iam/users/create")}>Create user</GatedButton>
              <GatedButton op="iam:CreateRole" href={href("/iam/roles/create")}>Create role</GatedButton>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Users -------------------------------------------------------------------------------------------

const USER_COLUMNS: ResourceTableColumn<IamUser_Serialize>[] = [
  { id: "name", header: "User name", cell: (u) => <Link href={userHref(u.name)}>{u.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "path", header: "Path", cell: (u) => u.path },
  { id: "created", header: "Creation time", cell: (u) => formatDate(u.created), sortingField: "created" },
  { id: "used", header: "Console last sign-in", cell: (u) => (u.password_last_used ? formatDate(u.password_last_used) : "-") },
  { id: "arn", header: "ARN", cell: (u) => u.arn, hidden: true },
];

function UsersList() {
  const users = useLoad(() => commands.iamListUsers(), []);
  const [deleting, setDeleting] = useState<IamUser_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={users.error} onRetry={users.reload} />
      <ResourceTable<IamUser_Serialize>
        resourceName="User"
        title="Users"
        description="An IAM user is an identity with long-term credentials that is used to interact with AWS in an account."
        help={HELP}
        items={users.data ?? []}
        loading={users.loading}
        columns={USER_COLUMNS}
        filteringProperties={[textProperty("name", "User name"), textProperty("path", "Path")]}
        trackBy="name"
        preferencesKey="iam.users"
        selectionType="single"
        onRefresh={users.reload}
        emptyAction={<GatedButton op="iam:CreateUser" href={href("/iam/users/create")}>Create user</GatedButton>}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="iam:DeleteUser" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>Delete</GatedButton>
            <GatedButton variant="primary" op="iam:CreateUser" href={href("/iam/users/create")}>Create user</GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="user" names={deleting ? [deleting.name] : []} op="iam:DeleteUser" confirmation="typed" warning="Deleting the user also deletes its access keys, inline policies and group memberships, and detaches its managed policies." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeleteUser(deleting!.name); users.reload(); }} />
    </SpaceBetween>
  );
}

function TagsField({ tags, onChange }: { tags: TagEditorProps.Tag[]; onChange: (t: TagEditorProps.Tag[]) => void }) {
  return <TagEditor tags={tags} onChange={({ detail }) => onChange([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />;
}

const cleanTags = (tags: TagEditorProps.Tag[]) => tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value }));

function CreateUser() {
  const groups = useLoad(() => commands.iamListGroups(), []);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [memberOf, setMemberOf] = useState<string[]>([]);
  const [policies, setPolicies] = useState<IamPolicy_Serialize[]>([]);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [error, setError] = useState<string | undefined>();
  const check = () => {
    const e = NAME_RULE.test(name) ? undefined : NAME_HINT;
    setError(e);
    return !e;
  };
  return (
    <CreateWizard
      submitLabel="Create user"
      op="iam:CreateUser"
      dirty={name !== "" || memberOf.length > 0 || policies.length > 0 || tags.length > 0}
      cancelHref={href("/iam/users")}
      doneHref={userHref(name)}
      onSubmit={async () => {
        await commands.iamCreateUser({ name, path: path || null, tags: cleanTags(tags), groups: memberOf, policy_arns: policies.map((p) => p.arn) });
      }}
      steps={[
        {
          title: "Specify user details",
          validate: check,
          content: (
            <Container header={<Header variant="h2">User details</Header>}>
              <SpaceBetween size="l">
                <FormField label="User name" errorText={error} constraintText={NAME_HINT}>
                  <Input value={name} placeholder="Enter a user name" onChange={({ detail }) => setName(detail.value)} />
                </FormField>
                <FormField label="Path - optional" constraintText="Begins and ends with /, for example /division_abc/.">
                  <Input value={path} onChange={({ detail }) => setPath(detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Set permissions",
          isOptional: true,
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2" description="Add the user to groups to give it the permissions of the groups.">User groups</Header>}>
                <Multiselect
                  placeholder="Choose user groups"
                  statusType={groups.loading ? "loading" : "finished"}
                  selectedOptions={memberOf.map((g) => ({ value: g, label: g }))}
                  options={(groups.data ?? []).map((g) => ({ value: g.name, label: g.name }))}
                  onChange={({ detail }) => setMemberOf(detail.selectedOptions.map((o) => o.value!))}
                  keepOpen
                />
              </Container>
              <PolicyPicker selected={policies} onChange={setPolicies} />
            </SpaceBetween>
          ),
        },
        {
          title: "Review and create",
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">User details</Header>}>
                <KeyValuePairs columns={3} items={[{ label: "User name", value: name || "-" }, { label: "Path", value: path || "/" }, { label: "User groups", value: memberOf.join(", ") || "-" }, { label: "Attached policies", value: policies.map((p) => p.name).join(", ") || "-" }]} />
              </Container>
              <Container header={<Header variant="h2">Tags - optional</Header>}>
                <TagsField tags={tags} onChange={setTags} />
              </Container>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

/** Managed and inline policies of a user, group or role, with attach, detach and the inline JSON editor. */
function Permissions({ kind, name }: { kind: PrincipalKind; name: string }) {
  const L = kindLabel(kind);
  const { run } = useAction();
  const attached = useLoad(() => commands.iamListAttachedPolicies(kind, name), [kind, name]);
  const inline = useLoad(() => commands.iamListInlinePolicies(kind, name), [kind, name]);
  const [selected, setSelected] = useState<AttachedPolicy[]>([]);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<IamPolicy_Serialize[]>([]);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState<{ name: string; document: string; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { uiOnly } = useUiOnly();

  const openInline = async (policy: string) => {
    await run(async () => setEditing({ name: policy, document: prettyJson(await commands.iamGetInlinePolicy(kind, name, policy)), isNew: false }));
  };
  const EMPTY_DOC = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: [], Resource: "*" }] }, null, 2);

  return (
    <SpaceBetween size="l">
      <Table<AttachedPolicy>
        variant="container"
        items={uiOnly ? [] : (attached.data ?? [])}
        loading={attached.loading}
        trackBy="arn"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        columnDefinitions={[
          { id: "name", header: "Policy name", cell: (p) => <Link href={policyHref(p.arn)}>{p.name}</Link>, isRowHeader: true },
          { id: "type", header: "Type", cell: (p) => (p.arn.startsWith("arn:aws:iam::aws:") ? "AWS managed" : "Customer managed") },
        ]}
        empty={<Box textAlign="center" color="inherit">No managed policies are attached.</Box>}
        header={
          <Header
            variant="h2"
            counter={`(${attached.data?.length ?? 0})`}
            description="Managed policies attached to this identity."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op={`iam:Detach${L}Policy`} disabled={!selected.length} onClick={() => setRemoving(true)}>Remove</GatedButton>
                <GatedButton variant="primary" op={`iam:Attach${L}Policy`} onClick={() => { setPicked([]); setAdding(true); }}>Add permissions</GatedButton>
              </SpaceBetween>
            }
          >
            Permissions policies
          </Header>
        }
      />
      <LoadError error={attached.error ?? inline.error} />
      <Table<string>
        variant="container"
        items={uiOnly ? [] : (inline.data ?? [])}
        loading={inline.loading}
        trackBy={(n) => n}
        columnDefinitions={[
          { id: "name", header: "Policy name", cell: (n) => <Link onFollow={(e) => { e.preventDefault(); openInline(n); }}>{n}</Link>, isRowHeader: true },
          { id: "delete", header: "Actions", cell: (n) => <GatedButton variant="inline-link" op={`iam:Delete${L}Policy`} onClick={() => setDeleting(n)}>Delete</GatedButton> },
        ]}
        empty={<Box textAlign="center" color="inherit">No inline policies.</Box>}
        header={
          <Header variant="h2" counter={`(${inline.data?.length ?? 0})`} description="Policies embedded in this identity." actions={<GatedButton op={`iam:Put${L}Policy`} onClick={() => setEditing({ name: "", document: EMPTY_DOC, isNew: true })}>Create inline policy</GatedButton>}>
            Inline policies
          </Header>
        }
      />
      <FormModal
        visible={adding}
        size="large"
        header="Add permissions"
        op={`iam:Attach${L}Policy`}
        submitLabel="Add permissions"
        canSubmit={picked.length > 0}
        onDismiss={() => setAdding(false)}
        onSubmit={() =>
          run(async () => {
            for (const p of picked) await commands.iamAttachPolicy(kind, name, p.arn);
            attached.reload();
          }, `Attached ${picked.length} polic${picked.length === 1 ? "y" : "ies"}`)
        }
      >
        <PolicyPicker selected={picked} onChange={setPicked} exclude={(attached.data ?? []).map((p) => p.arn)} />
      </FormModal>
      <FormModal
        visible={removing}
        header="Remove permissions"
        op={`iam:Detach${L}Policy`}
        submitLabel="Remove"
        onDismiss={() => setRemoving(false)}
        onSubmit={() =>
          run(async () => {
            for (const p of selected) await commands.iamDetachPolicy(kind, name, p.arn);
            setSelected([]);
            attached.reload();
          }, "Policies detached")
        }
      >
        <Box variant="p">Detach {selected.map((p) => p.name).join(", ")} from {name}? The identity loses the permissions they grant.</Box>
      </FormModal>
      <FormModal
        visible={editing !== null}
        size="large"
        header={editing?.isNew ? "Create inline policy" : `Inline policy ${editing?.name}`}
        op={`iam:Put${L}Policy`}
        submitLabel={editing?.isNew ? "Create policy" : "Save changes"}
        canSubmit={!!editing && editing.name.trim() !== "" && !jsonError(editing.document, false)}
        onDismiss={() => setEditing(null)}
        onSubmit={() =>
          run(async () => {
            await commands.iamPutInlinePolicy(kind, name, editing!.name.trim(), JSON.stringify(JSON.parse(editing!.document)));
            inline.reload();
          }, "Inline policy saved")
        }
      >
        {editing && (
          <SpaceBetween size="m">
            <FormField label="Policy name">
              <Input value={editing.name} disabled={!editing.isNew} onChange={({ detail }) => setEditing({ ...editing, name: detail.value })} />
            </FormField>
            <JsonEditor label="Policy document (JSON)" value={editing.document} rows={16} allowEmpty={false} onChange={(v) => setEditing({ ...editing, document: v })} />
          </SpaceBetween>
        )}
      </FormModal>
      <DeleteModal visible={deleting !== null} resourceKind="inline policy" names={deleting ? [deleting] : []} op={`iam:Delete${L}Policy`} confirmation="simple" onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeleteInlinePolicy(kind, name, deleting!); inline.reload(); }} />
    </SpaceBetween>
  );
}

function UserGroupsTab({ user }: { user: string }) {
  const { run } = useAction();
  const memberships = useLoad(() => commands.iamListGroupsForUser(user), [user]);
  const [selected, setSelected] = useState<IamGroup_Serialize[]>([]);
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const all = useLoad(() => commands.iamListGroups(), [adding], adding);
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="m">
      <LoadError error={memberships.error} />
      <Table<IamGroup_Serialize>
        variant="container"
        items={uiOnly ? [] : (memberships.data ?? [])}
        loading={memberships.loading}
        trackBy="name"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        columnDefinitions={[{ id: "name", header: "Group name", cell: (g) => <Link href={groupHref(g.name)}>{g.name}</Link>, isRowHeader: true }, { id: "created", header: "Creation time", cell: (g) => formatDate(g.created) }]}
        empty={<Box textAlign="center" color="inherit">The user is not a member of any group.</Box>}
        header={
          <Header
            variant="h2"
            counter={`(${memberships.data?.length ?? 0})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="iam:RemoveUserFromGroup" disabled={!selected.length} onClick={() => run(async () => { for (const g of selected) await commands.iamRemoveUserFromGroup(g.name, user); setSelected([]); memberships.reload(); }, "Removed the user from the groups")}>Remove</GatedButton>
                <GatedButton variant="primary" op="iam:AddUserToGroup" onClick={() => { setChosen([]); setAdding(true); }}>Add user to groups</GatedButton>
              </SpaceBetween>
            }
          >
            User groups
          </Header>
        }
      />
      <FormModal visible={adding} header="Add user to groups" op="iam:AddUserToGroup" submitLabel="Add" canSubmit={chosen.length > 0} onDismiss={() => setAdding(false)} onSubmit={() => run(async () => { for (const g of chosen) await commands.iamAddUserToGroup(g, user); memberships.reload(); }, "Added the user to the groups")}>
        <FormField label="Groups">
          <Multiselect
            placeholder="Choose groups"
            statusType={all.loading ? "loading" : "finished"}
            selectedOptions={chosen.map((g) => ({ value: g, label: g }))}
            options={(all.data ?? []).filter((g) => !(memberships.data ?? []).some((m) => m.name === g.name)).map((g) => ({ value: g.name, label: g.name }))}
            onChange={({ detail }) => setChosen(detail.selectedOptions.map((o) => o.value!))}
            keepOpen
          />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

function AccessKeysTab({ user }: { user: string }) {
  const { run } = useAction();
  const keys = useLoad(() => commands.iamListAccessKeys(user), [user]);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [deleting, setDeleting] = useState<AccessKeyInfo_Serialize | null>(null);
  const { uiOnly } = useUiOnly();
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={uiOnly ? null : keys.error} />
      <Table<AccessKeyInfo_Serialize>
        variant="container"
        items={uiOnly ? [] : (keys.data ?? [])}
        loading={keys.loading && !uiOnly}
        trackBy="id"
        columnDefinitions={[
          { id: "id", header: "Access key ID", cell: (k) => k.id, isRowHeader: true },
          { id: "status", header: "Status", cell: (k) => <StatusIndicator type={k.status === "Active" ? "success" : "stopped"}>{k.status}</StatusIndicator> },
          { id: "created", header: "Created", cell: (k) => formatDate(k.created) },
          {
            id: "actions",
            header: "Actions",
            cell: (k) => (
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton variant="inline-link" op="iam:UpdateAccessKey" onClick={() => run(async () => { await commands.iamSetAccessKeyStatus(user, k.id, k.status !== "Active"); keys.reload(); }, `Access key ${k.status === "Active" ? "deactivated" : "activated"}`)}>
                  {k.status === "Active" ? "Make inactive" : "Make active"}
                </GatedButton>
                <GatedButton variant="inline-link" op="iam:DeleteAccessKey" onClick={() => setDeleting(k)}>Delete</GatedButton>
              </SpaceBetween>
            ),
          },
        ]}
        empty={<Box textAlign="center" color="inherit">No access keys. As a best practice, avoid long-term credentials.</Box>}
        header={
          <Header variant="h2" counter={`(${uiOnly ? 0 : (keys.data?.length ?? 0)})`} description="Use access keys to send programmatic calls to the emulator." actions={<GatedButton op="iam:CreateAccessKey" onClick={() => run(async () => setCreated(await commands.iamCreateAccessKey(user)), "Access key created").then(() => keys.reload())}>Create access key</GatedButton>}>
            Access keys
          </Header>
        }
      />
      <FormModal visible={created !== null} header="Retrieve access key" op="iam:CreateAccessKey" submitLabel="Done" onDismiss={() => setCreated(null)} onSubmit={async () => true}>
        {created && (
          <SpaceBetween size="m">
            <Alert type="warning" header="This is the only time the secret access key can be viewed">Copy it now. It is not stored and cannot be retrieved later.</Alert>
            <KeyValuePairs columns={1} items={[{ label: "Access key", value: <Copyable value={created.id} label="access key" /> }, { label: "Secret access key", value: <Copyable value={created.secret} label="secret access key" /> }]} />
          </SpaceBetween>
        )}
      </FormModal>
      <DeleteModal visible={deleting !== null} resourceKind="access key" names={deleting ? [deleting.id] : []} op="iam:DeleteAccessKey" confirmation="simple" onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeleteAccessKey(user, deleting!.id); keys.reload(); }} />
    </SpaceBetween>
  );
}

/** Tags of a user, role or policy, with the Manage tags modal. */
function IamTags({ kind, id }: { kind: "user" | "role" | "policy"; id: string }) {
  const { run } = useAction();
  const tags = useLoad(() => commands.iamListTags(kind, id), [kind, id]);
  const [editing, setEditing] = useState(false);
  const L = kindLabel(kind);
  return (
    <>
      <TagsTable tags={tags.data} loading={tags.loading} op={`iam:Tag${L}`} onEdit={() => setEditing(true)} description="Tags are key-value pairs that you can add to IAM resources." />
      <EditTagsModal
        visible={editing}
        tags={tags.data ?? []}
        op={`iam:Tag${L}`}
        onDismiss={() => setEditing(false)}
        onSave={(next) =>
          run(async () => {
            const before = tags.data ?? [];
            await commands.iamUpdateTags(kind, id, next.filter((t) => before.find((b) => b.key === t.key)?.value !== t.value), before.filter((b) => !next.some((t) => t.key === b.key)).map((b) => b.key));
            tags.reload();
          }, "Tags updated")
        }
      />
    </>
  );
}

function UserDetails({ name }: { name: string }) {
  const user = useLoad(() => commands.iamGetUser(name), [name]);
  const [deleting, setDeleting] = useState(false);
  const u = user.data;
  return (
    <SpaceBetween size="m">
      <LoadError error={user.error} onRetry={user.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={<GatedButton op="iam:DeleteUser" onClick={() => setDeleting(true)}>Delete</GatedButton>}
        overview={{ title: "Summary", columns: 3, items: [{ label: "ARN", value: u ? <Copyable value={u.arn} label="ARN" /> : "-" }, { label: "Created", value: formatDate(u?.created) }, { label: "Path", value: u?.path ?? "-" }, { label: "Console last sign-in", value: u?.password_last_used ? formatDate(u.password_last_used) : "-" }] }}
        sections={[
          { id: "permissions", label: "Permissions", content: <Permissions kind="user" name={name} /> },
          { id: "groups", label: "Groups", content: <UserGroupsTab user={name} /> },
          { id: "tags", label: "Tags", content: <IamTags kind="user" id={name} /> },
          { id: "security", label: "Security credentials", content: <UiOnlyScope primaryOp="iam:ListAccessKeys"><AccessKeysTab user={name} /></UiOnlyScope> },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="user" names={[name]} op="iam:DeleteUser" confirmation="typed" warning="Deleting the user also deletes its access keys, inline policies and group memberships, and detaches its managed policies." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.iamDeleteUser(name); window.location.hash = "#/iam/users"; }} />
    </SpaceBetween>
  );
}

// User groups -------------------------------------------------------------------------------------

const GROUP_COLUMNS: ResourceTableColumn<IamGroup_Serialize>[] = [
  { id: "name", header: "Group name", cell: (g) => <Link href={groupHref(g.name)}>{g.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "path", header: "Path", cell: (g) => g.path },
  { id: "created", header: "Creation time", cell: (g) => formatDate(g.created), sortingField: "created" },
  { id: "arn", header: "ARN", cell: (g) => g.arn, hidden: true },
];

function GroupsList() {
  const groups = useLoad(() => commands.iamListGroups(), []);
  const [deleting, setDeleting] = useState<IamGroup_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={groups.error} onRetry={groups.reload} />
      <ResourceTable<IamGroup_Serialize>
        resourceName="User group"
        title="User groups"
        description="A user group is a collection of IAM users. Use groups to specify permissions for a collection of users."
        help={HELP}
        items={groups.data ?? []}
        loading={groups.loading}
        columns={GROUP_COLUMNS}
        filteringProperties={[textProperty("name", "Group name"), textProperty("path", "Path")]}
        trackBy="name"
        preferencesKey="iam.groups"
        selectionType="single"
        onRefresh={groups.reload}
        emptyAction={<GatedButton op="iam:CreateGroup" href={href("/iam/groups/create")}>Create group</GatedButton>}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="iam:DeleteGroup" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>Delete</GatedButton>
            <GatedButton variant="primary" op="iam:CreateGroup" href={href("/iam/groups/create")}>Create group</GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="group" names={deleting ? [deleting.name] : []} op="iam:DeleteGroup" confirmation="typed" warning="Deleting the group removes its members and its policies from it; the users themselves stay." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeleteGroup(deleting!.name); groups.reload(); }} />
    </SpaceBetween>
  );
}

function CreateGroup() {
  const users = useLoad(() => commands.iamListUsers(), []);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [policies, setPolicies] = useState<IamPolicy_Serialize[]>([]);
  const [error, setError] = useState<string | undefined>();
  return (
    <CreateForm
      title="Create user group"
      help={HELP}
      mode="create"
      submitLabel="Create group"
      op="iam:CreateGroup"
      dirty={name !== "" || members.length > 0 || policies.length > 0}
      cancelHref={href("/iam/groups")}
      validate={() => {
        const e = NAME_RULE.test(name) ? undefined : NAME_HINT;
        setError(e);
        return !e;
      }}
      onSubmit={async () => {
        await commands.iamCreateGroup({ name, path: null, users: members, policy_arns: policies.map((p) => p.arn) });
        return groupHref(name);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Name the group</Header>}>
          <FormField label="User group name" errorText={error} constraintText={NAME_HINT}>
            <Input value={name} placeholder="Enter a meaningful name to identify this group" onChange={({ detail }) => setName(detail.value)} />
          </FormField>
        </Container>
        <Container header={<Header variant="h2">Add users to the group - optional</Header>}>
          <Multiselect placeholder="Choose users" statusType={users.loading ? "loading" : "finished"} selectedOptions={members.map((m) => ({ value: m, label: m }))} options={usersOptions(users.data)} onChange={({ detail }) => setMembers(detail.selectedOptions.map((o) => o.value!))} keepOpen />
        </Container>
        <PolicyPicker selected={policies} onChange={setPolicies} />
      </SpaceBetween>
    </CreateForm>
  );
}

function GroupUsersTab({ group }: { group: string }) {
  const { run } = useAction();
  const details = useLoad(() => commands.iamGetGroup(group), [group]);
  const [selected, setSelected] = useState<IamUser_Serialize[]>([]);
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const all = useLoad(() => commands.iamListUsers(), [adding], adding);
  const members = details.data?.users ?? [];
  return (
    <SpaceBetween size="m">
      <LoadError error={details.error} />
      <Table<IamUser_Serialize>
        variant="container"
        items={members}
        loading={details.loading}
        trackBy="name"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        columnDefinitions={[{ id: "name", header: "User name", cell: (u) => <Link href={userHref(u.name)}>{u.name}</Link>, isRowHeader: true }, { id: "created", header: "Creation time", cell: (u) => formatDate(u.created) }]}
        empty={<Box textAlign="center" color="inherit">The group has no users.</Box>}
        header={
          <Header
            variant="h2"
            counter={`(${members.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="iam:RemoveUserFromGroup" disabled={!selected.length} onClick={() => run(async () => { for (const u of selected) await commands.iamRemoveUserFromGroup(group, u.name); setSelected([]); details.reload(); }, "Removed the users from the group")}>Remove users</GatedButton>
                <GatedButton variant="primary" op="iam:AddUserToGroup" onClick={() => { setChosen([]); setAdding(true); }}>Add users</GatedButton>
              </SpaceBetween>
            }
          >
            Users in this group
          </Header>
        }
      />
      <FormModal visible={adding} header="Add users to the group" op="iam:AddUserToGroup" submitLabel="Add users" canSubmit={chosen.length > 0} onDismiss={() => setAdding(false)} onSubmit={() => run(async () => { for (const u of chosen) await commands.iamAddUserToGroup(group, u); details.reload(); }, "Added the users to the group")}>
        <FormField label="Users">
          <Multiselect placeholder="Choose users" statusType={all.loading ? "loading" : "finished"} selectedOptions={chosen.map((u) => ({ value: u, label: u }))} options={usersOptions(all.data).filter((o) => !members.some((m) => m.name === o.value))} onChange={({ detail }) => setChosen(detail.selectedOptions.map((o) => o.value!))} keepOpen />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

function GroupDetails({ name }: { name: string }) {
  const details = useLoad(() => commands.iamGetGroup(name), [name]);
  const [deleting, setDeleting] = useState(false);
  const g = details.data?.group;
  return (
    <SpaceBetween size="m">
      <LoadError error={details.error} onRetry={details.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={<GatedButton op="iam:DeleteGroup" onClick={() => setDeleting(true)}>Delete</GatedButton>}
        overview={{ title: "Summary", columns: 3, items: [{ label: "ARN", value: g ? <Copyable value={g.arn} label="ARN" /> : "-" }, { label: "Creation time", value: formatDate(g?.created) }, { label: "Path", value: g?.path ?? "-" }] }}
        sections={[
          { id: "users", label: "Users", content: <GroupUsersTab group={name} /> },
          { id: "permissions", label: "Permissions", content: <Permissions kind="group" name={name} /> },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="group" names={[name]} op="iam:DeleteGroup" confirmation="typed" warning="Deleting the group removes its members and its policies from it; the users themselves stay." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.iamDeleteGroup(name); window.location.hash = "#/iam/groups"; }} />
    </SpaceBetween>
  );
}

// Roles -------------------------------------------------------------------------------------------

/** The principal of a trust policy statement, for the "Trusted entities" column. */
function trustedEntities(doc: string | null | undefined): string {
  try {
    const parsed = JSON.parse(doc ?? "");
    const statements = Array.isArray(parsed.Statement) ? parsed.Statement : [parsed.Statement];
    const out: string[] = [];
    for (const s of statements) {
      const p = s?.Principal;
      if (typeof p === "string") out.push(p);
      else if (p && typeof p === "object") for (const v of Object.values(p).flat()) out.push(String(v));
    }
    return out.join(", ") || "-";
  } catch {
    return "-";
  }
}

const ROLE_COLUMNS: ResourceTableColumn<IamRole_Serialize>[] = [
  { id: "name", header: "Role name", cell: (r) => <Link href={roleHref(r.name)}>{r.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "trusted", header: "Trusted entities", cell: (r) => trustedEntities(r.trust_policy) },
  { id: "created", header: "Creation time", cell: (r) => formatDate(r.created), sortingField: "created" },
  { id: "used", header: "Last activity", cell: (r) => (r.last_used ? formatDate(r.last_used) : "-") },
  { id: "arn", header: "ARN", cell: (r) => r.arn, hidden: true },
];

function RolesList() {
  const roles = useLoad(() => commands.iamListRoles(), []);
  const [deleting, setDeleting] = useState<IamRole_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={roles.error} onRetry={roles.reload} />
      <ResourceTable<IamRole_Serialize>
        resourceName="Role"
        title="Roles"
        description="An IAM role is an identity you can create that has specific permissions with short-term credentials."
        help={HELP}
        items={roles.data ?? []}
        loading={roles.loading}
        columns={ROLE_COLUMNS}
        filteringProperties={[textProperty("name", "Role name")]}
        trackBy="name"
        preferencesKey="iam.roles"
        selectionType="single"
        onRefresh={roles.reload}
        emptyAction={<GatedButton op="iam:CreateRole" href={href("/iam/roles/create")}>Create role</GatedButton>}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="iam:DeleteRole" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>Delete</GatedButton>
            <GatedButton variant="primary" op="iam:CreateRole" href={href("/iam/roles/create")}>Create role</GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="role" names={deleting ? [deleting.name] : []} op="iam:DeleteRole" confirmation="typed" warning="Deleting the role detaches its managed policies, deletes its inline policies and removes it from instance profiles." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeleteRole(deleting!.name); roles.reload(); }} />
    </SpaceBetween>
  );
}

const TRUST_SERVICES = ["lambda.amazonaws.com", "ec2.amazonaws.com", "ecs-tasks.amazonaws.com", "states.amazonaws.com", "events.amazonaws.com", "apigateway.amazonaws.com", "sns.amazonaws.com", "s3.amazonaws.com"];

function trustPolicy(kind: string, service: string, account: string, custom: string): string {
  if (kind === "custom") return custom;
  const principal = kind === "service" ? { Service: service } : { AWS: `arn:aws:iam::${account}:root` };
  return JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: principal, Action: "sts:AssumeRole" }] }, null, 2);
}

function CreateRole() {
  const [kind, setKind] = useState("service");
  const [service, setService] = useState(TRUST_SERVICES[0]);
  const [account, setAccount] = useState("000000000000");
  const [custom, setCustom] = useState(trustPolicy("service", TRUST_SERVICES[0], "", ""));
  const [policies, setPolicies] = useState<IamPolicy_Serialize[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [error, setError] = useState<string | undefined>();
  const policy = trustPolicy(kind, service, account, custom);
  return (
    <CreateWizard
      submitLabel="Create role"
      op="iam:CreateRole"
      dirty={name !== "" || policies.length > 0 || tags.length > 0 || kind !== "service" || service !== TRUST_SERVICES[0]}
      cancelHref={href("/iam/roles")}
      doneHref={roleHref(name)}
      onSubmit={async () => {
        await commands.iamCreateRole({ name, path: null, description: description || null, trust_policy: JSON.stringify(JSON.parse(policy)), max_session_duration: null, tags: cleanTags(tags), policy_arns: policies.map((p) => p.arn) });
      }}
      steps={[
        {
          title: "Select trusted entity",
          validate: () => (kind === "custom" ? !jsonError(custom, false) : kind === "account" ? /^\d{12}$/.test(account) : true),
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Trusted entity type</Header>}>
                <Tiles
                  value={kind}
                  onChange={({ detail }) => setKind(detail.value)}
                  items={[
                    { value: "service", label: "AWS service", description: "Allow an AWS service such as Lambda to perform actions in this account." },
                    { value: "account", label: "AWS account", description: "Allow entities in this account to perform actions in this account." },
                    { value: "custom", label: "Custom trust policy", description: "Create a custom trust policy to enable others to perform actions in this account." },
                  ]}
                />
              </Container>
              {kind === "service" && (
                <Container header={<Header variant="h2">Service</Header>}>
                  <FormField label="Service principal">
                    <Select selectedOption={{ value: service, label: service }} options={TRUST_SERVICES.map((s) => ({ value: s, label: s }))} onChange={({ detail }) => setService(detail.selectedOption.value!)} />
                  </FormField>
                </Container>
              )}
              {kind === "account" && (
                <Container header={<Header variant="h2">AWS account</Header>}>
                  <FormField label="Account ID" errorText={/^\d{12}$/.test(account) ? undefined : "Enter a 12-digit account ID."}>
                    <Input value={account} onChange={({ detail }) => setAccount(detail.value)} />
                  </FormField>
                </Container>
              )}
              {kind === "custom" && (
                <Container header={<Header variant="h2">Custom trust policy</Header>}>
                  <JsonEditor label="Trust policy (JSON)" value={custom} rows={14} allowEmpty={false} onChange={setCustom} />
                </Container>
              )}
            </SpaceBetween>
          ),
        },
        { title: "Add permissions", isOptional: true, content: <PolicyPicker selected={policies} onChange={setPolicies} /> },
        {
          title: "Name, review, and create",
          validate: () => {
            const e = NAME_RULE.test(name) ? undefined : NAME_HINT;
            setError(e);
            return !e;
          },
          content: (
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Role details</Header>}>
                <SpaceBetween size="l">
                  <FormField label="Role name" errorText={error} constraintText={NAME_HINT}>
                    <Input value={name} placeholder="Enter a meaningful name to identify this role" onChange={({ detail }) => setName(detail.value)} />
                  </FormField>
                  <FormField label="Description - optional">
                    <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
                  </FormField>
                </SpaceBetween>
              </Container>
              <Container header={<Header variant="h2">Trust policy</Header>}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy)}</pre>
              </Container>
              <Container header={<Header variant="h2">Permissions</Header>}>{policies.length ? policies.map((p) => p.name).join(", ") : "No policies are attached."}</Container>
              <Container header={<Header variant="h2">Tags - optional</Header>}>
                <TagsField tags={tags} onChange={setTags} />
              </Container>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

function TrustTab({ role, reload }: { role: IamRole_Serialize | null; reload: () => void }) {
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <>
      <Container header={<Header variant="h2" description="Customize who can assume the role." actions={<GatedButton op="iam:UpdateAssumeRolePolicy" onClick={() => { setDraft(prettyJson(role?.trust_policy)); setEditing(true); }}>Edit trust policy</GatedButton>}>Trust policy</Header>}>
        {role?.trust_policy ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(role.trust_policy)}</pre> : <Box color="text-status-inactive">No trust policy.</Box>}
      </Container>
      <FormModal visible={editing} size="large" header="Edit trust policy" op="iam:UpdateAssumeRolePolicy" canSubmit={!jsonError(draft, false)} onDismiss={() => setEditing(false)} onSubmit={() => run(async () => { await commands.iamUpdateAssumeRolePolicy(role!.name, JSON.stringify(JSON.parse(draft))); reload(); }, "Trust policy updated")}>
        <JsonEditor label="Trust policy (JSON)" value={draft} rows={16} allowEmpty={false} onChange={setDraft} />
      </FormModal>
    </>
  );
}

function RoleDetails({ name }: { name: string }) {
  const { run } = useAction();
  const role = useLoad(() => commands.iamGetRole(name), [name]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("3600");
  const r = role.data;
  return (
    <SpaceBetween size="m">
      <LoadError error={role.error} onRetry={role.reload} />
      <DetailsPage
        title={name}
        help={HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="iam:UpdateRole" onClick={() => { setDescription(r?.description ?? ""); setDuration(String(r?.max_session_duration ?? 3600)); setEditing(true); }}>Edit</GatedButton>
            <GatedButton op="iam:DeleteRole" onClick={() => setDeleting(true)}>Delete</GatedButton>
          </SpaceBetween>
        }
        overview={{
          title: "Summary",
          columns: 3,
          items: [
            { label: "ARN", value: r ? <Copyable value={r.arn} label="ARN" /> : "-" },
            { label: "Creation date", value: formatDate(r?.created) },
            { label: "Description", value: r?.description ?? "-" },
            { label: "Maximum session duration", value: r?.max_session_duration ? `${r.max_session_duration / 3600} hour${r.max_session_duration === 3600 ? "" : "s"}` : "-" },
            { label: "Last activity", value: r?.last_used ? formatDate(r.last_used) : "-" },
            { label: "Trusted entities", value: trustedEntities(r?.trust_policy) },
          ],
        }}
        sections={[
          { id: "permissions", label: "Permissions", content: <Permissions kind="role" name={name} /> },
          { id: "trust", label: "Trust relationships", content: <TrustTab role={r ?? null} reload={role.reload} /> },
          { id: "tags", label: "Tags", content: <IamTags kind="role" id={name} /> },
        ]}
      />
      <FormModal
        visible={editing}
        header="Edit role"
        op="iam:UpdateRole"
        canSubmit={/^\d+$/.test(duration) && Number(duration) >= 3600 && Number(duration) <= 43200}
        onDismiss={() => setEditing(false)}
        onSubmit={() => run(async () => { await commands.iamUpdateRole(name, description, Number(duration)); role.reload(); }, "Role updated")}
      >
        <SpaceBetween size="m">
          <FormField label="Description">
            <Textarea value={description} onChange={({ detail }) => setDescription(detail.value)} rows={3} />
          </FormField>
          <FormField label="Maximum session duration" constraintText="Seconds, 3600 to 43200.">
            <Input type="number" value={duration} onChange={({ detail }) => setDuration(detail.value)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <DeleteModal visible={deleting} resourceKind="role" names={[name]} op="iam:DeleteRole" confirmation="typed" warning="Deleting the role detaches its managed policies, deletes its inline policies and removes it from instance profiles." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.iamDeleteRole(name); window.location.hash = "#/iam/roles"; }} />
    </SpaceBetween>
  );
}

// Policies ----------------------------------------------------------------------------------------

const POLICY_COLUMNS: ResourceTableColumn<IamPolicy_Serialize>[] = [
  { id: "name", header: "Policy name", cell: (p) => <Link href={policyHref(p.arn)}>{p.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "kind", header: "Type", cell: (p) => p.kind, sortingField: "kind" },
  { id: "attached", header: "Attached entities", cell: (p) => p.attachment_count, sortingField: "attachment_count" },
  { id: "updated", header: "Last edited", cell: (p) => formatDate(p.updated), sortingField: "updated" },
  { id: "arn", header: "ARN", cell: (p) => p.arn, hidden: true },
];

function PoliciesList() {
  const policies = useLoad(() => commands.iamListPolicies("all", false), []);
  const [deleting, setDeleting] = useState<IamPolicy_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={policies.error} onRetry={policies.reload} />
      <ResourceTable<IamPolicy_Serialize>
        resourceName="Policy"
        title="Policies"
        description="A policy is an object in AWS that defines permissions."
        help={HELP}
        items={policies.data ?? []}
        loading={policies.loading}
        columns={POLICY_COLUMNS}
        filteringProperties={[textProperty("name", "Policy name"), textProperty("kind", "Type", "enum")]}
        trackBy="arn"
        preferencesKey="iam.policies"
        selectionType="single"
        onRefresh={policies.reload}
        emptyAction={<GatedButton op="iam:CreatePolicy" href={href("/iam/policies/create")}>Create policy</GatedButton>}
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="iam:DeletePolicy" disabled={sel.length !== 1 || sel[0].kind !== "Customer managed"} onClick={() => setDeleting(sel[0])}>Delete</GatedButton>
            <GatedButton variant="primary" op="iam:CreatePolicy" href={href("/iam/policies/create")}>Create policy</GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal visible={deleting !== null} resourceKind="policy" names={deleting ? [deleting.name] : []} op="iam:DeletePolicy" confirmation="typed" warning="A policy attached to a user, group or role cannot be deleted until it is detached." onDismiss={() => setDeleting(null)} onDelete={async () => { await commands.iamDeletePolicy(deleting!.arn); policies.reload(); }} />
    </SpaceBetween>
  );
}

const POLICY_TEMPLATE = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }] }, null, 2);

function CreatePolicy() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState(POLICY_TEMPLATE);
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const [errors, setErrors] = useState<{ name?: string; document?: string }>({});
  return (
    <CreateForm
      title="Create policy"
      description="A policy defines the AWS permissions that you can assign to a user, group, or role."
      help={HELP}
      mode="create"
      submitLabel="Create policy"
      op="iam:CreatePolicy"
      dirty={name !== "" || description !== "" || document !== POLICY_TEMPLATE || tags.length > 0}
      cancelHref={href("/iam/policies")}
      validate={() => {
        const e = { name: NAME_RULE.test(name) ? undefined : NAME_HINT, document: jsonError(document, false) };
        setErrors(e);
        return !e.name && !e.document;
      }}
      onSubmit={async () => {
        const arn = await commands.iamCreatePolicy({ name, path: null, description: description || null, document: JSON.stringify(JSON.parse(document)), tags: cleanTags(tags) });
        return policyHref(arn);
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Policy editor</Header>}>
          <JsonEditor label="Policy document (JSON)" value={document} rows={18} allowEmpty={false} onChange={setDocument} />
          {errors.document && <Box color="text-status-error">{errors.document}</Box>}
        </Container>
        <Container header={<Header variant="h2">Policy details</Header>}>
          <SpaceBetween size="l">
            <FormField label="Policy name" errorText={errors.name} constraintText={NAME_HINT}>
              <Input value={name} placeholder="Enter a meaningful name to identify this policy" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Description - optional">
              <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2">Tags - optional</Header>}>
          <TagsField tags={tags} onChange={setTags} />
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

function PolicyVersionsTab({ arn, reload }: { arn: string; reload: () => void }) {
  const { run } = useAction();
  const versions = useLoad(() => commands.iamListPolicyVersions(arn), [arn]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [viewing, setViewing] = useState<{ id: string; document: string } | null>(null);
  const customer = !arn.startsWith("arn:aws:iam::aws:");
  const list = versions.data ?? [];
  return (
    <SpaceBetween size="m">
      <LoadError error={versions.error} />
      <Table
        variant="container"
        items={list}
        loading={versions.loading}
        trackBy="id"
        columnDefinitions={[
          { id: "id", header: "Version", cell: (v) => <Link onFollow={(e) => { e.preventDefault(); run(async () => setViewing({ id: v.id, document: prettyJson(await commands.iamGetPolicyVersion(arn, v.id)) })); }}>{v.id}</Link>, isRowHeader: true },
          { id: "default", header: "Default", cell: (v) => (v.is_default ? <StatusIndicator type="success">Default</StatusIndicator> : "-") },
          { id: "created", header: "Created", cell: (v) => formatDate(v.created) },
          {
            id: "actions",
            header: "Actions",
            cell: (v) =>
              customer && !v.is_default ? (
                <SpaceBetween direction="horizontal" size="xs">
                  <GatedButton variant="inline-link" op="iam:SetDefaultPolicyVersion" onClick={() => run(async () => { await commands.iamSetDefaultPolicyVersion(arn, v.id); versions.reload(); reload(); }, `Version ${v.id} is now the default`)}>Set as default</GatedButton>
                  <GatedButton variant="inline-link" op="iam:DeletePolicyVersion" onClick={() => run(async () => { await commands.iamDeletePolicyVersion(arn, v.id); versions.reload(); }, `Version ${v.id} deleted`)}>Delete</GatedButton>
                </SpaceBetween>
              ) : (
                "-"
              ),
          },
        ]}
        header={
          <Header variant="h2" counter={`(${list.length})`} description="A policy keeps up to five versions." actions={customer && <GatedButton op="iam:CreatePolicyVersion" disabled={list.length >= 5} onClick={() => { setDraft(POLICY_TEMPLATE); setCreating(true); }}>Create version</GatedButton>}>
            Policy versions
          </Header>
        }
      />
      <FormModal visible={creating} size="large" header="Create policy version" op="iam:CreatePolicyVersion" submitLabel="Create version" canSubmit={!jsonError(draft, false)} onDismiss={() => setCreating(false)} onSubmit={() => run(async () => { await commands.iamCreatePolicyVersion(arn, JSON.stringify(JSON.parse(draft))); versions.reload(); reload(); }, "Version created and set as the default")}>
        <JsonEditor label="Policy document (JSON)" value={draft} rows={16} allowEmpty={false} onChange={setDraft} />
      </FormModal>
      <FormModal visible={viewing !== null} size="large" header={`Version ${viewing?.id}`} op="iam:GetPolicyVersion" submitLabel="Done" onDismiss={() => setViewing(null)} onSubmit={async () => true}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{viewing?.document}</pre>
      </FormModal>
    </SpaceBetween>
  );
}

function PolicyDetails({ arn }: { arn: string }) {
  const policy = useLoad(() => commands.iamGetPolicy(arn), [arn]);
  const entities = useLoad(() => commands.iamListPolicyEntities(arn), [arn]);
  const [deleting, setDeleting] = useState(false);
  const p = policy.data?.policy;
  const customer = p ? p.kind === "Customer managed" : !arn.startsWith("arn:aws:iam::aws:");
  return (
    <SpaceBetween size="m">
      <LoadError error={policy.error} onRetry={policy.reload} />
      <DetailsPage
        title={p?.name ?? arn.slice(arn.lastIndexOf("/") + 1)}
        help={HELP}
        layout="tabs"
        actions={customer && <GatedButton op="iam:DeletePolicy" onClick={() => setDeleting(true)}>Delete</GatedButton>}
        overview={{
          title: "Summary",
          columns: 3,
          items: [
            { label: "ARN", value: <Copyable value={arn} label="ARN" /> },
            { label: "Type", value: p?.kind ?? "-" },
            { label: "Creation time", value: formatDate(p?.created) },
            { label: "Edited time", value: formatDate(p?.updated) },
            { label: "Attached entities", value: p?.attachment_count ?? "-" },
            { label: "Description", value: p?.description ?? "-" },
          ],
        }}
        sections={[
          { id: "permissions", label: "Permissions", content: <Container header={<Header variant="h2">Policy document</Header>}>{policy.data?.document ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy.data.document)}</pre> : <Box color="text-status-inactive">No document.</Box>}</Container> },
          {
            id: "entities",
            label: "Entities attached",
            content: (
              <Table
                variant="container"
                items={entities.data ?? []}
                loading={entities.loading}
                trackBy={(e) => `${e.kind}/${e.name}`}
                columnDefinitions={[
                  { id: "name", header: "Name", cell: (e) => <Link href={e.kind === "User" ? userHref(e.name) : e.kind === "Group" ? groupHref(e.name) : roleHref(e.name)}>{e.name}</Link>, isRowHeader: true },
                  { id: "kind", header: "Type", cell: (e) => e.kind },
                ]}
                empty={<Box textAlign="center" color="inherit">The policy is not attached to any user, group or role.</Box>}
                header={<Header variant="h2" counter={`(${entities.data?.length ?? 0})`}>Entities attached</Header>}
              />
            ),
          },
          ...(customer ? [{ id: "tags", label: "Tags", content: <IamTags kind="policy" id={arn} /> }] : []),
          { id: "versions", label: "Policy versions", content: <PolicyVersionsTab arn={arn} reload={policy.reload} /> },
        ]}
      />
      <DeleteModal visible={deleting} resourceKind="policy" names={[p?.name ?? arn]} op="iam:DeletePolicy" confirmation="typed" warning="A policy attached to a user, group or role cannot be deleted until it is detached." onDismiss={() => setDeleting(false)} onDelete={async () => { await commands.iamDeletePolicy(arn); window.location.hash = "#/iam/policies"; }} />
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The IAM page for a route path, or null when the path is not an IAM page. */
export function iamPage(path: string): ReactNode | null {
  if (path === "/iam" || path === "/iam/dashboard") return page("", "", [{ text: "Dashboard", href: href("/iam/dashboard") }], <UiOnlyScope primaryOp="iam:GetAccountSummary"><Dashboard /></UiOnlyScope>);
  if (path === "/iam/users") return page("Users", href("/iam/users"), [], <UiOnlyScope primaryOp="iam:ListUsers"><UsersList /></UiOnlyScope>, "table");
  if (path === "/iam/users/create") return page("Users", href("/iam/users"), [{ text: "Create user", href: href("/iam/users/create") }], <CreateUser />, "form");
  const user = matchPath("/iam/users/:name", path);
  if (user) return page("Users", href("/iam/users"), [{ text: user.name, href: userHref(user.name) }], <UiOnlyScope primaryOp="iam:GetUser"><UserDetails key={user.name} name={user.name} /></UiOnlyScope>);
  if (path === "/iam/groups") return page("User groups", href("/iam/groups"), [], <UiOnlyScope primaryOp="iam:ListGroups"><GroupsList /></UiOnlyScope>, "table");
  if (path === "/iam/groups/create") return page("User groups", href("/iam/groups"), [{ text: "Create user group", href: href("/iam/groups/create") }], <CreateGroup />, "form");
  const group = matchPath("/iam/groups/:name", path);
  if (group) return page("User groups", href("/iam/groups"), [{ text: group.name, href: groupHref(group.name) }], <UiOnlyScope primaryOp="iam:GetGroup"><GroupDetails key={group.name} name={group.name} /></UiOnlyScope>);
  if (path === "/iam/roles") return page("Roles", href("/iam/roles"), [], <UiOnlyScope primaryOp="iam:ListRoles"><RolesList /></UiOnlyScope>, "table");
  if (path === "/iam/roles/create") return page("Roles", href("/iam/roles"), [{ text: "Create role", href: href("/iam/roles/create") }], <CreateRole />, "form");
  const role = matchPath("/iam/roles/:name", path);
  if (role) return page("Roles", href("/iam/roles"), [{ text: role.name, href: roleHref(role.name) }], <UiOnlyScope primaryOp="iam:GetRole"><RoleDetails key={role.name} name={role.name} /></UiOnlyScope>);
  if (path === "/iam/policies") return page("Policies", href("/iam/policies"), [], <UiOnlyScope primaryOp="iam:ListPolicies"><PoliciesList /></UiOnlyScope>, "table");
  if (path === "/iam/policies/create") return page("Policies", href("/iam/policies"), [{ text: "Create policy", href: href("/iam/policies/create") }], <CreatePolicy />, "form");
  const policy = matchPath("/iam/policies/:arn", path);
  if (policy) return page("Policies", href("/iam/policies"), [{ text: policy.arn.slice(policy.arn.lastIndexOf("/") + 1), href: policyHref(policy.arn) }], <UiOnlyScope primaryOp="iam:GetPolicy"><PolicyDetails key={policy.arn} arn={policy.arn} /></UiOnlyScope>);
  return null;
}
