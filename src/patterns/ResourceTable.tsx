// Adapted from cloudscape-design/demos (MIT-0): pages/table-property-filter,
// pages/table-date-filter and pages/table-editable.

import { useCollection, type PropertyFilterProperty } from "@cloudscape-design/collection-hooks";
import Button from "@cloudscape-design/components/button";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import PropertyFilter, { type PropertyFilterProps } from "@cloudscape-design/components/property-filter";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { InfoLink, type HelpContent } from "../shell/ConsolePage";
import { useLocalStorage } from "../shell/storage";
import { useUiOnly } from "./gating";
import {
  getHeaderCounterText,
  getTextFilterCounterText,
  renderAriaLive,
  TableEmptyState,
  TableNoMatchState,
  TablePreferences,
  withSortLabels,
} from "./table-common";

const NONE: readonly never[] = [];

export interface ResourceTableColumn<T> extends TableProps.ColumnDefinition<T> {
  id: string;
  header: string;
  /** Shown in the preferences' column list; columns are visible unless `hidden`. */
  hidden?: boolean;
  alwaysVisible?: boolean;
}

export interface ResourceTableProps<T> {
  /** Singular, capitalized: `Bucket`, `Queue`. */
  resourceName: string;
  title: string;
  description?: ReactNode;
  help?: HelpContent;
  items: readonly T[];
  loading?: boolean;
  columns: ResourceTableColumn<T>[];
  filteringProperties: PropertyFilterProperty[];
  trackBy: TableProps<T>["trackBy"];
  /** Key for the stored preferences, for example `s3.buckets`. */
  preferencesKey: string;
  selectionType?: TableProps["selectionType"];
  /** Header actions; receives the selection so Delete and Edit can enable for one item. */
  actions?: (selected: readonly T[]) => ReactNode;
  /** Shown in the empty state, usually the create button. */
  emptyAction?: ReactNode;
  onRefresh?: () => void;
  onSelectionChange?: (selected: readonly T[]) => void;
  /** Inline edit (the table-editable pattern): columns carry `editConfig`; this saves one cell. */
  submitEdit?: TableProps<T>["submitEdit"];
  variant?: TableProps["variant"];
}

/**
 * A console resource list: property filter, sorting, pagination, preferences, selection and
 * optional inline edit. On a UI-only page it shows no items and its actions stay disabled.
 */
export function ResourceTable<T>(props: ResourceTableProps<T>) {
  const { resourceName, title, items, columns, filteringProperties, preferencesKey } = props;
  const { uiOnly } = useUiOnly();

  const defaultPreferences = useMemo<CollectionPreferencesProps.Preferences>(
    () => ({
      pageSize: 25,
      wrapLines: false,
      stripedRows: false,
      contentDensity: "comfortable",
      stickyColumns: { first: 0, last: 0 },
      contentDisplay: columns.map((c) => ({ id: c.id, visible: !c.hidden })),
    }),
    [columns],
  );
  const [preferences, setPreferences] = useLocalStorage(`table.${preferencesKey}`, defaultPreferences);
  const shown = uiOnly ? [] : items;

  const { items: pageItems, actions, filteredItemsCount, collectionProps, paginationProps, propertyFilterProps } = useCollection(shown, {
    propertyFiltering: {
      filteringProperties,
      empty: <TableEmptyState resourceName={resourceName} action={uiOnly ? undefined : props.emptyAction} />,
      noMatch: <TableNoMatchState onClearFilter={() => actions.setPropertyFiltering({ tokens: [], operation: "and" })} />,
    },
    pagination: { pageSize: preferences.pageSize },
    sorting: { defaultState: { sortingColumn: columns[0] } },
    selection: { trackBy: typeof props.trackBy === "string" ? props.trackBy : undefined },
  });

  const selected = collectionProps.selectedItems ?? NONE;
  const { onSelectionChange } = props;
  useEffect(() => onSelectionChange?.(selected), [selected, onSelectionChange]);

  const [submitting, setSubmitting] = useState(false);
  const submitEdit: TableProps<T>["submitEdit"] = props.submitEdit
    ? async (item, column, value) => {
        setSubmitting(true);
        try {
          await props.submitEdit?.(item, column, value);
        } finally {
          setSubmitting(false);
        }
      }
    : undefined;

  const filterProps: PropertyFilterProps = {
    ...propertyFilterProps,
    filteringAriaLabel: `Find ${resourceName.toLowerCase()}s`,
    filteringPlaceholder: `Find ${resourceName.toLowerCase()}s`,
    countText: getTextFilterCounterText(filteredItemsCount),
    expandToViewport: true,
    disabled: uiOnly || submitting,
  };

  return (
    <Table
      {...collectionProps}
      enableKeyboardNavigation
      items={pageItems}
      trackBy={props.trackBy}
      columnDefinitions={withSortLabels(columns)}
      columnDisplay={preferences.contentDisplay}
      selectionType={props.selectionType}
      variant={props.variant ?? "full-page"}
      stickyHeader
      resizableColumns
      wrapLines={preferences.wrapLines}
      stripedRows={preferences.stripedRows}
      contentDensity={preferences.contentDensity}
      stickyColumns={preferences.stickyColumns}
      renderAriaLive={renderAriaLive}
      loading={!uiOnly && props.loading}
      loadingText={`Loading ${resourceName.toLowerCase()}s`}
      submitEdit={uiOnly ? undefined : submitEdit}
      ariaLabels={{
        allItemsSelectionLabel: () => "select all",
        itemSelectionLabel: (_, item) => `select ${String(typeof props.trackBy === "string" ? (item as Record<string, unknown>)[props.trackBy] : "")}`,
        selectionGroupLabel: `${resourceName} selection`,
        activateEditLabel: (column) => `Edit ${column.header}`,
        cancelEditLabel: (column) => `Cancel editing ${column.header}`,
        submitEditLabel: (column) => `Submit edit ${column.header}`,
      }}
      header={
        <Header
          variant={(props.variant ?? "full-page") === "full-page" ? "awsui-h1-sticky" : "h2"}
          counter={uiOnly || props.loading ? undefined : getHeaderCounterText(items.length, selected.length)}
          info={props.help && <InfoLink topic={props.help} />}
          description={props.description}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {props.onRefresh && (
                <Button iconName="refresh" ariaLabel="Refresh" disabled={uiOnly || props.loading} onClick={props.onRefresh} />
              )}
              {props.actions?.(selected)}
            </SpaceBetween>
          }
        >
          {title}
        </Header>
      }
      filter={<PropertyFilter {...filterProps} />}
      pagination={<Pagination {...paginationProps} disabled={uiOnly} />}
      preferences={
        <TablePreferences
          resourceName={resourceName}
          preferences={preferences}
          setPreferences={setPreferences}
          contentDisplayOptions={columns.map((c) => ({ id: c.id, label: c.header, alwaysVisible: c.alwaysVisible }))}
          disabled={submitting}
        />
      }
    />
  );
}
