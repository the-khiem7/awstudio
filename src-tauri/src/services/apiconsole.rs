//! API Console and seed scripts.
//!
//! The API Console runs any operation of any modeled service through the AWS CLI as a subprocess
//! (ASD-D8). The CLI is spawned with an argument array, never a shell; the environment is the
//! emulator's (the same variables as "Open terminal with emulator environment") after every
//! variable that could select real credentials or a real profile has been removed (ASD-D17).
//! Keys stay in the files the CLI reads; they never reach the WebView.
//!
//! A seed script is a saved list of such calls, stored as JSON in the app config folder so it
//! survives an emulator restart and can rebuild the lost state.

use crate::aws::ApiError;
use crate::commands::{blocking, AppState};
use crate::env;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};
use tauri::State;

/// The CLI is killed after this long; a hung call must not hold the console.
const TIMEOUT: Duration = Duration::from_secs(90);
/// Output kept per stream. A larger answer is cut and says so.
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_INPUT: usize = 2 * 1024 * 1024;
const MAX_SEED_STEPS: usize = 500;

/// Everything one CLI call produced.
#[derive(Debug, Clone, Serialize, Type)]
pub struct CliResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    /// The command line without the temporary file paths, for display and for copying.
    pub command: String,
    pub millis: u32,
    /// Size of a streaming body the CLI wrote to a temporary file, which is discarded.
    pub streamed_bytes: Option<f64>,
    pub truncated: bool,
}

/// Which AWS CLI the console will run.
#[derive(Debug, Clone, Serialize, Type)]
pub struct CliInfo {
    pub version: String,
}

fn invalid(detail: impl Into<String>) -> ApiError {
    ApiError::Invalid { detail: detail.into() }
}

/// A CLI service or operation name: lower case letters, digits and single hyphens. This keeps a
/// name from being read as an option (`--profile`) or a path.
pub fn valid_command_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name.bytes().next().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.contains("--")
}

fn valid_region(region: &str) -> bool {
    !region.is_empty() && region.len() <= 30 && region.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn windows_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn cli_missing(e: &std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::NotFound {
        ApiError::Session {
            detail: "the AWS CLI v2 was not found on PATH; install it for the current user and restart AWStudio".into(),
        }
    } else {
        ApiError::Session { detail: format!("cannot start the AWS CLI: {e}") }
    }
}

fn read_capped(mut stream: impl Read + Send + 'static) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buf = [0u8; 16 * 1024];
        let mut cut = false;
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if kept.len() < MAX_OUTPUT {
                        let take = n.min(MAX_OUTPUT - kept.len());
                        kept.extend_from_slice(&buf[..take]);
                        cut |= take < n;
                    } else {
                        cut = true;
                    }
                }
            }
        }
        (kept, cut)
    })
}

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A temporary file path that is removed when dropped.
struct Temp(PathBuf);

impl Temp {
    fn new(kind: &str) -> Temp {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        Temp(std::env::temp_dir().join(format!("awstudio-api-{}-{n}.{kind}", std::process::id())))
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// The argument list of one call, without the `aws` program name. `input` and `outfile` are the
/// temporary files, or `None` when the call has none.
pub fn cli_args(service: &str, operation: &str, endpoint_url: &str, input: Option<&Path>, outfile: Option<&Path>) -> Vec<String> {
    let mut args = vec![service.to_string(), operation.to_string()];
    if let Some(path) = input {
        args.push("--cli-input-json".into());
        args.push(format!("file://{}", path.display()));
    }
    args.extend(
        ["--endpoint-url", endpoint_url, "--output", "json", "--no-cli-pager", "--no-paginate", "--cli-connect-timeout", "15", "--cli-read-timeout", "60"]
            .map(String::from),
    );
    if let Some(path) = outfile {
        args.push(path.display().to_string());
    }
    args
}

/// The command line for display: the temporary paths are shown as placeholders.
pub fn display_command(service: &str, operation: &str, has_input: bool, streaming: bool) -> String {
    let mut line = format!("aws {service} {operation}");
    if has_input {
        line.push_str(" --cli-input-json file://input.json");
    }
    line.push_str(" --no-paginate");
    if streaming {
        line.push_str(" outfile");
    }
    line
}

fn run_cli(
    vars: Vec<(&'static str, String)>,
    region: &str,
    service: &str,
    operation: &str,
    input: Option<String>,
    streaming: bool,
) -> Result<CliResponse, ApiError> {
    if !valid_command_name(service) || !valid_command_name(operation) {
        return Err(invalid("the service and operation names may hold only lower case letters, digits and hyphens"));
    }
    if !valid_region(region) {
        return Err(invalid("the Region is not a valid Region name"));
    }
    let endpoint_url = vars
        .iter()
        .find(|(k, _)| *k == "AWS_ENDPOINT_URL")
        .map(|(_, v)| v.clone())
        .ok_or_else(|| ApiError::Session { detail: "the emulator endpoint is unknown".into() })?;

    let input_file = match &input {
        Some(text) => {
            if text.len() > MAX_INPUT {
                return Err(invalid("the input is larger than 2 MiB"));
            }
            serde_json::from_str::<serde_json::Value>(text).map_err(|e| invalid(format!("the input is not valid JSON: {e}")))?;
            let temp = Temp::new("json");
            std::fs::write(&temp.0, text).map_err(|e| invalid(format!("cannot write the input file: {e}")))?;
            Some(temp)
        }
        None => None,
    };
    let out_file = streaming.then(|| Temp::new("out"));

    let args = cli_args(service, operation, &endpoint_url, input_file.as_ref().map(|t| t.0.as_path()), out_file.as_ref().map(|t| t.0.as_path()));
    let mut cmd = Command::new("aws");
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for name in env::CLEARED {
        cmd.env_remove(name);
    }
    for (k, v) in &vars {
        cmd.env(k, v);
    }
    cmd.env("AWS_REGION", region).env("AWS_DEFAULT_REGION", region).env("AWS_PAGER", "").env("AWS_CLI_AUTO_PROMPT", "off");
    if let Some(home) = std::env::var_os("USERPROFILE") {
        cmd.current_dir(home);
    }
    windows_no_window(&mut cmd);

    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| cli_missing(&e))?;
    let out = read_capped(child.stdout.take().expect("stdout is piped"));
    let err = read_capped(child.stderr.take().expect("stderr is piped"));
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ApiError::Transport { op: format!("{service}:{operation}"), detail: format!("the AWS CLI did not finish within {} seconds and was stopped", TIMEOUT.as_secs()) });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(ApiError::Session { detail: format!("cannot wait for the AWS CLI: {e}") }),
        }
    };
    let (stdout, cut_out) = out.join().unwrap_or_default();
    let (stderr, cut_err) = err.join().unwrap_or_default();
    let streamed_bytes = out_file.as_ref().and_then(|t| std::fs::metadata(&t.0).ok()).map(|m| m.len() as f64);
    Ok(CliResponse {
        exit_code: status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        command: display_command(service, operation, input.is_some(), streaming),
        millis: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
        streamed_bytes,
        truncated: cut_out || cut_err,
    })
}

/// Runs `aws <service> <operation>` against the emulator and returns what the CLI printed. A
/// non-zero exit code is a result, not an error: the page shows the CLI's own message.
#[tauri::command]
#[specta::specta]
pub async fn api_run(
    state: State<'_, AppState>,
    region: String,
    service: String,
    operation: String,
    input: Option<String>,
    streaming: bool,
) -> Result<CliResponse, ApiError> {
    let vars = blocking(&state, |rt| rt.env_vars()).await?;
    tauri::async_runtime::spawn_blocking(move || run_cli(vars, &region, &service, &operation, input, streaming))
        .await
        .map_err(|e| ApiError::Session { detail: e.to_string() })?
}

/// Version line of the AWS CLI on PATH, so the page can say which CLI it will use.
#[tauri::command]
#[specta::specta]
pub async fn api_cli_info() -> Result<CliInfo, ApiError> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = Command::new("aws");
        cmd.arg("--version").stdin(Stdio::null());
        windows_no_window(&mut cmd);
        let output = cmd.output().map_err(|e| cli_missing(&e))?;
        let text = String::from_utf8_lossy(if output.stdout.is_empty() { &output.stderr } else { &output.stdout });
        Ok(CliInfo { version: text.lines().next().unwrap_or_default().trim().to_string() })
    })
    .await
    .map_err(|e| ApiError::Session { detail: e.to_string() })?
}

/// One saved call of a seed script.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct SeedStep {
    /// Capability key of the service, for example `cloudwatch-logs`.
    pub service_key: String,
    /// CLI service name, for example `logs`.
    pub service: String,
    /// Operation name as the model spells it, for example `CreateLogGroup`.
    pub operation: String,
    /// CLI operation name, for example `create-log-group`.
    pub command: String,
    pub region: String,
    /// The input as JSON text; absent for an operation without input.
    pub input: Option<String>,
    pub streaming: bool,
    /// A short label the owner may set.
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct SeedScript {
    pub name: String,
    pub steps: Vec<SeedStep>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SeedSummary {
    pub name: String,
    pub steps: u32,
}

fn valid_seed_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed == name
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
        && !name.starts_with('.')
}

fn seed_dir(dir: &Path) -> PathBuf {
    dir.join("seeds")
}

fn seed_path(dir: &Path, name: &str) -> Result<PathBuf, ApiError> {
    if !valid_seed_name(name) {
        return Err(invalid("a seed script name may hold letters, digits, space, hyphen, underscore and dot, up to 64 characters"));
    }
    Ok(seed_dir(dir).join(format!("{name}.json")))
}

fn check_step(step: &SeedStep) -> Result<(), ApiError> {
    if !valid_command_name(&step.service) || !valid_command_name(&step.command) || !valid_region(&step.region) {
        return Err(invalid(format!("step {} {}: the service, operation or Region name is not valid", step.service, step.command)));
    }
    if let Some(text) = &step.input {
        if text.len() > MAX_INPUT || serde_json::from_str::<serde_json::Value>(text).is_err() {
            return Err(invalid(format!("step {} {}: the input is not valid JSON", step.service, step.command)));
        }
    }
    Ok(())
}

pub fn list_seeds_in(dir: &Path) -> Vec<SeedSummary> {
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(seed_dir(dir)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else { continue };
            let steps = std::fs::read_to_string(&path)
                .ok()
                .and_then(|t| serde_json::from_str::<SeedScript>(&t).ok())
                .map(|s| s.steps.len() as u32)
                .unwrap_or(0);
            found.push(SeedSummary { name, steps });
        }
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    found
}

pub fn save_seed_in(dir: &Path, script: &SeedScript) -> Result<(), ApiError> {
    let path = seed_path(dir, &script.name)?;
    if script.steps.len() > MAX_SEED_STEPS {
        return Err(invalid(format!("a seed script holds at most {MAX_SEED_STEPS} steps")));
    }
    for step in &script.steps {
        check_step(step)?;
    }
    std::fs::create_dir_all(seed_dir(dir)).map_err(|e| invalid(format!("cannot create the seed folder: {e}")))?;
    let text = serde_json::to_string_pretty(script).map_err(|e| invalid(e.to_string()))?;
    // Written next to the target and renamed, so a crash never leaves a half-written script.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| invalid(format!("cannot write the seed script: {e}")))?;
    std::fs::rename(&tmp, &path).map_err(|e| invalid(format!("cannot write the seed script: {e}")))
}

pub fn load_seed_in(dir: &Path, name: &str) -> Result<SeedScript, ApiError> {
    let path = seed_path(dir, name)?;
    let text = std::fs::read_to_string(&path).map_err(|e| invalid(format!("cannot read the seed script {name}: {e}")))?;
    let script: SeedScript = serde_json::from_str(&text).map_err(|e| invalid(format!("the seed script {name} is not valid: {e}")))?;
    Ok(SeedScript { name: name.to_string(), steps: script.steps })
}

pub fn delete_seed_in(dir: &Path, name: &str) -> Result<(), ApiError> {
    let path = seed_path(dir, name)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(invalid(format!("cannot delete the seed script {name}: {e}"))),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn seed_list(state: State<'_, AppState>) -> Result<Vec<SeedSummary>, ApiError> {
    blocking(&state, |rt| Ok(list_seeds_in(rt.dir()))).await
}

#[tauri::command]
#[specta::specta]
pub async fn seed_load(state: State<'_, AppState>, name: String) -> Result<SeedScript, ApiError> {
    blocking(&state, move |rt| load_seed_in(rt.dir(), &name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn seed_save(state: State<'_, AppState>, script: SeedScript) -> Result<(), ApiError> {
    blocking(&state, move |rt| save_seed_in(rt.dir(), &script)).await
}

#[tauri::command]
#[specta::specta]
pub async fn seed_delete(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    blocking(&state, move |rt| delete_seed_in(rt.dir(), &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(input: Option<&str>) -> SeedStep {
        SeedStep {
            service_key: "cloudwatch-logs".into(),
            service: "logs".into(),
            operation: "CreateLogGroup".into(),
            command: "create-log-group".into(),
            region: "us-east-1".into(),
            input: input.map(String::from),
            streaming: false,
            note: String::new(),
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("awstudio-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn command_names_cannot_be_read_as_options() {
        assert!(valid_command_name("describe-log-groups"));
        assert!(valid_command_name("s3api"));
        assert!(!valid_command_name("--profile"));
        assert!(!valid_command_name("-x"));
        assert!(!valid_command_name("a--b"));
        assert!(!valid_command_name("Logs"));
        assert!(!valid_command_name("a b"));
        assert!(!valid_command_name(""));
        assert!(!valid_command_name("a/../b"));
    }

    #[test]
    fn regions_are_plain_names() {
        assert!(valid_region("eu-west-1"));
        assert!(!valid_region("eu west"));
        assert!(!valid_region(""));
        assert!(!valid_region("EU"));
    }

    #[test]
    fn arguments_pin_the_endpoint_and_disable_paging() {
        let args = cli_args("logs", "describe-log-groups", "https://127.0.0.1:9297", Some(Path::new("C:/t/in.json")), None);
        assert_eq!(&args[..2], ["logs", "describe-log-groups"]);
        assert!(args.windows(2).any(|w| w == ["--endpoint-url", "https://127.0.0.1:9297"]));
        assert!(args.contains(&"--no-paginate".to_string()));
        assert!(args.contains(&"--no-cli-pager".to_string()));
        assert!(args.contains(&"file://C:/t/in.json".to_string()));
        let streaming = cli_args("s3api", "get-object", "https://127.0.0.1:9297", None, Some(Path::new("C:/t/o.out")));
        assert_eq!(streaming.last().unwrap(), "C:/t/o.out");
        assert!(!streaming.contains(&"--cli-input-json".to_string()));
    }

    #[test]
    fn display_command_hides_temporary_paths() {
        assert_eq!(display_command("logs", "create-log-group", true, false), "aws logs create-log-group --cli-input-json file://input.json --no-paginate");
        assert_eq!(display_command("s3api", "get-object", true, true), "aws s3api get-object --cli-input-json file://input.json --no-paginate outfile");
    }

    #[test]
    fn seed_names_are_plain_file_names() {
        assert!(valid_seed_name("local dev 1"));
        assert!(valid_seed_name("a-b_c.d"));
        assert!(!valid_seed_name("../x"));
        assert!(!valid_seed_name(".hidden"));
        assert!(!valid_seed_name(" lead"));
        assert!(!valid_seed_name("a/b"));
        assert!(!valid_seed_name(""));
        assert!(!valid_seed_name(&"x".repeat(65)));
    }

    #[test]
    fn seed_scripts_round_trip_list_and_delete() {
        let dir = scratch("seed");
        let script = SeedScript { name: "base".into(), steps: vec![step(Some("{\"logGroupName\":\"a\"}")), step(None)] };
        save_seed_in(&dir, &script).unwrap();
        assert_eq!(load_seed_in(&dir, "base").unwrap(), script);
        let listed = list_seeds_in(&dir);
        assert_eq!((listed.len(), listed[0].name.as_str(), listed[0].steps), (1, "base", 2));
        delete_seed_in(&dir, "base").unwrap();
        assert!(list_seeds_in(&dir).is_empty());
        delete_seed_in(&dir, "base").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_step_with_bad_names_or_input_is_refused() {
        let dir = scratch("bad");
        let mut bad = step(None);
        bad.command = "--profile".into();
        assert!(save_seed_in(&dir, &SeedScript { name: "x".into(), steps: vec![bad] }).is_err());
        assert!(save_seed_in(&dir, &SeedScript { name: "x".into(), steps: vec![step(Some("{oops"))] }).is_err());
        assert!(save_seed_in(&dir, &SeedScript { name: "../x".into(), steps: vec![] }).is_err());
        assert!(list_seeds_in(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
