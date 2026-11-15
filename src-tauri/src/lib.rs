pub mod commands;
pub mod emulator_tls;
pub mod provider;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| commands::setup(app))
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running awsandbox");
}
