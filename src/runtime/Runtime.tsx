import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Toggle from "@cloudscape-design/components/toggle";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorText,
  type LogLine,
  type ProviderKind,
  type Settings,
  type Status,
  type VersionCheck,
} from "./api";

const KINDS = [
  { value: "docker", label: "Docker", description: "Container built from the AWS package" },
  { value: "native", label: "Native (WSL)", description: "RPM or DEB installed in a WSL distribution" },
  { value: "attach", label: "Attach", description: "An emulator that is already running" },
];

const MAX_LOG_LINES = 300;

type Pending = "stop" | "restart" | null;

export function Runtime() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [versionCheck, setVersionCheck] = useState<VersionCheck | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [noticeTelemetry, setNoticeTelemetry] = useState(true);
  const subscribed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setDraft(s);
      setNoticeTelemetry(s.telemetry);
    });
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const running = status?.state === "running";
  const busy = working !== null || status?.busy === true;

  // Subscribe to logs and check the version once per run, after the emulator is up.
  useEffect(() => {
    if (!running) {
      subscribed.current = false;
      setVersionCheck(null);
      return;
    }
    if (subscribed.current) return;
    subscribed.current = true;
    setLogs([]);
    api
      .logs((l) => setLogs((prev) => [...prev, l].slice(-MAX_LOG_LINES)))
      .catch(() => undefined);
    api
      .versionCheck()
      .then(setVersionCheck)
      .catch(() => setVersionCheck(null));
  }, [running]);

  const run = async (label: string, action: () => Promise<void>) => {
    setWorking(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(null);
      refresh();
    }
  };

  const confirmDataLoss = async () => {
    const action = pending;
    setPending(null);
    if (action === "stop") await run("Stopping", () => api.stop(true));
    if (action === "restart") await run("Restarting", () => api.restart(true));
  };

  const saveDraft = () =>
    run("Saving", async () => {
      if (!draft) return;
      await api.saveSettings(draft);
      setSettings(draft);
    });

  const acknowledgeNotice = async () => {
    await api.ackTelemetryNotice(noticeTelemetry);
    const s = await api.getSettings();
    setSettings(s);
    setDraft(s);
  };

  const dirty = draft !== null && settings !== null && JSON.stringify(draft) !== JSON.stringify(settings);
  const attach = settings?.provider === "attach";

  return (
    <SpaceBetween size="l">
      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)} header="Runtime error">
          <Box variant="code">{error}</Box>
        </Alert>
      )}

      {versionCheck && !versionCheck.matches && (
        <Alert
          type="warning"
          header="The running emulator differs from the pinned build"
          action={
            settings?.provider === "docker" ? (
              <Button disabled={busy} onClick={() => run("Building image", api.rebuildImage)}>
                Rebuild image at pinned version
              </Button>
            ) : undefined
          }
        >
          Running {versionCheck.running_version} ({versionCheck.running_commit.slice(0, 12)}), capability matrix built
          from {versionCheck.pinned_version} ({versionCheck.pinned_commit}). Controls follow the pinned matrix, so some
          may not match this build.
        </Alert>
      )}

      <Container
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="primary"
                  disabled={busy || running || attach}
                  loading={working === "Starting"}
                  onClick={() => run("Starting", api.start)}
                >
                  Start
                </Button>
                <Button disabled={busy || !running || attach} onClick={() => setPending("restart")}>
                  Restart
                </Button>
                <Button disabled={busy || !running || attach} onClick={() => setPending("stop")}>
                  Stop
                </Button>
                {attach && (
                  <Button disabled={busy} onClick={() => run("Starting", api.start)}>
                    Connect
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            Emulator
          </Header>
        }
      >
        <ColumnLayout columns={4} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">State</Box>
            <StatusIndicator type={running ? "success" : "stopped"}>
              {working ?? (status?.busy ? "Working" : running ? "Running" : "Stopped")}
            </StatusIndicator>
          </div>
          <div>
            <Box variant="awsui-key-label">Health</Box>
            <StatusIndicator
              type={status?.health === "healthy" ? "success" : status?.health === "unhealthy" ? "error" : "pending"}
            >
              {status?.health ?? "unknown"}
            </StatusIndicator>
          </div>
          <div>
            <Box variant="awsui-key-label">Endpoint</Box>
            <Box>{status?.endpoint?.url ?? "-"}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Provider</Box>
            <Box>{KINDS.find((k) => k.value === settings?.provider)?.label ?? "-"}</Box>
          </div>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h2">Provider</Header>}>
        {draft && (
          <SpaceBetween size="m">
            <ColumnLayout columns={3}>
              <FormField label="Runtime provider">
                <Select
                  selectedOption={KINDS.find((k) => k.value === draft.provider) ?? null}
                  options={KINDS}
                  onChange={({ detail }) =>
                    setDraft({ ...draft, provider: detail.selectedOption.value as ProviderKind })
                  }
                />
              </FormField>
              <FormField label="Port">
                <Input
                  type="number"
                  value={String(draft.port)}
                  onChange={({ detail }) => setDraft({ ...draft, port: Number(detail.value) || 0 })}
                />
              </FormField>
              <FormField label="Memory limit" description="Docker only. Over the limit the container exits with 137 and all state is lost.">
                <Input
                  value={draft.memory_limit}
                  onChange={({ detail }) => setDraft({ ...draft, memory_limit: detail.value })}
                />
              </FormField>
            </ColumnLayout>
            {draft.provider === "native" && (
              <ColumnLayout columns={2}>
                <FormField label="WSL distribution" description="Empty uses the default distribution.">
                  <Input value={draft.wsl_distro} onChange={({ detail }) => setDraft({ ...draft, wsl_distro: detail.value })} />
                </FormField>
                <FormField label="Emulator executable in WSL">
                  <Input value={draft.wsl_binary} onChange={({ detail }) => setDraft({ ...draft, wsl_binary: detail.value })} />
                </FormField>
              </ColumnLayout>
            )}
            <Toggle checked={draft.telemetry} onChange={({ detail }) => setDraft({ ...draft, telemetry: detail.checked })}>
              Emulator telemetry (applies on the next start)
            </Toggle>
            <Button disabled={!dirty || busy} onClick={saveDraft}>
              Save
            </Button>
          </SpaceBetween>
        )}
      </Container>

      <Container header={<Header variant="h2">Logs</Header>}>
        <Box variant="code">
          <div style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {logs.length === 0 ? "No log lines." : logs.map((l, i) => <div key={i}>[{l.level}] {l.message}</div>)}
          </div>
        </Box>
      </Container>

      <Modal
        visible={pending !== null}
        onDismiss={() => setPending(null)}
        header={pending === "stop" ? "Stop the emulator?" : "Restart the emulator?"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmDataLoss}>
                {pending === "stop" ? "Stop and delete resources" : "Restart and delete resources"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        The emulator keeps every emulated resource in memory. {pending === "stop" ? "Stopping" : "Restarting"} it deletes
        all of them, and its access keys change.
      </Modal>

      <Modal
        visible={settings !== null && !settings.telemetry_notice_seen}
        onDismiss={() => undefined}
        header="Emulator telemetry"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={acknowledgeNotice}>
              Continue
            </Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>
            AWS Emulator collects usage data and reports it to AWS. It is on by default. The data excludes request
            and response content, resource names, credentials and personal data. This app is not affiliated with AWS.
          </Box>
          <Toggle checked={noticeTelemetry} onChange={({ detail }) => setNoticeTelemetry(detail.checked)}>
            Send emulator telemetry
          </Toggle>
          <Box color="text-body-secondary">You can change this later under Provider.</Box>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
