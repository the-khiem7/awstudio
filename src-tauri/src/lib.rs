pub mod aws;
pub mod commands;
pub mod env;
pub mod provider;
pub mod session;

use tauri_specta::{collect_commands, Builder};

/// Command registry shared by the app and the bindings export, so the generated TypeScript always
/// lists exactly the commands the app serves.
pub fn bindings() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::provider_status,
        commands::provider_start,
        commands::provider_stop,
        commands::provider_restart,
        commands::provider_version_check,
        commands::provider_rebuild_image,
        commands::provider_logs,
        commands::get_settings,
        commands::save_settings,
        commands::ack_telemetry_notice,
        commands::session_info,
        commands::session_check,
        commands::env_block,
        commands::open_terminal,
    ])
}

/// Generated bindings, resolved from this crate's source folder so a debug build started from any
/// working directory writes the same file.
pub fn bindings_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("src").join("bindings.ts")
}

pub fn export_bindings(builder: &Builder<tauri::Wry>) -> Result<(), String> {
    builder
        .export(specta_typescript::Typescript::default(), bindings_path())
        .map_err(|e| e.to_string())
}

pub fn run() {
    let builder = bindings();
    // Keeps the committed bindings in step during `tauri dev`; a failure must not stop the app.
    #[cfg(debug_assertions)]
    if let Err(e) = export_bindings(&builder) {
        eprintln!("TypeScript bindings were not exported: {e}");
    }

    tauri::Builder::default()
        .setup(|app| commands::setup(app))
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running awsandbox");
}
