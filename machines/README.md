# Machine profiles

`scripts/dev.ps1` and `scripts/build.ps1` load `machines/<computer name>.toml` when it exists and `machines/_default.toml` otherwise, and print only `profile: local` or `profile: default`.

Only `_default.toml` is tracked; every other `*.toml` here is gitignored so a host name never reaches the repository.

| Key | Meaning |
|---|---|
| `toolchain` | Rustup toolchain exported as `RUSTUP_TOOLCHAIN` for the run |
| `path` | Directories prepended to `PATH`, `%ENVVAR%` references expanded |

A machine without Visual Studio Build Tools can use `stable-x86_64-pc-windows-gnullvm` with a per-user llvm-mingw `bin` directory in `path`.
