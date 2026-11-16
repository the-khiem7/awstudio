---
baseline_schema: "3.0"
pack: "awstudio"
document: "roadmap"
status: "active"
updated: "2026-11-16"
code_ref: "0c0182b"
---

# awstudio - roadmap

## Status

| Phase | Subject | Status | Depends on |
|---|---|---|---|
| Phase 0 | Foundation and toolchain gate | complete | - |
| Phase 1 | Runtime providers | complete | Phase 0 |
| Phase 2 | Session and SDK access | complete | Phase 1 |
| Phase 3 | Console shell and capability matrix | complete | Phase 2 |
| Phase 4 | Services wave 1: S3, DynamoDB, SQS, SNS | complete | Phase 3 |
| Phase 5 | Services wave 2: IAM, Lambda | complete | Phase 4 |
| Phase 6 | Services wave 3: Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge | complete | Phase 5 |
| Phase 7 | API Console, fidelity catalog, seed scripts | planned | Phase 3 |
| Phase 8 | Packaging | planned | Phase 6, Phase 7 |
| Phase 9 | Embedded mode spike | deferred | Phase 8 |

Every service page's acceptance lists which controls are green (must work against the running emulator) and which are UI-only, from the capability matrix (ASD-D9, ASD-D32).

## Phase 0: Foundation and toolchain gate

Tasks:

1. Per-machine profiles (ASD-D6): `machines/_default.toml` (MSVC), a local profile for the GNU-target machine, `.gitignore` entry for every other `machines/*.toml`, `scripts/dev.ps1` and `scripts/build.ps1` that read the machine name and print `profile: local` or `profile: default`, never the name. No Linux script yet (ASD-D7).
2. GNU-family machine: per-user llvm-mingw under `%LOCALAPPDATA%\Programs`, `~/.cargo/bin` on the user PATH, rustup toolchain `stable-x86_64-pc-windows-gnullvm` (the plain GNU target does not link, ASD-D20).
3. Scaffold Tauri v2 + Vite + React 18 + TypeScript + Cloudscape (`components`, `global-styles`, `collection-hooks`) with an empty AppLayout.
4. Add one AWS SDK crate (`aws-sdk-sts` or `aws-sdk-s3`) and an HTTP client that trusts a custom PEM CA, so the TLS and crypto stack compiles in the gate.
5. `tools/vendor-drift` (Python, run with `uv`): resolve two commits of a submodule, report tier deltas, variant deltas, moved issues, Smithy model changes, and pack entries whose `**Vendor:**` line names a changed service (ASD-D13).
6. Pre-commit hygiene hook (Python via `uv`): refuse staged text containing the local machine name, employer domains, 12-digit account IDs other than `000000000000`, and private key blocks (ASD-D15).
7. `shallow = true` for both submodules in `.gitmodules`.
8. CI skeleton: Windows build of the scaffold on GitHub Actions (ASD-D7).
9. README with the non-affiliation line (ASD-D1) and the telemetry notice (ASD-D12).
10. One commit for the scaffold, profiles, tools and hook; the submodules and this pack are already committed separately (ASD-D16).

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
| `scripts/dev.ps1` opens a window with a Cloudscape AppLayout | verified on the GNU-family machine: window titled `AWStudio`, heading rendered under the strict CSP |
| Same scaffold builds on a Windows runner in CI | verified: GitHub Actions run 43653923870 on commit `9163495`, job `windows` passed in 4m34s (checkout, Node, rustup, `npm ci`, `npm run tauri -- build --debug --no-bundle`) |
| SDK crate and custom-CA client compile | verified locally with `scripts/build.ps1 --debug --no-bundle` (release profile, 9m16s, `awstudio.exe` produced) and in the same CI run; TLS against a running emulator not exercised |
| `tools/vendor-drift` `v1.0.364` to `v1.0.382` prints a summary for the 11 services | verified: tier changes S3 1, SNS 5, Lambda 4, SSM 4; variants removed SSM 2; Smithy model files changed 0; 339 issues moved to now-work |
| Hygiene hook blocks a staged file with the local machine name | verified by running `.githooks/pre-commit` on a staged probe file (exit 1, no name printed); an actual `git commit` refusal was not exercised |

- Toolchain gate: the GNU target failed and `gnullvm` passed; cause and fix in ASD-D20. `cargo-xwin` and `rustls-ring` were not needed.
- Changed files: root `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.gitattributes`, `.gitmodules` (`shallow = true`), `README.md`; `src/`; `src-tauri/` (`Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/default.json`, `icons/`, `src/lib.rs`, `src/main.rs`, `src/emulator_tls.rs`); `machines/_default.toml`, `machines/README.md`; `scripts/dev.ps1`, `scripts/build.ps1`, `scripts/machine.ps1`; `tools/vendor-drift/`, `tools/hygiene/`; `.githooks/pre-commit`; `.github/workflows/ci.yml`.
- Local setup, not tracked: llvm-mingw `20261104` under `%LOCALAPPDATA%\Programs`, user PATH entries for `~/.cargo/bin` and llvm-mingw, the `gnullvm` and `gnu` rustup toolchains (the `gnu` one is unused), the gitignored local machine file, `core.hooksPath=.githooks`, and an untracked `hygiene-deny.txt` in the git directory.
- Risk: the icon set is a generated placeholder; the CI action pins ran green once.

## Phase 1: Runtime providers

Tasks:

1. Provider trait: start, stop, restart, health, logs stream, version, endpoint.
2. Docker provider through the `docker` CLI (ASD-D4): detect engine kind (Docker Desktop, WSL shim), translate bind-mount paths for a WSL engine, build the image from the AWS package (pinned version and signature check), run with `127.0.0.1:<port>:<port>` and a memory limit, stream container JSON logs.
3. Native provider: the RPM/DEB installed inside WSL; process lifecycle through `wsl.exe` on Windows.
4. Attach provider: an existing endpoint plus its `~/.aws/emulator/<port>/` folder.
5. Version check: run `aws-emulator -v` and compare the commit with the capability matrix; banner on mismatch (ASD-D14) and a "Rebuild image at pinned version" action.
6. Telemetry first-run notice and toggle (ASD-D12).
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
| Idle memory measured, default limit set from it | 180 MiB idle (version 1.0.382); default stays `2g` (ASD-D24) |
| Gate: WSL port reachable at `127.0.0.1:<port>` | verified: Windows `curl` and the app's HTTPS health check reached both the container and the native process |

- Tasks: 1 `Provider` trait; 2 `DockerProvider` (engine classification, `/mnt/<drive>` path translation, image build with fingerprint and signature check, `127.0.0.1` publish, memory limit, JSON log stream); 3 `NativeProvider` (`wsl.exe --exec`, `HOME` on the Windows profile, SIGTERM stop); 4 `AttachProvider`; 5 `aws-emulator -v` parse and pinned-commit compare, warning banner, "Rebuild image at pinned version"; 6 first-run telemetry modal and toggle, `--telemetry off` passed when off; 7 stop and restart refuse without `confirm_data_loss` (backend) and a confirmation modal (UI).
- Evidence: `cargo test --lib` 23 passed; `cargo test --test live_providers -- --ignored` 2 passed (Docker start, health, version, logs, restart, stop; native start, health, version, log replay, attach, stop, attach after stop fails); `npm run build` passed; release build launched and driven over WebView2 remote debugging (`get_settings`, `provider_status`, `provider_start`, `provider_version_check`, `provider_stop` without confirmation returned `confirmation_required`, `provider_stop` confirmed returned stopped); the page showed the telemetry notice on first run; a build with a wrong key fingerprint failed (ASD-D21).
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`serde`, `serde_json`, `reqwest` 0.13 with `rustls` and `blocking`), `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/provider/` (`mod.rs`, `process.rs`, `docker.rs`, `native.rs`, `attach.rs`, `health.rs`, `version.rs`, `settings.rs`), `src-tauri/tests/live_providers.rs`, `src/App.tsx`, `src/runtime/api.ts`, `src/runtime/Runtime.tsx`.
- Open: ASD-Q7 (native install source, no DEB URL); the default memory limit is closed by ASD-D24. Windows CI on the new code: verified, GitHub Actions run 43658052256 on commit `3283b1a` passed (job `windows`, 2m56s). Not verified: Docker Desktop; a running emulator's log panel in the UI; the `-d --rm` first run that exited at once and was not reproduced.
- Risk: attach reports no version or logs (an unowned process); the first-run telemetry modal cannot be dismissed without a choice by design; `telemetry` files under `~/.aws/emulator/telemetry` appeared during probes and their cause was not traced.

## Phase 2: Session and SDK access

Tasks:

1. Load keys, `ca.pem` and `config` from `~/.aws/emulator/<port>/` on every (re)start; the key filename is one constant.
2. Shared SDK config: explicit credentials provider, custom-CA HTTP client, endpoint override, endpoint guard (ASD-D17).
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
- Region result: SQS queues of one name in `us-east-1` and `eu-west-1` are separate resources (each region lists only its own; a tag set in `us-east-1` is absent in `eu-west-1`); recorded under Emulator facts in `awstudio.introduction.md`.
- Evidence: `cargo test --lib` 34 passed; `cargo test --test bindings` passed (committed bindings match); `cargo test --test live_session -- --ignored` 2 passed; `npm run build` passed; release build driven over WebView2 remote debugging (`session_check` before start returned the `session` error, `session_info`, `env_block`, "Test connection" click rendered the signed-in line, `open_terminal` spawned `powershell.exe -NoExit`, `session_check` after stop returned the `session` error); both env blocks run in a shell holding a bogus `AWS_PROFILE` and `AWS_ACCESS_KEY_ID` returned account `000000000000`.
- Test binaries that link the Tauri runtime failed to load until the Windows resource was linked into them; cause and fix in ASD-D23.
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`aws-sdk-s3`, `aws-types`, `specta` `=2.0.0-rc.28`, `specta-typescript` 0.0.15, `tauri-specta` `=2.0.0-rc.29`), `src-tauri/build.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/session.rs`, `src-tauri/src/aws.rs`, `src-tauri/src/env.rs`, `src-tauri/src/provider/` (`mod.rs`, `settings.rs`, `version.rs`: `specta::Type` derives), `src-tauri/src/emulator_tls.rs` (removed, replaced by `aws.rs`), `src-tauri/tests/bindings.rs`, `src-tauri/tests/live_session.rs`, `src-tauri/tests/fixtures/test-ca.pem` (certificate only, no key), `src/bindings.ts`, `src/runtime/api.ts`, `src/runtime/SdkAccess.tsx`, `src/runtime/Runtime.tsx`, `README.md`.
- Not verified: a live HTTP 501 through `map_sdk_error` (the 501 message parser is unit-tested only); the environment inside the opened terminal window (the window opened; the same variables passed the CLI check); the Windows CI run of this code; the SDK access panel on a screenshot.
- Risk: tauri-specta and specta are release candidates pinned with `=`; the emulator returns SQS queue URLs on real AWS hosts (`https://sqs.<region>.amazonaws.com/...`), so a client that follows such a URL instead of the endpoint override is stopped only by the guard.

## Phase 3: Console shell and capability matrix

Tasks:

1. `tools/capability-gen`: read the pinned `scores.json`, the Smithy models, `SKIPPED_STUBS.md` and `not_implemented("...")` messages; write `capability.json` with a `vendor` header (repo, commit, tag, scoredAt) and per-operation tier, pass ratio and unsupported variants (ASD-D9). Commit the generated file so builds do not need the submodule.
2. `useCapability(op, variant?)` hook; runtime 501 cache per session.
3. Shell: TopNavigation with a permanent LOCAL badge, services menu and search, region selector, account menu `000000000000`, AppLayout, breadcrumbs, Flashbar, help panel, split panel, unified settings (visual mode, density, default region).
4. Console Home with board-components widgets: recently visited, emulator health, fidelity.
5. Emulator page: lifecycle, logs, environment export, telemetry state, version check.
6. Shared page patterns ported from `vendor/cloudscape-demos` (ASD-D3): table with property filter, details with tabs, details hub, single-page create, wizard, edit, delete confirmations, manage tags, S3 read/write pickers, dashboard, split-panel comparison, date-filter table, editable table.
7. Routes mirror console URL paths, for example `#/s3/buckets/<name>?tab=objects`.

Acceptance:

- A UI-only page shows the empty table, the "Not supported by AWS Emulator vX" banner and disabled actions.
- A green control calls the backend; a red control is disabled with its reason.

Checkpoint (tasks 1 to 7 implemented, committed in `11a6413`, `dc3cb58`, `147ba03`, `689a5fd`, `cacf9d5`, `76256ab`, `b53d859`, `52fe16d`; unsaved-changes guard fixed in `8ce1a04`; closed with Kai's approval on 2026-11-15, acceptance accepted on the gallery per ASD-D28):

| Acceptance | State |
|---|---|
| UI-only page: empty table, banner, disabled actions | verified on the dev-only pattern gallery (`#/dev/patterns/gating`, fixture rows, primary op `ssm:DescribeMaintenanceWindows`): empty state only, banner "Not supported by AWS Emulator v1.0.382", Delete and Create disabled with "This page is view-only: ..."; no service page exists yet; repeated on the Phase 4 pages (ASD-D28) |
| Green control calls the backend; red control disabled with reason | verified in the same gallery with a running Docker emulator: `sts:GetCallerIdentity` button answered account `000000000000`; `ssm:DescribeMaintenanceWindows` disabled with "... is not implemented in AWS Emulator v1.0.382 (HTTP 501)"; yellow `s3:GetObjectAttributes` and `lambda:UpdateFunctionCode` with `PublishTo` disabled |

- Tasks: 1 `tools/capability-gen/capability_gen.py` writes `src/capability/capability.json` (436 services, 19451 operations, key = SDK id slug, ASD-D26; every modeled service, ASD-D27); 2 `useCapability`, `judge`, `reportUnsupported`, run-scoped 501 cache reset by `runId` of the app-wide `RuntimeStatusProvider`; 3 shell under `src/shell/` (TopNavigation with `LOCAL` logo badge, service search with Alt+S, Services menu, Emulator status button, Region menu, account menu, `ConsolePage` with breadcrumbs, Flashbar, help panel, split panel slot, Unified Settings page); 4 Console Home board (Recently visited, Emulator health, Emulator fidelity); 5 Emulator page wrapping `Runtime` with Version and Telemetry fields, telemetry notice and version-mismatch notice moved to the shell; 6 13 patterns under `src/patterns/`; 7 hash routes `#/`, `#/emulator`, `#/settings`, a support landing page per console service path, `#/dev/patterns/<pattern>` in dev builds only.
- Evidence: `uv run tools/capability-gen/capability_gen.py --summary` twice, byte-identical output; `npm run build` passed (capability chunk 1176.54 kB, no gallery chunk in the release build); dev app (`scripts/dev.ps1`) driven over WebView2 remote debugging: every route and all 13 gallery pages rendered with no exception, Start reached running in 9 s, version 1.0.382 matched the pin, Unified Settings dark and compact applied and persisted.
- Defect, fixed in `8ce1a04`: the unsaved-changes guard (`useUnsavedChanges`) did not hold a hash change on a dirty create form; cause and fix in ASD-D25. Repro `#/dev/patterns/create`, type a name, `location.hash = "#/"` now stays on the form with the Leave page modal; with the old files the same script ends on `#/`.
- Verified after the fix (dev server, headless Edge 157 over remote debugging, 1600x1000 viewport, real input and pointer events): Leave and Cancel in the Leave page modal; Cancel on a dirty form opens the modal; wizard blocks Next without a name, holds a navigation when dirty, steps to Set permissions and Review, submit goes to `#/dev/patterns/gating`; typed delete stays disabled until the exact name `fixture-01` is typed, deletes and closes, simple delete enabled; inline edit opens, submits through the async save and closes (fixture rows do not keep the value by design); comparison split panel shows `2 fixtures selected` and Compare details; tag add and Save changes navigate to the gallery; S3 read picker opens, browses `fixture-bucket` and writes `s3://fixture-bucket/readme.txt` back; Region menu selects Ireland `eu-west-1`, stores it as `awstudio.region` and keeps it after reload; Services menu lists Console Home and the 11 services; Alt+S focuses service search, `queue` offers Simple Queue Service, selecting it opens `#/sqs`; Console Home board drag swapped Recently visited and Emulator health and resize changed `health` from 2x3 to 1x5, both stored in `awstudio.home.layout`; no console errors.
- Verified in the release window (`scripts/build.ps1 --no-bundle`, 2m16s, `awstudio.exe` driven over WebView2 remote debugging): Console Home and the LOCAL badge render; `#/dev/patterns/gating` shows Page not found; `provider_start` started the Docker emulator, version 1.0.382 matched the pin, `session_check` answered account `000000000000`; Emulator page shows Running, healthy, matches the pinned build; `#/sqs` landing shows 19 of 23 operations supported.
- Not verified: the run-time 501 cache (no backend command reaches a 501 operation until Phase 4); the version-mismatch notice (needs an image at another version); Windows CI of this code (push not authorized).
- Risk: backend errors name the bare operation (`GetCallerIdentity`), so a cached 501 also disables same-named operations of other services; Phase 4 commands should report `service:Operation`. The selected Region is frontend state only until service commands take a Region. Unified settings live in WebView localStorage, not `settings.json`. CommitKit's scan flags `tokenType` in the property-filter operator list as a credential (false positive). Only one navigation guard is active at a time, so two dirty guarded forms mounted together leave only the newer one guarding.
- Changed files: `.gitignore`, `package.json`, `package-lock.json` (`@cloudscape-design/board-components` `3.0.247`), `tools/capability-gen/capability_gen.py`, `src/capability/` (`capability.json`, `types.ts`, `index.tsx`), `src/runtime/RuntimeStatus.tsx`, `src/runtime/Runtime.tsx`, `src/shell/` (`router.ts` navigation guard added in `8ce1a04`), `src/patterns/` (`unsaved.tsx` changed in `8ce1a04`), `src/pages/`, `src/App.tsx`.

## Phase 4: Services wave 1: S3, DynamoDB, SQS, SNS

Pages:

- S3: buckets list, create bucket, bucket details (Objects with folders, upload, download, delete; Properties; Permissions with policy, CORS, Block Public Access; Management with lifecycle), object details and versions.
- DynamoDB: dashboard, tables, create table, table details (Overview, Indexes, Backups, Additional settings), Explore items (scan and query builder, form and JSON item editor), PartiQL editor.
- SQS: queues, create queue (Standard or FIFO, DLQ, access policy), queue details (SNS subscriptions, Lambda triggers, DLQ, tags, encryption), send and receive messages, purge.
- SNS: dashboard, topics, create topic, topic details (subscriptions, access policy, tags), publish message, subscriptions.

Acceptance: every green control works against the running emulator; S3 upload and download stream through the backend in parts for a 60 MiB file, within the emulator's 64 MiB per-bucket limit (ASD-D31); the Phase 3 gating acceptance (UI-only page with empty table, banner and disabled actions; green control calls the backend; red control disabled with its reason) is repeated on these pages (ASD-D28).

Checkpoint (pages and commands implemented, committed in `f737fab`, `2ff5f40`, `5bb1850` and `81673f4`; partial-read gating (ASD-D32), S3 default encryption and the upload limit hint (ASD-D31) in `3007e58`, `d241796` and `b718f5c`; closed with Kai's approval on 2026-11-15):

| Acceptance | State |
|---|---|
| Every green control works against the running emulator | verified for the controls listed below; on a page whose primary read is yellow, green controls are enabled (ASD-D32), Create queue included |
| S3 upload and download of a 60 MiB file in parts through the backend | verified through the backend transfer functions (ASD-D31); 120 MiB refused at part 8 by the per-bucket limit; the native file dialogs not driven |
| Phase 3 gating acceptance repeated on the real pages | verified before ASD-D32: SQS Queues, Explore items and SNS Subscriptions were UI-only with the banner "Not supported by AWS Emulator v1.0.382", no data loaded and every action disabled; after ASD-D32 no page of these four services has a red primary read, so those pages and the Default encryption, queue SNS subscriptions and dead-letter source sections load data under "Partly supported by AWS Emulator v1.0.382"; yellow controls (bucket policy Edit, lifecycle rules, DynamoDB Manage tags, Delete items, Query in Explore items) are disabled with their reason; green controls call the backend |

- Pages: S3 buckets, create bucket, bucket details (Objects, Properties, Permissions, Management), object details and versions; DynamoDB dashboard, tables, create table, table details (Indexes, Backups, Additional settings), Explore items, JSON item editor, PartiQL editor, backups; SQS queues, create and edit queue, queue details (SNS subscriptions, Lambda triggers note, dead-letter queue, tagging, access policy, encryption), send and receive; SNS dashboard, topics, create topic, topic details, publish, subscriptions, create subscription, subscription details. Routes in `awstudio.sourcecode.md`.
- Commands: 71 Region-scoped commands (S3 28, DynamoDB 17, SQS 12, SNS 14); every backend error names `service:Operation`, carried over from Phase 3.
- Evidence: `cargo test --lib` 39 passed; `cargo test --test bindings` passed; `cargo test --test live_s3_transfer -- --ignored` with 60 MiB passed (upload 62914560 bytes in 1.52 s, 8 parts and 9 progress reports, download in 0.92 s, digests equal) and with 120 MiB failed at part 8 with the emulator's per-bucket limit; `npx tsc --noEmit` and `npm run build` passed (main chunk 1434.65 kB).
- Verified in the dev app over WebView2 remote debugging, Docker emulator running: create bucket (Block Public Access all on), create folder, object details, object tags, versions; create table, create item, duplicate key refused with ConditionalCheckFailedException, PartiQL SELECT, create backup, TTL status, dashboard counts; queue details, edit visibility timeout to 45, queue tags, send, poll, delete message, purge; create topic, create subscription with the queue policy grant, publish delivered to the queue; in `eu-west-1` the tables list showed none of the `us-east-1` tables; no console errors after a reload.
- Verified after ASD-D31 and ASD-D32 (`cargo test --lib` 39 passed; `cargo test --test bindings` regenerated `src/bindings.ts` once, then passed; `npx tsc --noEmit` and `npm run build` passed, main chunk 1435.95 kB; dev app over WebView2 remote debugging, Docker emulator running): SQS Queues lists 4 queues under the partly supported banner with Create queue enabled; SNS Subscriptions lists 3; a queue's SNS subscriptions tab lists 1; a dead-letter queue's source queues listed `ui-probe-queue3` after a redrive policy was set on it; Explore items Scan returned 1 item and Run is disabled once Query is selected; Default encryption shows SSE-S3, Bucket Key Disabled, AWS KMS key "-"; 17 S3, DynamoDB, SQS and SNS routes with no console errors.
- Defects found and fixed in this phase: every create or edit form sent its request twice (cause and fix in ASD-D29); `serde_json::Value` could not be exported to the bindings (ASD-D30); the queue form capped Maximum message size at 262144 bytes while the emulator reports 1048576.
- Not verified: the Upload and Download buttons through the native dialogs, and with them the upload limit hint in the notice; Default encryption for SSE-KMS, DSSE-KMS or no configuration; a UI-only page of these services after ASD-D32 (none has a red primary read); the release build window; Windows CI (push not authorized); restore from backup; time to live turned on; the queue form's dead-letter queue fields; the subscription filter policy editor; Enter in a form whose operation is not green.
- Risk: SNS to SQS delivery needs the topic granted in the queue policy, as on AWS; the Create subscription page adds that grant for SQS endpoints by default and changes the queue policy. DynamoDB item counts stay 0 after writes in this emulator. Each list command describes every resource it lists, one call per resource.
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`aws-sdk-dynamodb`, `aws-sdk-sns`, `aws-sdk-sqs`, `aws-smithy-types`, `tauri-plugin-dialog`, `tokio`), `src-tauri/src/aws.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/` (`mod.rs`, `s3.rs`, `dynamodb.rs`, `sqs.rs`, `sns.rs`), `src-tauri/tests/live_s3_transfer.rs`, `src-tauri/tests/live_session.rs`, `src/bindings.ts`, `src/capability/index.tsx`, `src/patterns/` (`CreateForm.tsx`, `gating.tsx`, `DetailsPage.tsx`, `ServiceDashboard.tsx`, `index.ts`), `src/services/` (`common.tsx`, `routes.tsx`, `s3/S3Pages.tsx`, `dynamodb/DynamoDbPages.tsx`, `sqs/SqsPages.tsx`, `sns/SnsPages.tsx`), `src/App.tsx`.

## Phase 5: Services wave 2: IAM, Lambda

Pages:

- IAM: dashboard, users, user groups, roles, policies, create wizards, JSON policy editor, access keys (secret shown once, never logged).
- Lambda: dashboard, functions, create function, function details (Code with deploy and Test events, Configuration, Triggers, Permissions, environment variables), versions and aliases (ASD-D10).

Acceptance: a Node.js and a Python function are created, edited in the Code tab, deployed and invoked from the Test tab.

Checkpoint (pages and commands implemented, committed in `32cc89a`, `a241ecd`, `9fec15b` and `251af0c`; closed with Kai's approval on 2026-11-16):

| Acceptance | State |
|---|---|
| A Node.js function is created, edited in the Code tab, deployed and invoked from the Test tab | verified in the dev app over WebView2 remote debugging with the Docker emulator: created from the Create function form, edited in the Code tab, Deploy, Test returned the edited value and the log |
| A Python function is created, edited in the Code tab, deployed and invoked from the Test tab | verified the same way, with the runtime chosen in the form (handler and sample code switch to Python) |

- Pages: IAM dashboard, users, user groups, roles, policies; user and role create wizards, user group and policy create forms with the JSON policy editor; details pages with Permissions (attach, detach, inline policies), Groups, Tags, Security credentials (access keys), Trust relationships, policy entities and versions. Lambda dashboard, functions, create function, details with Code (file list and editor, deploy), Test (events saved in local storage), Configuration (general, environment variables, triggers, resource policy, function URL, tags), Aliases, Versions. Routes in `awstudio.sourcecode.md`.
- Commands: 61 (IAM 41, Lambda 20); IAM commands take no Region, Lambda commands take one.
- Evidence: `cargo test --lib` 50 passed (11 new: document decoding, principal operation names, zip round trip and unsafe names); `cargo test --test bindings` regenerated `src/bindings.ts` once, then passed; `npx tsc --noEmit` and `npm run build` passed (main chunk 1526.63 kB). Through the app IPC against the Docker emulator: policy with versions, role, group, user, attach and detach, inline policy, tags, access key create, deactivate and list; Node.js and Python functions created and invoked, deploy with an added file and with an unchanged file, version, alias create, update and delete, tags, configuration update, resource policy and function URL reads. In the dev app: 31 IAM and Lambda routes rendered with no console error; user wizard, role wizard, user group form, policy form and Create function form created their resources; attach, detach, inline policy create and the typed delete of a user worked.
- Defects found and fixed in this phase: a second Lambda update right after an update got HTTP 409 (cause and fix in ASD-D33); the Code tab started as unsaved because its first snapshot differed from the empty file list, which held every navigation behind the Leave page modal; the Code tab's file column did not span a quarter of the width (changed to a grid); the Create alias button was disabled because it asked the matrix about the `FunctionVersion` feature, which the emulator refuses only for `$LATEST.PUBLISHED` (feature removed from the button).
- Verified after ASD-D34 and ASD-D35 (dev app over WebView2 remote debugging, Docker emulator running): Create access key is enabled and opens the dialog that shows the secret once, the key is listed after Done; Edit on the function Configuration tab is enabled and a new description saved from the dialog shows on the page; Publish new version lists the version; Create alias with a chosen version lists the alias.
- Decisions: ASD-D34 (the Lambda list shows every function with a Region column, the emulator keeps one function namespace for every Region), ASD-D35 (Create access key and Edit function configuration are enabled although partly supported).
- Risk: IAM state is not enforced by the emulator, so the pages manage identities that do not affect authorization; deleting a user, group or role makes several calls and a failure part way leaves it partly cleaned; an access key's secret crosses IPC once to the WebView; the Region column of the Lambda list is read from the ARN text.
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`aws-sdk-iam`, `aws-sdk-lambda`, `zip`, tokio `time`), `src-tauri/src/aws.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/` (`mod.rs`, `iam.rs`, `lambda.rs`), `src/bindings.ts`, `src/services/routes.tsx`, `src/services/iam/IamPages.tsx`, `src/services/lambda/LambdaPages.tsx`, `src/capability/index.tsx`, `README.md`.

## Phase 6: Services wave 3: Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge

Pages:

- Secrets Manager: secrets, store a new secret wizard, secret details (retrieve value, rotation, versions, tags).
- SSM: every console area, functional where green (ASD-D8): Parameter Store with history and labels, OpsCenter, Documents, Automation, Patch Manager, Run Command, settings; red areas as UI-only pages.
- KMS: customer managed keys, AWS managed keys, create key wizard, key details (key policy, rotation, aliases, tags).
- CloudWatch Logs: log groups, log streams, log events with date filter, metric filters, subscription filters, Logs Insights.
- EventBridge: event buses, rules, create rule wizard (event pattern editor, targets), archives, send events.

Acceptance: an EventBridge rule targeting an SQS queue delivers a sent event that is visible in the SQS page.

Checkpoint (pages and commands implemented, committed in `2f349df` (commands), `a1b3fcb` (pages), `0b4888b` (README) and `0c0182b` (enabled operations); closed with Kai's approval on 2026-11-16):

| Acceptance | State |
|---|---|
| An EventBridge rule targeting an SQS queue delivers a sent event that is visible in the SQS page | verified in the dev app: the Create rule wizard created a rule with an SQS target, Send events put an event, and the queue's Send and receive page listed the message (Messages 1, 215 B); repeated after PutTargets was enabled (ASD-D38) with Add target on an existing rule; the queue policy grant the emulator needs is added by the page (ASD-D36) |

- Pages: Secrets Manager (list, Store a new secret wizard, details with value, rotation, versions, resource permissions, tags); KMS (customer and AWS managed key lists, Create key wizard, details with key policy, rotation, aliases, grants, tags); CloudWatch Logs (log groups, create, details with streams, metric filters, subscription filters, tags, log events, Logs Insights with saved queries); EventBridge (rules, Create rule wizard, rule details, event buses, archives, Send events); Systems Manager (Parameter Store, OpsCenter, Settings, Automation, Hybrid Activations, Resource Data Sync, Documents, Patch Manager, and the view-only or partly supported Maintenance Windows, Fleet Manager, Compliance, Inventory, Session Manager, Run Command, State Manager). Routes in `awstudio.sourcecode.md`.
- Commands: 116 (Secrets Manager 15, KMS 21, CloudWatch Logs 23, EventBridge 18, SSM 39), all Region-scoped, every error names `service:Operation`.
- Gating: Documents, Patch Manager, Maintenance Windows, Compliance and Session Manager lists are UI-only (their list operations are red); the Parameters, Fleet Manager, Inventory, Run Command, State Manager and Settings pages load under the partly supported banner (ASD-D32); PutTargets, ListAliases, StartQuery and GetQueryResults are enabled (ASD-D38); ListQueues stays disabled outside the SQS pages, so the EventBridge target form takes the queue ARN typed (ASD-D39).
- Evidence: `cargo test --lib` 62 passed (12 new); `cargo test --test bindings` regenerated `src/bindings.ts` once, then passed; `npx tsc --noEmit` and `npm run build` passed (main chunk 1756.73 kB). Through the app IPC against the Docker emulator: secrets (create, read, version, tags, policy, delete, restore), keys (create, alias, rotation, policy, tags, schedule and cancel deletion), log groups (streams, events, metric filters, tags, saved queries, an Insights query), EventBridge (buses, rules, targets, PutEvents, archives, tags), Parameter Store (put, history, labels, tags, delete), OpsItems, documents, Automation, activations, resource data syncs, service settings and a patch baseline. In the dev app over WebView2 remote debugging: 60 routes rendered with no load error; the secrets wizard and value Retrieve (cleared on tab change), SecureString parameter create, decrypt on click and edit, Create key wizard with alias, log group, stream and test events with filter, Insights run, rule wizard with SQS target, Send events, patch baseline, document, Automation execution and activation code dialog.
- Defects found and fixed in this phase: the EventBridge target form sent PutTargets without the queue policy grant, so events never reached the queue (cause and fix in ASD-D36); the patch baseline form sent no approved patches and the emulator refused it (ASD-D37); the rules list put a form field inside the table header description, which React reported as invalid nesting (field moved above the table).
- Not verified: targets of types other than SQS; delete and restore of a secret and of a key from the pages; the metric filter, tag, rotation, grant, OpsItem edit and settings Edit modals; the asymmetric key branch of the Create key wizard; rotation with a real Lambda function; subscription filters with a real destination; Run Command, State Manager, Fleet Manager and Inventory against a managed node; the release build window; Windows CI (push not authorized).
- Decisions: ASD-D38 (PutTargets, ListAliases, StartQuery and GetQueryResults are enabled although partly supported), ASD-D39 (ListQueues stays disabled outside the SQS pages).
- Risk: Region partitioning was measured only for Secrets Manager (a secret in `us-east-1` is not listed in `eu-west-1`), not for the other four services; the rules list shows an `Events-Archive-<name>` rule the emulator creates for each archive and the pages leave managed rules read-only; creating an activation needs an existing IAM role that trusts `ssm.amazonaws.com`; rotation and subscription filters validate the Lambda function and its permission; AWS-owned Automation documents such as `AWS-RestartEC2Instance` do not exist, so Automation needs a document the user created.
- Changed files: `src-tauri/Cargo.toml`, `Cargo.lock` (`aws-sdk-secretsmanager`, `aws-sdk-ssm`, `aws-sdk-kms`, `aws-sdk-cloudwatchlogs`, `aws-sdk-eventbridge`), `src-tauri/src/aws.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/` (`mod.rs`, `secretsmanager.rs`, `kms.rs`, `logs.rs`, `eventbridge.rs`, `ssm.rs`), `src/bindings.ts`, `src/services/routes.tsx`, `src/services/secretsmanager/SecretsManagerPages.tsx`, `src/services/kms/KmsPages.tsx`, `src/services/logs/LogsPages.tsx`, `src/services/eventbridge/EventBridgePages.tsx`, `src/services/ssm/` (`shell.tsx`, `SsmPages.tsx`, `ParameterStore.tsx`, `OpsCenter.tsx`, `SsmSettings.tsx`, `SsmAreas.tsx`), `README.md`.
## Phase 7: API Console, fidelity catalog, seed scripts

Tasks:

1. API Console: service and operation picker, forms generated from a trimmed Smithy model bundle (documentation stripped, not the 118 MB originals), execution through the AWS CLI subprocess (ASD-D8, ASD-D17).
2. Fidelity catalog: every modeled service with its tiers and links to vendor issues.
3. Seed scripts: save and replay a list of calls to rebuild state after a restart.

Acceptance: an operation of a service outside the 11 runs from the API Console and shows its response.

## Phase 8: Packaging

Tasks: per-user NSIS installer on Windows (Linux packaging deferred, ASD-D7), Tauri updater, signing per ASD-D19, About page with licenses and NOTICE files.

Acceptance: install without elevation on Windows; first run shows the telemetry notice.

## Phase 9: Embedded mode spike

Deferred by ASD-D5. Scope: link `aws-emulator-embedded` into the backend as a provider; measure build time, disk and binary size.

## Risks

| Risk | Impact | Handling |
|---|---|---|
| GNU target unsupported by Tauri | Phase 0 blocked on that machine | Phase 0 gate, `cargo-xwin` fallback |
| SDK crypto stack needs C tools | Phase 0 blocked | `rustls-ring` feature |
| WSL port forwarding off | No endpoint from Windows | Phase 1 gate |
| Idle memory over limit | Exit 137, state lost | Idle measured at 180 MiB, default `2g` (ASD-D24) |
| Region semantics unknown | Wrong region selector behavior | Measured in Phase 2: SQS state is partitioned by region |
| Upstream release velocity | Stale capability claims | ASD-D13 drift tool |
| Running version differs from pin | Wrong gating | ASD-D14 banner, ASD-D18 |
| Smithy models 118 MB | Large installer | Trimmed bundle in Phase 7 |
| Emulator per-bucket limit of 64 MiB of object bytes, 1000 objects | Large uploads refused | Acceptance at 60 MiB, limit explained in the upload notice (ASD-D31) |
| Yellow primary reads load data that may be incomplete | A partial page can miss edge cases of its list | Partly supported banner; other yellow controls disabled (ASD-D32) |
| Lambda keeps one function namespace for every Region | A Region selector that does not scope the Lambda pages | Region column in the list, help note (ASD-D34) |
| Lambda refuses an update while a create or update runs | HTTP 409 on deploy, publish or invoke | Backend waits for the function (ASD-D33) |
| Enabled partly supported operations can fail on input the probes did not try | An error in the Flashbar | The list of enabled operations grows only after a probe (ASD-D35, ASD-D38) |
| EventBridge and SNS deliver to SQS only with a queue policy grant | Events and messages are silently dropped | The pages add the grant (ASD-D36) |

## Next action

Phase 6 is complete. Phase 7 (API Console, fidelity catalog, seed scripts) starts only when the owner asks. ASD-Q7 (native provider install source) stays open and deferred. The Docker emulator is stopped. Pushing for CI of Phase 2 to Phase 6 code is not yet authorized.
