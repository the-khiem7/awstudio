// Systems Manager OpsCenter console pages: OpsItems list, create OpsItem and OpsItem details.

import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { useState, type ReactNode } from "react";
import { commands, type SsmOpsItemSummary_Serialize } from "../../bindings";
import { CreateForm, DeleteModal, DetailsPage, GatedButton, ResourceTable, ScopeBanner, textProperty, UiOnlyScope, type ResourceTableColumn } from "../../patterns";
import { navigate } from "../../shell/router";
import { formatDate, FormModal, LoadError, useAction, useLoad, useRegion } from "../common";
import { SSM_HELP, ssmHref, ssmPage } from "./shell";

const OPSITEMS = "/systems-manager/opsitems";

const listHref = () => ssmHref("/opsitems");
const createHref = () => ssmHref("/opsitems/create");
const itemHref = (id: string) => ssmHref("/opsitems/detail", { id });

const STATUSES = ["Open", "InProgress", "Resolved"].map((s) => ({ value: s, label: s }));
const PRIORITIES = ["1", "2", "3", "4", "5"].map((p) => ({ value: p, label: p }));
const SEVERITIES = [
  { value: "1", label: "1 - Critical" },
  { value: "2", label: "2 - High" },
  { value: "3", label: "3 - Medium" },
  { value: "4", label: "4 - Low" },
];
const CATEGORIES = ["Availability", "Cost", "Performance", "Recovery", "Security"].map((c) => ({ value: c, label: c }));

// OpsItems list -----------------------------------------------------------------------------------

const COLUMNS: ResourceTableColumn<SsmOpsItemSummary_Serialize>[] = [
  { id: "id", header: "ID", cell: (o) => <Link href={itemHref(o.id)}>{o.id}</Link>, sortingField: "id", isRowHeader: true, alwaysVisible: true },
  { id: "title", header: "Title", cell: (o) => o.title || "-", sortingField: "title" },
  { id: "status", header: "Status", cell: (o) => o.status || "-", sortingField: "status" },
  { id: "priority", header: "Priority", cell: (o) => o.priority ?? "-", sortingField: "priority" },
  { id: "source", header: "Source", cell: (o) => o.source || "-", sortingField: "source" },
  { id: "severity", header: "Severity", cell: (o) => o.severity || "-", sortingField: "severity" },
  { id: "category", header: "Category", cell: (o) => o.category || "-", sortingField: "category" },
  { id: "created", header: "Created", cell: (o) => formatDate(o.created), sortingField: "created" },
];

function OpsItemsList() {
  const region = useRegion();
  const items = useLoad(() => commands.ssmListOpsItems(region), []);
  const [deleting, setDeleting] = useState<SsmOpsItemSummary_Serialize | null>(null);
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={items.error} onRetry={items.reload} />
      <ResourceTable<SsmOpsItemSummary_Serialize>
        resourceName="OpsItem"
        title="OpsItems"
        help={SSM_HELP}
        items={items.data ?? []}
        loading={items.loading}
        columns={COLUMNS}
        filteringProperties={[
          textProperty("id", "ID"),
          textProperty("title", "Title"),
          textProperty("status", "Status", "enum"),
          textProperty("source", "Source"),
          textProperty("severity", "Severity", "enum"),
          textProperty("category", "Category", "enum"),
        ]}
        trackBy="id"
        preferencesKey="ssm.opsitems"
        selectionType="single"
        onRefresh={items.reload}
        emptyAction={
          <GatedButton op="ssm:CreateOpsItem" href={createHref()}>
            Create OpsItem
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="ssm:DeleteOpsItem" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="ssm:CreateOpsItem" href={createHref()}>
              Create OpsItem
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="OpsItem"
        names={deleting ? [deleting.id] : []}
        op="ssm:DeleteOpsItem"
        confirmation="simple"
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.ssmDeleteOpsItem(region, deleting!.id);
          items.reload();
        }}
      />
    </SpaceBetween>
  );
}

// Create OpsItem ----------------------------------------------------------------------------------

function CreateOpsItem() {
  const region = useRegion();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; source?: string; description?: string }>({});
  return (
    <CreateForm
      title="Create OpsItem"
      help={SSM_HELP}
      mode="create"
      submitLabel="Create OpsItem"
      op="ssm:CreateOpsItem"
      dirty={title !== "" || source !== "" || description !== ""}
      cancelHref={listHref()}
      validate={() => {
        const e = {
          title: title ? (title.length > 1024 ? "The title can have at most 1024 characters." : undefined) : "Enter a title.",
          source: source ? (source.length > 128 ? "The source can have at most 128 characters." : undefined) : "Enter a source.",
          description: description ? (description.length > 2048 ? "The description can have at most 2048 characters." : undefined) : "Enter a description.",
        };
        setErrors(e);
        return !e.title && !e.source && !e.description;
      }}
      onSubmit={async () => {
        const id = await commands.ssmCreateOpsItem(region, { title, source, description, priority: priority ? Number(priority) : null, severity, category });
        return itemHref(id);
      }}
    >
      <Container header={<Header variant="h2">OpsItem details</Header>}>
        <SpaceBetween size="l">
          <FormField label="Title" errorText={errors.title} constraintText="Up to 1024 characters.">
            <Input value={title} onChange={({ detail }) => setTitle(detail.value)} />
          </FormField>
          <FormField label="Source" errorText={errors.source} description="Where the issue originated, for example the name of a service or application." constraintText="Up to 128 characters. Can't start with aws, amazon or amzn.">
            <Input value={source} onChange={({ detail }) => setSource(detail.value)} />
          </FormField>
          <FormField label="Description" errorText={errors.description} constraintText="Up to 2048 characters." stretch>
            <Textarea value={description} rows={5} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <FormField label="Priority - optional" description="1 is the highest priority.">
            <Select selectedOption={PRIORITIES.find((p) => p.value === priority) ?? null} options={PRIORITIES} placeholder="Choose a priority" onChange={({ detail }) => setPriority(detail.selectedOption.value ?? null)} />
          </FormField>
          <FormField label="Severity - optional">
            <Select selectedOption={SEVERITIES.find((s) => s.value === severity) ?? null} options={SEVERITIES} placeholder="Choose a severity" onChange={({ detail }) => setSeverity(detail.selectedOption.value ?? null)} />
          </FormField>
          <FormField label="Category - optional">
            <Select selectedOption={CATEGORIES.find((c) => c.value === category) ?? null} options={CATEGORIES} placeholder="Choose a category" onChange={({ detail }) => setCategory(detail.selectedOption.value ?? null)} />
          </FormField>
        </SpaceBetween>
      </Container>
    </CreateForm>
  );
}

// OpsItem details ---------------------------------------------------------------------------------

function OpsItemDetails({ id }: { id: string }) {
  const region = useRegion();
  const { run } = useAction();
  const item = useLoad(() => commands.ssmGetOpsItem(region, id), [id]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Open");
  const [priority, setPriority] = useState<string | null>(null);
  const o = item.data;
  const statusOptions = status && !STATUSES.some((s) => s.value === status) ? [...STATUSES, { value: status, label: status }] : STATUSES;
  return (
    <SpaceBetween size="m">
      <LoadError error={item.error} onRetry={item.reload} />
      <DetailsPage
        title={`OpsItem: ${id}`}
        help={SSM_HELP}
        layout="tabs"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton
              op="ssm:UpdateOpsItem"
              disabled={!o}
              onClick={() => {
                setTitle(o?.title ?? "");
                setDescription(o?.description ?? "");
                setStatus(o?.status ?? "Open");
                setPriority(o?.priority != null ? String(o.priority) : null);
                setEditing(true);
              }}
            >
              Edit
            </GatedButton>
            <GatedButton op="ssm:DeleteOpsItem" onClick={() => setDeleting(true)}>
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
                    { label: "ID", value: id },
                    { label: "Title", value: o?.title || "-" },
                    { label: "Status", value: o?.status || "-" },
                    { label: "Priority", value: o?.priority ?? "-" },
                    { label: "Source", value: o?.source || "-" },
                    { label: "Severity", value: o?.severity || "-" },
                    { label: "Category", value: o?.category || "-" },
                    { label: "Created", value: formatDate(o?.created) },
                    { label: "Created by", value: o?.created_by || "-" },
                    { label: "Last modified", value: formatDate(o?.last_modified) },
                    { label: "Description", value: o?.description ? <span style={{ whiteSpace: "pre-wrap" }}>{o.description}</span> : "-" },
                  ]}
                />
              </Container>
            ),
          },
          {
            id: "operational-data",
            label: "Operational data",
            content: (
              <Table
                variant="container"
                loading={item.loading}
                loadingText="Loading operational data"
                items={Object.entries(o?.operational_data ?? {}).map(([key, value]) => ({ key, value }))}
                trackBy="key"
                columnDefinitions={[
                  { id: "key", header: "Key", cell: (d) => d.key, isRowHeader: true },
                  { id: "value", header: "Value", cell: (d) => d.value },
                ]}
                empty={
                  <Box textAlign="center" color="inherit">
                    <b>No operational data</b>
                  </Box>
                }
                header={<Header variant="h2">Operational data</Header>}
              />
            ),
          },
        ]}
      />
      <DeleteModal
        visible={deleting}
        resourceKind="OpsItem"
        names={[id]}
        op="ssm:DeleteOpsItem"
        confirmation="simple"
        onDismiss={() => setDeleting(false)}
        onDelete={async () => {
          await commands.ssmDeleteOpsItem(region, id);
          navigate(listHref());
        }}
      />
      <FormModal
        visible={editing}
        size="large"
        header={`Edit OpsItem ${id}`}
        op="ssm:UpdateOpsItem"
        canSubmit={title !== "" && description !== ""}
        onDismiss={() => setEditing(false)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmUpdateOpsItem(region, id, title, description, status, priority ? Number(priority) : null);
            item.reload();
          }, "OpsItem updated")
        }
      >
        <SpaceBetween size="l">
          <FormField label="Title">
            <Input value={title} onChange={({ detail }) => setTitle(detail.value)} />
          </FormField>
          <FormField label="Description" stretch>
            <Textarea value={description} rows={5} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <FormField label="Status">
            <Select selectedOption={statusOptions.find((s) => s.value === status) ?? null} options={statusOptions} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
          </FormField>
          <FormField label="Priority" description="1 is the highest priority.">
            <Select selectedOption={PRIORITIES.find((p) => p.value === priority) ?? null} options={PRIORITIES} placeholder="Choose a priority" onChange={({ detail }) => setPriority(detail.selectedOption.value ?? null)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
    </SpaceBetween>
  );
}

// Routes ------------------------------------------------------------------------------------------

/** The OpsCenter page for a route path, or null when the path is not one of its pages. */
export function opsCenterPages(path: string, query: URLSearchParams): ReactNode | null {
  const list = { text: "OpsCenter", href: listHref() };
  if (path === OPSITEMS) {
    return ssmPage(
      [list],
      <UiOnlyScope primaryOp="ssm:DescribeOpsItems">
        <OpsItemsList />
      </UiOnlyScope>,
      "table",
    );
  }
  if (path === `${OPSITEMS}/create`) return ssmPage([list, { text: "Create OpsItem", href: createHref() }], <CreateOpsItem />, "form");
  if (path === `${OPSITEMS}/detail`) {
    const id = query.get("id") ?? "";
    return ssmPage(
      [list, { text: id || "OpsItem", href: itemHref(id) }],
      id ? (
        <UiOnlyScope primaryOp="ssm:GetOpsItem">
          <OpsItemDetails key={id} id={id} />
        </UiOnlyScope>
      ) : (
        <Box color="text-status-inactive">No OpsItem is selected. Choose one from the OpsItems list.</Box>
      ),
    );
  }
  return null;
}
