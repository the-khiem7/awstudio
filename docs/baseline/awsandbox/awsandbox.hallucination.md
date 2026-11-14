---
baseline_schema: "3.0"
pack: "awsandbox"
document: "hallucination"
status: "active"
updated: "2026-11-15"
code_ref: "uncommitted"
---

# awsandbox - decisions and open questions

Vendor-dependent entries carry a `**Vendor:**` line naming the vendor submodule commit the entry was judged against. When the pinned commit moves, `tools/vendor-drift` lists the entries whose vendor line names a changed service (see ASB-D13).

## Entry index

| ID | Subject | Status | Related |
|---|---|---|---|
| ASB-D1 | Product scope and name | closed | ASB-D2, ASB-D15 |
| ASB-D2 | Frontend stack: React 18 + Cloudscape | closed | ASB-D1, ASB-D3 |
| ASB-D3 | Console-parity reference sources | closed | ASB-D2 |
| ASB-D4 | Emulator runtime providers | closed | ASB-D5, ASB-D7, ASB-Q3 |
| ASB-D5 | Embedded mode deferred | closed | ASB-D4 |
| ASB-D6 | Per-machine build toolchain profiles | closed | ASB-D7, ASB-D15 |
| ASB-D7 | Target platforms | closed | ASB-D4, ASB-D6, ASB-Q3 |
| ASB-D8 | Service scope and generic API Console | closed | ASB-D9 |
| ASB-D9 | Capability tiers and UI gating | closed | ASB-D8, ASB-D10, ASB-D11 |
| ASB-D10 | Lambda Code tab is functional | closed | ASB-D9, ASB-D11 |
| ASB-D11 | Lesson: branch-level not_implemented read as whole-operation gaps | lesson | ASB-D9, ASB-D10 |
| ASB-D12 | Emulator telemetry default | closed | - |
| ASB-D13 | Vendor pinning and drift detection | closed | ASB-D14, ASB-D16, ASB-Q2 |
| ASB-D14 | Running-version mismatch handling | closed | ASB-D13, ASB-Q2 |
| ASB-D15 | Repository model and public hygiene | closed | ASB-D6, ASB-D16 |
| ASB-D16 | Submodule commit timing and path | closed | ASB-D13, ASB-D15 |
| ASB-Q1 | Security baseline for keys, CA, endpoint and subprocesses | open | ASB-D4, ASB-D8 |
| ASB-Q2 | Pin only tags that have a matching LTS package | open | ASB-D13, ASB-D14 |
| ASB-Q3 | Default runtime provider on Linux | open | ASB-D4, ASB-D7 |
| ASB-Q4 | Code signing and updater signing timing | open | ASB-D7 |

## Closed decisions

### ASB-D1: Product scope and name

- Decision (Kai, 2026-11-15): build `awsandbox`, a Tauri v2 desktop app that gives aws/aws-emulator the same experience as the AWS Management Console, locally.
- Why: the emulator has no graphical interface; only an HTTPS endpoint and `GET /__admin/health` exist [user].
- What breaks if ignored: the name contains the AWS trademark; without a README line stating the project is not affiliated with AWS, the public repo can be read as an official AWS product.
- Rejected: `Cumulocal` (neutral, no "aws" in the name) - owner preferred the aws wordplay style [user].
- Rejected: `awshore` - owner picked `awsandbox` from the shortlist [user].

### ASB-D2: Frontend stack: React 18 + Cloudscape

- Decision (Kai, 2026-11-15): React 18 + TypeScript + Vite with Cloudscape (`@cloudscape-design/components`, `global-styles`, `collection-hooks`, `board-components`) to mimic the AWS Console completely.
- Why: Cloudscape is the design system the AWS Console is built with, Apache-2.0 [user]; the reference demos pin React 18 [agent].
- What breaks if ignored: a generic component kit cannot reproduce console layout, tables, wizards and flashbars, and the parity goal of ASB-D1 fails.
- Rejected: Svelte - no Cloudscape implementation [user].
- Rejected: React + shadcn/ui - does not look or behave like the console [user].

### ASB-D3: Console-parity reference sources

- Decision (Kai, 2026-11-15): use cloudscape-design/demos (submodule `vendor/cloudscape-demos`) as the first reference for console page patterns; owner screenshots of the real console are the fallback.
- Why: the demos are the official console page patterns (tables, details tabs, wizard, delete confirmations, manage tags, S3 pickers, dashboards) [user].
- What breaks if ignored: pages built from memory drift from real console behavior and parity cannot be checked.
- Rejected: screenshots first - slower, and needs manual capture per page [user].

### ASB-D4: Emulator runtime providers

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): a Docker provider driven through the `docker` CLI is primary; a native RPM/DEB provider (in WSL on Windows) is optional; an attach provider connects to an already running endpoint.
- Why: on Windows and macOS the only supported path is a container built from the AWS RPM; building from source is supported on Linux only and needs about 100 GB for `target/` [user].
- Why the CLI: a `docker` command can be a shim into a WSL2 distro whose engine socket is unreachable from Windows, and the CLI works the same with that shim, Docker Desktop, Rancher and Podman [user].
- What breaks if ignored: an Engine API client cannot reach a WSL-hosted engine, and Windows host paths in `-v` fail unless translated to `/mnt/<drive>/...`.
- Rejected: bollard (Docker Engine API) - cannot reach the engine behind a WSL shim [user].
- Rejected: building the emulator from source - Linux-only and about 100 GB [user].

### ASB-D5: Embedded mode deferred

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): defer an embedded-mode provider (`aws-emulator-embedded` linked into the Tauri backend) until after the packaging phase.
- Why: it compiles all 437 service crates into the app and building on Windows is not supported upstream [user].
- What breaks if ignored: the first build costs about 100 GB and hours of compile before any UI exists.

### ASB-D6: Per-machine build toolchain profiles

- Decision (Kai, 2026-11-15): the build toolchain is chosen per machine by machine name through `machines/<name>.toml`, read by `scripts/dev.ps1` and `scripts/build.ps1`; only `machines/_default.toml` (MSVC) is committed and every other profile is gitignored.
- Decision (Kai, 2026-11-15): a machine without MSVC Build Tools uses `x86_64-pc-windows-gnu` with a per-user llvm-mingw; `cargo-xwin` is the fallback when that target fails to build.
- Why: one machine cannot install MSVC Build Tools without elevation; others can use MSVC [user]. Profile files named after machines would leak host names in a public repo [user].
- What breaks if ignored: pinning a target in `rust-toolchain.toml` or `.cargo/config.toml` forces it on every machine; committing profiles publishes host names.
- Rejected: MSVC Build Tools on every machine - needs elevation on at least one machine [user].
- Rejected: committing every machine profile - leaks machine information [user].
- Note: Tauri states it "officially only supports the MSVC Windows target"; the GNU route is unverified until Phase 0 proves it [agent].

### ASB-D7: Target platforms

- Decision (Kai, 2026-11-15): target Windows and Linux from the start.
- Why: owner requirement [user].
- What breaks if ignored: Windows-only assumptions (paths, WSL shim handling, toolchain scripts in PowerShell only) leak into shared code and block the Linux build later.
- Rejected: Windows only until packaging - owner wants Linux from the first phase [user].

### ASB-D8: Service scope and generic API Console

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): build dedicated console-parity UI for 11 services: S3, DynamoDB, SQS, SNS, IAM, Lambda, Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge.
- Decision (Kai, 2026-11-15): SSM covers every console area the emulator supports, not only Parameter Store.
- Decision (Kai, 2026-11-15): every other service is reached through a generic API Console whose forms come from the vendor Smithy models and whose calls run the AWS CLI as a subprocess.
- Why: the 11 services are the common local-dev set; the emulator models 437 services, too many for dedicated pages [user].
- What breaks if ignored: dedicated pages for every service never finish; without the API Console the other 426 services are unreachable from the app.
- Rejected: Parameter Store only for SSM - owner wants as much as the emulator supports [user].
- Rejected: native Smithy serialization + SigV4 signing for the API Console - five wire protocols to implement before the first call works [user].

### ASB-D9: Capability tiers and UI gating

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): tier every operation from the pinned release's `scores.json`: green at pass rate >= 80%, yellow above 0%, red at 0% or HTTP 501.
- Decision (Kai, 2026-11-15): an operation with no score is green unless the vendor source has a `not_implemented` branch in it.
- Decision (Kai, 2026-11-15): green is functional; yellow and red still get the full Cloudscape console UI but are non-functional.
- Decision (Kai, 2026-11-15): gate per operation and per unsupported variant (the feature named in a `not_implemented("...")` message), not per feature area.
- Decision (Kai, 2026-11-15): a page whose primary read operation (List or Describe) is not green is UI-only: empty table, a "Not supported by AWS Emulator vX" banner, disabled actions.
- Why: parity of the console look is the goal, and the emulator's real ability decides what may run [user].
- What breaks if ignored: buttons that call unsupported operations fail at click time; area-level gating locks working operations because one sibling fails.
- Rejected: unscored operations as yellow until a smoke test passes - owner prefers more enabled features [user].
- Rejected: mock sample data on UI-only pages - looks like real behavior and misleads [user].
- Rejected: gating per feature area - locks working operations [user].

### ASB-D10: Lambda Code tab is functional

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): the Lambda Code tab edits and deploys code; only the `PublishTo` option is disabled.
- Why: `UpdateFunctionCode` passes 9/10 scored steps and returns 501 only when `PublishTo` is set [user].
- What breaks if ignored: a read-only Code tab removes a working console feature.
- Rejected: read-only Code tab - based on the misreading recorded in ASB-D11 [user].
- Rejected: delete and recreate the function to change code - loses configuration and triggers [user].

### ASB-D11: Lesson: branch-level not_implemented read as whole-operation gaps

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Believed: Lambda `UpdateFunctionCode`, `PublishVersion`, `CreateAlias`, KMS `Encrypt`/`Decrypt`, DynamoDB `CreateTable` and SNS `Publish` return 501.
- Why it looked reasonable: a grep for `not_implemented(` in each `src/ops/<op>.rs` matched those files.
- What disproved it: the calls sit inside branches (for example `if let Some(publish_to) = input.publish_to` in `update_function_code.rs`); scores show `UpdateFunctionCode` 9/10, `PublishVersion` 29/34, `CreateAlias` 19/19, `Encrypt` 3/3, `Decrypt` 2/2, `CreateTable` 443/483; SNS `Publish` refuses only phone numbers and platform endpoints.
- Fix: capability generation reads the `not_implemented` message as an unsupported variant of the operation and takes the tier from scores (ASB-D9).

### ASB-D12: Emulator telemetry default

- Decision (Kai, 2026-11-15): keep emulator telemetry on by default, as upstream ships it.
- Why: owner choice [user].
- What breaks if ignored: upstream README asks a tool that includes the emulator to tell its users about telemetry and give them a way to turn it off; a missing first-run notice or toggle breaks that obligation.
- Rejected: off by default - owner keeps upstream behavior [user].

### ASB-D13: Vendor pinning and drift detection

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): every vendor-dependent decision or limitation in the docs carries `**Vendor:** <submodule>@<sha12> (<tag>)`, and `tools/vendor-drift` compares a recorded commit with a newer one.
- Decision (Kai, 2026-11-15): drift output covers operation tier changes from both releases' `scores.json`, new or removed unsupported variants, issues moved from `issues/things-that-do-not-work/` to `issues/things-that-now-work/`, Smithy model changes of the 11 services, and the pack entries whose vendor line names a changed service.
- Decision (Kai, 2026-11-15): the vendor convention lives in this repo only; the baselinedocs skills are not changed for it.
- Decision (Kai, 2026-11-15): bump the pin on demand with a drift report; no scheduled CI drift job.
- Why: a decision or limitation must be traceable to the vendor commit it was judged against, and comparable with the latest commit [user]. Upstream moves fast: `v1.0.364` to `v1.0.382`, 18 releases in one day, changed 3298 files and touched 10 of the 11 services, so a raw diff is unreadable [agent].
- Evidence: `git fetch --depth 1 origin <sha>` of an older release commit into the shallow submodule, then `git diff` between the two commits, works; diff needs only the two trees.
- What breaks if ignored: a limitation stays documented after upstream fixed it, or a feature stays enabled after upstream broke it, with no way to tell which commit the claim came from.
- Rejected: changing the baselinedocs skills to carry a vendor field - not needed for this repo now [user].
- Rejected: tracking every upstream release - thousands of changed files per day [user].
- Rejected: weekly CI drift job opening an issue - not needed [user].

### ASB-D14: Running-version mismatch handling

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): when the running emulator's `aws-emulator -v` commit differs from the commit the capability matrix was built from, show a warning banner and keep using the pinned matrix.
- Why: the matrix comes from the submodule tag while the runtime comes from a downloaded package, and the two can differ [user].
- What breaks if ignored: green controls call operations the running version does not support, or red controls hide operations it does.
- Rejected: block the app until the image is rebuilt at the pinned version - too strict for a local tool [user].

### ASB-D15: Repository model and public hygiene

- Decision (Kai, 2026-11-15): this is a personal repository that will be public; the working branch is `main`; the baseline pack lives in this repository.
- Decision (Kai, 2026-11-15): tracked files, docs and commit messages carry no machine names, company names, company accounts or internal paths; machine-specific setups are described generically.
- Why: public visibility; a work-repository convention (empty `main`, semver release branches, packs kept out of the published repo) does not govern a personal repository [user].
- What breaks if ignored: host and employer information is published with the repository.
- Rejected: a private working repo plus a separate public repo - the work-repository convention does not apply here [user].
- Rejected: keeping `master` - owner chose `main` [user].

### ASB-D16: Submodule commit timing and path

- Decision (Kai, 2026-11-15): keep the submodules under `vendor/` (`vendor/aws-emulator`, `vendor/cloudscape-demos`).
- Decision (Kai, 2026-11-15): commit the submodules and the baseline pack before the Phase 0 scaffold, as separate commits; the scaffold is its own later commit. Supersedes the earlier choice to commit everything with the scaffold.
- Why: owner choice; the submodules are references for implementation, not build dependencies [user].
- What breaks if ignored: none beyond history shape; the toolchain gate is not tied to the submodule commits.
- Rejected: `references/` path - owner keeps `vendor/` [user].
- Rejected: one commit holding submodules, pack and scaffold - owner chose separate commits [user].

## Open questions

### ASB-Q1: Security baseline for keys, CA, endpoint and subprocesses

- Question: adopt this baseline for Phase 1 to Phase 7?
  - Emulator access keys stay in the Rust backend and never reach the WebView; they are never logged.
  - SDK clients use an explicit credentials provider built from the emulator's per-port files, never the default credential chain, plus an endpoint guard that refuses any host other than the emulator endpoint.
  - The emulator CA is trusted only inside the app's HTTP client, never imported into the OS certificate store.
  - Containers publish `127.0.0.1:<port>:<port>`, never `0.0.0.0`.
  - The WebView never fetches emulator URLs (S3 downloads, presigned URLs, function URLs); the backend proxies them and streams large files from file paths instead of IPC bytes.
  - The API Console spawns the AWS CLI with an argument array (no shell), removes `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` from its environment, and sets only the emulator variables.
  - Tauri capabilities are least-privilege with a strict CSP; the WebView gets no shell permission.
- Recommendation: adopt all; a default credential chain can sign with a real AWS profile and send local test traffic to real AWS.

### ASB-Q2: Pin only tags that have a matching LTS package

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Question: should the submodule pin be restricted to tags whose package `<tag>.1` exists in the LTS `versions.json`?
- Context: GitHub tag `v1.0.382` maps to LTS package `1.0.382.1`; the LTS stream lists 41 versions, so not every tag has a package. Pinned package URL pattern: `https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-<version>-1-x86_64.rpm`.
- Recommendation: yes; then the Docker image can be built at the pinned version and ASB-D14 mismatches only happen on user-built images.

### ASB-Q3: Default runtime provider on Linux

- Question: on Linux, is the Docker provider still the default, or the native RPM/DEB provider (the official primary path on Linux)?
- Recommendation: Docker by default on both platforms for one code path and a memory cap; native provider selectable.

### ASB-Q4: Code signing and updater signing timing

- Question: when to add Windows code signing and the Tauri updater signing key?
- Recommendation: unsigned builds until the packaging phase; the updater private key lives only in GitHub Actions secrets, never in the repository.
