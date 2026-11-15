# AWStudio

A desktop app that gives [AWS Emulator](https://github.com/aws/aws-emulator) the same experience as the AWS Management Console, locally. It is built with Tauri v2, React 18 and [Cloudscape](https://cloudscape.design).

AWStudio is an independent project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Inc. or its affiliates. "AWS" and "Amazon Web Services" are trademarks of Amazon.com, Inc. or its affiliates.

## Status

The Runtime page starts, stops and restarts the emulator through Docker, a binary inside WSL, or an emulator that is already running, and shows its health and logs. Its SDK access panel tests the connection with `sts:GetCallerIdentity` and `s3:ListBuckets`, shows PowerShell and Command Prompt lines that point the AWS CLI and SDKs at the emulator, and opens a PowerShell window with that environment. Console pages exist for S3, DynamoDB, SQS, SNS, IAM and Lambda; every other service shows a landing page that lists what the emulator supports. Windows with Docker is the first target; Linux is deferred.

The backend signs with the keys each emulator run writes, trusts only that run's CA inside the app, and refuses to send a request to any host other than `https://127.0.0.1:<port>`. The exported environment names the emulator's own files rather than the key values and clears `AWS_PROFILE`, `AWS_ACCESS_KEY_ID` and the other variables that could select real AWS credentials.

## Telemetry

AWS Emulator reports usage data to AWS by default, and AWStudio keeps that default. Telemetry is described in [Telemetry in AWS Emulator](https://docs.aws.amazon.com/emulator/latest/userguide/telemetry.html). To turn it off, start the emulator with `--telemetry off` or set `EMULATOR_TELEMETRY=off`.

## Develop

Requires Node.js, Rust through rustup, and a C toolchain for the Rust target.

```powershell
npm install
./scripts/dev.ps1
```

`scripts/dev.ps1` and `scripts/build.ps1` pick the Rust toolchain from `machines/` (see `machines/README.md`) and print only `profile: local` or `profile: default`.

`src/bindings.ts` is generated from the Tauri commands by tauri-specta and committed. A debug run rewrites it; `cargo test --test bindings` (in `src-tauri`) regenerates it and fails when the committed copy was out of date.

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
