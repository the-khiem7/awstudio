//! Attach provider: an emulator the user already runs. The app reads its endpoint and per-port
//! folder and never starts or stops it.

use super::{
    emulator_home, health, Endpoint, Health, LogSink, LogStream, Provider, ProviderError, ProviderKind,
    Result, RunState, StartOptions, VersionInfo,
};

pub struct AttachProvider {
    port: u16,
}

impl AttachProvider {
    pub fn new(port: u16) -> Self {
        AttachProvider { port }
    }
}

const NOT_OWNED: &str = "an attached emulator is not managed by this app";

impl Provider for AttachProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Attach
    }

    fn start(&mut self, opts: &StartOptions) -> Result<()> {
        // Attaching is re-pointing at the port and checking the emulator answers.
        self.port = opts.port;
        match health::check(&self.endpoint()) {
            Health::Healthy => Ok(()),
            _ => Err(ProviderError::Health(format!(
                "no healthy emulator found on port {} (looked for its files in {})",
                self.port,
                self.endpoint().dir.display()
            ))),
        }
    }

    fn stop(&mut self) -> Result<()> {
        Err(ProviderError::Unsupported(NOT_OWNED.into()))
    }

    fn restart(&mut self, _opts: &StartOptions) -> Result<()> {
        Err(ProviderError::Unsupported(NOT_OWNED.into()))
    }

    fn state(&self) -> RunState {
        if health::check(&self.endpoint()) == Health::Healthy {
            RunState::Running
        } else {
            RunState::Stopped
        }
    }

    fn health(&self) -> Health {
        health::check(&self.endpoint())
    }

    fn version(&self) -> Result<VersionInfo> {
        // `aws-emulator -v` cannot be run against a process this app did not start, and the health
        // endpoint answers only `ok`.
        Err(ProviderError::Unsupported("version of an attached emulator is not available".into()))
    }

    fn endpoint(&self) -> Endpoint {
        Endpoint::local(self.port, emulator_home().join(self.port.to_string()))
    }

    fn logs(&self, _sink: LogSink) -> Result<LogStream> {
        Err(ProviderError::Unsupported("logs of an attached emulator are not available".into()))
    }
}
