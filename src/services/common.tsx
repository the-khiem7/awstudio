// Shared pieces of the service console pages: data loading tied to the Region and the emulator run,
// gated actions with Flashbar results, and small formatters.

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown, { type ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Textarea from "@cloudscape-design/components/textarea";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { judge, useCapabilityMatrix, useReportUnsupported, useRuntime501 } from "../capability";
import { GatedButton, useUiOnly } from "../patterns";
import { errorText } from "../runtime/api";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import { useNotifications } from "../shell/notifications";
import { usePreferences } from "../shell/preferences";

/** The Region of the region selector; every service command takes it. */
export function useRegion(): string {
  return usePreferences().region;
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data for a page and reloads it when the Region, the emulator run or `deps` change. A
 * UI-only page loads nothing: its primary read is not supported, so no call is made at all.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true): Loaded<T> {
  const { uiOnly } = useUiOnly();
  const { runId } = useRuntimeStatus();
  const region = useRegion();
  const report = useReportUnsupported();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const active = enabled && !uiOnly;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!active) {
      setData(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((d) => live && setData(d))
      .catch((e) => {
        if (!live) return;
        report(e);
        setError(errorText(e));
        setData(null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, region, runId, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Runs a mutation, reports a 501 to the capability cache and shows the result in the Flashbar. */
export function useAction() {
  const { notify } = useNotifications();
  const report = useReportUnsupported();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: () => Promise<unknown>, success?: ReactNode): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        if (success) notify({ type: "success", content: success });
        return true;
      } catch (e) {
        report(e);
        notify({ type: "error", header: "The request failed", content: errorText(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify, report],
  );
  return { run, busy };
}

/** Gates of several operations at once, with the page's UI-only state applied, for dropdown items. */
export function useGates(ops: readonly string[]): Record<string, { enabled: boolean; reason: string }> {
  const matrix = useCapabilityMatrix();
  const runtime501 = useRuntime501();
  const page = useUiOnly();
  const key = ops.join("|");
  return useMemo(
    () =>
      Object.fromEntries(
        ops.map((op) => {
          if (page.uiOnly) return [op, { enabled: false, reason: `This page is view-only: ${page.reason}` }];
          const c = judge(matrix, runtime501, op);
          return [op, { enabled: c.enabled, reason: c.reason }];
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix, runtime501, page.uiOnly, page.reason, key],
  );
}

export interface GatedItem {
  id: string;
  text: string;
  op: string;
  disabled?: boolean;
}

/** The console's "Actions" dropdown, each item disabled with its reason unless its operation may run. */
export function GatedDropdown({ items, onItemClick, label = "Actions", variant }: { items: GatedItem[]; onItemClick: (id: string) => void; label?: string; variant?: ButtonDropdownProps["variant"] }) {
  const gates = useGates(items.map((i) => i.op));
  return (
    <ButtonDropdown
      variant={variant}
      items={items.map((i) => ({
        id: i.id,
        text: i.text,
        disabled: i.disabled || !gates[i.op]?.enabled,
        disabledReason: !gates[i.op]?.enabled ? gates[i.op]?.reason : undefined,
      }))}
      onItemClick={({ detail }) => onItemClick(detail.id)}
    >
      {label}
    </ButtonDropdown>
  );
}

export function LoadError({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert type="error" header="Could not load from the emulator" action={onRetry && <Button onClick={onRetry}>Retry</Button>}>
      {error}
    </Alert>
  );
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** `1.5 MB`, as the console's size columns show it. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

/** `November 15, 2026, 21:07:30 (UTC+07:00)`, the console's date format. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour12: false });
  return `${date}, ${time} (UTC${sign}${hh}:${mm})`;
}

/** Validates JSON text; returns the error to show, or undefined. An empty text passes when `allowEmpty`. */
export function jsonError(text: string, allowEmpty = true): string | undefined {
  if (!text.trim()) return allowEmpty ? undefined : "Enter a JSON document.";
  try {
    JSON.parse(text);
    return undefined;
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
}

/** A JSON document editor: a monospace text area that shows a parse error as the user types. */
export function JsonEditor({ label, description, value, onChange, rows = 14, readOnly, allowEmpty = true }: { label: string; description?: ReactNode; value: string; onChange?: (v: string) => void; rows?: number; readOnly?: boolean; allowEmpty?: boolean }) {
  return (
    <FormField label={label} description={description} errorText={jsonError(value, allowEmpty)} stretch>
      <div style={{ fontFamily: "monospace" }}>
        <Textarea value={value} rows={rows} readOnly={readOnly} spellcheck={false} onChange={({ detail }) => onChange?.(detail.value)} />
      </div>
    </FormField>
  );
}

/** Pretty-prints JSON text, keeping text that does not parse as it is. */
export function prettyJson(text: string | null | undefined): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The last segment of an ARN or a queue URL. */
export function lastSegment(id: string, sep: ":" | "/" = ":"): string {
  return id.slice(id.lastIndexOf(sep) + 1);
}


export interface ResourceTag {
  key: string;
  value: string;
}

/** The "Tags" container of a details page: the tags in a table and a gated Manage tags button. */
export function TagsTable({ tags, loading, op, onEdit, description }: { tags: ResourceTag[] | null; loading?: boolean; op: string; onEdit: () => void; description?: string }) {
  const { uiOnly } = useUiOnly();
  const shown = uiOnly ? [] : (tags ?? []);
  return (
    <Table
      variant="container"
      loading={loading && !uiOnly}
      loadingText="Loading tags"
      items={shown}
      trackBy="key"
      columnDefinitions={[
        { id: "key", header: "Key", cell: (t) => t.key, isRowHeader: true },
        { id: "value", header: "Value", cell: (t) => t.value || "-" },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <b>No tags</b>
          <Box variant="p" color="inherit">
            No tags are associated with the resource.
          </Box>
        </Box>
      }
      header={
        <Header
          variant="h2"
          counter={`(${shown.length})`}
          description={description ?? "Track storage cost or other criteria by tagging your resource."}
          actions={
            <GatedButton op={op} onClick={onEdit}>
              Manage tags
            </GatedButton>
          }
        >
          Tags
        </Header>
      }
    />
  );
}

/** Edits a resource's whole tag set in a modal; `onSave` receives the complete new set. */
export function EditTagsModal({ visible, tags, op, onDismiss, onSave }: { visible: boolean; tags: ResourceTag[]; op: string; onDismiss: () => void; onSave: (next: ResourceTag[]) => Promise<boolean> }) {
  const [edited, setEdited] = useState<TagEditorProps.Tag[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) setEdited(tags.filter((t) => !t.key.startsWith("aws:")).map((t) => ({ ...t, existing: true })));
  }, [visible, tags]);
  const save = async () => {
    setSaving(true);
    const kept = edited.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value }));
    const system = tags.filter((t) => t.key.startsWith("aws:"));
    const ok = await onSave([...system, ...kept]);
    setSaving(false);
    if (ok) onDismiss();
  };
  return (
    <Modal
      visible={visible}
      size="large"
      header="Manage tags"
      onDismiss={onDismiss}
      closeAriaLabel="Close dialog"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <GatedButton variant="primary" op={op} loading={saving} onClick={save}>
              Save changes
            </GatedButton>
          </SpaceBetween>
        </Box>
      }
    >
      <TagEditor
        tags={edited}
        onChange={({ detail }) => setEdited([...detail.tags])}
        tagLimit={50}
        i18nStrings={{ tagLimit: (available) => `You can add up to ${available} more tag${available === 1 ? "" : "s"}.` }}
      />
    </Modal>
  );
}

/** A modal form with a gated primary button; `onSubmit` returns true to close. */
export function FormModal({ visible, header, op, submitLabel = "Save changes", onDismiss, onSubmit, children, size = "medium", canSubmit = true }: { visible: boolean; header: string; op: string; submitLabel?: string; onDismiss: () => void; onSubmit: () => Promise<boolean>; children: ReactNode; size?: "small" | "medium" | "large"; canSubmit?: boolean }) {
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    const ok = await onSubmit();
    setSaving(false);
    if (ok) onDismiss();
  };
  return (
    <Modal
      visible={visible}
      size={size}
      header={header}
      onDismiss={onDismiss}
      closeAriaLabel="Close dialog"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <GatedButton variant="primary" op={op} loading={saving} disabled={!canSubmit} onClick={submit}>
              {submitLabel}
            </GatedButton>
          </SpaceBetween>
        </Box>
      }
    >
      {visible && children}
    </Modal>
  );
}

/** Copies a value, with the console's copy icon and "copied" popover. */
export function Copyable({ value, label }: { value: string; label: string }) {
  return <CopyToClipboard variant="inline" textToCopy={value} copyButtonAriaLabel={`Copy ${label}`} copySuccessText={`${label} copied`} copyErrorText={`${label} failed to copy`} />;
}
