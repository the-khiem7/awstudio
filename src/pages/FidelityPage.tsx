import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useEffect, useMemo, useState } from "react";
import { emulatorLabel, tierCounts, useCapabilityMatrix, type Tier } from "../capability";
import { ResourceTable, textProperty, type ResourceTableColumn } from "../patterns";
import { Copyable } from "../services/common";
import { ConsolePage } from "../shell/ConsolePage";
import { href, matchPath, useLocation } from "../shell/router";

/** `src/capability/issues.json`: the open vendor issues of each service, most severe first. */
interface IssueIndex {
  vendor: { repo: string; commit: string; tag: string; dir: string; open: number; unmatched: number };
  services: Record<string, { open: number; items: [file: string, severity: string, title: string][] }>;
}

function useIssues(): IssueIndex | null {
  const [issues, setIssues] = useState<IssueIndex | null>(null);
  useEffect(() => {
    import("../capability/issues.json").then((m) => setIssues(m.default as unknown as IssueIndex));
  }, []);
  return issues;
}

/** Link to an issue file of the vendor repository at the pinned commit. */
export function issueUrl(index: IssueIndex, file: string): string {
  const { repo, commit, dir } = index.vendor;
  return `https://github.com/${repo}/blob/${commit}/${dir}/${file}`;
}

interface ServiceRow {
  key: string;
  name: string;
  total: number;
  green: number;
  yellow: number;
  red: number;
  percent: number;
  issues: number;
}

const COLUMNS: ResourceTableColumn<ServiceRow>[] = [
  { id: "name", header: "Service", cell: (r) => <Link href={href(`/fidelity/${r.key}`)}>{r.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "key", header: "Key", cell: (r) => r.key, sortingField: "key" },
  { id: "total", header: "Operations", cell: (r) => r.total, sortingField: "total" },
  { id: "green", header: "Supported", cell: (r) => r.green, sortingField: "green" },
  { id: "yellow", header: "Partial", cell: (r) => r.yellow, sortingField: "yellow" },
  { id: "red", header: "Not supported", cell: (r) => r.red, sortingField: "red" },
  { id: "percent", header: "Supported share", cell: (r) => `${r.percent}%`, sortingField: "percent" },
  { id: "issues", header: "Open vendor issues", cell: (r) => r.issues, sortingField: "issues" },
];

const FILTERS = [textProperty("name", "Service"), textProperty("key", "Key")];

function FidelityList() {
  const matrix = useCapabilityMatrix();
  const issues = useIssues();
  const rows = useMemo<ServiceRow[]>(
    () =>
      Object.entries(matrix?.services ?? {}).map(([key, s]) => {
        const c = tierCounts(s);
        return {
          key,
          name: s.name,
          total: c.total,
          green: c.green,
          yellow: c.yellow,
          red: c.red,
          percent: c.total ? Math.round((c.green / c.total) * 100) : 0,
          issues: issues?.services[key]?.open ?? 0,
        };
      }),
    [matrix, issues],
  );
  const totals = rows.reduce((t, r) => ({ ops: t.ops + r.total, green: t.green + r.green }), { ops: 0, green: 0 });

  return (
    <ConsolePage
      breadcrumbs={[
        { text: "Console Home", href: href("/") },
        { text: "Fidelity catalog", href: href("/fidelity") },
      ]}
      help={{
        header: "Fidelity catalog",
        body: (
          <SpaceBetween size="s">
            <Box variant="p">Every service the emulator models, with the support level of each operation in the pinned release: supported, partial or not supported.</Box>
            <Box variant="p">Open vendor issues come from the emulator repository at the pinned commit. An issue is matched to a service by its shape id, its issue key or its file name, so a few may be missing or misplaced.</Box>
          </SpaceBetween>
        ),
      }}
      content={
        <SpaceBetween size="m">
          <Box color="text-body-secondary">
            {emulatorLabel(matrix)}: {totals.green} of {totals.ops} operations of {rows.length} services are supported.
          </Box>
          <ResourceTable<ServiceRow>
            resourceName="Service"
            title="Fidelity catalog"
            description="Support level of every modeled service."
            items={rows}
            loading={!matrix}
            columns={COLUMNS}
            filteringProperties={FILTERS}
            trackBy="key"
            preferencesKey="fidelity.services"
          />
        </SpaceBetween>
      }
    />
  );
}

interface OpRow {
  name: string;
  tier: Tier;
  pass: string;
  note: string;
}

const TIER_STATUS = {
  green: { type: "success", label: "Supported" },
  yellow: { type: "warning", label: "Partial" },
  red: { type: "error", label: "Not supported" },
} as const;

const OP_COLUMNS: ResourceTableColumn<OpRow>[] = [
  { id: "name", header: "Operation", cell: (r) => r.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "tier", header: "Support", cell: (r) => <StatusIndicator type={TIER_STATUS[r.tier].type}>{TIER_STATUS[r.tier].label}</StatusIndicator>, sortingField: "tier" },
  { id: "pass", header: "Conformance steps passed", cell: (r) => r.pass || "-", sortingField: "pass" },
  { id: "note", header: "Notes", cell: (r) => r.note || "-" },
];

interface IssueRow {
  file: string;
  severity: string;
  title: string;
  url: string;
}

function FidelityDetails({ serviceKey }: { serviceKey: string }) {
  const matrix = useCapabilityMatrix();
  const issues = useIssues();
  const service = matrix?.services[serviceKey];
  const counts = tierCounts(service);

  const ops = useMemo<OpRow[]>(
    () =>
      Object.entries(service?.ops ?? {}).map(([name, op]) => ({
        name,
        tier: op.tier,
        pass: op.pass ?? "",
        note: op.reason ? (op.reason === "unwired" ? "No handler, HTTP 501" : "Scaffolded, HTTP 501") : (op.unsupported ?? []).join("; "),
      })),
    [service],
  );
  const issueRows = useMemo<IssueRow[]>(
    () => (issues?.services[serviceKey]?.items ?? []).map(([file, severity, title]) => ({ file, severity, title, url: issueUrl(issues!, file) })),
    [issues, serviceKey],
  );

  const issueColumns: ResourceTableColumn<IssueRow>[] = [
    { id: "title", header: "Issue", cell: (r) => r.title, sortingField: "title", isRowHeader: true, alwaysVisible: true },
    { id: "severity", header: "Severity", cell: (r) => r.severity, sortingField: "severity" },
    { id: "url", header: "Link", cell: (r) => <Copyable value={r.url} label="issue link" /> },
  ];

  return (
    <ConsolePage
      breadcrumbs={[
        { text: "Console Home", href: href("/") },
        { text: "Fidelity catalog", href: href("/fidelity") },
        { text: service?.name ?? serviceKey, href: href(`/fidelity/${serviceKey}`) },
      ]}
      help={{
        header: service?.name ?? "Fidelity",
        body: <Box variant="p">Issue links point to the emulator repository at the pinned commit. Copy a link to open it in a browser.</Box>,
      }}
      content={
        <SpaceBetween size="l">
          <Header variant="h1" description={serviceKey}>
            {service?.name ?? serviceKey}
          </Header>
          {matrix && !service && <Alert type="error">The capability matrix has no service {serviceKey}.</Alert>}
          {service && (
            <Container header={<Header variant="h2">Support in {emulatorLabel(matrix)}</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Operations</Box>
                  <Box variant="h2">{counts.total}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Supported</Box>
                  <Box variant="h2">{counts.green}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Partial</Box>
                  <Box variant="h2">{counts.yellow}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Not supported</Box>
                  <Box variant="h2">{counts.red}</Box>
                </div>
              </ColumnLayout>
              <Box margin={{ top: "m" }}>
                <ProgressBar value={counts.total ? Math.round((counts.green / counts.total) * 100) : 0} label="Supported share" />
              </Box>
            </Container>
          )}
          <ResourceTable<OpRow>
            resourceName="Operation"
            title="Operations"
            description={<Link href={href("/api-console", { service: serviceKey })}>Open this service in the API Console</Link>}
            items={ops}
            loading={!matrix}
            columns={OP_COLUMNS.map((c) =>
              c.id === "name" ? { ...c, cell: (r: OpRow) => <Link href={href("/api-console", { service: serviceKey, op: r.name })}>{r.name}</Link> } : c,
            )}
            filteringProperties={[textProperty("name", "Operation"), textProperty("tier", "Support", "enum")]}
            trackBy="name"
            preferencesKey="fidelity.ops"
          />
          <ResourceTable<IssueRow>
            resourceName="Issue"
            title="Open vendor issues"
            description={issues ? `At ${issues.vendor.tag} (${issues.vendor.commit}); the 100 most severe per service.` : undefined}
            items={issueRows}
            loading={!issues}
            columns={issueColumns}
            filteringProperties={[textProperty("title", "Issue"), textProperty("severity", "Severity", "enum")]}
            trackBy="file"
            preferencesKey="fidelity.issues"
          />
        </SpaceBetween>
      }
    />
  );
}

/** The fidelity catalog: every modeled service with its tiers, and per service the open vendor issues. */
export function FidelityPage() {
  const { path } = useLocation();
  const match = matchPath("/fidelity/:service", path);
  return match ? <FidelityDetails key={match.service} serviceKey={match.service} /> : <FidelityList />;
}
