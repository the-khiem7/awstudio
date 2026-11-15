//! Live checks of the session and SDK access against a real emulator in Docker. Ignored by default
//! for the same reasons as `live_providers`. Run with
//! `cargo test --test live_session -- --ignored --nocapture --test-threads=1`.

use awsandbox_lib::aws::{map_sdk_error, Clients};
use awsandbox_lib::env;
use awsandbox_lib::provider::docker::DockerProvider;
use awsandbox_lib::provider::{Provider, StartOptions, DEFAULT_MEMORY_LIMIT};
use awsandbox_lib::session::Session;
use std::process::Command;

const PORT: u16 = 9297;

fn opts() -> StartOptions {
    StartOptions { port: PORT, memory_limit: DEFAULT_MEMORY_LIMIT.into(), telemetry: false }
}

fn identity_and_buckets(clients: &Clients) -> (String, usize) {
    tauri::async_runtime::block_on(async {
        let id = clients
            .sts()
            .get_caller_identity()
            .send()
            .await
            .map_err(|e| map_sdk_error("GetCallerIdentity", e))
            .expect("GetCallerIdentity");
        let buckets = clients
            .s3()
            .list_buckets()
            .send()
            .await
            .map_err(|e| map_sdk_error("ListBuckets", e))
            .expect("ListBuckets");
        (id.account().unwrap_or_default().to_string(), buckets.buckets().len())
    })
}

/// The backend reaches the emulator with each run's own keys: after a restart the old clients are
/// detected as stale and new ones built from the rewritten files succeed.
#[test]
#[ignore]
fn sts_and_s3_succeed_after_start_and_after_restart() {
    let mut p = DockerProvider::new(PORT).expect("docker provider");
    let _ = p.stop();
    p.start(&opts()).expect("start");

    let first = Session::load(&p.endpoint()).expect("session after start");
    let clients = Clients::new(first.clone()).expect("clients");
    let (account, buckets) = identity_and_buckets(&clients);
    println!("after start: account {account}, {buckets} buckets, region {}", first.region);
    assert_eq!(account, "000000000000");

    p.restart(&opts()).expect("restart");
    let second = Session::load(&p.endpoint()).expect("session after restart");
    assert!(!first.same_run(&second), "a restart must write new keys or a new CA");
    let (account, _) = identity_and_buckets(&Clients::new(second).expect("clients after restart"));
    println!("after restart: account {account}");
    assert_eq!(account, "000000000000");

    p.stop().expect("stop");
}

fn aws_cli(vars: &[(&'static str, String)], args: &[&str]) -> std::process::Output {
    let mut cmd = Command::new("aws");
    for n in env::CLEARED {
        cmd.env_remove(n);
    }
    for (k, v) in vars {
        cmd.env(k, v);
    }
    cmd.args(args).args(["--output", "json"]).output().expect("run the AWS CLI")
}

/// The exported environment works for the AWS CLI, and records whether queues of one name in two
/// regions are separate resources. Needs the AWS CLI v2 on PATH.
#[test]
#[ignore]
fn cli_environment_works_and_region_partitioning_is_reported() {
    let mut p = DockerProvider::new(PORT).expect("docker provider");
    let _ = p.stop();
    p.start(&opts()).expect("start");
    let endpoint = p.endpoint();
    let session = Session::load(&endpoint).expect("session");
    let vars = env::variables(&endpoint, &session);

    let id = aws_cli(&vars, &["sts", "get-caller-identity"]);
    assert!(id.status.success(), "aws sts get-caller-identity: {}", String::from_utf8_lossy(&id.stderr));
    assert!(String::from_utf8_lossy(&id.stdout).contains("000000000000"));

    let name = "awsandbox-region-probe";
    let mut urls = Vec::new();
    for region in ["us-east-1", "eu-west-1"] {
        let out = aws_cli(&vars, &["sqs", "create-queue", "--queue-name", name, "--region", region]);
        assert!(out.status.success(), "create-queue {region}: {}", String::from_utf8_lossy(&out.stderr));
        let url = String::from_utf8_lossy(&out.stdout).to_string();
        println!("create-queue {region}: {}", url.trim());
        urls.push(url);
    }
    let tagged = aws_cli(&vars, &["sqs", "tag-queue", "--queue-url", &queue_url(&urls[0]), "--tags", "probe=us-east-1", "--region", "us-east-1"]);
    assert!(tagged.status.success(), "tag-queue: {}", String::from_utf8_lossy(&tagged.stderr));
    for (i, region) in ["us-east-1", "eu-west-1"].iter().enumerate() {
        let list = aws_cli(&vars, &["sqs", "list-queues", "--region", region]);
        println!("list-queues {region}: {}", String::from_utf8_lossy(&list.stdout).trim());
        let tags = aws_cli(&vars, &["sqs", "list-queue-tags", "--queue-url", &queue_url(&urls[i]), "--region", region]);
        println!("list-queue-tags {region}: {}", String::from_utf8_lossy(&tags.stdout).trim());
    }
    let partitioned = queue_url(&urls[0]) != queue_url(&urls[1]);
    println!("queue URLs differ by region: {partitioned}");

    p.stop().expect("stop");
}

fn queue_url(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("QueueUrl").and_then(|u| u.as_str()).map(str::to_string))
        .unwrap_or_default()
}
