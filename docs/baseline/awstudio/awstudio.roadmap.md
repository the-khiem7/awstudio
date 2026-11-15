---
baseline_schema: "3.0"
pack: "awsandbox"
document: "roadmap"
status: "active"
updated: "2026-11-15"
code_ref: "e69d991"
---

# awsandbox - roadmap

## Status

| Phase | Subject | Status | Depends on |
|---|---|---|---|
| Phase 0 | Foundation and toolchain gate | complete | - |
| Phase 1 | Runtime providers | complete | Phase 0 |
| Phase 2 | Session and SDK access | complete | Phase 1 |
| Phase 3 | Console shell and capability matrix | planned | Phase 2 |
| Phase 4 | Services wave 1: S3, DynamoDB, SQS, SNS | planned | Phase 3 |
| Phase 5 | Services wave 2: IAM, Lambda | planned | Phase 4 |
| Phase 6 | Services wave 3: Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge | planned | Phase 5 |
| Phase 7 | API Console, fidelity catalog, seed scripts | planned | Phase 3 |
| Phase 8 | Packaging | planned | Phase 6, Phase 7 |
| Phase 9 | Embedded mode spike | deferred | Phase 8 |

Every service page's acceptance lists which controls are green (must work against the running emulator) and which are UI-only, from the capability matrix (ASB-D9).

## Phase 0: Foundation and toolchain gate

Tasks:

1. Per-machine profiles (ASB-D6): `machines/_default.toml` (MSVC), a local profile for the GNU-target machine, `.gitignore` entry for every other `machines/*.toml`, `scripts/dev.ps1` and `scripts/build.ps1` that read the machine name and print `profile: local` or `profile: default`, never the name. No Linux script yet (ASB-D7).
2. GNU-family machine: per-user llvm-mingw under `%LOCALAPPDATA%\Programs`, `~/.cargo/bin` on the user PATH, rustup toolchain `stable-x86_64-pc-windows-gnullvm` (the plain GNU target does not link, ASB-D20).
3. Scaffold Tauri v2 + Vite + React 18 + TypeScript + Cloudscape (`components`, `global-styles`, `collection-hooks`) with an empty AppLayout.
4. Add one AWS SDK crate (`aws-sdk-sts` or `aws-sdk-s3`) and an HTTP client that trusts a custom PEM CA, so the TLS and crypto stack compiles in the gate.
5. `tools/vendor-drift` (Python, run with `uv`): resolve two commits of a submodule, report tier deltas, variant deltas, moved issues, Smithy model changes, and pack entries whose `**Vendor:**` line names a changed service (ASB-D13).
6. Pre-commit hygiene hook (Python via `uv`): refuse staged text containing the local machine name, employer domains, 12-digit account IDs other than `000000000000`, and private key blocks (ASB-D15).
7. `shallow = true` for both submodules in `.gitmodules`.
8. CI skeleton: Windows build of the scaffold on GitHub Actions (ASB-D7).
9. README with the non-affiliation line (ASB-D1) and the telemetry notice (ASB-D12).
10. One commit for the scaffold, profiles, tools and hook; the submodules and this pack are already committed separately (ASB-D16).

Acceptance:

- `scripts/dev.ps1` opens a window showing a Cloudscape AppLayout on the GNU-target machine.
- The same scaffold builds on a Windows runner in CI.
- The SDK crate and custom-CA client from task 4 compile on both the GNU-target machine and CI.
- `tools/vendor-drift` run between `v1.0.364` (`7496e0fe6a47`) and `v1.0.382` (`a978cc2cde36`) prints a summary for the 11 services.
- The hygiene hook blocks a staged file containing the local machine name.

Verification gate: if the GNU target fails to build the Tauri app or the SDK crypto stack, switch that machine's profile to `cargo-xwin` and record the failure in `hallucination` before continuing. If `aws-lc-rs` needs tools the machine cannot install per-user, try the SDK's `rustls-ring` TLS feature.

Checkpoint (tasks 1 to 10 done, committed in `d535a96`):

| Acceptance | State |
|---|---|
| `scripts/dev.ps1` opens a window with a Cloudscape AppLayout | verified on the GNU-family machine: window titled `awsandbox`, heading rendered under the strict CSP |
| Same scaffold builds on a Windows runner in CI | verified: GitHub Actions run 43653923870 on commit `9163495`, job `windows` passed in 4m34s (checkout, Node, rustup, `npm ci`, `npm run tauri -- build --debug --no-bundle`) |
| SDK crate and custom-CA client compile | verified locally with `scripts/build.ps1 --debug --no-bundle` (release profile, 9m16s, `awsandbox.exe` produced) and in the same CI run; TLS against a running emulator not exercised |
| `tools/vendor-drift` `v1.0.364` to `v1.0.382` prints a summary for the 11 services | verified: tier changes S3 1, SNS 5, Lambda 4, SSM 4; variants removed SSM 2; Smithy model files changed 0; 339 issues moved to now-work |
| Hygiene hook blocks a staged file with the local machine name | verified by running `.githooks/pre-commit` on a staged probe file (exit 1, no name printed); an actual `git commit` refusal was not exercised |

- Toolchain gate: the GNU target failed and `gnullvm` passed; cause and fix in ASB-D20. `cargo-xwin` and `rustls-ring` were not needed.
- Changed files: root `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.gitattributes`, `.gitmodules` (`shallow = true`), `README.md`; `src/`; `src-tauri/` (`Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/default.json`, `icons/`, `src/lib.rs`, `src/main.rs`, `src/emulator_tls.rs`); `machines/_default.toml`, `machines/README.md`; `scripts/dev.ps1`, `scripts/build.ps1`, `scripts/machine.ps1`; `tools/vendor-drift/`, `tools/hygiene/`; `.githooks/pre-commit`; `.github/workflows/ci.yml`.
- Local setup, not tracked: llvm-mingw `20261104` under `%LOCALAPPDATA%\Programs`, user PATH entries for `~/.cargo/bin` and llvm-mingw, the `gnullvm` and `gnu` rustup toolchains (the `gnu` one is unused), the gitignored local machine file, `core.hooksPath=.githooks`, and an untracked `hygiene-deny.txt` in the git directory.
- Risk: the icon set is a generated placeholder; the CI action pins ran green once.

## Phase 1: Runtime providers

Tasks:

1. Provider trait: start, stop, restart, health, logs stream, version, endpoint.
2. Docker provider through the `docker` CLI (ASB-D4): detect engine kind (Docker Desktop, WSL shim), translate bind-mount paths for a WSL engine, build the image from the AWS package (pinned version and signature check), run with `127.0.0.1:<port>:<port>` and a memory limit, stream container JSON logs.
3. Native provider: the RPM/DEB installed inside WSL; process lifecycle through `wsl.exe` on Windows.
4. Attach provider: an existing endpoint plus its `~/.aws/emulator/<port>/` folder.
5. Version check: run `aws-emulator -v` and compare the commit with the capability matrix; banner on mismatch (ASB-D14) and a "Rebuild image at pinned version" action.
6. Telemetry first-run notice and toggle (ASB-D12).
7. Stop and restart warn that all emulated resources are lost.

Acceptance:

- Start, stop and restart work from the app with each provider on Windows (WSL-shim engine and Docker Desktop).
- Health turns green after start; logs stream live.
- Memory use of an idle emulator with all 437 services is measured and the default memory limit is set from it.

Verification gate: the port published inside WSL is reachable from Windows at `127.0.0.1:<port>`.

Checkpoint (tasks 1 to 7 implemented, committed in `2fb042d` and `22ee71e`):

| Acceptance | State |
|---|---|
| Start, stop, restart from the app, each provider, WSL-shim engine and Docker Desktop | verified for the Docker provider on the WSL-shim engine (`docker.cmd` into Ubuntu-24.04) through the real WebView IPC; native and attach verified against a binary copied into WSL; Docker Desktop not verified, none installed here |
| Health turns green after start; logs stream live | health `healthy` after start through the app; logs streamed in the Rust live test (Docker and native); the UI log panel was not exercised with a running emulator |
| Idle memory measured, default limit set from it | 180 MiB idle (version 1.0.382); default stays `2g` (ASB-D24) |
| Gate: WSL port reachable at `127.0.0.1:<port>` | verified: Windows `curl` and the app's HTTPS health check reached both the container and the native process |

- Tasks: 1 `Provider` trait; 2 `DockerProvider` (engine classification, `/mnt/<drive>` path translation, image build with fingerprint and signature check, `127.0.0.1` publish, memory limit, JSON log stream); 3 `NativeProvider` (`wsl.exe --exec`, `HOME` on the Windows profile, SIGTERM stop); 4 `AttachProvider`; 5 `aws-emulator -v` parse and pinned-commit compare, warning banner, "Rebuild image at pinned version"; 6 first-run telemetry modal and toggle, `--telemetry off` passed when off; 7 stop and restart refuse without `confirm_data_loss` (backend) and a confirmation modal (UI).
- Evidence: `cargo test --lib` 23 passed; `cargo test --test live_providers -- --ignored` 2 passed (Docker start, health, version, logs, restart, stop; native start, health, version, log replay, attach, stop, attach after stop fails); `npm run build` passed; release build launched and driven over WebView2 remote debugging (`get_settings`, `provider_status`, `provider_start`, `provider_version_check`, `provider_stop` without confirmation returned `confirmation_required`, `provider_stop` confirmed returned stopped); the page showed the telemetry notice on first run; a build with a wrong key fingerprint failed (ASB-D21).
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`serde`, `serde_json`, `reqwest` 0.13 with `rustls` and `blocking`), `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/provider/` (`mod.rs`, `process.rs`, `docker.rs`, `native.rs`, `attach.rs`, `health.rs`, `version.rs`, `settings.rs`), `src-tauri/tests/live_providers.rs`, `src/App.tsx`, `src/runtime/api.ts`, `src/runtime/Runtime.tsx`.
- Open: ASB-Q7 (native install source, no DEB URL); the default memory limit is closed by ASB-D24. Windows CI on the new code: verified, GitHub Actions run 43658052256 on commit `3283b1a` passed (job `windows`, 2m56s). Not verified: Docker Desktop; a running emulator's log panel in the UI; the `-d --rm` first run that exited at once and was not reproduced.
- Risk: attach reports no version or logs (an unowned process); the first-run telemetry modal cannot be dismissed without a choice by design; `telemetry` files under `~/.aws/emulator/telemetry` appeared during probes and their cause was not traced.

## Phase 2: Session and SDK access

Tasks:

1. Load keys, `ca.pem` and `config` from `~/.aws/emulator/<port>/` on every (re)start; the key filename is one constant.
2. Shared SDK config: explicit credentials provider, custom-CA HTTP client, endpoint override, endpoint guard (ASB-D17).
3. Typed Tauri commands with generated TypeScript bindings (tauri-specta); error mapping: HTTP 501 to `Unsupported { op, variant, version }`, AWS errors to code and message.
4. "Copy environment block" and "Open terminal with emulator environment" for the AWS CLI and SDKs.
5. Verify region behavior: create the same resource name in two regions and record whether state is partitioned.

Acceptance:

- `sts:GetCallerIdentity` and `s3:ListBuckets` succeed from the backend after each restart without user action.
- A request built for a non-emulator host is refused by the endpoint guard.

Checkpoint (tasks 1 to 5 implemented, committed in `80a18b6`, `5dc0e1c`, `4f12a55` and `632ca58`):

| Acceptance | State |
|---|---|
| STS and S3 succeed after each restart, no user action | verified twice: the `live_session` test (start, both calls, restart, new key detected, both calls) and the release build over WebView2 IPC (`session_check` after `provider_start` and after `provider_restart`, account `000000000000`, 0 buckets) |
| Request to a non-emulator host refused by the guard | verified by unit test: an STS client whose endpoint is `https://sts.amazonaws.com` fails with the `guard` error and sends nothing; URI rules unit-tested (other port, `http`, virtual-hosted bucket, look-alike host) |

- Tasks: 1 `Session::load` reads `ca.pem`, the key file (name from the one constant) and the region from `config` on every SDK call, rebuilds clients when key, CA or region change, and is preloaded after start and restart; 2 `aws::Clients` (explicit credentials, CA-only trust store, endpoint override, `EndpointGuard` at `read_before_transmit`, path-style S3); 3 tauri-specta bindings in `src/bindings.ts`, `ApiError` with HTTP 501 to `unsupported { op, variant, version }`; 4 PowerShell and cmd environment blocks plus "Open terminal with emulator environment" on a new SDK access panel; 5 region probe.
- Region result: SQS queues of one name in `us-east-1` and `eu-west-1` are separate resources (each region lists only its own; a tag set in `us-east-1` is absent in `eu-west-1`); recorded under Emulator facts in `awsandbox.introduction.md`.
- Evidence: `cargo test --lib` 34 passed; `cargo test --test bindings` passed (committed bindings match); `cargo test --test live_session -- --ignored` 2 passed; `npm run build` passed; release build driven over WebView2 remote debugging (`session_check` before start returned the `session` error, `session_info`, `env_block`, "Test connection" click rendered the signed-in line, `open_terminal` spawned `powershell.exe -NoExit`, `session_check` after stop returned the `session` error); both env blocks run in a shell holding a bogus `AWS_PROFILE` and `AWS_ACCESS_KEY_ID` returned account `000000000000`.
- Test binaries that link the Tauri runtime failed to load until the Windows resource was linked into them; cause and fix in ASB-D23.
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`aws-sdk-s3`, `aws-types`, `specta` `=2.0.0-rc.28`, `specta-typescript` 0.0.15, `tauri-specta` `=2.0.0-rc.29`), `src-tauri/build.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/session.rs`, `src-tauri/src/aws.rs`, `src-tauri/src/env.rs`, `src-tauri/src/provider/` (`mod.rs`, `settings.rs`, `version.rs`: `specta::Type` derives), `src-tauri/src/emulator_tls.rs` (removed, replaced by `aws.rs`), `src-tauri/tests/bindings.rs`, `src-tauri/tests/live_session.rs`, `src-tauri/tests/fixtures/test-ca.pem` (certificate only, no key), `src/bindings.ts`, `src/runtime/api.ts`, `src/runtime/SdkAccess.tsx`, `src/runtime/Runtime.tsx`, `README.md`.
- Not verified: a live HTTP 501 through `map_sdk_error` (the 501 message parser is unit-tested only); the environment inside the opened terminal window (the window opened; the same variables passed the CLI check); the Windows CI run of this code; the SDK access panel on a screenshot.
- Risk: tauri-specta and specta are release candidates pinned with `=`; the emulator returns SQS queue URLs on real AWS hosts (`https://sqs.<region>.amazonaws.com/...`), so a client that follows such a URL instead of the endpoint override is stopped only by the guard.

## Phase 3: Console shell and capability matrix

Tasks:

1. `tools/capability-gen`: read the pinned `scores.json`, the Smithy models, `SKIPPED_STUBS.md` and `not_implemented("...")` messages; write `capability.json` with a `vendor` header (repo, commit, tag, scoredAt) and per-operation tier, pass ratio and unsupported variants (ASB-D9). Commit the generated file so builds do not need the submodule.
2. `useCapability(op, variant?)` hook; runtime 501 cache per session.
3. Shell: TopNavigation with a permanent LOCAL badge, services menu and search, region selector, account menu `000000000000`, AppLayout, breadcrumbs, Flashbar, help panel, split panel, unified settings (visual mode, density, default region).
4. Console Home with board-components widgets: recently visited, emulator health, fidelity.
5. Emulator page: lifecycle, logs, environment export, telemetry state, version check.
6. Shared page patterns ported from `vendor/cloudscape-demos` (ASB-D3): table with property filter, details with tabs, details hub, single-page create, wizard, edit, delete confirmations, manage tags, S3 read/write pickers, dashboard, split-panel comparison, date-filter table, editable table.
7. Routes mirror console URL paths, for example `#/s3/buckets/<name>?tab=objects`.

Acceptance:

- A UI-only page shows the empty table, the "Not supported by AWS Emulator vX" banner and disabled actions.
- A green control calls the backend; a red control is disabled with its reason.

## Phase 4: Services wave 1: S3, DynamoDB, SQS, SNS

Pages:

- S3: buckets list, create bucket, bucket details (Objects with folders, upload, download, delete; Properties; Permissions with policy, CORS, Block Public Access; Management with lifecycle), object details and versions.
- DynamoDB: dashboard, tables, create table, table details (Overview, Indexes, Backups, Additional settings), Explore items (scan and query builder, form and JSON item editor), PartiQL editor.
- SQS: queues, create queue (Standard or FIFO, DLQ, access policy), queue details (SNS subscriptions, Lambda triggers, DLQ, tags, encryption), send and receive messages, purge.
- SNS: dashboard, topics, create topic, topic details (subscriptions, access policy, tags), publish message, subscriptions.

Acceptance: every green control works against the running emulator; S3 upload and download stream through the backend for a file of at least 100 MB.

## Phase 5: Services wave 2: IAM, Lambda

Pages:

- IAM: dashboard, users, user groups, roles, policies, create wizards, JSON policy editor, access keys (secret shown once, never logged).
- Lambda: dashboard, functions, create function, function details (Code with deploy and Test events, Configuration, Triggers, Permissions, environment variables), versions and aliases (ASB-D10).

Acceptance: a Node.js and a Python function are created, edited in the Code tab, deployed and invoked from the Test tab.

## Phase 6: Services wave 3: Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge

Pages:

- Secrets Manager: secrets, store a new secret wizard, secret details (retrieve value, rotation, versions, tags).
- SSM: every console area, functional where green (ASB-D8): Parameter Store with history and labels, OpsCenter, Documents, Automation, Patch Manager, Run Command, settings; red areas as UI-only pages.
- KMS: customer managed keys, AWS managed keys, create key wizard, key details (key policy, rotation, aliases, tags).
- CloudWatch Logs: log groups, log streams, log events with date filter, metric filters, subscription filters, Logs Insights.
- EventBridge: event buses, rules, create rule wizard (event pattern editor, targets), archives, send events.

Acceptance: an EventBridge rule targeting an SQS queue delivers a sent event that is visible in the SQS page.

## Phase 7: API Console, fidelity catalog, seed scripts

Tasks:

1. API Console: service and operation picker, forms generated from a trimmed Smithy model bundle (documentation stripped, not the 118 MB originals), execution through the AWS CLI subprocess (ASB-D8, ASB-D17).
2. Fidelity catalog: every modeled service with its tiers and links to vendor issues.
3. Seed scripts: save and replay a list of calls to rebuild state after a restart.

Acceptance: an operation of a service outside the 11 runs from the API Console and shows its response.

## Phase 8: Packaging

Tasks: per-user NSIS installer on Windows (Linux packaging deferred, ASB-D7), Tauri updater, signing per ASB-D19, About page with licenses and NOTICE files.

Acceptance: install without elevation on Windows; first run shows the telemetry notice.

## Phase 9: Embedded mode spike

Deferred by ASB-D5. Scope: link `aws-emulator-embedded` into the backend as a provider; measure build time, disk and binary size.

## Risks

| Risk | Impact | Handling |
|---|---|---|
| GNU target unsupported by Tauri | Phase 0 blocked on that machine | Phase 0 gate, `cargo-xwin` fallback |
| SDK crypto stack needs C tools | Phase 0 blocked | `rustls-ring` feature |
| WSL port forwarding off | No endpoint from Windows | Phase 1 gate |
| Idle memory over limit | Exit 137, state lost | Idle measured at 180 MiB, default `2g` (ASB-D24) |
| Region semantics unknown | Wrong region selector behavior | Measured in Phase 2: SQS state is partitioned by region |
| Upstream release velocity | Stale capability claims | ASB-D13 drift tool |
| Running version differs from pin | Wrong gating | ASB-D14 banner, ASB-D18 |
| Smithy models 118 MB | Large installer | Trimmed bundle in Phase 7 |

## Next action

Phase 1 and Phase 2 are approved and complete. ASB-Q7 is deferred by the user; later phases target the Docker provider. Push so CI builds the Phase 2 code (not yet authorized), then start Phase 3 task 1 (`tools/capability-gen` writing `capability.json` from the pinned vendor data).
