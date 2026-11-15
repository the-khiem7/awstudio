// Board layout adapted from cloudscape-design/demos (MIT-0): pages/configurable-dashboard.

import Board, { type BoardProps } from "@cloudscape-design/board-components/board";
import BoardItem from "@cloudscape-design/board-components/board-item";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useMemo, type ReactNode } from "react";
import { emulatorLabel, tierCounts, useCapabilityMatrix } from "../capability";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import { ConsolePage } from "../shell/ConsolePage";
import { usePreferences } from "../shell/preferences";
import { regionName } from "../shell/regions";
import { href } from "../shell/router";
import { SERVICES, serviceById } from "../shell/services";
import { recentlyVisited, useLocalStorage } from "../shell/storage";

interface WidgetData {
  title: string;
}

type Item = BoardProps.Item<WidgetData>;

const WIDGETS: Record<string, WidgetData> = {
  recent: { title: "Recently visited" },
  health: { title: "Emulator health" },
  fidelity: { title: "Emulator fidelity" },
};

const DEFAULT_LAYOUT: Item[] = [
  { id: "recent", rowSpan: 3, columnSpan: 2, data: WIDGETS.recent },
  { id: "health", rowSpan: 3, columnSpan: 2, data: WIDGETS.health },
  { id: "fidelity", rowSpan: 5, columnSpan: 4, data: WIDGETS.fidelity },
];

/** Stored layout: placement only, so a renamed widget title is not kept from an old layout. */
type StoredItem = Pick<Item, "id" | "rowSpan" | "columnSpan" | "columnOffset">;

const boardItemI18n = {
  dragHandleAriaLabel: "Drag handle",
  dragHandleAriaDescription:
    "Use Space or Enter to activate drag, arrow keys to move, Space or Enter to submit, or Escape to discard.",
  resizeHandleAriaLabel: "Resize handle",
  resizeHandleAriaDescription:
    "Use Space or Enter to activate resize, arrow keys to move, Space or Enter to submit, or Escape to discard.",
};

const boardI18n: BoardProps.I18nStrings<WidgetData> = {
  liveAnnouncementDndStarted: (op) => (op === "resize" ? "Resizing" : "Dragging"),
  liveAnnouncementDndItemReordered: (op) => `Item moved to column ${op.placement.x + 1}, row ${op.placement.y + 1}.`,
  liveAnnouncementDndItemResized: (op) => `Item resized to ${op.placement.width} columns, ${op.placement.height} rows.`,
  liveAnnouncementDndItemInserted: (op) => `Item inserted to column ${op.placement.x + 1}, row ${op.placement.y + 1}.`,
  liveAnnouncementDndCommitted: (op) => `${op} committed`,
  liveAnnouncementDndDiscarded: (op) => `${op} discarded`,
  liveAnnouncementItemRemoved: (op) => `Removed item ${op.item.data.title}.`,
  navigationAriaLabel: "Board navigation",
  navigationAriaDescription: "Click on non-empty item to move focus over",
  navigationItemAriaLabel: (item) => (item ? item.data.title : "Empty"),
};

function RecentlyVisited() {
  const recent = recentlyVisited()
    .map(serviceById)
    .filter((s) => s !== undefined);
  if (!recent.length) {
    return (
      <Box textAlign="center" color="inherit" padding={{ vertical: "m" }}>
        <b>No recently visited services</b>
        <Box variant="p" color="inherit">
          Explore the services menu or search for a service.
        </Box>
      </Box>
    );
  }
  return (
    <SpaceBetween size="xs">
      {recent.map((s) => (
        <Link key={s.id} href={href(s.path)}>
          {s.title}
        </Link>
      ))}
    </SpaceBetween>
  );
}

function EmulatorHealth() {
  const { status, running, healthy, versionCheck } = useRuntimeStatus();
  const { region } = usePreferences();
  return (
    <KeyValuePairs
      columns={2}
      items={[
        {
          label: "State",
          value: (
            <StatusIndicator type={healthy ? "success" : running ? "pending" : "stopped"}>
              {healthy ? "Running" : running ? "Starting" : "Stopped"}
            </StatusIndicator>
          ),
        },
        { label: "Health", value: status?.health ?? "unknown" },
        { label: "Endpoint", value: status?.endpoint?.url ?? "-" },
        { label: "Region", value: `${regionName(region)} (${region})` },
        {
          label: "Version",
          value: versionCheck ? (
            <StatusIndicator type={versionCheck.matches ? "success" : "warning"}>{versionCheck.running_version}</StatusIndicator>
          ) : (
            "-"
          ),
        },
        { label: "Provider", value: status?.kind ?? "-" },
      ]}
    />
  );
}

function Fidelity() {
  const matrix = useCapabilityMatrix();
  const rows = SERVICES.map((s) => ({ service: s, counts: tierCounts(matrix?.services[s.capability]) }));
  return (
    <SpaceBetween size="s">
      <Box variant="small" color="text-body-secondary">
        Operations by tier in {emulatorLabel(matrix)}: green works, yellow and red controls stay disabled with their reason.
      </Box>
      <Table
        variant="borderless"
        loading={!matrix}
        loadingText="Loading the capability matrix"
        items={rows}
        columnDefinitions={[
          { id: "service", header: "Service", cell: (r) => <Link href={href(r.service.path)}>{r.service.title}</Link> },
          {
            id: "green",
            header: "Supported",
            cell: (r) => (
              <ProgressBar
                value={r.counts.total ? Math.round((100 * r.counts.green) / r.counts.total) : 0}
                additionalInfo={`${r.counts.green} of ${r.counts.total} operations`}
                ariaLabel={`${r.service.title} supported operations`}
              />
            ),
          },
          { id: "yellow", header: "Partial", cell: (r) => <StatusIndicator type="warning">{r.counts.yellow}</StatusIndicator> },
          { id: "red", header: "Not supported", cell: (r) => <StatusIndicator type="error">{r.counts.red}</StatusIndicator> },
        ]}
      />
    </SpaceBetween>
  );
}

const CONTENT: Record<string, () => ReactNode> = {
  recent: () => <RecentlyVisited />,
  health: () => <EmulatorHealth />,
  fidelity: () => <Fidelity />,
};

function toStored(items: readonly Item[]): StoredItem[] {
  return items.map(({ id, rowSpan, columnSpan, columnOffset }) => ({ id, rowSpan, columnSpan, columnOffset }));
}

export function ConsoleHome() {
  const [stored, setStored] = useLocalStorage<StoredItem[]>("home.layout", toStored(DEFAULT_LAYOUT));
  const items = useMemo<Item[]>(
    () => stored.filter((s) => WIDGETS[s.id]).map((s) => ({ ...s, data: WIDGETS[s.id] })),
    [stored],
  );
  const missing = DEFAULT_LAYOUT.filter((d) => !items.some((i) => i.id === d.id));

  return (
    <ConsolePage
      breadcrumbs={[{ text: "Console Home", href: href("/") }]}
      help={{
        header: "Console Home",
        body: (
          <Box variant="p">
            Console Home shows the services you opened last, the state of the local emulator and how much of each
            service the pinned emulator build supports. Drag a widget by its handle to move it, or resize it from its
            corner.
          </Box>
        ),
      }}
      content={
        <SpaceBetween size="m">
          <Header
            variant="h1"
            description="Your local AWS Management Console, backed by AWS Emulator."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setStored(toStored(DEFAULT_LAYOUT))}>Reset to default layout</Button>
                {missing.length > 0 && (
                  <ButtonDropdown
                    items={missing.map((m) => ({ id: m.id, text: m.data.title }))}
                    onItemClick={({ detail }) => {
                      const add = DEFAULT_LAYOUT.find((d) => d.id === detail.id);
                      if (add) setStored([...stored, ...toStored([add])]);
                    }}
                  >
                    Add widget
                  </ButtonDropdown>
                )}
              </SpaceBetween>
            }
          >
            Console Home
          </Header>
          <Board<WidgetData>
            items={items}
            i18nStrings={boardI18n}
            onItemsChange={({ detail }) => setStored(toStored(detail.items))}
            empty={
              <Box textAlign="center" color="inherit">
                <b>No widgets</b>
                <Box variant="p" color="inherit">
                  There are no widgets on Console Home.
                </Box>
                <Button onClick={() => setStored(toStored(DEFAULT_LAYOUT))}>Reset to default layout</Button>
              </Box>
            }
            renderItem={(item, actions) => (
              <BoardItem
                header={<Header variant="h2">{item.data.title}</Header>}
                i18nStrings={boardItemI18n}
                settings={
                  <ButtonDropdown
                    variant="icon"
                    ariaLabel="Widget settings"
                    expandToViewport
                    items={[{ id: "remove", text: "Remove" }]}
                    onItemClick={() => actions.removeItem()}
                  />
                }
              >
                {CONTENT[item.id]?.()}
              </BoardItem>
            )}
          />
        </SpaceBetween>
      }
    />
  );
}
