import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Toggle from "@cloudscape-design/components/toggle";
import { useEffect, useState } from "react";
import { api, type Settings } from "../runtime/api";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import { useNotifications } from "./notifications";
import { href, navigate } from "./router";

/** Fired after the settings file changes outside the Emulator page, so that page reloads its copy. */
export const SETTINGS_CHANGED = "awstudio:settings-changed";

/**
 * First-run telemetry notice. It sits on the shell, not on one page, so it shows on whichever page
 * the app opens: upstream asks tools that include the emulator to tell users about telemetry.
 */
export function TelemetryNotice() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [telemetry, setTelemetry] = useState(true);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setTelemetry(s.telemetry);
      })
      .catch(() => setSettings(null));
  }, []);

  const acknowledge = async () => {
    await api.ackTelemetryNotice(telemetry);
    setSettings(await api.getSettings());
    window.dispatchEvent(new Event(SETTINGS_CHANGED));
  };

  return (
    <Modal
      visible={settings !== null && !settings.telemetry_notice_seen}
      onDismiss={() => undefined}
      header="Emulator telemetry"
      footer={
        <Box float="right">
          <Button variant="primary" onClick={acknowledge}>
            Continue
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box>
          AWS Emulator collects usage data and reports it to AWS. It is on by default. The data excludes request and
          response content, resource names, credentials and personal data. This app is not affiliated with AWS.
        </Box>
        <Toggle checked={telemetry} onChange={({ detail }) => setTelemetry(detail.checked)}>
          Send emulator telemetry
        </Toggle>
        <Box color="text-body-secondary">You can change this later on the Emulator page, under Provider.</Box>
      </SpaceBetween>
    </Modal>
  );
}

const VERSION_NOTICE = "version-mismatch";

/**
 * Warns on every page while the running emulator is another build than the one the capability
 * matrix was made from: controls follow the pinned matrix and may not match that build.
 */
export function VersionNotice() {
  const { versionCheck } = useRuntimeStatus();
  const { notify, dismiss } = useNotifications();

  useEffect(() => {
    if (!versionCheck || versionCheck.matches) {
      dismiss(VERSION_NOTICE);
      return;
    }
    notify({
      id: VERSION_NOTICE,
      type: "warning",
      header: "The running emulator differs from the pinned build",
      content: `Running ${versionCheck.running_version} (${versionCheck.running_commit.slice(0, 12)}); controls follow the capability matrix of ${versionCheck.pinned_version} (${versionCheck.pinned_commit}).`,
      action: <Button onClick={() => navigate(href("/emulator"))}>Open Emulator page</Button>,
    });
  }, [versionCheck, notify, dismiss]);

  return null;
}
