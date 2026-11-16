// Systems Manager console pages: one module per group of console areas, tried in turn.

import type { ReactNode } from "react";
import { opsCenterPages } from "./OpsCenter";
import { parameterStorePages } from "./ParameterStore";
import { ssmAreaPages } from "./SsmAreas";
import { ssmSettingsPages } from "./SsmSettings";
import { SSM_ROOT } from "./shell";

/** The Systems Manager page for a route path, or null when the path is not one. */
export function ssmRoutes(path: string, query: URLSearchParams): ReactNode | null {
  const p = path === SSM_ROOT ? `${SSM_ROOT}/opsitems` : path;
  return parameterStorePages(p, query) ?? opsCenterPages(p, query) ?? ssmSettingsPages(p, query) ?? ssmAreaPages(p, query);
}
