// Adapted from cloudscape-design/demos (MIT-0): pages/details-tabs and pages/details-hub.

import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs, { type KeyValuePairsProps } from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import type { ReactNode } from "react";
import { InfoLink, type HelpContent } from "../shell/ConsolePage";
import { href, navigate, useLocation } from "../shell/router";
import { UnsupportedBanner, useUiOnly } from "./gating";

export interface DetailsSection {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface DetailsPageProps {
  title: string;
  help?: HelpContent;
  /** Header actions: Edit, Delete, an Actions dropdown, each a gated control. */
  actions?: ReactNode;
  /** The "General configuration" or "Details" container at the top. */
  overview?: { title: string; columns?: 1 | 2 | 3 | 4; items: KeyValuePairsProps.Item[] };
  /**
   * `tabs` (details-tabs) keeps the selected tab in the `tab` query parameter, as console URLs do;
   * `hub` (details-hub) stacks every section on one page.
   */
  layout: "tabs" | "hub";
  sections: DetailsSection[];
}

/** A resource details page with an overview and tabs or stacked sections. */
export function DetailsPage({ title, help, actions, overview, layout, sections }: DetailsPageProps) {
  const { path, query } = useLocation();
  const { uiOnly } = useUiOnly();
  const active = sections.find((s) => s.id === query.get("tab"))?.id ?? sections[0]?.id;

  return (
    <SpaceBetween size="m">
      <Header variant="h1" info={help && <InfoLink topic={help} />} actions={actions}>
        {title}
      </Header>
      {uiOnly && <UnsupportedBanner />}
      {overview && (
        <Container header={<Header variant="h2">{overview.title}</Header>}>
          <KeyValuePairs columns={overview.columns ?? 3} items={uiOnly ? overview.items.map((i) => ({ ...i, value: "-" })) : overview.items} />
        </Container>
      )}
      {layout === "tabs" ? (
        <Tabs
          activeTabId={active}
          onChange={({ detail }) => {
            const next = Object.fromEntries(query.entries());
            next.tab = detail.activeTabId;
            navigate(href(path, next));
          }}
          tabs={sections.map((s) => ({ id: s.id, label: s.label, content: s.content, disabled: s.disabled }))}
        />
      ) : (
        <SpaceBetween size="l">
          {sections.map((s) => (
            <div key={s.id}>{s.content}</div>
          ))}
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
