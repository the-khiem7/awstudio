---
baseline_schema: "3.0"
pack: "awstudio"
document: "introduction"
status: "active"
updated: "2026-11-16"
code_ref: "0b4888b"
---

# awstudio - introduction

## Scope

`awstudio` is a Tauri v2 desktop app (Windows first, Linux deferred, ASD-D7) that runs and drives aws/aws-emulator and presents it with the look and behavior of the AWS Management Console, built on Cloudscape. Decisions: `awstudio.hallucination.md` ASD-D1 to ASD-D37.

In scope:

- Emulator lifecycle (start, stop, restart, health, logs, version check) through runtime providers (ASD-D4).
- Console shell: top navigation, services menu and search, region selector, breadcrumbs, flashbar, help panel, unified settings, Console Home.
- Console-parity pages for 11 services; SSM as far as the emulator supports it (ASD-D8).
- A generic API Console for the other modeled services (ASD-D8).
- A capability matrix that decides which controls are functional (ASD-D9, ASD-D32).
- Vendor pinning and drift reports (ASD-D13).

Out of scope until after packaging: embedded mode (ASD-D5).

## Current truth

| Item | State |
|---|---|
| Application code | Phase 0 scaffold, Phase 1 runtime providers (Docker, native WSL, attach), Phase 2 session loading, shared SDK clients with the endpoint guard and generated bindings, and Phase 3 capability matrix, console shell, Console Home, Emulator page, Unified Settings, page patterns and per-service support landing pages are committed (Phase 3 complete); Phase 4 console pages and Region-scoped commands for S3, DynamoDB, SQS and SNS are committed (Phase 4 complete); Phase 5 console pages and commands for IAM and Lambda are committed (Phase 5 complete); Phase 6 console pages and commands for Secrets Manager, SSM, KMS, CloudWatch Logs and EventBridge are committed and await approval, so all 11 services have pages |
| Branch | `main` |
| Committed | `.gitmodules`, `vendor/aws-emulator`, `vendor/cloudscape-demos`, this pack |
| Windows CI | verified for Phase 0 (run 43653923870 on `9163495`) and Phase 1 (run 43658052256 on `3283b1a`); Phase 2 to Phase 6 code not run in CI, push not authorized |

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
- SQS reports `MaximumMessageSize` 1048576 bytes for a new queue (measured in Phase 4).
- S3 keeps at most 64 MiB of object bytes per bucket, parts of uploads in flight included, 1000 objects per bucket and 10000 objects in total; compile-time constants in `services/service-com-amazonaws-s3-amazons3/src/state.rs`, no flag or variable changes them (ASD-D31).
- SNS delivers to an SQS subscription only when the queue policy grants `sns.amazonaws.com` `SQS:SendMessage`, as AWS does; without the grant `Publish` succeeds and the queue stays empty (measured in Phase 4).
- DynamoDB `ItemCount` stays 0 after `PutItem` (measured in Phase 4).
- Lambda keeps one function namespace for every Region: a function created in `us-east-1` is listed, fetched and invoked from `eu-west-1`, its ARN names `us-east-1`, and the same name in another Region is refused with `ResourceConflictException` (measured in Phase 5, ASD-D34).
- Lambda `CreateFunction` answers `State` `Pending` and `UpdateFunctionCode` answers `LastUpdateStatus` `InProgress`; invoking or updating meanwhile gets HTTP 409 (ASD-D33). `ListFunctions` carries no `State`.
- Lambda `GetFunction` hands out `Code.Location` as a presigned URL on the emulator's own endpoint (`https://127.0.0.1:<port>/awslambda-<region>-tasks/...`), valid 600 seconds; a download needs no signature (measured in Phase 5).
- IAM returns policy documents as plain JSON, not URL-encoded as AWS does; the backend decodes either form. A new emulator already holds one user, `emulator`, created on 1970-01-01. IAM data is global to the session Region and the emulator does not evaluate it when it authorizes requests (measured in Phase 5).
- Secrets Manager state is partitioned by Region: a secret created in `us-east-1` is not listed in `eu-west-1` (measured in Phase 6); the other four Phase 6 services were not checked.
- EventBridge delivers a matching event to an SQS target only when the queue policy grants `events.amazonaws.com` `SQS:SendMessage`; PutTargets and PutEvents succeed without it and the queue stays empty (measured in Phase 6, ASD-D36).
- Each archive creates a managed rule `Events-Archive-<name>` that ListRules returns with `ManagedBy` `events.amazonaws.com` (measured in Phase 6).
- CreateActivation refuses an IAM role that does not exist or does not trust `ssm.amazonaws.com`; CreatePatchBaseline refuses a baseline with neither approved patches nor approval rules (ASD-D37); RotateSecret and PutSubscriptionFilter refuse a Lambda function that is missing or lacks the service's permission; AWS-owned Automation documents such as `AWS-RestartEC2Instance` do not exist (measured in Phase 6).
- Logs Insights returned correct rows from `StartQuery` and `GetQueryResults` in one probe although both are partly supported; `kms:ListAliases` and `eventbridge:PutTargets` also worked when called (measured in Phase 6, ASD-Q15 to ASD-Q17).
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

Tiers per ASD-D9 thresholds, before the unscored-operation rule and variant gating are applied.

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

Generated matrix (`src/capability/capability.json`, tools/capability-gen), with the 501 rules applied: unwired or scaffolded operations are red even when a step that expects an error passes; unscored operations are green unless they have a named unsupported variant.

| Service key | Ops | Green / Yellow / Red |
|---|---|---|
| `s3` | 112 | 97 / 10 / 5 |
| `dynamodb` | 58 | 35 / 19 / 4 |
| `sqs` | 23 | 19 / 4 / 0 |
| `sns` | 42 | 38 / 3 / 1 |
| `lambda` | 88 | 72 / 11 / 5 |
| `iam` | 180 | 147 / 17 / 16 |
| `secrets-manager` | 23 | 22 / 0 / 1 |
| `ssm` | 152 | 45 / 22 / 85 |
| `kms` | 54 | 41 / 8 / 5 |
| `cloudwatch-logs` | 118 | 86 / 25 / 7 |
| `eventbridge` | 57 | 53 / 4 / 0 |

- Operations with no `//! @op` handler, or whose file carries `//! SCAFFOLDED, NOT IMPLEMENTED:`, always answer HTTP 501.
- Some `not_implemented` messages hold only a run-time placeholder (`{unserved}`, `{member}`, many S3 operations); they name no feature a page can gate on.

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

- Public repository: no machine names, company names, company accounts or internal paths in tracked files (ASD-D15).
- Machine profiles other than `machines/_default.toml` are gitignored (ASD-D6).
- Builds must not need elevation on a machine without MSVC Build Tools (ASD-D6).
- Windows with the Docker provider is the only supported target for now; avoid Windows-only assumptions in shared code where cheap, but build nothing for Linux yet (ASD-D7).
- The submodule pin is restricted to tags with an LTS package (ASD-D18); builds stay unsigned until packaging (ASD-D19).
- The app never redistributes the emulator package or image; the image is built on the user's machine from the AWS download URL. The license of the binary package is not stated in the docs.
- Cloudscape is Apache-2.0: ship its NOTICE in the About page.
- The `docker` command may be a shim into a WSL2 distro; Windows host paths must be translated for bind mounts and ports reach Windows through WSL2 localhost forwarding (ASD-D4).
- Some agent environments block shell commands that mention credential file paths; keep the emulator key filename in one constant and test with temporary fake files.
