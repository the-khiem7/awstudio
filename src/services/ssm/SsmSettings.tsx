// Systems Manager Settings page: the Parameter Store service settings (default parameter tier and
// high-throughput state).

import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { useState, type ReactNode } from "react";
import { commands } from "../../bindings";
import { GatedButton, ScopeBanner, UiOnlyScope } from "../../patterns";
import { InfoLink } from "../../shell/ConsolePage";
import { formatDate, FormModal, LoadError, useAction, useLoad, useRegion } from "../common";
import { SSM_HELP, ssmHref, ssmPage } from "./shell";

const TIER_ID = "/ssm/parameter-store/default-parameter-tier";
const THROUGHPUT_ID = "/ssm/parameter-store/high-throughput-enabled";

const TIERS = ["Standard", "Advanced", "Intelligent-Tiering"].map((t) => ({ value: t, label: t }));
const BOOLEANS = ["true", "false"].map((t) => ({ value: t, label: t }));

interface SettingRow {
  id: string;
  label: string;
  value: string;
  status: string;
  modified: string | null;
  options: { value: string; label: string }[];
}

function Settings() {
  const region = useRegion();
  const { run } = useAction();
  const tier = useLoad(() => commands.ssmGetServiceSetting(region, TIER_ID), []);
  const throughput = useLoad(() => commands.ssmGetServiceSetting(region, THROUGHPUT_ID), []);
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [value, setValue] = useState("");
  const rows: SettingRow[] = [
    { id: TIER_ID, label: "Default parameter tier", value: tier.data?.setting_value ?? "-", status: tier.data?.status ?? "-", modified: tier.data?.last_modified ?? null, options: TIERS },
    { id: THROUGHPUT_ID, label: "High-throughput enabled", value: throughput.data?.setting_value ?? "-", status: throughput.data?.status ?? "-", modified: throughput.data?.last_modified ?? null, options: BOOLEANS },
  ];
  const loading = tier.loading || throughput.loading;
  const reload = () => {
    tier.reload();
    throughput.reload();
  };
  const options = editing ? (editing.options.some((o) => o.value === value) || !value ? editing.options : [...editing.options, { value, label: value }]) : [];
  return (
    <SpaceBetween size="m">
      <Header variant="h1" info={<InfoLink topic={SSM_HELP} />}>
        Settings
      </Header>
      <ScopeBanner />
      <LoadError error={tier.error ?? throughput.error} onRetry={reload} />
      <Container header={<Header variant="h2" description="Service settings that apply to Parameter Store in this Region.">Parameter Store</Header>}>
        <Table
          variant="embedded"
          loading={loading}
          loadingText="Loading settings"
          items={rows}
          trackBy="id"
          columnDefinitions={[
            { id: "label", header: "Setting", cell: (r) => r.label, isRowHeader: true },
            { id: "id", header: "Setting ID", cell: (r) => r.id },
            { id: "value", header: "Value", cell: (r) => r.value },
            { id: "status", header: "Status", cell: (r) => r.status },
            { id: "modified", header: "Last modified", cell: (r) => formatDate(r.modified) },
            {
              id: "edit",
              header: "Actions",
              cell: (r) => (
                <GatedButton
                  op="ssm:UpdateServiceSetting"
                  onClick={() => {
                    setValue(r.value === "-" ? "" : r.value);
                    setEditing(r);
                  }}
                >
                  Edit
                </GatedButton>
              ),
            },
          ]}
          empty={<Box color="text-status-inactive">No settings.</Box>}
        />
      </Container>
      <FormModal
        visible={editing !== null}
        header={editing ? `Edit ${editing.label.toLowerCase()}` : "Edit setting"}
        op="ssm:UpdateServiceSetting"
        canSubmit={value !== ""}
        onDismiss={() => setEditing(null)}
        onSubmit={() =>
          run(async () => {
            await commands.ssmUpdateServiceSetting(region, editing!.id, value);
            reload();
          }, "Setting updated")
        }
      >
        <FormField label={editing?.label ?? "Value"} description={editing?.id}>
          <Select selectedOption={options.find((o) => o.value === value) ?? null} options={options} placeholder="Choose a value" onChange={({ detail }) => setValue(detail.selectedOption.value!)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

/** The Settings page for a route path, or null when the path is not the settings route. */
export function ssmSettingsPages(path: string, _query: URLSearchParams): ReactNode | null {
  if (path !== "/systems-manager/settings") return null;
  return ssmPage(
    [{ text: "Settings", href: ssmHref("/settings") }],
    <UiOnlyScope primaryOp="ssm:GetServiceSetting">
      <Settings />
    </UiOnlyScope>,
  );
}
