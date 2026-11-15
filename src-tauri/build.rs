fn main() {
    tauri_build::build();

    // tauri-build links the Windows resource (with the Common Controls v6 manifest) into binaries
    // only. A test binary that links the Tauri runtime then fails to load with
    // STATUS_ENTRYPOINT_NOT_FOUND (TaskDialogIndirect exists only in Common Controls v6), so the
    // same resource is linked into test binaries too.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = std::env::var("OUT_DIR").expect("OUT_DIR");
        // `libresource.a` on the GNU-family toolchains, `resource.lib` on MSVC.
        for name in ["libresource.a", "resource.lib"] {
            let resource = std::path::Path::new(&out).join(name);
            if resource.exists() {
                println!("cargo:rustc-link-arg-tests={}", resource.display());
            }
        }
    }
}
