//! Live checks against a real engine. They need Docker (or the WSL `docker` shim), network access
//! to downloads.aws.com on the first image build, and a free port 9297, so they are ignored by
//! default. Run with `cargo test --test live_providers -- --ignored --nocapture`.

use awstudio_lib::provider::attach::AttachProvider;
use awstudio_lib::provider::docker::DockerProvider;
use awstudio_lib::provider::native::NativeProvider;
use awstudio_lib::provider::{version, Health, LogLine, Provider, RunState, StartOptions, DEFAULT_MEMORY_LIMIT};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn opts() -> StartOptions {
    StartOptions { port: 9297, memory_limit: DEFAULT_MEMORY_LIMIT.into(), telemetry: false }
}

#[test]
#[ignore]
fn docker_provider_start_health_logs_version_restart_stop() {
    let mut p = DockerProvider::new(9297).expect("docker provider");
    println!("engine kind: {:?}", p.engine_kind());
    let _ = p.stop();

    p.start(&opts()).expect("start");
    assert_eq!(p.state(), RunState::Running);
    assert_eq!(p.health(), Health::Healthy);

    let v = p.version().expect("version");
    println!("running {} {}", v.version, v.commit);
    assert!(version::compare(&v).matches, "running build differs from the pin");

    let lines: Arc<Mutex<Vec<LogLine>>> = Arc::default();
    let sink = lines.clone();
    let stream = p.logs(Arc::new(move |l| sink.lock().unwrap().push(l))).expect("logs");
    std::thread::sleep(Duration::from_secs(3));
    assert!(!lines.lock().unwrap().is_empty(), "no log lines streamed");
    drop(stream);

    p.restart(&opts()).expect("restart");
    assert_eq!(p.health(), Health::Healthy);

    p.stop().expect("stop");
    assert_eq!(p.state(), RunState::Stopped);
    assert_eq!(p.health(), Health::Unknown);
}

/// Needs an emulator binary inside WSL: set AWSTUDIO_WSL_BIN (and AWSTUDIO_WSL_DISTRO if the
/// default distribution is not the one that holds it).
#[test]
#[ignore]
fn native_provider_and_attach_provider_on_one_emulator() {
    let bin = std::env::var("AWSTUDIO_WSL_BIN").expect("AWSTUDIO_WSL_BIN");
    let distro = std::env::var("AWSTUDIO_WSL_DISTRO").unwrap_or_default();
    let o = StartOptions { port: 9298, memory_limit: DEFAULT_MEMORY_LIMIT.into(), telemetry: false };
    let mut n = NativeProvider::new(&distro, &bin, 9298);
    let _ = n.stop();

    n.start(&o).expect("native start");
    assert_eq!(n.health(), Health::Healthy);
    let v = n.version().expect("native version");
    assert!(version::compare(&v).matches);

    let lines: Arc<Mutex<Vec<LogLine>>> = Arc::default();
    let sink = lines.clone();
    let _stream = n.logs(Arc::new(move |l| sink.lock().unwrap().push(l))).expect("logs");
    assert!(!lines.lock().unwrap().is_empty(), "no buffered log lines replayed");

    let mut a = AttachProvider::new(9298);
    a.start(&o).expect("attach to the running emulator");
    assert_eq!(a.health(), Health::Healthy);
    assert!(a.stop().is_err(), "attach must not stop an emulator it does not own");

    n.stop().expect("native stop");
    assert_eq!(n.state(), RunState::Stopped);
    std::thread::sleep(Duration::from_secs(1));
    assert!(a.start(&o).is_err(), "attach must fail once the emulator is gone");
}