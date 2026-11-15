use super::{ProviderError, Result, VersionInfo, PINNED_COMMIT, PINNED_VERSION};
use serde::Serialize;

/// Parses the output of `aws-emulator -v`:
///
/// ```text
/// Version: 1.0.382
/// Release date: 2026.11.14
/// Commit: a978cc2cde36a474352a49bb53f79b30030a6585
/// ```
pub fn parse(output: &str) -> Result<VersionInfo> {
    let field = |name: &str| {
        output
            .lines()
            .find_map(|l| l.strip_prefix(name).map(|v| v.trim().to_string()))
    };
    match (field("Version:"), field("Commit:")) {
        (Some(version), Some(commit)) => Ok(VersionInfo {
            version,
            commit,
            release_date: field("Release date:").unwrap_or_default(),
        }),
        _ => Err(ProviderError::Tool(format!("unrecognised `aws-emulator -v` output: {}", output.trim()))),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionCheck {
    pub matches: bool,
    pub running_version: String,
    pub running_commit: String,
    pub pinned_version: String,
    pub pinned_commit: String,
}

/// Compares the running build with the build the capability matrix was made from. A mismatch is a
/// warning, never a block: the pinned matrix stays in use.
pub fn compare(running: &VersionInfo) -> VersionCheck {
    VersionCheck {
        matches: running.commit.starts_with(PINNED_COMMIT) || PINNED_COMMIT.starts_with(&running.commit),
        running_version: running.version.clone(),
        running_commit: running.commit.clone(),
        pinned_version: PINNED_VERSION.into(),
        pinned_commit: PINNED_COMMIT.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUT: &str = "Version: 1.0.382\nRelease date: 2026.11.14\nCommit: a978cc2cde36a474352a49bb53f79b30030a6585\n";

    #[test]
    fn parses_version_output() {
        let v = parse(OUT).unwrap();
        assert_eq!(v.version, "1.0.382");
        assert_eq!(v.release_date, "2026.11.14");
        assert!(v.commit.starts_with("a978cc2cde36"));
    }

    #[test]
    fn pinned_build_matches() {
        assert!(compare(&parse(OUT).unwrap()).matches);
    }

    #[test]
    fn other_commit_mismatches() {
        let other = OUT.replace("a978cc2cde36", "0123456789ab");
        assert!(!compare(&parse(&other).unwrap()).matches);
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(parse("nope").is_err());
    }
}
