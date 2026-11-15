//! Child-process helpers shared by the providers. Every subprocess gets an argument array and no
//! shell, and runs without a console window.

use super::{LogLine, LogSink, LogStream, ProviderError, Result};
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub struct Output {
    pub status_ok: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn run(cmd: &mut Command) -> Result<Output> {
    let out = cmd.output().map_err(|e| ProviderError::Tool(format!("cannot run {:?}: {e}", cmd.get_program())))?;
    Ok(Output {
        status_ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Like [`run`] but turns a non-zero exit into an error carrying stderr.
pub fn run_ok(cmd: &mut Command) -> Result<String> {
    let o = run(cmd)?;
    if o.status_ok {
        Ok(o.stdout)
    } else {
        Err(ProviderError::Tool(o.stderr.trim().to_string()))
    }
}

/// Resolves an executable on PATH, honouring PATHEXT so `.cmd` shims are found. Rust's `Command`
/// only searches for `.exe` when given a bare name, and a `docker.cmd` shim into WSL is a
/// supported setup.
pub fn resolve_executable(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .map(|s| s.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Streams the stdout and stderr of a spawned child line by line into `sink`.
pub fn stream_lines(mut cmd: Command, sink: LogSink) -> Result<LogStream> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| ProviderError::Tool(format!("cannot start log stream: {e}")))?;
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(out) = child.stdout.take() {
        spawn_reader(out, sink.clone(), stop.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(err, sink, stop.clone());
    }
    Ok(LogStream::new(stop, Some(child)))
}

fn spawn_reader<R: Read + Send + 'static>(r: R, sink: LogSink, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        for line in BufReader::new(r).lines() {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            match line {
                Ok(l) if !l.trim().is_empty() => sink(super::parse_log_line(&l)),
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
}

pub fn info_line(message: &str) -> LogLine {
    LogLine { level: "INFO".into(), message: message.into(), raw: message.into() }
}
