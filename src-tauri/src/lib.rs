pub mod emulator_tls;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running awsandbox");
}
