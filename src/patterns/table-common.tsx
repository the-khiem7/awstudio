// Adapted from cloudscape-design/demos (MIT-0): pages/commons/table-config.tsx,
// pages/commons/common-components.tsx, common/property-filter-operators.ts and
// pages/table-date-filter/table-date-filter-forms.tsx.

import type { PropertyFilterOperatorFormProps, PropertyFilterProperty } from "@cloudscape-design/collection-hooks";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Calendar from "@cloudscape-design/components/calendar";
import CollectionPreferences, { type CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import DateInput from "@cloudscape-design/components/date-input";
import DatePicker from "@cloudscape-design/components/date-picker";
import FormField from "@cloudscape-design/components/form-field";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { TableProps } from "@cloudscape-design/components/table";
import TimeInput from "@cloudscape-design/components/time-input";
import { useEffect, useState, type ReactNode } from "react";

export const stringOperators = [":", "!:", "=", "!=", "^", "!^"];

export const enumOperators = [{ operator: "=", tokenType: "enum" }, { operator: "!=", tokenType: "enum" }, ":", "!:"] as const;

export function getHeaderCounterText(total: number, selected: number | undefined): string {
  return selected ? `(${selected}/${total})` : `(${total})`;
}

export function getTextFilterCounterText(count = 0): string {
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

export const renderAriaLive: TableProps["renderAriaLive"] = ({ firstIndex, lastIndex, totalItemsCount }) =>
  totalItemsCount !== undefined
    ? `Displaying items ${firstIndex} to ${lastIndex} of ${totalItemsCount}`
    : `Displaying items ${firstIndex} to ${lastIndex}`;

/** Sort-state labels for screen readers, per column. */
export function withSortLabels<T>(columns: TableProps.ColumnDefinition<T>[]): TableProps.ColumnDefinition<T>[] {
  return columns.map((column) =>
    !column.sortingField && !column.sortingComparator
      ? column
      : {
          ...column,
          ariaLabel: ({ sorted, descending }) =>
            sorted ? `${column.header}, sorted ${descending ? "descending" : "ascending"}.` : `${column.header}, not sorted.`,
        },
  );
}

export function TableEmptyState({ resourceName, action }: { resourceName: string; action?: ReactNode }) {
  return (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <div>
          <b>No {resourceName.toLowerCase()}s</b>
          <Box variant="p" color="inherit">
            You don't have any {resourceName.toLowerCase()}s in this Region.
          </Box>
        </div>
        {action}
      </SpaceBetween>
    </Box>
  );
}

export function TableNoMatchState({ onClearFilter }: { onClearFilter: () => void }) {
  return (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <div>
          <b>No matches</b>
          <Box variant="p" color="inherit">
            We can't find a match.
          </Box>
        </div>
        <Button onClick={onClearFilter}>Clear filter</Button>
      </SpaceBetween>
    </Box>
  );
}

export interface PreferencesProps {
  resourceName: string;
  preferences: CollectionPreferencesProps.Preferences;
  setPreferences: (p: CollectionPreferencesProps.Preferences) => void;
  contentDisplayOptions: CollectionPreferencesProps.ContentDisplayOption[];
  disabled?: boolean;
}

export function TablePreferences({ resourceName, preferences, setPreferences, contentDisplayOptions, disabled }: PreferencesProps) {
  const plural = `${resourceName}s`;
  return (
    <CollectionPreferences
      title="Preferences"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      disabled={disabled}
      preferences={preferences}
      onConfirm={({ detail }) => setPreferences(detail)}
      pageSizePreference={{
        title: "Page size",
        options: [
          { value: 10, label: `10 ${plural}` },
          { value: 25, label: `25 ${plural}` },
          { value: 50, label: `50 ${plural}` },
          { value: 100, label: `100 ${plural}` },
        ],
      }}
      wrapLinesPreference={{}}
      stripedRowsPreference={{}}
      contentDensityPreference={{}}
      contentDisplayPreference={{ options: contentDisplayOptions }}
      stickyColumnsPreference={{
        firstColumns: {
          title: "Stick first column(s)",
          description: "Keep the first column(s) visible while horizontally scrolling the table content.",
          options: [
            { label: "None", value: 0 },
            { label: "First column", value: 1 },
            { label: "First two columns", value: 2 },
          ],
        },
        lastColumns: {
          title: "Stick last column",
          description: "Keep the last column visible while horizontally scrolling the table content.",
          options: [
            { label: "None", value: 0 },
            { label: "Last column", value: 1 },
          ],
        },
      }}
    />
  );
}

// Date and time filtering for a property filter (the table-date-filter pattern).

function isValidIsoDate(isoDate: string): boolean {
  return !isNaN(new Date(isoDate).getTime());
}

function formatTimezoneOffset(isoDate: string): string {
  const offset = 0 - new Date(isoDate).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hours = Math.floor(Math.abs(offset) / 60).toFixed(0).padStart(2, "0");
  const minutes = Math.abs(offset % 60).toFixed(0).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function formatDateTime(isoDate: string): string {
  return isoDate ? isoDate + formatTimezoneOffset(isoDate) : "";
}

function parseDateTimeFilter(filter: string) {
  const regexDate = /^(\d\d\d\d(-|\/\d\d)?(-|\/\d\d)?)(T\d\d(:\d\d)?(:\d\d)?)?/;
  const dateTime = filter.match(regexDate)?.[0] || "";
  let [dateValue, timeValue = ""] = dateTime.split("T");
  const [year, month = "01", day = "01"] = dateValue.split(/-|\//);
  const [hours = "00", minutes = "00", seconds = "00"] = timeValue.split(":");
  dateValue = year.length === 4 ? `${year}-${month}-${day}` : "";
  timeValue = timeValue ? `${hours}:${minutes}:${seconds}` : "";
  const value = !timeValue ? dateValue : `${dateValue}T${timeValue}`;
  return isValidIsoDate(value) ? { dateValue, timeValue } : { dateValue: "", timeValue: "" };
}

function DateTimeForm({ filter, operator, value, onChange }: PropertyFilterOperatorFormProps<string>) {
  const defaultTime = operator === "<" || operator === ">=" ? "" : "23:59:59";
  const [datePart = "", timePart = ""] = (value ?? "").split("T");
  const [{ dateValue, timeValue }, setState] = useState({ dateValue: datePart, timeValue: timePart || defaultTime });

  useEffect(() => {
    if (filter) setState(parseDateTimeFilter(filter.trim()));
  }, [filter]);

  useEffect(() => {
    const full = `${dateValue}T${timeValue || "00:00:00"}`;
    if (!dateValue.trim()) onChange(null);
    else if (isValidIsoDate(full)) onChange(full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateValue, timeValue]);

  const date = { placeholder: "YYYY/MM/DD", value: dateValue, onChange: (e: { detail: { value: string } }) => setState((s) => ({ ...s, dateValue: e.detail.value })) };
  const time = (
    <FormField description="Time">
      <TimeInput format="hh:mm:ss" placeholder="hh:mm:ss" value={timeValue} onChange={(e) => setState((s) => ({ ...s, timeValue: e.detail.value }))} />
    </FormField>
  );
  if (typeof filter !== "undefined") {
    return (
      <SpaceBetween size="s">
        <FormField description="Date">
          <DateInput {...date} />
        </FormField>
        {time}
        <Calendar value={dateValue} locale="en-GB" onChange={(e) => setState((s) => ({ ...s, dateValue: e.detail.value }))} />
      </SpaceBetween>
    );
  }
  return (
    <SpaceBetween size="s">
      <FormField description="Date">
        <DatePicker {...date} />
      </FormField>
      {time}
    </SpaceBetween>
  );
}

/** A property-filter property that compares a `Date` field with before and after operators. */
export function dateTimeProperty(key: string, propertyLabel: string): PropertyFilterProperty {
  return {
    key,
    propertyLabel,
    groupValuesLabel: `${propertyLabel} value`,
    defaultOperator: ">",
    operators: ["<", "<=", ">", ">="].map((operator) => ({
      operator,
      form: DateTimeForm,
      format: formatDateTime,
      match: "datetime" as const,
    })),
  };
}

/** A text property with the string or enum operators of the demos. */
export function textProperty(key: string, propertyLabel: string, kind: "string" | "enum" = "string"): PropertyFilterProperty {
  return {
    key,
    propertyLabel,
    groupValuesLabel: `${propertyLabel} values`,
    operators: kind === "enum" ? [...enumOperators] : stringOperators,
  };
}
