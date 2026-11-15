//! The emulator session: endpoint, access keys and CA of one emulator run.
//!
//! Every start writes new keys and a new CA under `~/.aws/emulator/<port>/`, so the session is
//! read from those files again whenever they change. Keys never leave the backend: `Session` is
//! not serializable and its `Debug` output omits the secret.

use crate::provider::Endpoint;
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;

/// Region the emulator writes into its generated config, used when the config cannot be read.
pub const FALLBACK_REGION: &str = "us-east-1";

#[derive(Clone)]
pub struct Session {
    pub endpoint_url: String,
    pub port: u16,
    pub region: String,
    pub access_key_id: String,
    secret_access_key: String,
    pub ca_pem: Vec<u8>,
    pub dir: PathBuf,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("endpoint_url", &self.endpoint_url)
            .field("region", &self.region)
            .field("secret_access_key", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    /// The per-port files are absent: the emulator is not running or has not written them yet.
    NotRunning(String),
    Malformed(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::NotRunning(m) | SessionError::Malformed(m) => f.write_str(m),
        }
    }
}

/// What the WebView may know about the session: no keys.
#[derive(Debug, Clone, Serialize, Type)]
pub struct SessionInfo {
    pub endpoint_url: String,
    pub region: String,
    pub files_dir: String,
}

impl Session {
    pub fn load(endpoint: &Endpoint) -> Result<Session, SessionError> {
        let read = |path: PathBuf| {
            std::fs::read(&path).map_err(|_| {
                SessionError::NotRunning(format!(
                    "no emulator session files in {}; start the emulator first",
                    endpoint.dir.display()
                ))
            })
        };
        let ca_pem = read(endpoint.ca_path())?;
        let credentials = String::from_utf8(read(endpoint.credentials_path())?)
            .map_err(|_| SessionError::Malformed("the emulator credentials file is not UTF-8".into()))?;
        let access_key_id = profile_value(&credentials, "default", "aws_access_key_id")
            .ok_or_else(|| SessionError::Malformed("the emulator credentials file has no access key id".into()))?;
        let secret_access_key = profile_value(&credentials, "default", "aws_secret_access_key")
            .ok_or_else(|| SessionError::Malformed("the emulator credentials file has no secret access key".into()))?;
        // The generated config also names an endpoint and a CA path, but those are written from
        // inside the container or WSL and can be paths or hosts that do not exist on Windows. Only
        // the region is taken from it.
        let region = std::fs::read_to_string(endpoint.config_path())
            .ok()
            .and_then(|c| profile_value(&c, "default", "region"))
            .unwrap_or_else(|| FALLBACK_REGION.to_string());
        Ok(Session {
            endpoint_url: endpoint.url.clone(),
            port: endpoint.port,
            region,
            access_key_id,
            secret_access_key,
            ca_pem,
            dir: endpoint.dir.clone(),
        })
    }

    pub fn secret_access_key(&self) -> &str {
        &self.secret_access_key
    }

    /// Identity of this run's files. A restart writes a new key and CA, so a changed value means
    /// clients built from the old session must be rebuilt.
    pub fn same_run(&self, other: &Session) -> bool {
        self.endpoint_url == other.endpoint_url
            && self.access_key_id == other.access_key_id
            && self.secret_access_key == other.secret_access_key
            && self.ca_pem == other.ca_pem
            && self.region == other.region
    }

    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            endpoint_url: self.endpoint_url.clone(),
            region: self.region.clone(),
            files_dir: self.dir.display().to_string(),
        }
    }
}

/// Reads `key` from `[section]` of an AWS shared config or credentials file.
pub fn profile_value(text: &str, section: &str, key: &str) -> Option<String> {
    let mut in_section = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim();
            in_section = name == section || name == format!("profile {section}");
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let v = v.trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{CA_FILE, CONFIG_FILE, CREDENTIALS_FILE};

    const FAKE_KEY: &str = "AKIDFAKEFAKEFAKE";
    const FAKE_SECRET: &str = "fake-secret-for-tests-only-0000000000";

    fn write_run(dir: &std::path::Path, key: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(CA_FILE), "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n").unwrap();
        std::fs::write(
            dir.join(CREDENTIALS_FILE),
            format!("[default]\naws_access_key_id = {key}\naws_secret_access_key = {FAKE_SECRET}\n"),
        )
        .unwrap();
        std::fs::write(
            dir.join(CONFIG_FILE),
            "[default]\nregion = eu-west-1\nendpoint_url = https://0.0.0.0:9297\nca_bundle = /root/.aws/emulator/9297/ca.pem\ns3 =\n  signature_version = s3v4\n",
        )
        .unwrap();
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("awsandbox-session-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn loads_keys_ca_and_region_but_keeps_the_local_endpoint() {
        let dir = temp("load");
        write_run(&dir, FAKE_KEY);
        let s = Session::load(&Endpoint::local(9297, dir.clone())).unwrap();
        assert_eq!(s.access_key_id, FAKE_KEY);
        assert_eq!(s.secret_access_key(), FAKE_SECRET);
        assert_eq!(s.region, "eu-west-1");
        assert_eq!(s.endpoint_url, "https://127.0.0.1:9297");
        assert!(s.ca_pem.starts_with(b"-----BEGIN CERTIFICATE-----"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_files_mean_not_running() {
        let dir = temp("missing");
        assert!(matches!(Session::load(&Endpoint::local(9297, dir)), Err(SessionError::NotRunning(_))));
    }

    #[test]
    fn a_new_key_is_a_new_run() {
        let dir = temp("rerun");
        write_run(&dir, FAKE_KEY);
        let ep = Endpoint::local(9297, dir.clone());
        let a = Session::load(&ep).unwrap();
        assert!(a.same_run(&Session::load(&ep).unwrap()));
        write_run(&dir, "AKIDOTHEROTHEROTH");
        assert!(!a.same_run(&Session::load(&ep).unwrap()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn debug_output_hides_the_secret() {
        let dir = temp("debug");
        write_run(&dir, FAKE_KEY);
        let s = Session::load(&Endpoint::local(9297, dir.clone())).unwrap();
        let text = format!("{s:?}");
        assert!(!text.contains(FAKE_SECRET));
        assert!(!text.contains(FAKE_KEY));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn profile_value_reads_the_named_section_only() {
        let text = "[other]\nregion = ap-south-1\n[default]\nregion = us-east-1\n";
        assert_eq!(profile_value(text, "default", "region").as_deref(), Some("us-east-1"));
        assert_eq!(profile_value(text, "default", "missing"), None);
    }
}
