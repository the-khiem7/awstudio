use super::{Endpoint, Health};
use std::time::Duration;

/// Calls `GET /__admin/health` over HTTPS, trusting only the emulator CA of this endpoint.
/// A healthy emulator answers 200 with the body `ok`.
pub fn check(endpoint: &Endpoint) -> Health {
    let ca = match std::fs::read(endpoint.ca_path()) {
        Ok(b) => b,
        Err(_) => return Health::Unknown,
    };
    let url = format!("{}/__admin/health", endpoint.url);
    // reqwest's blocking client panics when created inside an async runtime thread, so the call
    // runs on a plain OS thread.
    std::thread::scope(|s| {
        s.spawn(|| probe(&url, &ca)).join().unwrap_or(Health::Unknown)
    })
}

fn probe(url: &str, ca_pem: &[u8]) -> Health {
    let cert = match reqwest::Certificate::from_pem(ca_pem) {
        Ok(c) => c,
        Err(_) => return Health::Unknown,
    };
    let client = match reqwest::blocking::Client::builder()
        .tls_certs_only([cert])
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return Health::Unknown,
    };
    match client.get(url).send() {
        Ok(r) if r.status().is_success() => match r.text() {
            Ok(t) if t.trim() == "ok" => Health::Healthy,
            _ => Health::Unhealthy,
        },
        Ok(_) => Health::Unhealthy,
        Err(_) => Health::Unhealthy,
    }
}
