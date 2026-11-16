// Shell shared by every Systems Manager page module: the navigation, the help panel and the page
// frame. Console areas are grouped as the console's navigation groups them.

import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { ReactNode } from "react";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { href } from "../../shell/router";

export const SSM_ROOT = "/systems-manager";

/** Console-style route inside Systems Manager, for example `ssmHref("/parameters", { name })`. */
export const ssmHref = (path: string, query?: Record<string, string | undefined>) => href(`${SSM_ROOT}${path}`, query);

export const SSM_NAV = {
  header: { text: "Systems Manager", href: ssmHref("/opsitems") },
  items: [
    { type: "section" as const, text: "Operations Management", defaultExpanded: true, items: [{ type: "link" as const, text: "OpsCenter", href: ssmHref("/opsitems") }] },
    { type: "section" as const, text: "Application Management", defaultExpanded: true, items: [{ type: "link" as const, text: "Parameter Store", href: ssmHref("/parameters") }] },
    {
      type: "section" as const,
      text: "Change Management",
      defaultExpanded: true,
      items: [
        { type: "link" as const, text: "Automation", href: ssmHref("/automation") },
        { type: "link" as const, text: "Maintenance Windows", href: ssmHref("/maintenance-windows") },
      ],
    },
    {
      type: "section" as const,
      text: "Node Management",
      defaultExpanded: true,
      items: [
        { type: "link" as const, text: "Fleet Manager", href: ssmHref("/fleet-manager") },
        { type: "link" as const, text: "Compliance", href: ssmHref("/compliance") },
        { type: "link" as const, text: "Inventory", href: ssmHref("/inventory") },
        { type: "link" as const, text: "Hybrid Activations", href: ssmHref("/activations") },
        { type: "link" as const, text: "Session Manager", href: ssmHref("/session-manager") },
        { type: "link" as const, text: "Run Command", href: ssmHref("/run-command") },
        { type: "link" as const, text: "State Manager", href: ssmHref("/state-manager") },
        { type: "link" as const, text: "Patch Manager", href: ssmHref("/patch-manager") },
        { type: "link" as const, text: "Documents", href: ssmHref("/documents") },
        { type: "link" as const, text: "Resource Data Sync", href: ssmHref("/resource-data-sync") },
      ],
    },
    { type: "divider" as const },
    { type: "link" as const, text: "Settings", href: ssmHref("/settings") },
  ],
};

export const SSM_HELP: HelpContent = {
  header: "AWS Systems Manager",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Systems Manager areas of the local emulator, in the Region of the region selector. Parameter Store, OpsCenter, Hybrid Activations and Resource Data Sync are mostly supported.</Box>
      <Box variant="p">Maintenance Windows, Fleet Manager, Compliance, Inventory, Session Manager and parts of Run Command, State Manager and Patch Manager are only partly supported or not implemented; those pages show the console layout with disabled actions.</Box>
    </SpaceBetween>
  ),
};

/** The page frame of every Systems Manager route: breadcrumbs, navigation, help and content. */
export function ssmPage(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Systems Manager", href: ssmHref("/opsitems") }, ...breadcrumbs]} navigation={SSM_NAV} help={SSM_HELP} contentType={contentType} content={content} />;
}
