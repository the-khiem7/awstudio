//! Docker provider. Drives the `docker` CLI rather than the Engine API, because on Windows the
//! `docker` command is often a shim into a WSL distribution whose engine socket the app cannot
//! reach, while the CLI behaves the same through that shim, Docker Desktop, Rancher and Podman.

use super::process::{self, command, resolve_executable, run, run_ok};
use super::{
    emulator_home, health, version, Endpoint, Health, LogSink, LogStream, Provider, ProviderError, ProviderKind,
    Result, RunState, StartOptions, VersionInfo, PINNED_VERSION,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

/// Fingerprint AWS publishes for the key that signs aws-emulator packages.
pub const PUBLISHING_KEY_FINGERPRINT: &str = "98BCF336A3BE53B734E967C52E5BF49BD940F624";
const PACKAGE_BASE: &str = "https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS";
const KEY_URL: &str = "https://downloads.aws.com/keys/gpg/current.asc";
/// Directory inside the container the emulator uses as its home for per-port files.
const CONTAINER_EMULATOR_DIR: &str = "/home/emulator/.aws/emulator";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineKind {
    DockerDesktop,
    /// `docker` is a shim that runs the CLI inside a WSL distribution; host paths must be translated.
    WslShim,
    Other,
}

/// Classifies the engine from the resolved `docker` executable, `DOCKER_HOST` and the engine's own
/// operating-system string (`docker info --format '{{.OperatingSystem}}'`).
pub fn classify_engine(exe: &Path, docker_host: Option<&str>, engine_os: &str) -> EngineKind {
    if engine_os.contains("Docker Desktop") {
        return EngineKind::DockerDesktop;
    }
    let ext = exe.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let is_script = ext == "cmd" || ext == "bat" || ext == "ps1";
    let unix_host = docker_host.map(|h| h.starts_with("unix://")).unwrap_or(false);
    if is_script || unix_host {
        EngineKind::WslShim
    } else {
        EngineKind::Other
    }
}

/// Translates a Windows host path into the path the engine sees. A WSL engine mounts drives under
/// `/mnt/<drive>`; without translation `-v C:\...` is parsed as a volume name and the bind fails.
pub fn to_engine_path(kind: EngineKind, path: &str) -> String {
    if kind != EngineKind::WslShim {
        return path.to_string();
    }
    let p = path.replace('\\', "/");
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if let Some(rest) = p.strip_prefix(prefix) {
            // //wsl$/<distro>/home/x -> /home/x
            return match rest.split_once('/') {
                Some((_, tail)) => format!("/{tail}"),
                None => "/".to_string(),
            };
        }
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        let drive = (b[0] as char).to_ascii_lowercase();
        let rest = p[2..].trim_start_matches('/');
        return format!("/mnt/{drive}/{rest}");
    }
    p
}

pub fn image_tag(version: &str) -> String {
    format!("awstudio-emulator:{version}")
}

pub fn container_name(port: u16) -> String {
    format!("awstudio-emulator-{port}")
}

fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// Dockerfile for the pinned package. The first stage downloads the package, its detached
/// signature and AWS's public key, checks the key fingerprint and the signature, and fails the
/// build on any mismatch; the second stage only receives the verified package.
pub fn dockerfile(version: &str) -> Result<String> {
    if !valid_version(version) {
        return Err(ProviderError::Tool(format!("invalid emulator version {version:?}")));
    }
    let rpm = format!("{PACKAGE_BASE}/aws-emulator-{version}-1-x86_64.rpm");
    Ok(format!(
        r#"FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS verify
RUN dnf install -y --allowerasing gnupg2-full && dnf clean all
ADD {rpm} /pkg/aws-emulator.rpm
ADD {rpm}.sig /pkg/aws-emulator.rpm.sig
ADD {KEY_URL} /pkg/key.asc
RUN gpg --batch --import /pkg/key.asc \
 && gpg --batch --with-colons --fingerprint ssm-publishing@amazon.com | grep -q '^fpr:::::::::{PUBLISHING_KEY_FINGERPRINT}:' \
 && gpg --batch --verify /pkg/aws-emulator.rpm.sig /pkg/aws-emulator.rpm
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
COPY --from=verify /pkg/aws-emulator.rpm /tmp/aws-emulator.rpm
RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm && mkdir -p /home/emulator && chown 1000 /home/emulator
USER 1000
ENV HOME=/home/emulator
EXPOSE 9297
ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]
"#
    ))
}

/// Arguments of `docker run` for one emulator. The port is published on loopback only.
pub fn run_args(kind: EngineKind, opts: &StartOptions, image: &str, host_dir: &str) -> Vec<String> {
    let port = opts.port;
    let mut a: Vec<String> = vec![
        "run".into(),
        "-d".into(),
        "--name".into(),
        container_name(port),
        "--memory".into(),
        opts.memory_limit.clone(),
        "--memory-swap".into(),
        opts.memory_limit.clone(),
        "-p".into(),
        format!("127.0.0.1:{port}:{port}"),
        "-v".into(),
        format!("{}:{CONTAINER_EMULATOR_DIR}", to_engine_path(kind, host_dir)),
        image.into(),
        "-p".into(),
        port.to_string(),
    ];
    if !opts.telemetry {
        a.push("--telemetry".into());
        a.push("off".into());
    }
    a
}

pub struct DockerProvider {
    docker: PathBuf,
    kind: EngineKind,
    port: u16,
    version: String,
}

impl DockerProvider {
    pub fn new(port: u16) -> Result<Self> {
        let docker = resolve_executable("docker")
            .ok_or_else(|| ProviderError::NotConfigured("the `docker` command was not found on PATH".into()))?;
        let os = run_ok(command(docker.to_str().unwrap_or("docker")).args(["info", "--format", "{{.OperatingSystem}}"]))
            .map_err(|e| ProviderError::NotConfigured(format!("the docker engine is not reachable: {e}")))?;
        let kind = classify_engine(&docker, std::env::var("DOCKER_HOST").ok().as_deref(), os.trim());
        Ok(DockerProvider { docker, kind, port, version: PINNED_VERSION.into() })
    }

    pub fn engine_kind(&self) -> EngineKind {
        self.kind
    }

    pub fn set_port(&mut self, port: u16) {
        self.port = port;
    }

    fn docker(&self) -> std::process::Command {
        command(self.docker.to_str().unwrap_or("docker"))
    }

    fn name(&self) -> String {
        container_name(self.port)
    }

    fn image_exists(&self, tag: &str) -> bool {
        run(self.docker().args(["image", "inspect", tag])).map(|o| o.status_ok).unwrap_or(false)
    }

    /// Builds the emulator image at the pinned version. Also used by the "Rebuild image at pinned
    /// version" action. The Dockerfile goes through stdin so no build context is needed.
    pub fn build_image(&self, version: &str) -> Result<()> {
        let df = dockerfile(version)?;
        let mut child = self
            .docker()
            .args(["build", "-t", &image_tag(version), "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ProviderError::Tool(format!("cannot run docker build: {e}")))?;
        child
            .stdin
            .take()
            .ok_or_else(|| ProviderError::Tool("docker build has no stdin".into()))?
            .write_all(df.as_bytes())?;
        let out = child.wait_with_output()?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = err.lines().rev().take(15).collect();
            Err(ProviderError::Tool(format!(
                "image build failed (a signature or fingerprint mismatch fails here):\n{}",
                tail.into_iter().rev().collect::<Vec<_>>().join("\n")
            )))
        }
    }

    fn remove_container(&self) {
        let _ = run(self.docker().args(["rm", "-f", &self.name()]));
    }

    fn container_running(&self) -> bool {
        run(self.docker().args(["inspect", "-f", "{{.State.Running}}", &self.name()]))
            .map(|o| o.status_ok && o.stdout.trim() == "true")
            .unwrap_or(false)
    }

    fn last_logs(&self) -> String {
        run(self.docker().args(["logs", "--tail", "15", &self.name()]))
            .map(|o| format!("{}{}", o.stdout, o.stderr))
            .unwrap_or_default()
    }
}

impl Provider for DockerProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Docker
    }

    fn start(&mut self, opts: &StartOptions) -> Result<()> {
        self.port = opts.port;
        let tag = image_tag(&self.version);
        if !self.image_exists(&tag) {
            self.build_image(&self.version.clone())?;
        }
        self.remove_container();
        let host_dir = emulator_home();
        std::fs::create_dir_all(&host_dir)?;
        let args = run_args(self.kind, opts, &tag, &host_dir.to_string_lossy());
        run_ok(self.docker().args(&args))?;

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if !self.container_running() {
                let logs = self.last_logs();
                self.remove_container();
                return Err(ProviderError::Tool(format!("the emulator container exited during start:\n{logs}")));
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
        // `docker stop` sends SIGTERM, which lets the emulator delete its per-port files.
        let _ = run(self.docker().args(["stop", &self.name()]));
        self.remove_container();
        Ok(())
    }

    fn state(&self) -> RunState {
        if self.container_running() {
            RunState::Running
        } else {
            RunState::Stopped
        }
    }

    fn health(&self) -> Health {
        if !self.container_running() {
            return Health::Unknown;
        }
        health::check(&self.endpoint())
    }

    fn version(&self) -> Result<VersionInfo> {
        let out = if self.container_running() {
            run_ok(self.docker().args(["exec", &self.name(), "aws-emulator", "-v"]))?
        } else {
            let tag = image_tag(&self.version);
            if !self.image_exists(&tag) {
                return Err(ProviderError::NotConfigured("no emulator image has been built yet".into()));
            }
            run_ok(self.docker().args(["run", "--rm", "--entrypoint", "aws-emulator", &tag, "-v"]))?
        };
        version::parse(&out)
    }

    fn endpoint(&self) -> Endpoint {
        Endpoint::local(self.port, emulator_home().join(self.port.to_string()))
    }

    fn logs(&self, sink: LogSink) -> Result<LogStream> {
        let mut c = self.docker();
        c.args(["logs", "-f", "--tail", "200", &self.name()]);
        process::stream_lines(c, sink)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(telemetry: bool) -> StartOptions {
        StartOptions { port: 9297, memory_limit: "2g".into(), telemetry }
    }

    #[test]
    fn drive_paths_translate_for_a_wsl_engine() {
        assert_eq!(
            to_engine_path(EngineKind::WslShim, r"C:\Users\STYLVN\.aws\emulator"),
            "/mnt/c/Users/STYLVN/.aws/emulator"
        );
        assert_eq!(to_engine_path(EngineKind::WslShim, r"d:\x"), "/mnt/d/x");
    }

    #[test]
    fn wsl_unc_paths_translate_to_distro_paths() {
        assert_eq!(to_engine_path(EngineKind::WslShim, r"\\wsl$\Ubuntu\home\kai\x"), "/home/kai/x");
        assert_eq!(to_engine_path(EngineKind::WslShim, r"\\wsl.localhost\Ubuntu\home\kai"), "/home/kai");
    }

    #[test]
    fn docker_desktop_paths_are_not_translated() {
        assert_eq!(to_engine_path(EngineKind::DockerDesktop, r"C:\Users\a"), r"C:\Users\a");
    }

    #[test]
    fn engine_classification() {
        let cmd = Path::new(r"C:\x\docker.cmd");
        let exe = Path::new(r"C:\Program Files\Docker\docker.exe");
        assert_eq!(classify_engine(cmd, None, "Ubuntu 24.04"), EngineKind::WslShim);
        assert_eq!(classify_engine(exe, Some("unix:///var/run/docker.sock"), "Ubuntu"), EngineKind::WslShim);
        assert_eq!(classify_engine(exe, None, "Docker Desktop"), EngineKind::DockerDesktop);
        assert_eq!(classify_engine(cmd, None, "Docker Desktop"), EngineKind::DockerDesktop);
        assert_eq!(classify_engine(exe, None, "Ubuntu"), EngineKind::Other);
    }

    #[test]
    fn port_is_published_on_loopback_only() {
        let a = run_args(EngineKind::WslShim, &opts(true), "img", r"C:\h\.aws\emulator");
        assert!(a.contains(&"127.0.0.1:9297:9297".to_string()));
        assert!(!a.iter().any(|x| x.starts_with("0.0.0.0")));
        assert!(a.contains(&"/mnt/c/h/.aws/emulator:/home/emulator/.aws/emulator".to_string()));
        assert!(a.windows(2).any(|w| w == ["--memory", "2g"]));
        assert!(a.windows(2).any(|w| w == ["--memory-swap", "2g"]));
    }

    #[test]
    fn telemetry_flag_follows_the_setting() {
        assert!(!run_args(EngineKind::Other, &opts(true), "i", "h").contains(&"--telemetry".to_string()));
        let off = run_args(EngineKind::Other, &opts(false), "i", "h");
        assert_eq!(&off[off.len() - 2..], ["--telemetry", "off"]);
    }

    #[test]
    fn dockerfile_pins_version_and_verifies_signature() {
        let d = dockerfile("1.0.382").unwrap();
        assert!(d.contains("aws-emulator-1.0.382-1-x86_64.rpm.sig"));
        assert!(d.contains(PUBLISHING_KEY_FINGERPRINT));
        assert!(d.contains("gpg --batch --verify"));
        assert!(d.contains("COPY --from=verify"));
    }

    #[test]
    fn dockerfile_rejects_injection_in_the_version() {
        assert!(dockerfile("1.0.382\nRUN evil").is_err());
        assert!(dockerfile("").is_err());
    }
}
