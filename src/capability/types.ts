// Shape of `capability.json`, written by tools/capability-gen from the pinned emulator release.

export type Tier = "green" | "yellow" | "red";

export interface OpCapability {
  tier: Tier;
  /** Passed and total conformance steps of the release scores, for example `9/10`. Absent when unscored. */
  pass?: string;
  /** Features of a working operation that answer HTTP 501, from the emulator's `not_implemented` messages. */
  unsupported?: string[];
  /** Why the operation always answers HTTP 501: no handler is wired, or the handler is a scaffold. */
  reason?: "unwired" | "scaffolded";
}

export interface ServiceCapability {
  name: string;
  sdkId: string;
  prefix: string;
  models: string[];
  ops: Record<string, OpCapability>;
}

export interface CapabilityMatrix {
  vendor: { repo: string; commit: string; tag: string; scoredAt: string };
  thresholds: Record<Tier, string>;
  services: Record<string, ServiceCapability>;
}

/** What a control needs to know: may it call the backend, and if not, why. */
export interface Capability {
  /** `unknown` while the matrix loads or when the operation is not in it. */
  tier: Tier | "unknown";
  enabled: boolean;
  /** Short reason for a disabled control; empty when enabled. */
  reason: string;
  pass?: string;
}
