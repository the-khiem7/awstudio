use super::{ProviderKind, DEFAULT_MEMORY_LIMIT, DEFAULT_PORT};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// App settings kept in the app config directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub provider: ProviderKind,
    pub port: u16,
    pub memory_limit: String,
    /// Emulator telemetry stays on by default, as upstream ships it. The user can turn it off.
    pub telemetry: bool,
    /// False until the user has seen the first-run telemetry notice.
    pub telemetry_notice_seen: bool,
    /// WSL distribution for the native provider. Empty means the default distribution.
    pub wsl_distro: String,
    /// Emulator executable inside the WSL distribution for the native provider.
    pub wsl_binary: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            provider: ProviderKind::Docker,
            port: DEFAULT_PORT,
            memory_limit: DEFAULT_MEMORY_LIMIT.into(),
            telemetry: true,
            telemetry_notice_seen: false,
            wsl_distro: String::new(),
            wsl_binary: "aws-emulator".into(),
        }
    }
}

fn file(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, s: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(file(dir), serde_json::to_vec_pretty(s).map_err(std::io::Error::other)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_defaults_on_and_notice_unseen() {
        let s = Settings::default();
        assert!(s.telemetry);
        assert!(!s.telemetry_notice_seen);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let s: Settings = serde_json::from_str(r#"{"telemetry": false}"#).unwrap();
        assert!(!s.telemetry);
        assert_eq!(s.port, DEFAULT_PORT);
    }

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join("awsandbox-settings-test");
        let mut s = Settings::default();
        s.port = 9300;
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir).port, 9300);
        let _ = std::fs::remove_dir_all(dir);
    }
}
