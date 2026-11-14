# awsandbox

A desktop app that gives [AWS Emulator](https://github.com/aws/aws-emulator) the same experience as the AWS Management Console, locally. It is built with Tauri v2, React 18 and [Cloudscape](https://cloudscape.design).

awsandbox is an independent project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Inc. or its affiliates. "AWS" and "Amazon Web Services" are trademarks of Amazon.com, Inc. or its affiliates.

## Status

Foundation only: an empty Cloudscape `AppLayout` in a Tauri window and a build that links the AWS SDK for Rust with a custom-CA HTTP client. No console pages exist yet. Windows with Docker is the first target; Linux is deferred.

## Telemetry

AWS Emulator reports usage data to AWS by default, and awsandbox keeps that default. Telemetry is described in [Telemetry in AWS Emulator](https://docs.aws.amazon.com/emulator/latest/userguide/telemetry.html). To turn it off, start the emulator with `--telemetry off` or set `EMULATOR_TELEMETRY=off`.

## Develop

Requires Node.js, Rust through rustup, and a C toolchain for the Rust target.

```powershell
npm install
./scripts/dev.ps1
```

`scripts/dev.ps1` and `scripts/build.ps1` pick the Rust toolchain from `machines/` (see `machines/README.md`) and print only `profile: local` or `profile: default`.

Enable the pre-commit hygiene check once per clone:

```powershell
git config core.hooksPath .githooks
```

It runs `tools/hygiene/hygiene.py` through `uv` and refuses staged text with the local machine name, extra terms listed in the untracked `hygiene-deny.txt` inside the git directory, account IDs other than `000000000000`, or private key blocks.

## Vendor submodules

`vendor/aws-emulator` and `vendor/cloudscape-demos` are shallow reference submodules pinned at exact commits; they are not build dependencies.

```powershell
git submodule update --init
uv run tools/vendor-drift/vendor_drift.py <old tag> <new tag>
```

`tools/vendor-drift` needs the GitHub CLI (`gh`) to download each release's `scores.json.gz`.
