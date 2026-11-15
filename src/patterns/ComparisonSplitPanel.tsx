// Adapted from cloudscape-design/demos (MIT-0): pages/split-panel-comparison.

import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SplitPanel from "@cloudscape-design/components/split-panel";
import Table from "@cloudscape-design/components/table";
import { useEffect, useState, type ReactNode } from "react";
import type { SplitPanelSlot } from "../shell/ConsolePage";

export interface ComparedProperty<T> {
  label: string;
  value: (item: T) => ReactNode;
}

export interface ComparisonOptions<T> {
  /** Plural resource kind, lowercase: `versions`, `functions`. */
  kind: string;
  idOf: (item: T) => string;
  properties: ComparedProperty<T>[];
}

/**
 * Split panel that shows one selected item's details and compares several side by side. It opens
 * on the first selection and stays closed once the user closes it, as in the console.
 */
export function useComparisonSplitPanel<T>(selected: readonly T[], { kind, idOf, properties }: ComparisonOptions<T>): SplitPanelSlot {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(300);
  const [closedOnce, setClosedOnce] = useState(false);

  useEffect(() => {
    if (selected.length && !closedOnce) setOpen(true);
  }, [selected.length, closedOnce]);

  let header: string;
  let body: ReactNode;
  if (!selected.length) {
    header = `0 ${kind} selected`;
    body = `Select an item to see its details. Select multiple ${kind} to compare.`;
  } else if (selected.length === 1) {
    header = idOf(selected[0]);
    body = <KeyValuePairs columns={3} items={properties.map((p) => ({ label: p.label, value: p.value(selected[0]) }))} />;
  } else {
    header = `${selected.length} ${kind} selected`;
    type Row = { label: string; index: number };
    body = (
      <Box padding={{ bottom: "l" }}>
        <Table<Row>
          header={<Header variant="h2">Compare details</Header>}
          variant="borderless"
          items={properties.map((p, index) => ({ label: p.label, index }))}
          columnDefinitions={[
            { id: "property", header: "", cell: (row) => <b>{row.label}</b> },
            ...selected.map((item) => ({
              id: idOf(item),
              header: idOf(item),
              cell: (row: Row) => properties[row.index].value(item),
            })),
          ]}
        />
      </Box>
    );
  }

  return {
    panel: (
      <SplitPanel header={header} closeBehavior="collapse">
        {body}
      </SplitPanel>
    ),
    open,
    onToggle: (next) => {
      setOpen(next);
      if (!next) setClosedOnce(true);
    },
    size,
    onResize: setSize,
  };
}
