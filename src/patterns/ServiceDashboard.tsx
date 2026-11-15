// Adapted from cloudscape-design/demos (MIT-0): pages/dashboard.

import Container from "@cloudscape-design/components/container";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { ReactNode } from "react";
import { InfoLink, type HelpContent } from "../shell/ConsolePage";
import { ScopeBanner } from "./gating";

export interface DashboardWidget {
  id: string;
  title: string;
  content: ReactNode;
  /** Columns out of 12 at the widest breakpoint. */
  span?: 3 | 4 | 6 | 8 | 12;
}

export interface ServiceDashboardProps {
  title: string;
  help?: HelpContent;
  actions?: ReactNode;
  widgets: DashboardWidget[];
}

/** A service dashboard: a header and a responsive grid of containers. */
export function ServiceDashboard({ title, help, actions, widgets }: ServiceDashboardProps) {
  return (
    <SpaceBetween size="m">
      <Header variant="h1" info={help && <InfoLink topic={help} />} actions={actions}>
        {title}
      </Header>
      <ScopeBanner />
      <Grid gridDefinition={widgets.map((w) => ({ colspan: { default: 12, m: w.span ?? 6 } }))}>
        {widgets.map((w) => (
          <Container key={w.id} fitHeight header={<Header variant="h2">{w.title}</Header>}>
            {w.content}
          </Container>
        ))}
      </Grid>
    </SpaceBetween>
  );
}

/** The "Resources" widget: one large count per resource kind, each linking to its list. */
export function ResourceCounts({ items }: { items: { label: string; count: number | null; href: string }[] }) {
  return (
    <KeyValuePairs
      columns={Math.min(4, items.length) as 1 | 2 | 3 | 4}
      items={items.map((i) => ({
        label: i.label,
        value: (
          <Link variant="awsui-value-large" href={i.href} ariaLabel={`${i.label} (${i.count ?? "-"})`}>
            {i.count ?? "-"}
          </Link>
        ),
      }))}
    />
  );
}
