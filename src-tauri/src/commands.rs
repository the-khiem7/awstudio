//! Tauri commands over the runtime providers. All provider work runs on a blocking worker so a
//! slow `docker build` never stalls the event loop.

use crate::provider::attach::AttachProvider;
use crate::provider::docker::DockerProvider;
use crate::provider::native::NativeProvider;
use crate::provider::settings::{self, Settings};
use crate::provider::version::{self, VersionCheck};
use crate::provider::{
    Endpoint, Health, LogLine, Provider, ProviderError, ProviderKind, RunState, StartOptions, PINNED_VERSION,
};
use crate::provider::LogStream;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Manager as _, State};

pub struct Runtime {
    settings: Settings,
    dir: PathBuf,
    provider: Option<Box<dyn Provider>>,
    log: Option<LogStream>,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Mutex<Runtime>>);

impl AppState {
    pub fn new(dir: PathBuf) -> Self {
        let settings = settings::load(&dir);
        AppState(Arc::new(Mutex::new(Runtime { settings, dir, provider: None, log: None })))
    }
}

#[derive(Serialize)]
pub struct Status {
    kind: ProviderKind,
    state: RunState,
    health: Health,
    /// True while a start, stop, restart or build holds the provider.
    busy: bool,
    endpoint: Option<Endpoint>,
}

impl Runtime {
    fn opts(&self) -> StartOptions {
        StartOptions {
            port: self.settings.port,
            memory_limit: self.settings.memory_limit.clone(),
            telemetry: self.settings.telemetry,
        }
    }

    fn provider(&mut self) -> Result<&mut Box<dyn Provider>, ProviderError> {
        if self.provider.is_none() {
            let s = &self.settings;
            let p: Box<dyn Provider> = match s.provider {
                ProviderKind::Docker => Box::new(DockerProvider::new(s.port)?),
                ProviderKind::Native => Box::new(NativeProvider::new(&s.wsl_distro, &s.wsl_binary, s.port)),
                ProviderKind::Attach => Box::new(AttachProvider::new(s.port)),
            };
            self.provider = Some(p);
        }
        Ok(self.provider.as_mut().expect("provider was just created"))
    }

    fn status(&mut self) -> Status {
        let kind = self.settings.provider;
        match self.provider() {
            Ok(p) => Status { kind, state: p.state(), health: p.health(), busy: false, endpoint: Some(p.endpoint()) },
            Err(_) => Status { kind, state: RunState::Stopped, health: Health::Unknown, busy: false, endpoint: None },
        }
    }

    /// Stop and restart discard every emulated resource, so they need an explicit confirmation.
    fn require_confirmation(&mut self, confirmed: bool) -> Result<(), ProviderError> {
        if confirmed {
            return Ok(());
        }
        let running = self.provider()?.state() == RunState::Running;
        if running {
            Err(ProviderError::ConfirmationRequired(
                "stopping the emulator deletes every emulated resource, because it keeps them in memory".into(),
            ))
        } else {
            Ok(())
        }
    }
}

async fn blocking<T, F>(state: &State<'_, AppState>, f: F) -> Result<T, ProviderError>
where
    T: Send + 'static,
    F: FnOnce(&mut Runtime) -> Result<T, ProviderError> + Send + 'static,
{
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rt = inner.lock().map_err(|_| ProviderError::Tool("runtime state poisoned".into()))?;
        f(&mut rt)
    })
    .await
    .map_err(|e| ProviderError::Tool(e.to_string()))?
}

#[tauri::command]
pub async fn provider_status(state: State<'_, AppState>) -> Result<Status, ProviderError> {
    // A start, stop or build holds the lock for a long time; report that instead of waiting.
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || match inner.try_lock() {
        Ok(mut rt) => Ok(rt.status()),
        Err(std::sync::TryLockError::WouldBlock) => Ok(Status {
            kind: ProviderKind::Docker,
            state: RunState::Stopped,
            health: Health::Unknown,
            busy: true,
            endpoint: None,
        }),
        Err(_) => Err(ProviderError::Tool("runtime state poisoned".into())),
    })
    .await
    .map_err(|e| ProviderError::Tool(e.to_string()))?
}

#[tauri::command]
pub async fn provider_start(state: State<'_, AppState>) -> Result<(), ProviderError> {
    blocking(&state, |rt| {
        let opts = rt.opts();
        rt.provider()?.start(&opts)
    })
    .await
}

#[tauri::command]
pub async fn provider_stop(state: State<'_, AppState>, confirm_data_loss: bool) -> Result<(), ProviderError> {
    blocking(&state, move |rt| {
        rt.require_confirmation(confirm_data_loss)?;
        rt.log = None;
        rt.provider()?.stop()
    })
    .await
}

#[tauri::command]
pub async fn provider_restart(state: State<'_, AppState>, confirm_data_loss: bool) -> Result<(), ProviderError> {
    blocking(&state, move |rt| {
        rt.require_confirmation(confirm_data_loss)?;
        rt.log = None;
        let opts = rt.opts();
        rt.provider()?.restart(&opts)
    })
    .await
}

#[tauri::command]
pub async fn provider_version_check(state: State<'_, AppState>) -> Result<VersionCheck, ProviderError> {
    blocking(&state, |rt| {
        let running = rt.provider()?.version()?;
        Ok(version::compare(&running))
    })
    .await
}

/// "Rebuild image at pinned version": rebuilds the Docker image at the version the capability
/// matrix was made from.
#[tauri::command]
pub async fn provider_rebuild_image(state: State<'_, AppState>) -> Result<(), ProviderError> {
    blocking(&state, |rt| {
        let port = rt.settings.port;
        DockerProvider::new(port)?.build_image(PINNED_VERSION)
    })
    .await
}

/// Streams emulator log lines into `on_line`: the lines already buffered, then live ones.
#[tauri::command]
pub async fn provider_logs(state: State<'_, AppState>, on_line: Channel<LogLine>) -> Result<(), ProviderError> {
    blocking(&state, move |rt| {
        rt.log = None;
        let sink = Arc::new(move |l: LogLine| {
            let _ = on_line.send(l);
        });
        let stream = rt.provider()?.logs(sink)?;
        rt.log = Some(stream);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, ProviderError> {
    blocking(&state, |rt| Ok(rt.settings.clone())).await
}

/// Saves settings. Changing the provider kind, port or WSL target drops the cached provider so the
/// next call builds one for the new target.
#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), ProviderError> {
    blocking(&state, move |rt| {
        let target_changed = rt.settings.provider != settings.provider
            || rt.settings.port != settings.port
            || rt.settings.wsl_distro != settings.wsl_distro
            || rt.settings.wsl_binary != settings.wsl_binary;
        if target_changed {
            if let Some(p) = rt.provider.as_ref() {
                if p.state() == RunState::Running && p.kind() != ProviderKind::Attach {
                    return Err(ProviderError::Tool("stop the emulator before changing the provider or port".into()));
                }
            }
            rt.log = None;
            rt.provider = None;
        }
        rt.settings = settings;
        settings::save(&rt.dir, &rt.settings)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn ack_telemetry_notice(state: State<'_, AppState>, telemetry: bool) -> Result<(), ProviderError> {
    blocking(&state, move |rt| {
        rt.settings.telemetry = telemetry;
        rt.settings.telemetry_notice_seen = true;
        settings::save(&rt.dir, &rt.settings)?;
        Ok(())
    })
    .await
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_config_dir()?;
    app.manage(AppState::new(dir));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{LogSink, VersionInfo};

    struct Fake {
        running: bool,
    }

    impl Provider for Fake {
        fn kind(&self) -> ProviderKind {
            ProviderKind::Docker
        }
        fn start(&mut self, _: &StartOptions) -> Result<(), ProviderError> {
            self.running = true;
            Ok(())
        }
        fn stop(&mut self) -> Result<(), ProviderError> {
            self.running = false;
            Ok(())
        }
        fn state(&self) -> RunState {
            if self.running { RunState::Running } else { RunState::Stopped }
        }
        fn health(&self) -> Health {
            Health::Unknown
        }
        fn version(&self) -> Result<VersionInfo, ProviderError> {
            Err(ProviderError::Unsupported("fake".into()))
        }
        fn endpoint(&self) -> Endpoint {
            Endpoint::local(9297, PathBuf::new())
        }
        fn logs(&self, _: LogSink) -> Result<LogStream, ProviderError> {
            Err(ProviderError::Unsupported("fake".into()))
        }
    }

    fn runtime(running: bool) -> Runtime {
        Runtime {
            settings: Settings::default(),
            dir: PathBuf::new(),
            provider: Some(Box::new(Fake { running })),
            log: None,
        }
    }

    #[test]
    fn stopping_a_running_emulator_needs_confirmation() {
        let mut rt = runtime(true);
        assert!(matches!(rt.require_confirmation(false), Err(ProviderError::ConfirmationRequired(_))));
        assert!(rt.require_confirmation(true).is_ok());
    }

    #[test]
    fn stopping_a_stopped_emulator_needs_no_confirmation() {
        assert!(runtime(false).require_confirmation(false).is_ok());
    }
}
