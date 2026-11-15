//! Regenerates `src/bindings.ts` from the command registry and fails when the committed file was
//! out of date. The file is committed so a frontend build needs no Rust build first.
//!
//! This lives in an integration test because the registry links the Tauri runtime, and only test
//! targets of this kind receive the Windows resource that the runtime needs to load.

#[test]
fn committed_bindings_match_the_commands() {
    let path = awsandbox_lib::bindings_path();
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    awsandbox_lib::export_bindings(&awsandbox_lib::bindings()).expect("export bindings");
    let after = std::fs::read_to_string(&path).expect("read bindings");
    assert!(
        before.replace("\r\n", "\n") == after.replace("\r\n", "\n"),
        "src/bindings.ts was out of date and has been regenerated; commit the new file"
    );
}
