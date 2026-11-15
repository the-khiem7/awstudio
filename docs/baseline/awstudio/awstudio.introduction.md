---
baseline_schema: "3.0"
pack: "awsandbox"
document: "introduction"
status: "active"
updated: "2026-11-15"
code_ref: "e69d991"
---

# awsandbox - introduction

## Scope

`awsandbox` is a Tauri v2 desktop app (Windows first, Linux deferred, ASB-D7) that runs and drives aws/aws-emulator and presents it with the look and behavior of the AWS Management Console, built on Cloudscape. Decisions: `awsandbox.hallucination.md` ASB-D1 to ASB-D24.

In scope:

- Emulator lifecycle (start, stop, restart, health, logs, version check) through runtime providers (ASB-D4).
- Console shell: top navigation, services menu and search, region selector, breadcrumbs, flashbar, help panel, unified settings, Console Home.
- Console-parity pages for 11 services; SSM as far as the emulator supports it (ASB-D8).
- A generic API Console for the other modeled services (ASB-D8).
- A capability matrix that decides which controls are functional (ASB-D9).
- Vendor pinning and drift reports (ASB-D13).

Out of scope until after packaging: embedded mode (ASB-D5).

## Current truth

| Item | State |
|---|---|
| Application code | Phase 0 scaffold, Phase 1 runtime providers (Docker, native WSL, attach) with the Runtime page, and Phase 2 session loading, shared SDK clients with the endpoint guard, generated bindings and the SDK access panel are committed; no console pages |
| Branch | `main` |
| Committed | `.gitmodules`, `vendor/aws-emulator`, `vendor/cloudscape-demos`, this pack |
| Windows CI | verified: GitHub Actions run 43653923870 on commit `9163495` passed (job `windows`, 4m34s) |

## Vendor pins

| Submodule | Commit | Tag or date |
|---|---|---|
| `vendor/aws-emulator` | `a978cc2cde36` | `v1.0.382` |
| `vendor/cloudscape-demos` | `9b6815fa47f0` | 2026-11-13 |

- aws-emulator source: `https://github.com/aws/aws-emulator.git`, cloned with depth 1, about 1.3 GB.
- cloudscape-demos source: `https://github.com/cloudscape-design/demos.git`, depth 1, about 2.8 MB, MIT-style license.

## Emulator facts

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Rust workspace, one crate per service: 437 service crates, 438 Smithy models totalling 118 MB under `services/<svc>/smithy-model/`.
- Serves HTTPS with a self-signed certificate on `127.0.0.1:9297`; `GET /__admin/health` is the only admin route. No state listing, reset or snapshot API.
- CLI: `-b/--bind`, `-p/--port` (0 picks a free port), `-a/--auth on|off`, `-t/--telemetry on|off`, `--idle-timeout <seconds>`, `-v/--version` (prints Version, Release date, Commit), `-h/--help`.
- Environment: `EMULATOR_DATA_PORT`, `EMULATOR_BIND_ADDRESS`, `EMULATOR_TELEMETRY`, `EMULATOR_CONFIG`, `EMULATOR_STACK_BYTES`.
- SigV4 authentication is on by default; each start writes new keys, a new `ca.pem`, a `config` profile and `truststore.p12` under `~/.aws/emulator/<port>/` (`%USERPROFILE%\.aws\emulator\<port>\` on Windows).
- One account, `000000000000`; generated config region `us-east-1`. State is partitioned by region: SQS queues of one name in `us-east-1` and `eu-west-1` are separate resources, each listed and tagged only in its own region (measured in Phase 2).
- SQS returns queue URLs on real AWS hosts (`https://sqs.<region>.amazonaws.com/000000000000/<name>`); calls still work because clients send to the endpoint override.
- The generated `config` is written from where the emulator runs, so in a container or WSL its `ca_bundle` is that side's path and its `endpoint_url` can name that side's bind address; clients take the endpoint and CA path from the Windows side and only the region from the file (file contents under Docker not inspected).
- State is in memory only; stopping the emulator deletes all emulated resources. A container over its memory limit exits 137 and loses state.
- Lambda runs Node.js and Python handlers inside the emulator process; upstream says function code "isn't isolated from your machine".
- Upstream security guidance: do not use the emulator to test IAM, bucket or KMS policies, or cross-account or cross-Region access.
- Windows and macOS run the emulator in a container built from the AWS RPM; Linux installs the RPM or DEB. Upstream Dockerfile: `public.ecr.aws/amazonlinux/amazonlinux:2023-minimal`, `ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]`, published as `127.0.0.1:<port>:<port>`, `--memory=2g`.
- Each GitHub release attaches `scores.json.gz`: per-unit wire and behavioral fidelity results with the operations of each step.
- Gaps are tracked in `issues/things-that-do-not-work/`; fixed ones move to `issues/things-that-now-work/`.
- Telemetry is on by default; upstream asks tools that include the emulator to tell users and offer a way to turn it off.

## Capability baseline of the 11 services

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Tiers per ASB-D9 thresholds, before the unscored-operation rule and variant gating are applied.

| Service | Ops | Green / Yellow / Red / Unscored |
|---|---|---|
| S3 | 112 | 97 / 10 / 0 / 5 |
| DynamoDB | 58 | 29 / 19 / 4 / 6 |
| SQS | 23 | 19 / 4 / 0 / 0 |
| SNS | 42 | 36 / 3 / 1 / 2 |
| Lambda | 88 | 77 / 11 / 0 / 0 |
| IAM | 180 | 143 / 17 / 12 / 8 |
| Secrets Manager | 23 | 22 / 0 / 1 / 0 |
| SSM | 152 | 43 / 27 / 75 / 7 |
| KMS | 54 | 41 / 8 / 5 / 0 |
| CloudWatch Logs | 118 | 85 / 25 / 7 / 1 |
| EventBridge | 57 | 46 / 4 / 0 / 7 |

SSM by console area:

| Area | Level |
|---|---|
| Parameter Store, OpsCenter, Settings, Resource Data Sync, Hybrid Activations | mostly green |
| Documents (ListDocuments 0/2), Automation, Patch Manager | partial |
| Run Command | weak |
| Maintenance Windows, State Manager, Inventory, Compliance, Fleet Manager, Session Manager | red |

## Target

- A user who knows the AWS Console can run the emulator and work with local resources without reading emulator docs.
- Green operations work end to end; yellow and red ones show the real console UI, disabled, with the reason.
- Every vendor-dependent claim names its vendor commit and can be re-checked against a newer one.

## Constraints

- Public repository: no machine names, company names, company accounts or internal paths in tracked files (ASB-D15).
- Machine profiles other than `machines/_default.toml` are gitignored (ASB-D6).
- Builds must not need elevation on a machine without MSVC Build Tools (ASB-D6).
- Windows with the Docker provider is the only supported target for now; avoid Windows-only assumptions in shared code where cheap, but build nothing for Linux yet (ASB-D7).
- The submodule pin is restricted to tags with an LTS package (ASB-D18); builds stay unsigned until packaging (ASB-D19).
- The app never redistributes the emulator package or image; the image is built on the user's machine from the AWS download URL. The license of the binary package is not stated in the docs.
- Cloudscape is Apache-2.0: ship its NOTICE in the About page.
- The `docker` command may be a shim into a WSL2 distro; Windows host paths must be translated for bind mounts and ports reach Windows through WSL2 localhost forwarding (ASB-D4).
- Some agent environments block shell commands that mention credential file paths; keep the emulator key filename in one constant and test with temporary fake files.
