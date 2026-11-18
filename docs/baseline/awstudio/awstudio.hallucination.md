---
baseline_schema: "3.0"
pack: "awstudio"
document: "hallucination"
status: "active"
updated: "2026-11-18"
code_ref: "b8c40c7"
---

# awstudio - decisions and open questions

Vendor-dependent entries carry a `**Vendor:**` line naming the vendor submodule commit the entry was judged against. When the pinned commit moves, `tools/vendor-drift` lists the entries whose vendor line names a changed service (see ASD-D13).

## Entry index

| ID | Subject | Status | Related |
|---|---|---|---|
| ASD-D1 | Product scope and name | closed | ASD-D2, ASD-D15 |
| ASD-D2 | Frontend stack: React 18 + Cloudscape | closed | ASD-D1, ASD-D3 |
| ASD-D3 | Console-parity reference sources | closed | ASD-D2 |
| ASD-D4 | Emulator runtime providers | closed | ASD-D5, ASD-D7, ASD-Q3 |
| ASD-D5 | Embedded mode deferred | closed | ASD-D4 |
| ASD-D6 | Per-machine build toolchain profiles | closed | ASD-D7, ASD-D15, ASD-D20, ASD-Q5 |
| ASD-D7 | Target platforms: Windows with Docker first, Linux deferred | closed | ASD-D4, ASD-D6, ASD-Q3 |
| ASD-D8 | Service scope and generic API Console | closed | ASD-D9 |
| ASD-D9 | Capability tiers and UI gating | closed, reversed in part by ASD-D32, ASD-D35 and ASD-D38 | ASD-D8, ASD-D10, ASD-D11, ASD-D32, ASD-D35, ASD-D38 |
| ASD-D10 | Lambda Code tab is functional | closed | ASD-D9, ASD-D11 |
| ASD-D11 | Lesson: branch-level not_implemented read as whole-operation gaps | lesson | ASD-D9, ASD-D10 |
| ASD-D12 | Emulator telemetry default | closed | - |
| ASD-D13 | Vendor pinning and drift detection | closed | ASD-D14, ASD-D16, ASD-D18 |
| ASD-D14 | Running-version mismatch handling | closed | ASD-D13, ASD-D18 |
| ASD-D15 | Repository model and public hygiene | closed | ASD-D6, ASD-D16 |
| ASD-D16 | Submodule commit timing and path | closed | ASD-D13, ASD-D15 |
| ASD-D17 | Security baseline for keys, CA, endpoint and subprocesses | closed | ASD-D4, ASD-D8, ASD-Q1 |
| ASD-D18 | Pin only tags that have a matching LTS package | closed | ASD-D13, ASD-D14, ASD-Q2 |
| ASD-D19 | Code signing and updater signing timing | closed | ASD-D7, ASD-Q4 |
| ASD-D20 | Lesson: windows-gnu target fails with llvm-mingw, gnullvm builds | lesson | ASD-D6, ASD-D7 |
| ASD-D21 | Lesson: gnupg2-minimal cannot verify the package signature in the image build | lesson | ASD-D4, ASD-D18 |
| ASD-D22 | External agent skills tauri-v2 and modern-web-guidance not adopted | closed | ASD-D2, ASD-D17, ASD-D20 |
| ASD-D23 | Lesson: test binaries linking the Tauri runtime fail to load on Windows | lesson | ASD-D20 |
| ASD-D24 | Default container memory limit stays at the upstream 2g | closed | ASD-D4, ASD-Q6 |
| ASD-D25 | Lesson: a capture-phase hashchange listener on window does not run before earlier listeners | lesson | ASD-D3 |
| ASD-D26 | Capability matrix service key is the SDK id slug | closed | ASD-D9, ASD-D13, ASD-Q8 |
| ASD-D27 | Capability matrix covers every modeled service | closed | ASD-D8, ASD-D9, ASD-Q9 |
| ASD-D28 | Phase 3 acceptance accepted on the development gallery, repeated on the Phase 4 pages | closed | ASD-D9, ASD-Q10 |
| ASD-D29 | Lesson: the create form's submit button sent each request twice | lesson | ASD-D3, ASD-D28 |
| ASD-D30 | Lesson: specta refuses to export serde_json::Value to the bindings | lesson | ASD-D23 |
| ASD-D31 | S3 transfer acceptance sized to the emulator's 64 MiB per-bucket limit | closed | ASD-D18, ASD-Q11 |
| ASD-D32 | A yellow primary read loads its page under a partly supported banner | closed | ASD-D9, ASD-D28, ASD-Q12 |
| ASD-D33 | Lesson: Lambda refuses a second update while the first is still running | lesson | ASD-D9 |
| ASD-D34 | Lambda list shows every function with a Region column | closed | ASD-D9, ASD-D32, ASD-Q13 |
| ASD-D35 | Create access key and Edit function configuration are enabled although partly supported | closed | ASD-D9, ASD-D32, ASD-Q14 |
| ASD-D36 | Lesson: EventBridge delivers to an SQS target only when the queue policy grants events.amazonaws.com | lesson | ASD-D9, ASD-D38 |
| ASD-D37 | Lesson: CreatePatchBaseline needs approved patches or approval rules | lesson | ASD-D9 |
| ASD-D38 | PutTargets, ListAliases, StartQuery and GetQueryResults are enabled although partly supported | closed | ASD-D9, ASD-D35, ASD-D36, ASD-Q15, ASD-Q16, ASD-Q17 |
| ASD-D39 | ListQueues stays disabled outside the SQS pages | closed | ASD-D9, ASD-D32, ASD-D35, ASD-Q18 |
| ASD-D40 | Lesson: a busy status poll read as a stop and a start looped the version check | lesson | ASD-D14 |
| ASD-Q7 | Native provider install source: no DEB package URL known | open, deferred | ASD-D4, ASD-D7 |

## Closed decisions

### ASD-D1: Product scope and name

- Decision (Kai, 2026-11-15): build `awstudio` (display name AWStudio), a Tauri v2 desktop app that gives aws/aws-emulator the same experience as the AWS Management Console, locally.
- Why: the emulator has no graphical interface; only an HTTPS endpoint and `GET /__admin/health` exist [user].
- What breaks if ignored: the name contains the AWS trademark; without a README line stating the project is not affiliated with AWS, the public repo can be read as an official AWS product.
- Rejected: `Cumulocal` (neutral, no "aws" in the name) - owner preferred the aws wordplay style [user].
- Rejected: `awshore` - owner picked another name from the shortlist [user].
- Rejected: `awsandbox` (the first name chosen from the shortlist) - owner renamed the product to AWStudio on 2026-11-15 [user].

### ASD-D2: Frontend stack: React 18 + Cloudscape

- Decision (Kai, 2026-11-15): React 18 + TypeScript + Vite with Cloudscape (`@cloudscape-design/components`, `global-styles`, `collection-hooks`, `board-components`) to mimic the AWS Console completely.
- Why: Cloudscape is the design system the AWS Console is built with, Apache-2.0 [user]; the reference demos pin React 18 [agent].
- What breaks if ignored: a generic component kit cannot reproduce console layout, tables, wizards and flashbars, and the parity goal of ASD-D1 fails.
- Rejected: Svelte - no Cloudscape implementation [user].
- Rejected: React + shadcn/ui - does not look or behave like the console [user].

### ASD-D3: Console-parity reference sources

- Decision (Kai, 2026-11-15): use cloudscape-design/demos (submodule `vendor/cloudscape-demos`) as the first reference for console page patterns; owner screenshots of the real console are the fallback.
- Why: the demos are the official console page patterns (tables, details tabs, wizard, delete confirmations, manage tags, S3 pickers, dashboards) [user].
- What breaks if ignored: pages built from memory drift from real console behavior and parity cannot be checked.
- Rejected: screenshots first - slower, and needs manual capture per page [user].

### ASD-D4: Emulator runtime providers

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): a Docker provider driven through the `docker` CLI is primary; a native RPM/DEB provider (in WSL on Windows) is optional; an attach provider connects to an already running endpoint.
- Why: on Windows and macOS the only supported path is a container built from the AWS RPM; building from source is supported on Linux only and needs about 100 GB for `target/` [user].
- Why the CLI: a `docker` command can be a shim into a WSL2 distro whose engine socket is unreachable from Windows, and the CLI works the same with that shim, Docker Desktop, Rancher and Podman [user].
- What breaks if ignored: an Engine API client cannot reach a WSL-hosted engine, and Windows host paths in `-v` fail unless translated to `/mnt/<drive>/...`.
- Rejected: bollard (Docker Engine API) - cannot reach the engine behind a WSL shim [user].
- Rejected: building the emulator from source - Linux-only and about 100 GB [user].

### ASD-D5: Embedded mode deferred

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): defer an embedded-mode provider (`aws-emulator-embedded` linked into the Tauri backend) until after the packaging phase.
- Why: it compiles all 437 service crates into the app and building on Windows is not supported upstream [user].
- What breaks if ignored: the first build costs about 100 GB and hours of compile before any UI exists.

### ASD-D6: Per-machine build toolchain profiles

- Decision (Kai, 2026-11-15): the build toolchain is chosen per machine by machine name through `machines/<name>.toml`, read by `scripts/dev.ps1` and `scripts/build.ps1`; only `machines/_default.toml` (MSVC) is committed and every other profile is gitignored.
Closes ASD-Q5.

- Decision (Kai, 2026-11-15): a machine without MSVC Build Tools uses the `stable-x86_64-pc-windows-gnullvm` toolchain with a per-user llvm-mingw; `cargo-xwin` is the fallback when that toolchain fails to build.
- Why: one machine cannot install MSVC Build Tools without elevation; others can use MSVC [user]. Profile files named after machines would leak host names in a public repo [user].
- What breaks if ignored: pinning a target in `rust-toolchain.toml` or `.cargo/config.toml` forces it on every machine; committing profiles publishes host names.
- Rejected: MSVC Build Tools on every machine - needs elevation on at least one machine [user].
- Rejected: committing every machine profile - leaks machine information [user].
- Rejected: the `x86_64-pc-windows-gnu` target - does not link with llvm-mingw, which ships no `libgcc` or `libgcc_eh` (ASD-D20) [user].
- Note: Tauri states it "officially only supports the MSVC Windows target"; the `gnullvm` route built the Tauri skeleton and the SDK TLS stack in Phase 0, and a running emulator has not yet been exercised through it [agent].

### ASD-D7: Target platforms: Windows with Docker first, Linux deferred

Closes ASD-Q3.

- Decision (Kai, 2026-11-15): concentrate on Windows with the Docker provider; Linux support is deferred because it uses a different approach.
- Why: the owner treats Linux (native RPM/DEB as the official path) as a separate approach to design later [user].
- What breaks if ignored: Linux CI, a POSIX dev script, native Linux provider work and AppImage or DEB packaging are built before the Windows path works.
- Rejected: Windows and Linux from the start - owner defers Linux entirely [user].
- Rejected: Docker by default on both platforms - owner defers Linux entirely [user].
- Rejected: native RPM/DEB as the Linux default now - Linux is deferred [user].
- Note: the native provider inside WSL (ASD-D4) and the attach provider stay in scope as Windows options [agent].

### ASD-D8: Service scope and generic API Console

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): build dedicated console-parity UI for 11 services: S3, DynamoDB, SQS, SNS, IAM, Lambda, Secrets Manager, SSM, KMS, CloudWatch Logs, EventBridge.
- Decision (Kai, 2026-11-15): SSM covers every console area the emulator supports, not only Parameter Store.
- Decision (Kai, 2026-11-15): every other service is reached through a generic API Console whose forms come from the vendor Smithy models and whose calls run the AWS CLI as a subprocess.
- Why: the 11 services are the common local-dev set; the emulator models 437 services, too many for dedicated pages [user].
- What breaks if ignored: dedicated pages for every service never finish; without the API Console the other 426 services are unreachable from the app.
- Rejected: Parameter Store only for SSM - owner wants as much as the emulator supports [user].
- Rejected: native Smithy serialization + SigV4 signing for the API Console - five wire protocols to implement before the first call works [user].

### ASD-D9: Capability tiers and UI gating

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

### ASD-D10: Lambda Code tab is functional

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): the Lambda Code tab edits and deploys code; only the `PublishTo` option is disabled.
- Why: `UpdateFunctionCode` passes 9/10 scored steps and returns 501 only when `PublishTo` is set [user].
- What breaks if ignored: a read-only Code tab removes a working console feature.
- Rejected: read-only Code tab - based on the misreading recorded in ASD-D11 [user].
- Rejected: delete and recreate the function to change code - loses configuration and triggers [user].

### ASD-D11: Lesson: branch-level not_implemented read as whole-operation gaps

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Believed: Lambda `UpdateFunctionCode`, `PublishVersion`, `CreateAlias`, KMS `Encrypt`/`Decrypt`, DynamoDB `CreateTable` and SNS `Publish` return 501.
- Why it looked reasonable: a grep for `not_implemented(` in each `src/ops/<op>.rs` matched those files.
- What disproved it: the calls sit inside branches (for example `if let Some(publish_to) = input.publish_to` in `update_function_code.rs`); scores show `UpdateFunctionCode` 9/10, `PublishVersion` 29/34, `CreateAlias` 19/19, `Encrypt` 3/3, `Decrypt` 2/2, `CreateTable` 443/483; SNS `Publish` refuses only phone numbers and platform endpoints.
- Fix: capability generation reads the `not_implemented` message as an unsupported variant of the operation and takes the tier from scores (ASD-D9).

### ASD-D12: Emulator telemetry default

- Decision (Kai, 2026-11-15): keep emulator telemetry on by default, as upstream ships it.
- Why: owner choice [user].
- What breaks if ignored: upstream README asks a tool that includes the emulator to tell its users about telemetry and give them a way to turn it off; a missing first-run notice or toggle breaks that obligation.
- Rejected: off by default - owner keeps upstream behavior [user].

### ASD-D13: Vendor pinning and drift detection

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

### ASD-D14: Running-version mismatch handling

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): when the running emulator's `aws-emulator -v` commit differs from the commit the capability matrix was built from, show a warning banner and keep using the pinned matrix.
- Why: the matrix comes from the submodule tag while the runtime comes from a downloaded package, and the two can differ [user].
- What breaks if ignored: green controls call operations the running version does not support, or red controls hide operations it does.
- Rejected: block the app until the image is rebuilt at the pinned version - too strict for a local tool [user].

### ASD-D15: Repository model and public hygiene

- Decision (Kai, 2026-11-15): this is a personal repository that will be public; the working branch is `main`; the baseline pack lives in this repository.
- Decision (Kai, 2026-11-15): tracked files, docs and commit messages carry no machine names, company names, company accounts or internal paths; machine-specific setups are described generically.
- Why: public visibility; a work-repository convention (empty `main`, semver release branches, packs kept out of the published repo) does not govern a personal repository [user].
- What breaks if ignored: host and employer information is published with the repository.
- Rejected: a private working repo plus a separate public repo - the work-repository convention does not apply here [user].
- Rejected: keeping `master` - owner chose `main` [user].

### ASD-D16: Submodule commit timing and path

- Decision (Kai, 2026-11-15): keep the submodules under `vendor/` (`vendor/aws-emulator`, `vendor/cloudscape-demos`).
- Decision (Kai, 2026-11-15): commit the submodules and the baseline pack before the Phase 0 scaffold, as separate commits; the scaffold is its own later commit.
- Why: owner choice; the submodules are references for implementation, not build dependencies [user].
- What breaks if ignored: none beyond history shape; the toolchain gate is not tied to the submodule commits.
- Rejected: `references/` path - owner keeps `vendor/` [user].
- Rejected: one commit holding submodules, pack and scaffold - owner chose separate commits [user].

### ASD-D17: Security baseline for keys, CA, endpoint and subprocesses

Closes ASD-Q1.

- Decision (Kai, 2026-11-15): adopt the whole baseline for Phase 1 to Phase 7.
  - Emulator access keys stay in the Rust backend and never reach the WebView; they are never logged.
  - SDK clients use an explicit credentials provider built from the emulator's per-port files, never the default credential chain, plus an endpoint guard that refuses any host other than the emulator endpoint.
  - The emulator CA is trusted only inside the app's HTTP client, never imported into the OS certificate store.
  - Containers publish `127.0.0.1:<port>:<port>`, never `0.0.0.0`.
  - The WebView never fetches emulator URLs (S3 downloads, presigned URLs, function URLs); the backend proxies them and streams large files from file paths instead of IPC bytes.
  - The API Console spawns the AWS CLI with an argument array (no shell), removes `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` from its environment, and sets only the emulator variables.
  - Tauri capabilities are least-privilege with a strict CSP; the WebView gets no shell permission.
- Why: a default credential chain can sign with a real AWS profile and send local test traffic to real AWS [user].
- What breaks if ignored: test traffic and real credentials cross the local-to-AWS boundary; emulator keys or the CA leak into the WebView or the OS trust store.

### ASD-D18: Pin only tags that have a matching LTS package

Closes ASD-Q2.

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Decision (Kai, 2026-11-15): pin the aws-emulator submodule only at tags whose package `<tag>.1` exists in the LTS `versions.json`.
- Why: GitHub tag `v1.0.382` maps to LTS package `1.0.382.1`, and the LTS stream lists 41 versions, so not every tag has a package; pinned package URL pattern `https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-<version>-1-x86_64.rpm`; the Docker image can then be built at the pinned version and the ASD-D14 mismatch only happens on user-built images [user].
- What breaks if ignored: a pin with no package leaves the app unable to build an image at the pinned version, so the capability matrix and the running emulator differ.

### ASD-D19: Code signing and updater signing timing

Closes ASD-Q4.

- Decision (Kai, 2026-11-15): ship unsigned builds until the packaging phase; the Tauri updater private key lives only in GitHub Actions secrets, never in the repository.
- Why: no release exists before packaging, and a key in the repository is in history for good [user].
- What breaks if ignored: an updater private key committed to the public repository lets anyone sign updates.

### ASD-D20: Lesson: windows-gnu target fails with llvm-mingw, gnullvm builds

- Believed: on a machine without MSVC Build Tools, `rustup target add x86_64-pc-windows-gnu` plus a per-user llvm-mingw is enough to build Tauri and the SDK (ASD-D6, Phase 0 task 2).
- Why it looked reasonable: the target installs, llvm-mingw ships `x86_64-w64-mingw32-gcc`, and a build with `CARGO_BUILD_TARGET` set starts compiling.
- What disproved it: with the MSVC host toolchain, build scripts and proc macros still link for the host and fail with `link.exe` not found; with the GNU host toolchain the link fails with `unable to find library -lgcc_eh` and `-lgcc`, which llvm-mingw does not ship (it uses compiler-rt and libunwind); a `cdylib` crate type then failed with `too many exported symbols (got 90650, max 65535)`.
- Fix: `x86_64-pc-windows-gnullvm` as the host toolchain (`stable-x86_64-pc-windows-gnullvm`, exported as `RUSTUP_TOOLCHAIN` from the machine file) with llvm-mingw `bin` on `PATH`; `crate-type = ["rlib"]` because the desktop app needs neither `staticlib` nor `cdylib`. The Tauri skeleton, `aws-sdk-sts` and the aws-lc-rs TLS stack then build, so neither `cargo-xwin` nor the `rustls-ring` feature was needed.

### ASD-D21: Lesson: gnupg2-minimal cannot verify the package signature in the image build

- Believed: the Dockerfile verify stage can install `gnupg2-minimal` on `amazonlinux:2023` and run `gpg --import` then `gpg --verify` (ASD-D4 Phase 1 task 2, signature check on the pinned package).
- Why it looked reasonable: the minimal package provides `/usr/bin/gpg`, `gpg --import` printed `imported: 1`, and the AWS guide only says "you need GnuPG (gpg)".
- What disproved it: `gnupg2-minimal` ships no `gpg-agent`, so the import exits 2 (`can't connect to the gpg-agent: Configuration error`) and the `&&` chain stops before the fingerprint and signature checks; the build failed on the first run.
- Fix: `dnf install -y --allowerasing gnupg2-full`. The build then checks the key fingerprint `98BCF336A3BE53B734E967C52E5BF49BD940F624` and the detached `.sig`, and a build with a wrong fingerprint fails at that step (exit 1, no image produced). The rpm URL is `.../LTS/aws-emulator-<version>-1-x86_64.rpm`, not `<version>.1`. [agent]

### ASD-D22: External agent skills tauri-v2 and modern-web-guidance not adopted

- Decision (Kai, 2026-11-15): install neither the `tauri-v2` skill (nodnarbnitram/claude-code-extensions) nor the `modern-web-guidance` skill (GoogleChrome/modern-web-guidance) for this project; work from the official Tauri v2 and Cloudscape documentation and the closed decisions in this pack.
- Why: the user judged them unsuitable for this workflow [user].
- Why, agent's reading of both skills, not confirmed by the user: `tauri-v2` requires `crate-type = ["staticlib", "cdylib", "rlib"]` for mobile, which fails on the gnullvm toolchain (ASD-D20), lists `tauri-plugin-shell` as a normal plugin where ASD-D17 gives the WebView no shell permission, and was last verified 2026-04-02 against Tauri 2.12.4 pinned here; `modern-web-guidance` steers toward native HTML and CSS components where ASD-D2 fixes Cloudscape, and runs `npx -y modern-web-guidance@latest` so its content is unpinned [agent].
- What breaks if ignored: a skill applied without those overrides pushes `cdylib` into `Cargo.toml` (link failure with 90650 exported symbols against a limit of 65535), a shell plugin into the capability file, or hand-built dialogs and selects beside Cloudscape ones.
- Rejected: install `tauri-v2` project-scoped with override notes - the user declined [user].
- Rejected: defer `modern-web-guidance` to the console-shell phase - the user declined it together with the other skill [user].

### ASD-D23: Lesson: test binaries linking the Tauri runtime fail to load on Windows

- Believed: a unit test in the library crate can build the tauri-specta command registry (`Builder::<tauri::Wry>` with `collect_commands!`) and export `src/bindings.ts`, as the Phase 1 unit tests already linked `tauri` through `commands.rs`.
- Why it looked reasonable: `cargo check --lib --tests` passed and the Phase 1 tests that use `tauri::State` ran.
- What disproved it: `cargo test --lib` exited `-1073741511` (`STATUS_ENTRYPOINT_NOT_FOUND`) before any test ran. The registry pulls in the wry and tao window code, the test exe imports `comctl32.dll` and carries no resources; `TaskDialogIndirect` exists only in Common Controls v6, which needs the manifest that tauri-build links into binaries only (`cargo:rustc-link-arg-bins=...libresource.a`). Emitting `cargo:rustc-link-arg-tests` for the same resource did not reach the library's unit-test exe.
- Fix: `build.rs` emits `cargo:rustc-link-arg-tests` for `libresource.a` (GNU family) or `resource.lib` (MSVC), which integration tests receive, and the bindings export runs in the integration test `tests/bindings.rs`. Library unit tests stay free of the registry. [agent]

### ASD-D24: Default container memory limit stays at the upstream 2g

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q6.

- Decision (Kai, 2026-11-15): the Docker provider's default `--memory` stays `2g`, the value of the upstream Docker guide; the user can change it in the Provider settings.
- Why: keep upstream behavior [user]; idle use measured about 180 MiB (`docker stats`, 3 samples, version 1.0.382, `--telemetry off`), so `2g` is about 11 times idle [agent].
- What breaks if ignored: a container over its limit exits 137 and every emulated resource is lost.
- Rejected: `1g` (about 5.5 times idle, smaller footprint) - not measured under load, and the owner keeps the upstream value [user].

### ASD-D25: Lesson: a capture-phase hashchange listener on window does not run before earlier listeners

- Believed: `useUnsavedChanges` could hold a hash change on a dirty form with its own `window` `hashchange` listener registered with `{ capture: true }`, calling `stopImmediatePropagation()` and restoring the hash before the router's `useLocation` listener rendered the other route (Phase 3 task 6).
- Why it looked reasonable: capture listeners run before bubble listeners on ancestors, and the listener was registered and reached.
- What disproved it: `hashchange` is dispatched at `window` itself, and at the target listeners fire in registration order whatever their capture flag. Measured in headless Edge 157: an earlier bubble listener ran before a later capture listener. The router's listener mounts before the form's, so the route changed first; repro `#/dev/patterns/create`, type a name, `location.hash = "#/"` ended on `#/` with no Leave page modal.
- Fix: the router registers one capture listener when its module loads, ahead of every component listener, and exposes `setNavigationGuard`; the hook installs a guard that returns true to hold the change, and the router restores `e.oldURL`'s hash and stops the event. The same probe now stays on `#/dev/patterns/create` with the modal shown; with the old files it fails. [agent]

### ASD-D26: Capability matrix service key is the SDK id slug

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q8.

- Decision (Kai, 2026-11-15): a service in `capability.json` and in control ids (`<service key>:<Operation>`, for example `lambda:UpdateFunctionCode`) is keyed by its SDK id slug (`cloudwatch-logs`, `secrets-manager`, `eventbridge`); the EventBridge pages use `eventbridge`.
- Why: the SDK id is unique per model in this pin (436 keys for 436 models) [agent]; the owner kept the implemented key [user].
- What breaks if ignored: keying by endpoint prefix merges distinct services into one key: `lambda` would hold lambda, lambdacore, lambdamicrovms and lambdaweb (129 operations instead of 88), `rds` would hold rds, docdb and neptune, `email` would hold ses, sesv2 and pinpointemail, so a page gates on another service's tiers.
- Note: EventBridge has two keys in this pin: `eventbridge` (53 green of 57) and `cloudwatch-events` (7 green of 51) [agent].
- Rejected: endpoint prefix (`logs`, `secretsmanager`, `events`, IAM-style) - merges the services above [user].

### ASD-D27: Capability matrix covers every modeled service

Closes ASD-Q9.

- Decision (Kai, 2026-11-15): `capability.json` covers every modeled service, not only the 11 with console pages.
- Why: the Phase 7 API Console and fidelity catalog need the same data, so one generator output serves both [user]. Cost measured: 1.36 MB (21637 lines), a 1176.54 kB frontend chunk loaded through a dynamic import [agent].
- What breaks if ignored: a matrix of the 11 alone leaves Phase 7 without tiers for the other services and needs a second generator output.
- Rejected: the 11 services now and a second generator output in Phase 7 - two outputs of one generator to keep in step [user].

### ASD-D28: Phase 3 acceptance accepted on the development gallery, repeated on the Phase 4 pages

Closes ASD-Q10.

- Decision (Kai, 2026-11-15): the Phase 3 acceptance (UI-only page with empty table, banner and disabled actions; green control calls the backend; red control disabled with its reason), checked on the development-only fixture gallery `#/dev/patterns/<pattern>`, is enough to close Phase 3; the same acceptance is repeated on the first real service pages in Phase 4.
- Why: no service page exists until Phase 4; the gallery is excluded from release builds and binds fixture rows to real matrix operations [agent]; owner accepted [user].
- What breaks if ignored: without the repeat in Phase 4, the gating is proven only on fixtures and a real page could ship with a control gated wrong.
- Rejected: build one real UI-only page now (for example SSM Maintenance Windows, red) ahead of Phase 6 - pulls Phase 6 work forward [user].

### ASD-D29: Lesson: the create form's submit button sent each request twice

- Believed: `CreateForm` (Phase 3 task 6) submits once: the primary `GatedButton` called `submit()` from its `onClick`, and the `<form onSubmit>` was there only so Enter in a field submits.
- Why it looked reasonable: the gallery's `onSubmit` was a no-op, so a second call left no trace, and the Phase 3 checks (validation, Leave page modal, navigation after submit) all passed.
- What disproved it: a Cloudscape `Button` without `formAction="none"` is a native submit button, so one click ran `onClick` and the form's submit event. Observed in Phase 4 against the running emulator: one Publish message click put two copies in a subscribed queue; the queue had one subscription.
- Fix: the primary button has no `onClick` and the form's submit event is the only path; an in-flight ref drops a second submit; `submit` also returns early when the form's own gate is not enabled, because a gated button is only `aria-disabled` and Enter still submits. After the fix one click left exactly one message and one subscription. [agent]

### ASD-D30: Lesson: specta refuses to export serde_json::Value to the bindings

- Believed: DynamoDB items can cross IPC as `serde_json::Value` once specta's `serde_json` feature is on (Phase 4 backend).
- Why it looked reasonable: the feature makes `Value` implement `specta::Type`, and `cargo build` passed.
- What disproved it: `cargo test --test bindings` failed with "Specta forbids exporting BigInt-style types (usize, isize, i64, u64, i128, u128)", because `Value::Number` holds an `i64` that TypeScript `number` cannot hold losslessly.
- Fix: a `Json(serde_json::Value)` newtype with `#[serde(transparent)]` whose `specta::Type` returns `specta_typescript::Unknown`, so the bindings type is `unknown`; the `serde_json` feature was removed again. DynamoDB numbers travel as strings inside DynamoDB JSON, so no precision is lost. [agent]

### ASD-D31: S3 transfer acceptance sized to the emulator's 64 MiB per-bucket limit

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q11.

- Decision (Kai, 2026-11-15): the Phase 4 S3 transfer acceptance is a multipart upload and download through the backend of a file that fits the emulator's per-bucket limit, 60 MiB (8 parts of 8 MiB), in place of "at least 100 MB".
- Decision (Kai, 2026-11-15): the upload notice explains the per-bucket limit when the emulator refuses a part or an object for it.
- Why: `services/service-com-amazonaws-s3-amazons3/src/state.rs` sets `MAX_OBJECT_BYTES_PER_BUCKET = 64 * 1024 * 1024` (also `MAX_OBJECTS_PER_BUCKET = 1_000`, `MAX_OBJECTS_TOTAL = 10_000`) as compile-time constants with no flag or environment variable, and parts of an upload in flight count against it; a 120 MiB upload failed at part 8 with ValidationException "past the 67108864 bytes this emulator keeps per bucket", while 60 MiB uploaded and downloaded intact; the 8 MiB part streaming is the evidence the size stood for [agent]; owner chose it [user].
- What breaks if ignored: the acceptance is unreachable on v1.0.382 and Phase 4 cannot close; without the notice hint a user who hits the limit reads a bare ValidationException with no next step.
- Rejected: (b) keep 100 MB and leave the item open until upstream raises the limit - blocks the phase on an upstream change with no date [user].
- Rejected: (c) replace the size with a memory bound on the app process during a transfer - measures memory use, not whether the transfer works [user].

### ASD-D32: A yellow primary read loads its page under a partly supported banner

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q12. Reverses in part ASD-D9 (its rule that a page whose primary read is not green is UI-only); the rest of ASD-D9 stands.

- Decision (Kai, 2026-11-15): a page, or a section with its own primary read, is UI-only only when its primary read operation is red or not judged yet; a yellow primary read loads data under a "Partly supported by AWS Emulator vX" banner and that read may run, while every other yellow control stays disabled.
- Why: the partial tiers of these reads come from edge cases the pages do not use (SQS `ListQueues` 2/7 fails on body-shape and pagination steps; the plain listing worked in Phase 2), while keeping them UI-only hid working green actions [agent]; owner chose it [user].
- What breaks if ignored: SQS Queues (`ListQueues`), Explore items (`Scan` 222/287), SNS Subscriptions and a queue's SNS subscriptions tab (`ListSubscriptions` 2/4), dead-letter source queues (`ListDeadLetterSourceQueues` 4/6) and S3 Default encryption (`GetBucketEncryption` 5/32) load nothing, and Create queue, whose only entry is on the Queues page, is unreachable, so queues are reachable only by URL or from an SNS subscription.
- Consequence: only the scope's own primary read runs, so Query in Explore items (yellow, 197/260) stays disabled, and the SNS Dashboard subscription count stays "-" because `ListSubscriptions` is not that page's primary read [agent].
- Rejected: (a) keep ASD-D9 as is - hides working green actions such as Create queue [user].
- Rejected: (c) keep the rule and add a Create queue entry outside the Queues page - fixes one action and leaves the yellow-read pages empty [user].

### ASD-D33: Lesson: Lambda refuses a second update while the first is still running

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Believed: after `CreateFunction`, `UpdateFunctionCode` or `UpdateFunctionConfiguration` returns, the function can be invoked, updated again or published at once (Phase 5 Code and Test tabs).
- Why it looked reasonable: each call answers 200 with the new configuration, and the first backend probe created a function and read it back without trouble.
- What disproved it: `CreateFunction` answers `State` `Pending` and an `Invoke` sent at once got HTTP 409 `ResourceConflictException` "currently in the following state: Pending"; `UpdateFunctionCode` answers `LastUpdateStatus` `InProgress` and the next `UpdateFunctionCode` or `UpdateFunctionConfiguration` got 409 "An update is in progress"; `ListFunctions` carries no `State`.
- Fix: the backend `wait_ready` polls `GetFunctionConfiguration` every 500 ms for up to 40 s until the function is not `Pending` and its last update is not `InProgress`; deploy, configuration update and publish call it first, `Invoke` retries once after a 409 and waits, and the details page polls while the function is busy. The list has no State column. After the fix the same sequence passed. [agent]

### ASD-D34: Lambda list shows every function with a Region column

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q13.

- Decision (Kai, 2026-11-16): the Lambda function list shows every function the emulator holds, whatever Region the region selector names, with a Region column read from each function ARN; the help panel says the emulator keeps one function namespace for every Region.
- Why: a function created in `us-east-1` is listed, fetched and invoked from `eu-west-1` and `ap-southeast-2`, its ARN names `us-east-1`, and the same name in `eu-west-1` fails with `ResourceConflictException` "Function already exist"; the list shows what the emulator holds and explains the clash, while SQS, SNS, DynamoDB and S3 stay partitioned by Region [agent]; owner chose it [user].
- What breaks if ignored: a list filtered to the selected Region hides a function that still blocks its name, so creating that name in another Region fails while the list looks empty.
- Rejected: filter to the functions whose ARN names the selected Region - hides the function behind a name clash [agent].
- Rejected: pin the Lambda pages to one Region - drops the region selector for one service and still leaves the namespace shared [agent].

### ASD-D35: Create access key and Edit function configuration are enabled although partly supported

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q14. Reverses in part ASD-D9 (its rule that yellow operations are non-functional); the rest of ASD-D9 and ASD-D32 stand.

- Decision (Kai, 2026-11-16): `iam:CreateAccessKey` (2 of 3 conformance steps) and `lambda:UpdateFunctionConfiguration` (25 of 37) are enabled, through a list of enabled yellow operations in `src/capability/index.tsx`; every other yellow control stays disabled.
- Why: each blocks the main flow of its page (access keys on a user, configuration of a function), and each worked when called against the emulator: an access key was created, shown once, deactivated and listed; description, handler, memory, timeout and environment of a function were changed from the page [agent]; owner chose it [user].
- What breaks if ignored: a user cannot create an access key or edit a function's configuration from the app although the emulator accepts both; if the list grows without a probe, a partly supported operation can fail on input the probe did not try, and the failure shows as an error in the Flashbar.
- Rejected: keep ASD-D9 as it is - leaves two working flows disabled [agent].
- Rejected: enable every yellow control that works when called - each needs its own probe, and an unprobed one can misbehave [agent].

### ASD-D36: Lesson: EventBridge delivers to an SQS target only when the queue policy grants events.amazonaws.com

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Believed: PutRule, PutTargets with an SQS queue ARN and PutEvents are enough for a matching event to reach the queue (Phase 6 acceptance).
- Why it looked reasonable: PutTargets and PutEvents both answered success with no failed entry, the rule matched the event (`TestEventPattern` true) and the target was listed.
- What disproved it: an event sent with PutEvents left the queue empty (ReceiveMessage with a 3 s wait returned no message); after the queue policy gained a statement allowing `events.amazonaws.com` `SQS:SendMessage`, the next event arrived with the full event JSON. SNS behaves the same (Phase 4).
- Fix: before PutTargets for an SQS target the pages add that statement to the queue policy, with `aws:SourceArn` equal to the rule ARN and the other statements kept; with the grant, a rule created from the wizard and an event from Send events put a message on the queue that the SQS Send and receive page listed. [agent]

### ASD-D37: Lesson: CreatePatchBaseline needs approved patches or approval rules

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Believed: a patch baseline can be created from a name, an operating system and an optional description (Phase 6 Patch Manager form).
- Why it looked reasonable: the AWS API marks only the name as required and the SDK builder accepted the request.
- What disproved it: the emulator answered ValidationException "Patch Baseline attribute: Approved Patches and Approval Rule, at least one must be non empty."
- Fix: `ssm_create_patch_baseline` takes `approved_patches` and the form requires at least one line; with one approved patch the baseline was created. [agent]

### ASD-D38: PutTargets, ListAliases, StartQuery and GetQueryResults are enabled although partly supported

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q15, ASD-Q16 and ASD-Q17. Reverses in part ASD-D9 (its rule that yellow operations are non-functional); the rest of ASD-D9, ASD-D32 and ASD-D35 stand.

- Decision (Kai, 2026-11-16): `eventbridge:PutTargets` (36 of 49 conformance steps), `kms:ListAliases` (6 of 9), `cloudwatch-logs:StartQuery` (13 of 17) and `cloudwatch-logs:GetQueryResults` (2 of 3) are enabled through the list of enabled yellow operations in `src/capability/index.tsx`; every other yellow control stays disabled.
- Why: each blocks the main flow of its page (a rule's targets, a key's aliases, a Logs Insights query) and each worked when called against the emulator: a rule got an SQS target and a matching event reached the queue, a key's alias was listed, and an Insights query over two log events returned both rows with status Complete [agent]; owner chose it [user].
- What breaks if ignored: without PutTargets a rule gets no target from the app and the Phase 6 acceptance (a rule targeting an SQS queue delivers an event visible on the SQS page) is unreachable from the UI; without ListAliases the Aliases tab cannot list and Create alias makes names the user cannot see again; without StartQuery and GetQueryResults Logs Insights is view-only. If the list grows without a probe, a partly supported operation can fail on input the probe did not try, and the failure shows as an error in the Flashbar.
- Rejected: keep the four disabled - leaves three working flows disabled and the acceptance unreachable [user].

### ASD-D39: ListQueues stays disabled outside the SQS pages

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

Closes ASD-Q18.

- Decision (Kai, 2026-11-16): `sqs:ListQueues` (2 of 7 conformance steps) is not added to the list of enabled yellow operations; the EventBridge target form takes the queue ARN typed, and the SQS Queues page keeps loading the list under the partly supported banner (ASD-D32).
- Why: the plain listing worked on the SQS page, but its failing steps (body shape, pagination) were not probed outside that page [agent]; owner accepted the recommendation [user].
- What breaks if ignored: enabling it everywhere lets a partly supported read run on any page without a probe of how it fails there.
- Rejected: enable ListQueues so the target form can offer a queue picker - the failing steps are unprobed outside the SQS page [user].

### ASD-D40: Lesson: a busy status poll read as a stop and a start looped the version check

- Believed: the `busy` flag of `provider_status` means a start, stop, restart or build is running, so the page can take its stopped placeholder as the real state (Phase 1 status polling, Phase 3 `RuntimeStatusProvider`).
- Why it looked reasonable: the comment on the command says only a start, stop or build holds the lock for long, and Phases 1 to 6 ran against Docker with no sign of trouble.
- What disproved it: `provider_status` answers `Stopped`, `busy: true`, no endpoint whenever `try_lock` fails, and every backend command takes that lock, `provider_version_check` (an `aws-emulator -v` exec of about 0.3 s through the WSL shim) included. Each poll that met the lock read as a stop, the next as a start, the run id changed both times, and a new run id triggers the next version check. The engine logged that exec about every 4 seconds with nothing touching the app; the nav button alternated between running and working, and Run on the API Console was disabled with "the emulator is not running" on most polls.
- Fix: `RuntimeStatusProvider` keeps the last status that was not busy and, while a poll says busy, stores it with `busy: true`; after the change no version check ran in 25 seconds. A real start or stop still changes the run id when the lock is released and through `markLifecycle`. [agent]

## Open questions

### ASD-Q7: Native provider install source: no DEB package URL known

- Question: where does the native provider get its binary inside WSL?
- Found: `downloads.aws.com/.../LTS/` serves `aws-emulator-<version>-1-x86_64.rpm` and `.sig`; guessed DEB names (`-amd64.deb`, `_amd64.deb`) return 403, so no DEB URL is known. The provider takes the executable path from settings (`wsl_binary`) and was verified with the emulator binary copied out of the Docker image into `~/awsb-bin` in Ubuntu 24.04, not with an installed package.
- Options: document an RPM extraction (`rpm2cpio`) into a user directory, find the real DEB URL on the AWS Linux guide, or keep the setting and leave installation to the user.
- Recommendation: keep the setting and leave installation to the user until the AWS Linux guide shows a DEB URL. [agent]
- Deferred (Kai, 2026-11-15): not answered now; work concentrates on the Docker provider, and the native provider stays as built, reading `wsl_binary` from settings [user].
