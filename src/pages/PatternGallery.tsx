// Development-only gallery of the console page patterns, with fixture data. It is not bundled
// into a release build. It also exercises the gating acceptance: a UI-only page, a green control
// that calls the backend and red or variant-gated controls that stay disabled.

import Box from "@cloudscape-design/components/box";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useState } from "react";
import { useReportUnsupported } from "../capability";
import {
  CreateForm,
  CreateWizard,
  dateTimeProperty,
  DeleteModal,
  DetailsPage,
  GatedButton,
  ManageTags,
  ResourceCounts,
  ResourceTable,
  S3Picker,
  ServiceDashboard,
  textProperty,
  UiOnlyScope,
  UnsupportedBanner,
  useComparisonSplitPanel,
  type ResourceTableColumn,
  type S3Source,
  type Tag,
} from "../patterns";
import { api, errorText } from "../runtime/api";
import { ConsolePage } from "../shell/ConsolePage";
import { href } from "../shell/router";

interface Fixture {
  name: string;
  state: string;
  created: Date;
  size: number;
  description: string;
}

const FIXTURES: Fixture[] = Array.from({ length: 23 }, (_, i) => ({
  name: `fixture-${String(i + 1).padStart(2, "0")}`,
  state: i % 4 === 0 ? "Disabled" : "Enabled",
  created: new Date(Date.UTC(2026, 10, 1 + (i % 14), 8 + (i % 10))),
  size: (i * 37) % 500,
  description: i % 3 === 0 ? "" : `Gallery fixture ${i + 1}`,
}));

const FIXTURE_COLUMNS: ResourceTableColumn<Fixture>[] = [
  { id: "name", header: "Name", cell: (f) => f.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  {
    id: "state",
    header: "State",
    cell: (f) => <StatusIndicator type={f.state === "Enabled" ? "success" : "stopped"}>{f.state}</StatusIndicator>,
    sortingField: "state",
  },
  { id: "created", header: "Created", cell: (f) => f.created.toISOString(), sortingField: "created" },
  { id: "size", header: "Size (KB)", cell: (f) => f.size, sortingField: "size" },
  {
    id: "description",
    header: "Description",
    cell: (f) => f.description || "-",
    editConfig: {
      ariaLabel: "Description",
      editIconAriaLabel: "editable",
      editingCell: (item, { currentValue, setValue }) => (
        <Input autoFocus value={(currentValue as string | undefined) ?? item.description} onChange={({ detail }) => setValue(detail.value)} />
      ),
    },
  },
];

const FIXTURE_FILTERS = [
  textProperty("name", "Name"),
  textProperty("state", "State", "enum"),
  textProperty("description", "Description"),
  dateTimeProperty("created", "Created"),
];

const S3_FIXTURE: S3Source = {
  buckets: async () => [
    { Name: "fixture-bucket", CreationDate: "2026-11-01T00:00:00Z" },
    { Name: "fixture-logs", CreationDate: "2026-11-02T00:00:00Z" },
  ],
  objects: async (_bucket, path) =>
    path ? [{ Key: "report.csv", Size: 1024, LastModified: "2026-11-03T00:00:00Z" }] : [{ Key: "data/", IsFolder: true }, { Key: "readme.txt", Size: 12 }],
  versions: async () => [{ VersionId: "v1", LastModified: "2026-11-03T00:00:00Z", Size: 1024 }],
};

const PATTERNS = [
  ["gating", "Gating acceptance"],
  ["table", "Table with property and date filter"],
  ["editable", "Editable table"],
  ["comparison", "Split-panel comparison"],
  ["details-tabs", "Details with tabs"],
  ["details-hub", "Details hub"],
  ["create", "Single-page create"],
  ["edit", "Edit"],
  ["wizard", "Wizard"],
  ["delete", "Delete confirmations"],
  ["tags", "Manage tags"],
  ["s3", "S3 read and write pickers"],
  ["dashboard", "Dashboard"],
] as const;

function GatingDemo() {
  const report = useReportUnsupported();
  const [result, setResult] = useState<string | null>(null);
  const callBackend = async () => {
    try {
      const check = await api.sessionCheck();
      setResult(`Backend answered: account ${check.account}, ${check.bucket_count} buckets`);
    } catch (e) {
      report(e);
      setResult(errorText(e));
    }
  };
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Controls</Header>}>
        <SpaceBetween size="m">
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sts:GetCallerIdentity" onClick={callBackend} data-testid="green">
              Green: get caller identity
            </GatedButton>
            <GatedButton op="ssm:DescribeMaintenanceWindows" data-testid="red">
              Red: describe maintenance windows
            </GatedButton>
            <GatedButton op="s3:GetObjectAttributes" data-testid="yellow">
              Yellow: get object attributes
            </GatedButton>
            <GatedButton op="lambda:UpdateFunctionCode" feature="PublishTo" data-testid="variant">
              Variant: update code with PublishTo
            </GatedButton>
          </SpaceBetween>
          <Box data-testid="green-result">{result ?? "Not called yet."}</Box>
        </SpaceBetween>
      </Container>
      <UiOnlyScope primaryOp="ssm:DescribeMaintenanceWindows">
        <SpaceBetween size="m">
          <UnsupportedBanner />
          <ResourceTable<Fixture>
            resourceName="Maintenance window"
            title="Maintenance windows"
            items={FIXTURES}
            columns={FIXTURE_COLUMNS.slice(0, 3)}
            filteringProperties={FIXTURE_FILTERS}
            trackBy="name"
            preferencesKey="gallery.ui-only"
            selectionType="single"
            variant="container"
            actions={() => (
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="ssm:DeleteMaintenanceWindow">Delete</GatedButton>
                <GatedButton variant="primary" op="ssm:CreateMaintenanceWindow">
                  Create maintenance window
                </GatedButton>
              </SpaceBetween>
            )}
          />
        </SpaceBetween>
      </UiOnlyScope>
    </SpaceBetween>
  );
}

function Gallery({ pattern, onSelection }: { pattern: string; onSelection: (items: readonly Fixture[]) => void }) {
  const [deleting, setDeleting] = useState<"simple" | "typed" | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [uri, setUri] = useState("");
  const [tags, setTags] = useState<Tag[]>([{ key: "team", value: "local" }, { key: "aws:cloudformation:stack-name", value: "x" }]);
  const done = href("/dev/patterns/gating");

  switch (pattern) {
    case "gating":
      return <GatingDemo />;
    case "table":
    case "editable":
    case "comparison":
      return (
        <ResourceTable<Fixture>
          resourceName="Fixture"
          title="Fixtures"
          description="Fixture rows of the pattern gallery."
          items={FIXTURES}
          columns={pattern === "editable" ? FIXTURE_COLUMNS : FIXTURE_COLUMNS.map(({ editConfig: _, ...c }) => c)}
          filteringProperties={FIXTURE_FILTERS}
          trackBy="name"
          preferencesKey={`gallery.${pattern}`}
          selectionType={pattern === "comparison" ? "multi" : "single"}
          onSelectionChange={onSelection}
          submitEdit={pattern === "editable" ? async () => new Promise((r) => setTimeout(r, 300)) : undefined}
          onRefresh={() => undefined}
          actions={(selected) => (
            <SpaceBetween direction="horizontal" size="xs">
              <GatedButton op="sqs:DeleteQueue" disabled={selected.length === 0}>
                Delete
              </GatedButton>
              <GatedButton variant="primary" op="sqs:CreateQueue">
                Create fixture
              </GatedButton>
            </SpaceBetween>
          )}
        />
      );
    case "details-tabs":
    case "details-hub":
      return (
        <DetailsPage
          title="fixture-01"
          layout={pattern === "details-tabs" ? "tabs" : "hub"}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <GatedButton op="sqs:SetQueueAttributes">Edit</GatedButton>
              <GatedButton op="sqs:DeleteQueue">Delete</GatedButton>
              <ButtonDropdown items={[{ id: "purge", text: "Purge" }]}>Actions</ButtonDropdown>
            </SpaceBetween>
          }
          overview={{
            title: "Details",
            items: [
              { label: "Name", value: "fixture-01" },
              { label: "State", value: <StatusIndicator type="success">Enabled</StatusIndicator> },
              { label: "Created", value: FIXTURES[0].created.toISOString() },
            ],
          }}
          sections={[
            { id: "settings", label: "Settings", content: <Container header={<Header variant="h2">Settings</Header>}>Settings section.</Container> },
            { id: "monitoring", label: "Monitoring", content: <Container header={<Header variant="h2">Monitoring</Header>}>Monitoring section.</Container> },
            { id: "tags", label: "Tags", content: <Container header={<Header variant="h2">Tags</Header>}>Tags section.</Container> },
          ]}
        />
      );
    case "create":
    case "edit":
      return (
        <CreateForm
          title={pattern === "create" ? "Create fixture" : "Edit fixture-01"}
          mode={pattern}
          submitLabel={pattern === "create" ? "Create fixture" : undefined}
          op="sqs:CreateQueue"
          dirty={name !== ""}
          validate={() => {
            const error = /^[a-zA-Z0-9_-]{1,80}$/.test(name) ? undefined : "Use 1 to 80 letters, numbers, hyphens or underscores.";
            setNameError(error);
            return !error;
          }}
          onSubmit={async () => undefined}
          cancelHref={done}
        >
          <Container header={<Header variant="h2">Details</Header>}>
            <FormField label="Name" errorText={nameError}>
              <Input value={name} onChange={({ detail }) => setName(detail.value)} />
            </FormField>
          </Container>
        </CreateForm>
      );
    case "wizard":
      return (
        <CreateWizard
          submitLabel="Create fixture"
          op="iam:CreateUser"
          dirty={name !== ""}
          onSubmit={async () => undefined}
          cancelHref={done}
          steps={[
            {
              title: "Specify details",
              validate: () => name !== "",
              content: (
                <Container>
                  <FormField label="Name" errorText={name ? undefined : "Required"}>
                    <Input value={name} onChange={({ detail }) => setName(detail.value)} />
                  </FormField>
                </Container>
              ),
            },
            { title: "Set permissions", isOptional: true, content: <Container>Permissions step.</Container> },
            { title: "Review and create", content: <Container header={<Header variant="h2">Review</Header>}>Name: {name || "-"}</Container> },
          ]}
        />
      );
    case "delete":
      return (
        <Container header={<Header variant="h2">Delete confirmations</Header>}>
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="sqs:DeleteQueue" onClick={() => setDeleting("simple")}>
              Delete with simple confirmation
            </GatedButton>
            <GatedButton op="s3:DeleteBucket" onClick={() => setDeleting("typed")}>
              Delete with additional confirmation
            </GatedButton>
          </SpaceBetween>
          <DeleteModal
            visible={deleting !== null}
            resourceKind={deleting === "typed" ? "bucket" : "queue"}
            names={["fixture-01"]}
            op={deleting === "typed" ? "s3:DeleteBucket" : "sqs:DeleteQueue"}
            confirmation={deleting ?? "simple"}
            onDismiss={() => setDeleting(null)}
            onDelete={async () => undefined}
          />
        </Container>
      );
    case "tags":
      return (
        <ManageTags
          tags={tags}
          op="sqs:TagQueue"
          cancelHref={done}
          onSave={async (set, removed) =>
            setTags((prev) => [...prev.filter((t) => !removed.includes(t.key) && !set.some((s) => s.key === t.key)), ...set])
          }
        />
      );
    case "s3":
      return (
        <Container header={<Header variant="h2">S3 locations</Header>}>
          <SpaceBetween size="l">
            <S3Picker mode="read" label="Read from S3" value={uri} onChange={setUri} source={S3_FIXTURE} />
            <S3Picker mode="write" label="Write to S3" value="" onChange={() => undefined} source={S3_FIXTURE} />
          </SpaceBetween>
        </Container>
      );
    case "dashboard":
      return (
        <ServiceDashboard
          title="Fixture dashboard"
          widgets={[
            { id: "resources", title: "Resources", span: 8, content: <ResourceCounts items={[{ label: "Fixtures", count: FIXTURES.length, href: href("/dev/patterns/table") }, { label: "Disabled", count: 6, href: href("/dev/patterns/table") }]} /> },
            { id: "health", title: "Service health", span: 4, content: <StatusIndicator type="success">Local</StatusIndicator> },
          ]}
        />
      );
    default:
      return <Box>Unknown pattern.</Box>;
  }
}

export function PatternGallery({ pattern }: { pattern: string }) {
  const [selected, setSelected] = useState<readonly Fixture[]>([]);
  const splitPanel = useComparisonSplitPanel(selected, {
    kind: "fixtures",
    idOf: (f) => f.name,
    properties: [
      { label: "State", value: (f) => f.state },
      { label: "Created", value: (f) => f.created.toISOString() },
      { label: "Size (KB)", value: (f) => f.size },
    ],
  });
  const title = PATTERNS.find(([id]) => id === pattern)?.[1] ?? "Patterns";
  return (
    <ConsolePage
      key={pattern}
      breadcrumbs={[
        { text: "Pattern gallery", href: href("/dev/patterns/gating") },
        { text: title, href: href(`/dev/patterns/${pattern}`) },
      ]}
      navigation={{
        header: { text: "Pattern gallery", href: href("/dev/patterns/gating") },
        items: PATTERNS.map(([id, text]) => ({ type: "link" as const, text, href: href(`/dev/patterns/${id}`) })),
      }}
      contentType={["table", "editable", "comparison"].includes(pattern) ? "table" : ["create", "edit", "wizard", "tags"].includes(pattern) ? "form" : "default"}
      splitPanel={pattern === "comparison" ? splitPanel : undefined}
      help={{ header: title, body: <Box variant="p">Development-only fixture page for the {title.toLowerCase()} pattern.</Box> }}
      content={<Gallery pattern={pattern} onSelection={setSelected} />}
    />
  );
}
