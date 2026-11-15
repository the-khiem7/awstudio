//! Native provider: the emulator RPM or DEB installed inside a WSL distribution, with its process
//! lifecycle driven through `wsl.exe`. The emulator runs with `HOME` pointed at the Windows
//! profile, so its per-port files land in the same `.aws/emulator/<port>` folder the Docker
//! provider and the SDK side use.

use super::docker::{to_engine_path, EngineKind};
use super::process::{command, info_line, run, run_ok};
use super::{
    emulator_home, health, parse_log_line, version, Endpoint, Health, LogLine, LogSink, LogStream, Provider,
    ProviderError, ProviderKind, Result, RunState, StartOptions, VersionInfo,
};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const BUFFER_LINES: usize = 500;

#[derive(Default)]
struct Hub {
    lines: VecDeque<LogLine>,
    sinks: Vec<(Arc<AtomicBool>, LogSink)>,
}

impl Hub {
    fn push(&mut self, l: LogLine) {
        self.sinks.retain(|(stop, _)| !stop.load(Ordering::SeqCst));
        for (_, s) in &self.sinks {
            s(l.clone());
        }
        if self.lines.len() == BUFFER_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(l);
    }
}

pub struct NativeProvider {
    distro: String,
    binary: String,
    port: u16,
    child: Option<Child>,
    hub: Arc<Mutex<Hub>>,
}

/// Arguments for `wsl.exe` that start the emulator. `--exec` skips the shell, so no value is parsed
/// by a shell.
pub fn start_args(distro: &str, binary: &str, home: &str, opts: &StartOptions) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    if !distro.is_empty() {
        a.push("-d".into());
        a.push(distro.into());
    }
    a.extend(["--exec".into(), "env".into(), format!("HOME={home}"), binary.into(), "-p".into(), opts.port.to_string()]);
    a.extend(["-b".into(), "127.0.0.1".into()]);
    if !opts.telemetry {
        a.extend(["--telemetry".into(), "off".into()]);
    }
    a
}

/// `pkill` pattern that matches only the emulator started for `port`.
pub fn kill_pattern(port: u16) -> String {
    format!("^[^ ]*aws-emulator -p {port}( |$)")
}

impl NativeProvider {
    pub fn new(distro: &str, binary: &str, port: u16) -> Self {
        NativeProvider {
            distro: distro.into(),
            binary: if binary.is_empty() { "aws-emulator".into() } else { binary.into() },
            port,
            child: None,
            hub: Arc::new(Mutex::new(Hub::default())),
        }
    }

    fn wsl(&self) -> std::process::Command {
        let mut c = command("wsl.exe");
        if !self.distro.is_empty() {
            c.args(["-d", &self.distro]);
        }
        c
    }

    fn pump<R: Read + Send + 'static>(&self, r: R) {
        let hub = self.hub.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(r).lines().map_while(|l| l.ok()) {
                if !line.trim().is_empty() {
                    if let Ok(mut h) = hub.lock() {
                        h.push(parse_log_line(&line));
                    }
                }
            }
        });
    }

    fn alive(&mut self) -> bool {
        match self.child.as_mut() {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        }
    }
}

impl Provider for NativeProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Native
    }

    fn start(&mut self, opts: &StartOptions) -> Result<()> {
        if self.alive() {
            return Err(ProviderError::Tool("the native emulator is already running".into()));
        }
        self.port = opts.port;
        let home = std::env::var("USERPROFILE").map_err(|_| ProviderError::NotConfigured("USERPROFILE is not set".into()))?;
        std::fs::create_dir_all(emulator_home())?;
        let args = start_args(&self.distro, &self.binary, &to_engine_path(EngineKind::WslShim, &home), opts);
        let mut child = command("wsl.exe")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ProviderError::Tool(format!("cannot run wsl.exe: {e}")))?;
        if let Some(o) = child.stdout.take() {
            self.pump(o);
        }
        if let Some(e) = child.stderr.take() {
            self.pump(e);
        }
        self.child = Some(child);

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if !self.alive() {
                let tail: Vec<String> = self
                    .hub
                    .lock()
                    .map(|h| h.lines.iter().rev().take(10).map(|l| l.message.clone()).collect())
                    .unwrap_or_default();
                self.child = None;
                return Err(ProviderError::Tool(format!(
                    "the native emulator exited during start (is `{}` installed in the WSL distribution?):\n{}",
                    self.binary,
                    tail.into_iter().rev().collect::<Vec<_>>().join("\n")
                )));
            }
            if health::check(&self.endpoint()) == Health::Healthy {
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err(ProviderError::Health("the emulator did not answer its health check within 30 s".into()));
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    fn stop(&mut self) -> Result<()> {
        // SIGTERM lets the emulator delete its per-port files; killing the wsl.exe relay would not.
        let _ = run(self.wsl().args(["--exec", "pkill", "-TERM", "-f", &kill_pattern(self.port)]));
        if let Some(mut c) = self.child.take() {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if matches!(c.try_wait(), Ok(Some(_))) {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            let _ = c.kill();
            let _ = c.wait();
        }
        Ok(())
    }

    fn state(&self) -> RunState {
        // `alive` needs `&mut`; a shared read only reports a child that is still tracked.
        if self.child.is_some() {
            RunState::Running
        } else {
            RunState::Stopped
        }
    }

    fn health(&self) -> Health {
        if self.child.is_none() {
            return Health::Unknown;
        }
        health::check(&self.endpoint())
    }

    fn version(&self) -> Result<VersionInfo> {
        let out = run_ok(self.wsl().args(["--exec", &self.binary, "-v"]))?;
        version::parse(&out)
    }

    fn endpoint(&self) -> Endpoint {
        Endpoint::local(self.port, emulator_home().join(self.port.to_string()))
    }

    fn logs(&self, sink: LogSink) -> Result<LogStream> {
        let stop = Arc::new(AtomicBool::new(false));
        let mut hub = self.hub.lock().map_err(|_| ProviderError::Tool("log hub poisoned".into()))?;
        for l in hub.lines.iter() {
            sink(l.clone());
        }
        sink(info_line("-- live --"));
        hub.sinks.push((stop.clone(), sink));
        Ok(LogStream::new(stop, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(t: bool) -> StartOptions {
        StartOptions { port: 9297, memory_limit: "2g".into(), telemetry: t }
    }

    #[test]
    fn start_args_bind_loopback_and_use_exec() {
        let a = start_args("Ubuntu-24.04", "aws-emulator", "/mnt/c/Users/x", &opts(true));
        assert_eq!(&a[..2], ["-d", "Ubuntu-24.04"]);
        assert!(a.contains(&"--exec".to_string()));
        assert!(a.contains(&"HOME=/mnt/c/Users/x".to_string()));
        assert!(a.windows(2).any(|w| w == ["-b", "127.0.0.1"]));
        assert!(!a.contains(&"--telemetry".to_string()));
    }

    #[test]
    fn default_distro_omits_dash_d() {
        let a = start_args("", "aws-emulator", "/h", &opts(false));
        assert_eq!(a[0], "--exec");
        assert_eq!(&a[a.len() - 2..], ["--telemetry", "off"]);
    }

    #[test]
    fn kill_pattern_is_port_specific() {
        let p = kill_pattern(9297);
        assert!(p.contains("-p 9297"));
        assert!(!p.contains("9300"));
    }
}
