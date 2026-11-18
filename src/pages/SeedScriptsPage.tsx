import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useState } from "react";
import { commands, type SeedScript_Serialize, type SeedStep_Serialize, type SeedSummary } from "../bindings";
import { judge, useCapabilityMatrix, useRuntime501 } from "../capability";
import { ResourceTable, textProperty, type ResourceTableColumn } from "../patterns";
import { errorText } from "../runtime/api";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import { useAction, useLoad } from "../services/common";
import { ConsolePage } from "../shell/ConsolePage";
import { useNotifications } from "../shell/notifications";
import { href, matchPath, useLocation } from "../shell/router";

const HELP = {
  header: "Seed scripts",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">The emulator keeps its state in memory only, so a restart deletes every resource. A seed script is a saved list of API Console calls that rebuilds that state when replayed.</Box>
      <Box variant="p">Scripts are stored on this machine in the app config folder. Replay runs the steps in order, in the Region each step was saved with.</Box>
    </SpaceBetween>
  ),
};

const CRUMBS = [
  { text: "Console Home", href: href("/") },
  { text: "Seed scripts", href: href("/seeds") },
];

const SCRIPT_COLUMNS: ResourceTableColumn<SeedSummary>[] = [
  { id: "name", header: "Name", cell: (r) => <Link href={href(`/seeds/${encodeURIComponent(r.name)}`)}>{r.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "steps", header: "Steps", cell: (r) => r.steps, sortingField: "steps" },
];

function ScriptList() {
  const list = useLoad(() => commands.seedList(), []);
  const { run } = useAction();
  const [deleting, setDeleting] = useState<SeedSummary | null>(null);

  return (
    <ConsolePage
      breadcrumbs={CRUMBS}
      help={HELP}
      content={
        <SpaceBetween size="m">
          {list.error && <Alert type="error">{list.error}</Alert>}
          <ResourceTable<SeedSummary>
            resourceName="Seed script"
            title="Seed scripts"
            description="Saved calls that rebuild the emulator's state after a restart."
            items={list.data ?? []}
            loading={list.loading}
            columns={SCRIPT_COLUMNS}
            filteringProperties={[textProperty("name", "Name")]}
            trackBy="name"
            preferencesKey="seeds.scripts"
            selectionType="single"
            onRefresh={list.reload}
            actions={(selected) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={selected.length !== 1} onClick={() => setDeleting(selected[0])}>
                  Delete
                </Button>
                <Button variant="primary" href={href("/api-console")}>
                  Add a call in the API Console
                </Button>
              </SpaceBetween>
            )}
            emptyAction={<Button href={href("/api-console")}>Open the API Console</Button>}
          />
          <Modal
            visible={deleting !== null}
            onDismiss={() => setDeleting(null)}
            header="Delete seed script"
            footer={
              <Box float="right">
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="link" onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const target = deleting!;
                      setDeleting(null);
                      if (await run(() => commands.seedDelete(target.name), `Seed script ${target.name} deleted`)) list.reload();
                    }}
                  >
                    Delete
                  </Button>
                </SpaceBetween>
              </Box>
            }
          >
            Delete <b>{deleting?.name}</b> and its {deleting?.steps} saved calls? The emulator's resources are not touched.
          </Modal>
        </SpaceBetween>
      }
    />
  );
}

type StepState = { status: "pending" | "running" | "ok" | "failed" | "skipped"; detail?: string };

const STATE_TYPE: Record<StepState["status"], StatusIndicatorProps.Type> = {
  pending: "pending",
  running: "in-progress",
  ok: "success",
  failed: "error",
  skipped: "stopped",
};

function ScriptDetails({ name }: { name: string }) {
  const matrix = useCapabilityMatrix();
  const runtime501 = useRuntime501();
  const { running, healthy } = useRuntimeStatus();
  const { notify } = useNotifications();
  const script = useLoad(() => commands.seedLoad(name), [name]);
  const [steps, setSteps] = useState<SeedStep_Serialize[] | null>(null);
  const [states, setStates] = useState<StepState[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [saving, setSaving] = useState(false);

  // The edited copy starts from what was loaded; a reload replaces it.
  const loaded = script.data;
  const [seen, setSeen] = useState<SeedScript_Serialize | null>(null);
  if (loaded && loaded !== seen) {
    setSeen(loaded);
    setSteps(loaded.steps);
    setStates(loaded.steps.map(() => ({ status: "pending" as const })));
  }

  const current = steps ?? [];
  const dirty = !!loaded && JSON.stringify(loaded.steps) !== JSON.stringify(current);
  const gates = current.map((s) => judge(matrix, runtime501, `${s.service_key}:${s.operation}`));
  const blocked = gates.findIndex((g) => !g.enabled);
  const reason = !current.length
    ? "The script has no steps"
    : dirty
      ? "Save the changes first"
      : !running || !healthy
        ? "The emulator is not running; start it on the Emulator page"
        : blocked >= 0
          ? `Step ${blocked + 1}: ${gates[blocked].reason}`
          : "";

  const update = (index: number, patch: Partial<SeedStep_Serialize>) => setSteps(current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setSteps(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await commands.seedSave({ name, steps: current });
      notify({ type: "success", content: `Seed script ${name} saved` });
      script.reload();
    } catch (e) {
      notify({ type: "error", header: "The seed script was not saved", content: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  const replay = async () => {
    setReplaying(true);
    const next: StepState[] = current.map(() => ({ status: "pending" as const }));
    setStates([...next]);
    let failed = false;
    for (let i = 0; i < current.length; i += 1) {
      if (failed) {
        next[i] = { status: "skipped" };
        setStates([...next]);
        continue;
      }
      next[i] = { status: "running" };
      setStates([...next]);
      const s = current[i];
      try {
        const r = await commands.apiRun(s.region, s.service, s.command, s.input, s.streaming);
        if (r.exit_code === 0) next[i] = { status: "ok" };
        else {
          next[i] = { status: "failed", detail: r.stderr.trim() || `exit code ${r.exit_code}` };
          failed = true;
        }
      } catch (e) {
        next[i] = { status: "failed", detail: errorText(e) };
        failed = true;
      }
      setStates([...next]);
    }
    setReplaying(false);
    notify(
      failed
        ? { type: "error", header: "Replay stopped", content: "A step failed; the steps after it were not run." }
        : { type: "success", content: `Seed script ${name} replayed: ${current.length} ${current.length === 1 ? "step" : "steps"}` },
    );
  };

  const done = states.filter((s) => s.status === "ok").length;
  const started = states.some((s) => s.status !== "pending");

  return (
    <ConsolePage
      breadcrumbs={[...CRUMBS, { text: name, href: href(`/seeds/${encodeURIComponent(name)}`) }]}
      help={HELP}
      content={
        <SpaceBetween size="l">
          <Header
            variant="h1"
            description="Steps run in order and replay stops at the first failure."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={!dirty} onClick={() => setSteps(loaded?.steps ?? [])}>
                  Discard changes
                </Button>
                <Button disabled={!dirty} loading={saving} onClick={save}>
                  Save changes
                </Button>
                <Button variant="primary" loading={replaying} disabled={!!reason} disabledReason={reason || undefined} onClick={replay}>
                  Replay
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
          {script.error && <Alert type="error">{script.error}</Alert>}
          {started && <ProgressBar value={current.length ? Math.round((done / current.length) * 100) : 0} label="Replay progress" description={`${done} of ${current.length} steps done`} status={states.some((s) => s.status === "failed") ? "error" : done === current.length ? "success" : "in-progress"} />}
          <Container disableContentPaddings>
            <Table<SeedStep_Serialize>
              variant="embedded"
              items={current}
              loading={script.loading}
              trackBy={(s) => `${current.indexOf(s)}`}
              columnDefinitions={[
                { id: "n", header: "#", cell: (s) => current.indexOf(s) + 1, width: 50 },
                { id: "op", header: "Call", cell: (s) => <Box variant="code">{`${s.service} ${s.command}`}</Box> },
                { id: "region", header: "Region", cell: (s) => s.region },
                {
                  id: "note",
                  header: "Note",
                  cell: (s) => <Input value={s.note} ariaLabel={`Note of step ${current.indexOf(s) + 1}`} onChange={({ detail }) => update(current.indexOf(s), { note: detail.value })} />,
                  minWidth: 200,
                },
                {
                  id: "state",
                  header: "Replay",
                  cell: (s) => {
                    const state = states[current.indexOf(s)];
                    const gate = gates[current.indexOf(s)];
                    if (state && state.status !== "pending") return <StatusIndicator type={STATE_TYPE[state.status]}>{state.detail ?? state.status}</StatusIndicator>;
                    return gate && !gate.enabled ? <StatusIndicator type="warning">{gate.reason}</StatusIndicator> : <StatusIndicator type="pending">Ready</StatusIndicator>;
                  },
                },
                {
                  id: "actions",
                  header: "Order",
                  cell: (s) => {
                    const i = current.indexOf(s);
                    return (
                      <SpaceBetween direction="horizontal" size="xxs">
                        <Button variant="icon" iconName="angle-up" ariaLabel={`Move step ${i + 1} up`} disabled={i === 0 || replaying} onClick={() => move(i, -1)} />
                        <Button variant="icon" iconName="angle-down" ariaLabel={`Move step ${i + 1} down`} disabled={i === current.length - 1 || replaying} onClick={() => move(i, 1)} />
                        <Button variant="icon" iconName="remove" ariaLabel={`Remove step ${i + 1}`} disabled={replaying} onClick={() => setSteps(current.filter((_, k) => k !== i))} />
                      </SpaceBetween>
                    );
                  },
                },
              ]}
              empty={
                <Box textAlign="center" color="inherit" padding="m">
                  <b>No steps</b>
                  <Box variant="p" color="inherit">
                    Add calls from the API Console with Add to seed script.
                  </Box>
                </Box>
              }
            />
          </Container>
        </SpaceBetween>
      }
    />
  );
}

/** Seed scripts: list, edit and replay. */
export function SeedScriptsPage() {
  const { path } = useLocation();
  const match = matchPath("/seeds/:name", path);
  if (!match) return <ScriptList />;
  return <ScriptDetails key={match.name} name={decodeURIComponent(match.name)} />;
}
