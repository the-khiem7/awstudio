use aws_sdk_sts::config::{BehaviorVersion, Config, Credentials, Region};
use aws_smithy_http_client::tls::rustls_provider::CryptoMode;
use aws_smithy_http_client::tls::{Provider, TlsContext, TrustStore};
use aws_smithy_http_client::Builder;

/// Builds an STS client that trusts only the emulator CA and signs with the given static keys.
///
/// The trust store starts empty so the OS roots are never consulted, and the keys are passed in
/// explicitly so the default provider chain cannot pick up a real AWS profile.
pub fn sts_client(endpoint: &str, ca_pem: &[u8], access_key: &str, secret_key: &str) -> aws_sdk_sts::Client {
    let trust = TrustStore::empty().with_pem_certificate(ca_pem);
    let tls = TlsContext::builder()
        .with_trust_store(trust)
        .build()
        .expect("tls context");
    let http = Builder::new()
        .tls_provider(Provider::Rustls(CryptoMode::AwsLc))
        .tls_context(tls)
        .build_https();
    let config = Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .endpoint_url(endpoint)
        .credentials_provider(Credentials::new(access_key, secret_key, None, None, "emulator"))
        .http_client(http)
        .build();
    aws_sdk_sts::Client::from_conf(config)
}
