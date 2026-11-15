import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText, type Status, type VersionCheck } from "./api";

interface RuntimeStatusValue {
  status: Status | null;
  /** Last polling error, if the status command itself failed. */
  error: string | null;
  running: boolean;
  healthy: boolean;
  /**
   * Changes whenever the emulator may have become a different run: it came up, its endpoint
   * changed, or the app started, stopped or restarted it. Each run has new keys and empty state.
   */
  runId: number;
  versionCheck: VersionCheck | null;
  refresh: () => Promise<void>;
  /** Called by lifecycle actions, so per-run caches reset even when polling misses a short restart. */
  markLifecycle: () => void;
}

const RuntimeStatusContext = createContext<RuntimeStatusValue | null>(null);

const POLL_MS = 2000;

/** Polls `provider_status` for the whole app and checks the running version once per run. */
export function RuntimeStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [versionCheck, setVersionCheck] = useState<VersionCheck | null>(null);
  const last = useRef<{ running: boolean; url: string | null }>({ running: false, url: null });
  const checkedRun = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      setError(null);
      const running = next.state === "running";
      const url = next.endpoint?.url ?? null;
      if (running !== last.current.running || (running && url !== last.current.url)) {
        setRunId((n) => n + 1);
      }
      last.current = { running, url };
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const markLifecycle = useCallback(() => setRunId((n) => n + 1), []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const running = status?.state === "running";
  const healthy = running && status?.health === "healthy";

  useEffect(() => {
    if (!healthy) {
      setVersionCheck(null);
      return;
    }
    if (checkedRun.current === runId) return;
    checkedRun.current = runId;
    api
      .versionCheck()
      .then(setVersionCheck)
      .catch(() => setVersionCheck(null));
  }, [healthy, runId]);

  const value = useMemo(
    () => ({ status, error, running, healthy, runId, versionCheck, refresh, markLifecycle }),
    [status, error, running, healthy, runId, versionCheck, refresh, markLifecycle],
  );
  return <RuntimeStatusContext.Provider value={value}>{children}</RuntimeStatusContext.Provider>;
}

export function useRuntimeStatus(): RuntimeStatusValue {
  const value = useContext(RuntimeStatusContext);
  if (!value) throw new Error("useRuntimeStatus outside RuntimeStatusProvider");
  return value;
}
