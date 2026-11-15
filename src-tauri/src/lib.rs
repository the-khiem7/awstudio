pub mod aws;
pub mod commands;
pub mod env;
pub mod provider;
pub mod services;
pub mod session;

use services::{dynamodb, s3, sns, sqs};
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
        s3::s3_list_buckets,
        s3::s3_create_bucket,
        s3::s3_delete_bucket,
        s3::s3_empty_bucket,
        s3::s3_get_bucket_location,
        s3::s3_get_bucket_versioning,
        s3::s3_put_bucket_versioning,
        s3::s3_get_bucket_tagging,
        s3::s3_put_bucket_tagging,
        s3::s3_get_bucket_policy,
        s3::s3_put_bucket_policy,
        s3::s3_get_bucket_cors,
        s3::s3_put_bucket_cors,
        s3::s3_get_bucket_encryption,
        s3::s3_get_public_access_block,
        s3::s3_put_public_access_block,
        s3::s3_get_bucket_lifecycle,
        s3::s3_put_bucket_lifecycle,
        s3::s3_list_objects,
        s3::s3_create_folder,
        s3::s3_delete_objects,
        s3::s3_delete_object_version,
        s3::s3_head_object,
        s3::s3_list_object_versions,
        s3::s3_get_object_tagging,
        s3::s3_put_object_tagging,
        s3::s3_upload_files,
        s3::s3_download_object,
        dynamodb::ddb_list_tables,
        dynamodb::ddb_describe_table,
        dynamodb::ddb_create_table,
        dynamodb::ddb_delete_table,
        dynamodb::ddb_scan,
        dynamodb::ddb_query,
        dynamodb::ddb_get_item,
        dynamodb::ddb_put_item,
        dynamodb::ddb_delete_items,
        dynamodb::ddb_execute_statement,
        dynamodb::ddb_list_backups,
        dynamodb::ddb_create_backup,
        dynamodb::ddb_delete_backup,
        dynamodb::ddb_restore_backup,
        dynamodb::ddb_describe_ttl,
        dynamodb::ddb_update_ttl,
        dynamodb::ddb_list_tags,
        sqs::sqs_list_queues,
        sqs::sqs_create_queue,
        sqs::sqs_get_queue,
        sqs::sqs_set_queue_attributes,
        sqs::sqs_delete_queue,
        sqs::sqs_purge_queue,
        sqs::sqs_send_message,
        sqs::sqs_receive_messages,
        sqs::sqs_delete_message,
        sqs::sqs_list_tags,
        sqs::sqs_update_tags,
        sqs::sqs_list_dead_letter_sources,
        sns::sns_list_topics,
        sns::sns_create_topic,
        sns::sns_get_topic,
        sns::sns_set_topic_attribute,
        sns::sns_delete_topic,
        sns::sns_list_subscriptions_by_topic,
        sns::sns_list_subscriptions,
        sns::sns_subscribe,
        sns::sns_unsubscribe,
        sns::sns_get_subscription,
        sns::sns_set_subscription_attribute,
        sns::sns_publish,
        sns::sns_list_tags,
        sns::sns_update_tags,
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
        // The backend opens the upload and download dialogs itself; the WebView is granted no
        // dialog permission, so it can neither open one nor name a path.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| commands::setup(app))
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running AWStudio");
}
