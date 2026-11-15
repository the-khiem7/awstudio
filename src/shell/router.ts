import { useEffect, useState } from "react";

// Hash routes that mirror console URL paths: `#/s3/buckets/<name>?tab=objects` stands for
// `console.aws.amazon.com/s3/buckets/<name>?tab=objects`. The hash keeps every route inside the
// bundled page, so no server or history fallback is needed.

export interface Location {
  path: string;
  query: URLSearchParams;
}

function current(): Location {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const at = raw.indexOf("?");
  const path = (at < 0 ? raw : raw.slice(0, at)) || "/";
  return { path: path.startsWith("/") ? path : `/${path}`, query: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)) };
}

export function useLocation(): Location {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const onChange = () => setLocation(current());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return location;
}

/** `#/path` for a route path; Cloudscape links take this as their `href`. */
export function href(path: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") params.set(k, v);
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

export function navigate(target: string): void {
  window.location.hash = target.startsWith("#") ? target.slice(1) : target;
}

/** Matches `/s3/buckets/:name` against a path; returns the decoded parameters or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const got = path.split("/").filter(Boolean);
  const rest = want[want.length - 1] === "*";
  if (rest ? got.length < want.length - 1 : got.length !== want.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    if (w === "*") {
      params["*"] = got.slice(i).map(decodeURIComponent).join("/");
      return params;
    }
    if (w.startsWith(":")) params[w.slice(1)] = decodeURIComponent(got[i]);
    else if (w !== got[i]) return null;
  }
  return params;
}
