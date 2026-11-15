import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type ApiError,
  type LogLine,
  type ProviderError,
  type Settings_Serialize,
  type Shell,
  type Status_Serialize,
} from "../bindings";

// Command signatures and types come from the generated `src/bindings.ts`; this module only gives
// the Runtime page short names and one error formatter.
export type { Health, LogLine, ProviderKind, RunState, SessionCheck, SessionInfo, Shell, VersionCheck } from "../bindings";
export type Status = Status_Serialize;
export type Settings = Settings_Serialize;

/** Formats a rejected command: `ProviderError`, `ApiError`, or a framework string. */
export function errorText(e: unknown): string {
  if (!e || typeof e !== "object" || !("kind" in e)) return String(e);
  const err = e as ProviderError | ApiError;
  switch (err.kind) {
    case "unsupported":
      if ("op" in err) {
        return `${err.op}${err.variant ? ` with ${err.variant}` : ""} is not supported by AWS Emulator v${err.version}`;
      }
      return err.detail;
    case "aws":
      return `${err.op}: ${err.code}: ${err.message}`;
    case "guard":
    case "transport":
      return `${err.op}: ${err.detail}`;
    default:
      return err.detail;
  }
}

export const api = {
  status: () => commands.providerStatus(),
  start: async () => void (await commands.providerStart()),
  stop: async (confirmDataLoss: boolean) => void (await commands.providerStop(confirmDataLoss)),
  restart: async (confirmDataLoss: boolean) => void (await commands.providerRestart(confirmDataLoss)),
  versionCheck: () => commands.providerVersionCheck(),
  rebuildImage: async () => void (await commands.providerRebuildImage()),
  getSettings: () => commands.getSettings(),
  saveSettings: async (settings: Settings) => void (await commands.saveSettings(settings)),
  ackTelemetryNotice: async (telemetry: boolean) => void (await commands.ackTelemetryNotice(telemetry)),
  logs: async (onLine: (l: LogLine) => void) => {
    const channel = new Channel<LogLine>();
    channel.onmessage = onLine;
    await commands.providerLogs(channel);
  },
  sessionInfo: () => commands.sessionInfo(),
  sessionCheck: () => commands.sessionCheck(),
  envBlock: (shell: Shell) => commands.envBlock(shell),
  openTerminal: async () => void (await commands.openTerminal()),
};
