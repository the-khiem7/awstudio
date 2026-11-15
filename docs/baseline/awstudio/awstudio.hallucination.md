---
baseline_schema: "3.0"
pack: "awstudio"
document: "hallucination"
status: "active"
updated: "2026-11-15"
code_ref: "52fe16d"
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
| ASD-D9 | Capability tiers and UI gating | closed | ASD-D8, ASD-D10, ASD-D11 |
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
| ASD-Q7 | Native provider install source: no DEB package URL known | open, deferred | ASD-D4, ASD-D7 |
| ASD-Q8 | Capability matrix service key: SDK id slug or endpoint prefix | open | ASD-D9, ASD-D13 |
| ASD-Q9 | Capability matrix scope: every modeled service or the 11 console services | open | ASD-D8, ASD-D9 |
| ASD-Q10 | Phase 3 acceptance checked on a dev-only pattern gallery | open | ASD-D9 |

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

## Open questions

### ASD-Q7: Native provider install source: no DEB package URL known

- Question: where does the native provider get its binary inside WSL?
- Found: `downloads.aws.com/.../LTS/` serves `aws-emulator-<version>-1-x86_64.rpm` and `.sig`; guessed DEB names (`-amd64.deb`, `_amd64.deb`) return 403, so no DEB URL is known. The provider takes the executable path from settings (`wsl_binary`) and was verified with the emulator binary copied out of the Docker image into `~/awsb-bin` in Ubuntu 24.04, not with an installed package.
- Options: document an RPM extraction (`rpm2cpio`) into a user directory, find the real DEB URL on the AWS Linux guide, or keep the setting and leave installation to the user.
- Recommendation: keep the setting and leave installation to the user until the AWS Linux guide shows a DEB URL. [agent]
- Deferred (Kai, 2026-11-15): not answered now; work concentrates on the Docker provider, and the native provider stays as built, reading `wsl_binary` from settings [user].


### ASD-Q8: Capability matrix service key: SDK id slug or endpoint prefix

**Vendor:** aws-emulator@a978cc2cde36 (v1.0.382)

- Question: which key names a service in `capability.json` and in control ids such as `lambda:UpdateFunctionCode`?
- Found: keying by endpoint prefix merges distinct services: `lambda` would hold lambda, lambdacore, lambdamicrovms and lambdaweb (129 operations instead of 88), `rds` would hold rds, docdb and neptune, `email` would hold ses, sesv2 and pinpointemail. The SDK id is unique per model in this pin (436 keys for 436 models). EventBridge then has two keys: `eventbridge` (53 green of 57) and `cloudwatch-events` (7 green of 51).
- Options: SDK id slug (`cloudwatch-logs`, `secrets-manager`, `eventbridge`); endpoint prefix (`logs`, `secretsmanager`, `events`, IAM-style, but merges the services above).
- Implemented as: SDK id slug; the EventBridge pages use `eventbridge`. [agent]
- Recommendation: keep the SDK id slug. [agent]

### ASD-Q9: Capability matrix scope: every modeled service or the 11 console services

- Question: does `capability.json` cover every modeled service or only the 11 with console pages?
- Found: every service makes the file 1.36 MB (21637 lines) and a 1176.54 kB frontend chunk, loaded through a dynamic import; the 11 alone would be a small fraction of that.
- Options: every service (one file for the API Console and fidelity catalog of Phase 7); the 11 now and a second generator output in Phase 7.
- Implemented as: every modeled service. [agent]
- Recommendation: keep every service; Phase 7 needs the same data. [agent]

### ASD-Q10: Phase 3 acceptance checked on a dev-only pattern gallery

- Question: is checking the Phase 3 acceptance (UI-only page; green control calls the backend; red control disabled with reason) on a development-only fixture gallery enough to close Phase 3?
- Found: no service page exists until Phase 4; the gallery (`#/dev/patterns/<pattern>`) is excluded from release builds and binds fixture rows to real matrix operations.
- Options: accept the gallery check now and repeat it on the first real pages in Phase 4; build one real UI-only page now (for example SSM Maintenance Windows, red) ahead of Phase 6.
- Recommendation: accept the gallery check and repeat the acceptance on the Phase 4 pages. [agent]
