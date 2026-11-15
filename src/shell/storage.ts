import { useCallback, useState } from "react";

/** State kept in localStorage under `awstudio.<key>`; a stored value that does not parse is ignored. */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `awstudio.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const save = useCallback(
    (next: T) => {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setValue(next);
    },
    [storageKey],
  );
  return [value, save];
}

const RECENT_KEY = "awstudio.recently-visited";
const RECENT_MAX = 6;

/** Service ids in the order the user last opened them, newest first. */
export function recentlyVisited(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordVisit(serviceId: string): void {
  const next = [serviceId, ...recentlyVisited().filter((id) => id !== serviceId)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
