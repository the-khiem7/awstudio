import { applyDensity, applyMode, Density, Mode } from "@cloudscape-design/global-styles";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_REGION, isRegion } from "./regions";

export type VisualMode = "light" | "dark" | "system";
export type ContentDensity = "comfortable" | "compact";

/** `last-used` opens the app in the Region chosen last, as the console's default does. */
export const LAST_USED = "last-used";

/** The console's unified settings that apply in this app. */
export interface UnifiedSettings {
  visualMode: VisualMode;
  density: ContentDensity;
  defaultRegion: string;
}

const SETTINGS_KEY = "awstudio.unified-settings";
const REGION_KEY = "awstudio.region";

export const DEFAULT_SETTINGS: UnifiedSettings = { visualMode: "system", density: "comfortable", defaultRegion: LAST_USED };

/** Reads stored settings, keeping only values this version knows. */
function loadSettings(): UnifiedSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<UnifiedSettings>;
    return {
      visualMode: raw.visualMode === "light" || raw.visualMode === "dark" ? raw.visualMode : "system",
      density: raw.density === "compact" ? "compact" : "comfortable",
      defaultRegion: isRegion(raw.defaultRegion) ? raw.defaultRegion : LAST_USED,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function startRegion(defaultRegion: string): string {
  if (isRegion(defaultRegion)) return defaultRegion;
  const stored = localStorage.getItem(REGION_KEY);
  return isRegion(stored) ? stored : DEFAULT_REGION;
}

interface PreferencesValue {
  settings: UnifiedSettings;
  saveSettings: (next: UnifiedSettings) => void;
  /** Region of the region selector; every service page reads and writes this Region. */
  region: string;
  setRegion: (code: string) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UnifiedSettings>(loadSettings);
  const [region, setRegionState] = useState<string>(() => startRegion(settings.defaultRegion));

  useEffect(() => {
    const apply = () => {
      const dark = settings.visualMode === "dark" || (settings.visualMode === "system" && prefersDark());
      applyMode(dark ? Mode.Dark : Mode.Light);
    };
    apply();
    if (settings.visualMode !== "system" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings.visualMode]);

  useEffect(() => {
    applyDensity(settings.density === "compact" ? Density.Compact : Density.Comfortable);
  }, [settings.density]);

  const saveSettings = useCallback((next: UnifiedSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  const setRegion = useCallback((code: string) => {
    if (!isRegion(code)) return;
    localStorage.setItem(REGION_KEY, code);
    setRegionState(code);
  }, []);

  const value = useMemo(() => ({ settings, saveSettings, region, setRegion }), [settings, saveSettings, region, setRegion]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences outside PreferencesProvider");
  return value;
}
