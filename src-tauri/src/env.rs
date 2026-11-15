//! Environment that points the AWS CLI and SDKs at the running emulator.
//!
//! The block names the emulator's own config, credentials and CA files instead of the key values,
//! so it holds no secret, stays valid across restarts (the files are rewritten in place) and can be
//! shown in the WebView. Every variable that could select real AWS credentials or a real profile
//! is cleared first.

use crate::provider::Endpoint;
use crate::session::Session;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Variables that could make a CLI or SDK sign with real credentials or skip the endpoint.
pub const CLEARED: &[&str] = &[
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_ROLE_ARN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Shell {
    Powershell,
    Cmd,
}

/// Variables set for the emulator, in a stable order.
///
/// `AWS_ENDPOINT_URL`, `AWS_CA_BUNDLE` and the region are set even though the generated config
/// names them too: the config is written from inside the container or WSL, where the endpoint host
/// and the CA path differ from the Windows side, and environment variables take precedence.
pub fn variables(endpoint: &Endpoint, session: &Session) -> Vec<(&'static str, String)> {
    vec![
        ("AWS_CONFIG_FILE", endpoint.config_path().display().to_string()),
        ("AWS_SHARED_CREDENTIALS_FILE", endpoint.credentials_path().display().to_string()),
        ("AWS_PROFILE", "default".to_string()),
        ("AWS_ENDPOINT_URL", session.endpoint_url.clone()),
        ("AWS_CA_BUNDLE", endpoint.ca_path().display().to_string()),
        ("AWS_REGION", session.region.clone()),
        ("AWS_DEFAULT_REGION", session.region.clone()),
    ]
}

pub fn block(shell: Shell, vars: &[(&'static str, String)]) -> String {
    let mut out = String::new();
    match shell {
        Shell::Powershell => {
            let names: Vec<String> = CLEARED.iter().map(|n| format!("Env:{n}")).collect();
            out.push_str(&format!("Remove-Item {} -ErrorAction SilentlyContinue\n", names.join(", ")));
            for (k, v) in vars {
                out.push_str(&format!("$env:{k} = '{}'\n", v.replace('\'', "''")));
            }
        }
        Shell::Cmd => {
            for n in CLEARED {
                out.push_str(&format!("set \"{n}=\"\n"));
            }
            for (k, v) in vars {
                out.push_str(&format!("set \"{k}={v}\"\n"));
            }
        }
    }
    out
}

/// Opens a new PowerShell console whose environment points at the emulator. The process is spawned
/// directly with an argument array and an edited environment; no command line is built from input.
#[cfg(windows)]
pub fn open_terminal(vars: &[(&'static str, String)], endpoint_url: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let banner = format!(
        "Write-Host 'AWS CLI and SDKs in this window use the local emulator at {}' -ForegroundColor Cyan",
        endpoint_url.replace('\'', "''")
    );
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoExit", "-NoLogo", "-Command", &banner]);
    for n in CLEARED {
        cmd.env_remove(n);
    }
    for (k, v) in vars {
        cmd.env(k, v);
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        cmd.current_dir(home);
    }
    cmd.creation_flags(CREATE_NEW_CONSOLE).spawn().map(|_| ())
}

#[cfg(not(windows))]
pub fn open_terminal(_vars: &[(&'static str, String)], _endpoint_url: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "opening a terminal is implemented for Windows only"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> Vec<(&'static str, String)> {
        vec![("AWS_CONFIG_FILE", r"C:\Users\o'neil\.aws\emulator\9297\config".to_string()), ("AWS_REGION", "us-east-1".into())]
    }

    #[test]
    fn powershell_block_clears_real_credentials_and_quotes_values() {
        let b = block(Shell::Powershell, &vars());
        assert!(b.starts_with("Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY"));
        assert!(b.contains(r"$env:AWS_CONFIG_FILE = 'C:\Users\o''neil\.aws\emulator\9297\config'"));
        assert!(b.contains("$env:AWS_REGION = 'us-east-1'"));
    }

    #[test]
    fn cmd_block_clears_then_sets() {
        let b = block(Shell::Cmd, &vars());
        assert!(b.contains("set \"AWS_PROFILE=\"\n"));
        assert!(b.contains("set \"AWS_REGION=us-east-1\"\n"));
        assert!(b.find("set \"AWS_PROFILE=\"").unwrap() < b.find("set \"AWS_REGION=").unwrap());
    }
}
