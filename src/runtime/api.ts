import { Channel, invoke } from "@tauri-apps/api/core";

export type ProviderKind = "docker" | "native" | "attach";
export type RunState = "stopped" | "running";
export type Health = "healthy" | "unhealthy" | "unknown";

export interface Status {
  kind: ProviderKind;
  state: RunState;
  health: Health;
  busy: boolean;
  endpoint: { url: string; port: number } | null;
}

export interface Settings {
  provider: ProviderKind;
  port: number;
  memory_limit: string;
  telemetry: boolean;
  telemetry_notice_seen: boolean;
  wsl_distro: string;
  wsl_binary: string;
}

export interface VersionCheck {
  matches: boolean;
  running_version: string;
  running_commit: string;
  pinned_version: string;
  pinned_commit: string;
}

export interface LogLine {
  level: string;
  message: string;
  raw: string;
}

/** Error shape of every provider command (`ProviderError` on the Rust side). */
export interface ProviderError {
  kind: "confirmation_required" | "not_configured" | "unsupported" | "tool" | "io" | "health";
  detail: string;
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "detail" in e) return String((e as ProviderError).detail);
  return String(e);
}

export const api = {
  status: () => invoke<Status>("provider_status"),
  start: () => invoke<void>("provider_start"),
  stop: (confirmDataLoss: boolean) => invoke<void>("provider_stop", { confirmDataLoss }),
  restart: (confirmDataLoss: boolean) => invoke<void>("provider_restart", { confirmDataLoss }),
  versionCheck: () => invoke<VersionCheck>("provider_version_check"),
  rebuildImage: () => invoke<void>("provider_rebuild_image"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  ackTelemetryNotice: (telemetry: boolean) => invoke<void>("ack_telemetry_notice", { telemetry }),
  logs: (onLine: (l: LogLine) => void) => {
    const channel = new Channel<LogLine>();
    channel.onmessage = onLine;
    return invoke<void>("provider_logs", { onLine: channel });
  },
};
