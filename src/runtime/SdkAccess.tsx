import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import { useEffect, useState } from "react";
import { api, errorText, type SessionCheck, type SessionInfo, type Shell } from "./api";

const SHELLS: { id: Shell; label: string }[] = [
  { id: "powershell", label: "PowerShell" },
  { id: "cmd", label: "Command Prompt" },
];

/** Endpoint, environment export and a connection test for the running emulator. Keys never reach this page. */
export function SdkAccess({ running }: { running: boolean }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [blocks, setBlocks] = useState<Partial<Record<Shell, string>>>({});
  const [shell, setShell] = useState<Shell>("powershell");
  const [check, setCheck] = useState<SessionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCheck(null);
    setError(null);
    if (!running) {
      setInfo(null);
      setBlocks({});
      return;
    }
    api
      .sessionInfo()
      .then(setInfo)
      .catch((e) => setError(errorText(e)));
    Promise.all(SHELLS.map(async (s) => [s.id, await api.envBlock(s.id)] as const))
      .then((pairs) => setBlocks(Object.fromEntries(pairs)))
      .catch((e) => setError(errorText(e)));
  }, [running]);

  const testConnection = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await api.sessionCheck());
    } catch (e) {
      setCheck(null);
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const openTerminal = async () => {
    setError(null);
    try {
      await api.openTerminal();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Point the AWS CLI and SDKs at the local emulator. The lines name the emulator's own files, so they stay valid after a restart."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={!running} loading={checking} onClick={testConnection}>
                Test connection
              </Button>
              <Button disabled={!running} iconName="script" onClick={openTerminal}>
                Open terminal with emulator environment
              </Button>
            </SpaceBetween>
          }
        >
          SDK access
        </Header>
      }
    >
      {!running ? (
        <Box color="text-body-secondary">Start the emulator to use the AWS CLI and SDKs against it.</Box>
      ) : (
        <SpaceBetween size="m">
          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              <Box variant="code">{error}</Box>
            </Alert>
          )}
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Endpoint</Box>
              <Box>{info?.endpoint_url ?? "-"}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Region</Box>
              <Box>{info?.region ?? "-"}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Session files</Box>
              <Box variant="code">{info?.files_dir ?? "-"}</Box>
            </div>
          </ColumnLayout>
          {check && (
            <StatusIndicator type="success">
              Signed in as {check.arn} (account {check.account}); {check.bucket_count} S3 bucket
              {check.bucket_count === 1 ? "" : "s"}.
            </StatusIndicator>
          )}
          <Tabs
            activeTabId={shell}
            onChange={({ detail }) => setShell(detail.activeTabId as Shell)}
            tabs={SHELLS.map((s) => ({
              id: s.id,
              label: s.label,
              action: blocks[s.id] ? (
                <CopyToClipboard
                  variant="icon"
                  textToCopy={blocks[s.id] ?? ""}
                  copySuccessText="Environment copied"
                  copyErrorText="Copy failed"
                />
              ) : undefined,
              content: (
                <Box variant="code">
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{blocks[s.id] ?? "Loading..."}</div>
                </Box>
              ),
            }))}
          />
        </SpaceBetween>
      )}
    </Container>
  );
}
