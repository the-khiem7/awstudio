//! Live check of the S3 upload and download paths against a real emulator in Docker, with a file
//! large enough to go up in parts. The emulator keeps at most 64 MiB of object bytes per bucket,
//! parts in flight included, so the default size stays below that; `AWSTUDIO_TRANSFER_MIB` sets
//! another size in MiB. Ignored by default for the same reasons as `live_providers`. Run with
//! `cargo test --test live_s3_transfer -- --ignored --nocapture --test-threads=1`.

use awstudio_lib::aws::Clients;
use awstudio_lib::provider::docker::DockerProvider;
use awstudio_lib::provider::{Provider, StartOptions, DEFAULT_MEMORY_LIMIT};
use awstudio_lib::services::s3::{download_to, upload_file, MULTIPART_THRESHOLD, PART_SIZE};
use awstudio_lib::session::Session;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

const PORT: u16 = 9297;
fn size() -> u64 {
    std::env::var("AWSTUDIO_TRANSFER_MIB").ok().and_then(|v| v.parse().ok()).unwrap_or(60u64) * 1024 * 1024
}

/// Writes `size()` bytes of a fixed pseudo-random sequence, so a corrupted part changes the digest.
fn write_file(path: &std::path::Path) {
    let mut f = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut buf = vec![0u8; 1 << 20];
    for _ in 0..(size() >> 20) {
        for b in buf.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *b = x as u8;
        }
        f.write_all(&buf).unwrap();
    }
    f.flush().unwrap();
}

/// FNV-1a over the file, read in 1 MiB blocks.
fn digest(path: &std::path::Path) -> (u64, u64) {
    let mut f = std::fs::File::open(path).unwrap();
    let mut buf = vec![0u8; 1 << 20];
    let (mut h, mut n) = (0xcbf2_9ce4_8422_2325u64, 0u64);
    loop {
        let read = f.read(&mut buf).unwrap();
        if read == 0 {
            return (h, n);
        }
        for b in &buf[..read] {
            h = (h ^ *b as u64).wrapping_mul(0x100_0000_01b3);
        }
        n += read as u64;
    }
}

/// A file over the multipart threshold goes up in parts and comes back byte for byte, through the same functions the
/// upload and download commands call, in a Region other than the session's own.
#[test]
#[ignore]
fn a_multipart_file_uploads_in_parts_and_downloads_intact() {
    let size = size();
    let mut p = DockerProvider::new(PORT).expect("docker provider");
    let _ = p.stop();
    p.start(&StartOptions { port: PORT, memory_limit: DEFAULT_MEMORY_LIMIT.into(), telemetry: false }).expect("start");
    let clients = Clients::new(Session::load(&p.endpoint()).expect("session")).expect("clients");
    let client = clients.s3_in("eu-west-1").expect("client");

    let dir = std::env::temp_dir().join(format!("awstudio-transfer-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let source = dir.join("large.bin");
    let target = dir.join("large.copy.bin");
    write_file(&source);
    assert!(size >= MULTIPART_THRESHOLD);

    let bucket = "awstudio-transfer-probe";
    let reports = AtomicUsize::new(0);
    let progress = |done: f64, total: f64| {
        reports.fetch_add(1, Ordering::Relaxed);
        assert!(done <= total);
    };
    tauri::async_runtime::block_on(async {
        client
            .create_bucket()
            .bucket(bucket)
            .create_bucket_configuration(
                aws_sdk_s3::types::CreateBucketConfiguration::builder()
                    .location_constraint(aws_sdk_s3::types::BucketLocationConstraint::EuWest1)
                    .build(),
            )
            .send()
            .await
            .expect("CreateBucket");

        let started = Instant::now();
        let sent = upload_file(&client, bucket, "dir/large.bin", &source, &progress).await.expect("upload");
        let up = started.elapsed();
        let upload_reports = reports.swap(0, Ordering::Relaxed);
        println!("upload: {sent} bytes in {up:?}, {upload_reports} progress reports (parts of {PART_SIZE} bytes)");
        assert_eq!(sent as u64, size);
        assert_eq!(upload_reports as u64, 1 + size.div_ceil(PART_SIZE), "one report per part plus the start");

        let head = client.head_object().bucket(bucket).key("dir/large.bin").send().await.expect("HeadObject");
        println!("head: content length {:?}, etag {:?}", head.content_length(), head.e_tag());
        assert_eq!(head.content_length(), Some(size as i64));

        let started = Instant::now();
        let got = download_to(&client, bucket, "dir/large.bin", None, &target, &progress).await.expect("download");
        println!("download: {got} bytes in {:?}, {} progress reports", started.elapsed(), reports.load(Ordering::Relaxed));
        assert_eq!(got as u64, size);
        assert!(!dir.join("large.copy.bin.part").exists(), "the partial file is renamed on success");

        client.delete_object().bucket(bucket).key("dir/large.bin").send().await.expect("DeleteObject");
        client.delete_bucket().bucket(bucket).send().await.expect("DeleteBucket");
    });

    let (a, b) = (digest(&source), digest(&target));
    println!("digest source {:016x} ({} bytes), copy {:016x} ({} bytes)", a.0, a.1, b.0, b.1);
    assert_eq!(a, b);
    let _ = std::fs::remove_dir_all(&dir);
    p.stop().expect("stop");
}
