import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { useMemo } from "react";
import { emulatorLabel, tierCounts, useCapabilityMatrix, type Tier } from "../capability";
import { ResourceTable, textProperty, type ResourceTableColumn } from "../patterns";
import { ConsolePage } from "../shell/ConsolePage";
import { href } from "../shell/router";
import type { ConsoleService } from "../shell/services";

interface OpRow {
  name: string;
  tier: Tier;
  pass: string;
  unsupported: string;
  reason: string;
}

const TIER_STATUS: Record<Tier, { type: StatusIndicatorProps.Type; label: string }> = {
  green: { type: "success", label: "Supported" },
  yellow: { type: "warning", label: "Partial" },
  red: { type: "error", label: "Not supported" },
};

const COLUMNS: ResourceTableColumn<OpRow>[] = [
  { id: "name", header: "Operation", cell: (r) => r.name, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  {
    id: "tier",
    header: "Support",
    cell: (r) => <StatusIndicator type={TIER_STATUS[r.tier].type}>{TIER_STATUS[r.tier].label}</StatusIndicator>,
    sortingField: "tier",
  },
  { id: "pass", header: "Conformance steps passed", cell: (r) => r.pass || "-", sortingField: "pass" },
  { id: "reason", header: "HTTP 501", cell: (r) => r.reason || "-", sortingField: "reason" },
  { id: "unsupported", header: "Unsupported features", cell: (r) => r.unsupported || "-" },
];

const FILTERS = [
  textProperty("name", "Operation"),
  { ...textProperty("tier", "Support", "enum") },
  textProperty("unsupported", "Unsupported features"),
];

/**
 * Landing page of a service whose console pages are not built yet: what the pinned emulator build
 * supports of it, operation by operation.
 */
export function ServiceLanding({ service }: { service: ConsoleService }) {
  const matrix = useCapabilityMatrix();
  const capability = matrix?.services[service.capability];
  const counts = tierCounts(capability);
  const rows = useMemo<OpRow[]>(
    () =>
      Object.entries(capability?.ops ?? {}).map(([name, op]) => ({
        name,
        tier: op.tier,
        pass: op.pass ?? "",
        unsupported: (op.unsupported ?? []).join("; "),
        reason: op.reason === "unwired" ? "No handler" : op.reason === "scaffolded" ? "Scaffolded" : "",
      })),
    [capability],
  );

  return (
    <ConsolePage
      breadcrumbs={[
        { text: service.title, href: href(service.path) },
        { text: "Emulator support", href: href(service.path) },
      ]}
      navigation={{
        header: { text: service.title, href: href(service.path) },
        items: [{ type: "link", text: "Emulator support", href: href(service.path) }],
      }}
      help={{
        header: `${service.title} support`,
        body: (
          <SpaceBetween size="s">
            <Box variant="p">
              Each operation's tier comes from the conformance scores of {emulatorLabel(matrix)}. Supported operations
              work; partial and unsupported ones appear in the console pages as disabled controls with the reason.
            </Box>
            <Box variant="p">An unsupported feature is an option of a working operation that the emulator answers with HTTP 501.</Box>
          </SpaceBetween>
        ),
      }}
      contentType="table"
      content={
        <SpaceBetween size="m">
          <Alert type="info" header={`${service.title} console pages are not built yet`}>
            {capability
              ? `${emulatorLabel(matrix)} supports ${counts.green} of ${counts.total} ${capability.name} operations, ${counts.yellow} partly and ${counts.red} not at all.`
              : "Loading the capability matrix."}
          </Alert>
          <ResourceTable<OpRow>
            resourceName="Operation"
            title={capability?.name ?? service.title}
            description={service.description}
            items={rows}
            loading={!matrix}
            columns={COLUMNS}
            filteringProperties={FILTERS}
            trackBy="name"
            preferencesKey={`${service.id}.support`}
            variant="container"
          />
        </SpaceBetween>
      }
    />
  );
}
