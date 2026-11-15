//! Runtime providers: the ways the app starts, stops and watches an aws-emulator.
//!
//! Every provider is blocking. Callers run them on a worker thread so a slow `docker build` never
//! blocks the UI event loop.

pub mod attach;
pub mod docker;
pub mod health;
pub mod native;
pub mod process;
pub mod settings;
pub mod version;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Version of the emulator the capability matrix is built from (vendor submodule tag).
pub const PINNED_VERSION: &str = "1.0.382";
/// Commit of the pinned emulator build; compared with the `Commit:` line of `aws-emulator -v`.
pub const PINNED_COMMIT: &str = "a978cc2cde36";
/// Default emulator port.
pub const DEFAULT_PORT: u16 = 9297;
/// Container memory limit. Idle use of the emulator with every service registered measured about
/// 180 MiB; the limit sits at roughly eleven times that so a busy test run does not hit exit code
/// 137, which would discard every emulated resource.
pub const DEFAULT_MEMORY_LIMIT: &str = "2g";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Docker,
    Native,
    Attach,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Stopped,
    Running,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    Healthy,
    Unhealthy,
    Unknown,
}

/// Where the SDK-facing files of one emulator run live. The key filename is one constant.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Endpoint {
    pub url: String,
    pub port: u16,
    #[serde(skip)]
    pub dir: PathBuf,
}

pub const CREDENTIALS_FILE: &str = "emulator_credentials";
pub const CA_FILE: &str = "ca.pem";
pub const CONFIG_FILE: &str = "config";

impl Endpoint {
    pub fn local(port: u16, dir: PathBuf) -> Self {
        Endpoint { url: format!("https://127.0.0.1:{port}"), port, dir }
    }
    pub fn ca_path(&self) -> PathBuf {
        self.dir.join(CA_FILE)
    }
    pub fn credentials_path(&self) -> PathBuf {
        self.dir.join(CREDENTIALS_FILE)
    }
    pub fn config_path(&self) -> PathBuf {
        self.dir.join(CONFIG_FILE)
    }
}

#[derive(Debug, Clone)]
pub struct StartOptions {
    pub port: u16,
    pub memory_limit: String,
    pub telemetry: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct VersionInfo {
    pub version: String,
    pub commit: String,
    pub release_date: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LogLine {
    pub level: String,
    pub message: String,
    pub raw: String,
}

pub type LogSink = Arc<dyn Fn(LogLine) + Send + Sync>;

/// Handle of a running log stream. Dropping it stops the stream.
pub struct LogStream {
    stop: Arc<AtomicBool>,
    child: Option<std::process::Child>,
}

impl LogStream {
    pub fn new(stop: Arc<AtomicBool>, child: Option<std::process::Child>) -> Self {
        LogStream { stop, child }
    }
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(c) = self.child.as_mut() {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.child = None;
    }
}

impl Drop for LogStream {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum ProviderError {
    /// stop and restart discard every emulated resource and need an explicit confirmation.
    ConfirmationRequired(String),
    NotConfigured(String),
    Unsupported(String),
    Tool(String),
    Io(String),
    Health(String),
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::ConfirmationRequired(m)
            | ProviderError::NotConfigured(m)
            | ProviderError::Unsupported(m)
            | ProviderError::Tool(m)
            | ProviderError::Io(m)
            | ProviderError::Health(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for ProviderError {}

impl From<std::io::Error> for ProviderError {
    fn from(e: std::io::Error) -> Self {
        ProviderError::Io(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ProviderError>;

pub trait Provider: Send {
    fn kind(&self) -> ProviderKind;
    fn start(&mut self, opts: &StartOptions) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn restart(&mut self, opts: &StartOptions) -> Result<()> {
        self.stop()?;
        self.start(opts)
    }
    fn state(&self) -> RunState;
    fn health(&self) -> Health;
    /// Version of the running emulator, read from `aws-emulator -v`.
    fn version(&self) -> Result<VersionInfo>;
    fn endpoint(&self) -> Endpoint;
    fn logs(&self, sink: LogSink) -> Result<LogStream>;
}

/// Parses one emulator log line. The emulator logs JSON; anything else is passed through as info.
pub fn parse_log_line(raw: &str) -> LogLine {
    let trimmed = raw.trim_end();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let level = v.get("level").and_then(|x| x.as_str()).unwrap_or("INFO").to_string();
        let message = v
            .get("fields")
            .and_then(|f| f.get("message"))
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| trimmed.to_string());
        return LogLine { level, message, raw: trimmed.to_string() };
    }
    LogLine { level: "INFO".into(), message: trimmed.to_string(), raw: trimmed.to_string() }
}

/// Directory the emulator writes its per-port files to on the Windows side.
pub fn emulator_home() -> PathBuf {
    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    base.join(".aws").join("emulator")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_log_line_is_parsed() {
        let l = parse_log_line(r#"{"level":"WARN","fields":{"message":"hello"}}"#);
        assert_eq!(l.level, "WARN");
        assert_eq!(l.message, "hello");
    }

    #[test]
    fn plain_log_line_passes_through() {
        let l = parse_log_line("This emulator collects usage");
        assert_eq!(l.level, "INFO");
        assert_eq!(l.message, "This emulator collects usage");
    }

    #[test]
    fn endpoint_paths_use_the_key_constant() {
        let e = Endpoint::local(9297, PathBuf::from("x"));
        assert!(e.credentials_path().ends_with(CREDENTIALS_FILE));
        assert_eq!(e.url, "https://127.0.0.1:9297");
    }
}
