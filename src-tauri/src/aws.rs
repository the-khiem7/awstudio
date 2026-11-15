//! Shared AWS SDK setup for every service client the backend builds.
//!
//! Clients get an explicit credentials provider from the emulator's own files, an HTTP client that
//! trusts only the emulator CA, the emulator endpoint, and an interceptor that refuses to transmit
//! a request to any other host. The default credential chain is never consulted, so a real AWS
//! profile on the machine can neither sign nor receive local test traffic.

use crate::provider::PINNED_VERSION;
use crate::session::Session;
use aws_sdk_s3::config::interceptors::BeforeTransmitInterceptorContextRef;
use aws_sdk_s3::config::{ConfigBag, Intercept, RuntimeComponents};
use aws_sdk_s3::error::{BoxError, DisplayErrorContext, ProvideErrorMetadata, SdkError};
use aws_smithy_http_client::tls::rustls_provider::CryptoMode;
use aws_smithy_http_client::tls::{Provider, TlsContext, TrustStore};
use aws_types::region::Region;
use aws_types::sdk_config::{SharedCredentialsProvider, SharedHttpClient};
use aws_types::SdkConfig;
use serde::Serialize;
use specta::Type;

/// Prefix of the error the endpoint guard raises; used to tell a guard refusal from a transport
/// failure once the SDK has wrapped it.
const GUARD_REFUSAL: &str = "endpoint guard refused";

/// Refuses any request whose final URI is not `https://127.0.0.1:<port>`.
///
/// The check runs at the last hook before the request leaves the process, after endpoint
/// resolution, so a per-call endpoint override or a virtual-hosted S3 address is caught too.
#[derive(Debug, Clone)]
pub struct EndpointGuard {
    allowed: String,
}

impl EndpointGuard {
    pub fn new(port: u16) -> Self {
        EndpointGuard { allowed: format!("127.0.0.1:{port}") }
    }

    pub fn check(&self, uri: &str) -> Result<(), String> {
        let authority = uri
            .strip_prefix("https://")
            .map(|rest| rest.split(['/', '?', '#']).next().unwrap_or_default());
        match authority {
            Some(a) if a == self.allowed => Ok(()),
            _ => Err(format!("{GUARD_REFUSAL} a request to {} (only https://{} is allowed)", host_of(uri), self.allowed)),
        }
    }
}

/// Scheme and authority of a URI, without the path and query, so a refusal never echoes a
/// presigned query string.
fn host_of(uri: &str) -> &str {
    let after_scheme = uri.find("://").map(|i| i + 3).unwrap_or(0);
    let end = uri[after_scheme..].find(['/', '?', '#']).map(|i| after_scheme + i).unwrap_or(uri.len());
    &uri[..end]
}

impl Intercept for EndpointGuard {
    fn name(&self) -> &'static str {
        "EndpointGuard"
    }

    fn read_before_transmit(
        &self,
        context: &BeforeTransmitInterceptorContextRef<'_>,
        _runtime_components: &RuntimeComponents,
        _cfg: &mut ConfigBag,
    ) -> Result<(), BoxError> {
        self.check(context.request().uri()).map_err(BoxError::from)
    }
}

/// HTTP client trusting only the emulator CA. The trust store starts empty so the OS roots are
/// never consulted and the CA is never imported into the OS store.
fn http_client(ca_pem: &[u8]) -> Result<SharedHttpClient, ApiError> {
    let trust = TrustStore::empty().with_pem_certificate(ca_pem);
    let tls = TlsContext::builder()
        .with_trust_store(trust)
        .build()
        .map_err(|e| ApiError::Session { detail: format!("the emulator CA cannot be used: {e}") })?;
    Ok(aws_smithy_http_client::Builder::new()
        .tls_provider(Provider::Rustls(CryptoMode::AwsLc))
        .tls_context(tls)
        .build_https())
}

/// Clients of one emulator run. Cloning is cheap: the SDK clients share their connection pool.
#[derive(Clone)]
pub struct Clients {
    session: Session,
    config: SdkConfig,
    guard: EndpointGuard,
}

impl Clients {
    pub fn new(session: Session) -> Result<Clients, ApiError> {
        let credentials = aws_sdk_s3::config::Credentials::new(
            session.access_key_id.clone(),
            session.secret_access_key().to_string(),
            None,
            None,
            "aws-emulator",
        );
        let config = SdkConfig::builder()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(Region::new(session.region.clone()))
            .endpoint_url(session.endpoint_url.clone())
            .credentials_provider(SharedCredentialsProvider::new(credentials))
            .http_client(http_client(&session.ca_pem)?)
            .build();
        let guard = EndpointGuard::new(session.port);
        Ok(Clients { session, config, guard })
    }

    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn sts(&self) -> aws_sdk_sts::Client {
        let conf = aws_sdk_sts::config::Builder::from(&self.config).interceptor(self.guard.clone()).build();
        aws_sdk_sts::Client::from_conf(conf)
    }

    /// Path-style addressing: a virtual-hosted bucket name in front of an IP address is not a
    /// valid host, and the guard would refuse it.
    pub fn s3(&self) -> aws_sdk_s3::Client {
        let conf = aws_sdk_s3::config::Builder::from(&self.config)
            .force_path_style(true)
            .interceptor(self.guard.clone())
            .build();
        aws_sdk_s3::Client::from_conf(conf)
    }
}

/// Error shape of every AWS-facing command.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApiError {
    /// The emulator answered HTTP 501: the operation, or this variant of it, is not implemented.
    Unsupported { op: String, variant: Option<String>, version: String },
    /// An AWS error response with its code and message.
    Aws { op: String, code: String, message: String, status: Option<u16> },
    /// The emulator session files are missing or unreadable.
    Session { detail: String },
    /// The endpoint guard refused to send the request.
    Guard { op: String, detail: String },
    /// The request did not get an answer: connection, TLS, timeout.
    Transport { op: String, detail: String },
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Unsupported { op, variant, version } => match variant {
                Some(v) => write!(f, "{op} with {v} is not supported by AWS Emulator v{version}"),
                None => write!(f, "{op} is not supported by AWS Emulator v{version}"),
            },
            ApiError::Aws { op, code, message, .. } => write!(f, "{op}: {code}: {message}"),
            ApiError::Session { detail } => f.write_str(detail),
            ApiError::Guard { op, detail } | ApiError::Transport { op, detail } => write!(f, "{op}: {detail}"),
        }
    }
}

impl std::error::Error for ApiError {}

/// Maps an SDK error to [`ApiError`]. HTTP 501 becomes `Unsupported`; the variant is read from the
/// emulator's message `operation <Op> <variant> is scaffolded but not implemented in this emulator`.
pub fn map_sdk_error<E, R>(op: &str, err: SdkError<E, R>) -> ApiError
where
    E: ProvideErrorMetadata + std::error::Error + 'static,
    R: std::fmt::Debug + HttpStatus,
{
    let status = err.raw_response().map(|r| r.status_code());
    let code = err.code().map(str::to_string);
    let message = err.message().map(str::to_string);
    if status == Some(501) || code.as_deref() == Some("NotImplemented") {
        let name = op.rsplit(':').next().unwrap_or(op);
        return ApiError::Unsupported {
            op: op.to_string(),
            variant: message.as_deref().and_then(|m| unsupported_variant(name, m)),
            version: PINNED_VERSION.to_string(),
        };
    }
    if let (SdkError::ServiceError(_), Some(code)) = (&err, code) {
        return ApiError::Aws { op: op.to_string(), code, message: message.unwrap_or_default(), status };
    }
    let detail = DisplayErrorContext(&err).to_string();
    match detail.find(GUARD_REFUSAL) {
        Some(i) => ApiError::Guard { op: op.to_string(), detail: refusal_text(&detail[i..]) },
        None => ApiError::Transport { op: op.to_string(), detail },
    }
}

/// The guard's own sentence, cut from the SDK's wrapped error chain.
fn refusal_text(s: &str) -> String {
    match s.find(')') {
        Some(end) => s[..=end].to_string(),
        None => s.lines().next().unwrap_or(s).to_string(),
    }
}

/// Status code of a raw response, implemented for the SDK's HTTP response type.
pub trait HttpStatus {
    fn status_code(&self) -> u16;
}

impl HttpStatus for aws_sdk_s3::config::http::HttpResponse {
    fn status_code(&self) -> u16 {
        self.status().as_u16()
    }
}

/// Extracts the unsupported variant from a 501 message, for example `PublishTo=LATEST` from
/// `operation UpdateFunctionCode with PublishTo=LATEST is scaffolded but not implemented in this
/// emulator`. A message naming only the operation has no variant.
pub fn unsupported_variant(op: &str, message: &str) -> Option<String> {
    let inner = message
        .trim()
        .strip_prefix("operation ")?
        .strip_suffix(" is scaffolded but not implemented in this emulator")?;
    let rest = inner.strip_prefix(op).unwrap_or(inner).trim();
    let rest = rest.strip_prefix("with ").unwrap_or(rest).trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn guard_allows_only_the_emulator_endpoint() {
        let g = EndpointGuard::new(9297);
        assert!(g.check("https://127.0.0.1:9297/").is_ok());
        assert!(g.check("https://127.0.0.1:9297/bucket/key?x-id=GetObject").is_ok());
        assert!(g.check("http://127.0.0.1:9297/").is_err());
        assert!(g.check("https://127.0.0.1:9298/").is_err());
        assert!(g.check("https://sts.amazonaws.com/").is_err());
        assert!(g.check("https://bucket.127.0.0.1:9297/").is_err());
        assert!(g.check("https://127.0.0.1:9297.evil.example/").is_err());
    }

    #[test]
    fn guard_refusal_does_not_echo_the_query() {
        let err = EndpointGuard::new(9297).check("https://s3.amazonaws.com/b/k?X-Amz-Signature=abc").unwrap_err();
        assert!(err.contains("https://s3.amazonaws.com"));
        assert!(!err.contains("X-Amz-Signature"));
    }

    #[test]
    fn variant_is_read_from_the_501_message() {
        let m = "operation UpdateFunctionCode with PublishTo=LATEST_PUBLISHED is scaffolded but not implemented in this emulator";
        assert_eq!(unsupported_variant("UpdateFunctionCode", m).as_deref(), Some("PublishTo=LATEST_PUBLISHED"));
        let whole = "operation GetThing is scaffolded but not implemented in this emulator";
        assert_eq!(unsupported_variant("GetThing", whole), None);
        assert_eq!(unsupported_variant("GetThing", "something else"), None);
    }

    /// A client whose endpoint is not the emulator never sends: the guard refuses at transmit.
    #[test]
    fn a_request_to_another_host_is_refused_by_the_guard() {
        let session = test_session("https://sts.amazonaws.com");
        let clients = Clients::new(session).unwrap();
        let err = tauri::async_runtime::block_on(clients.sts().get_caller_identity().send()).unwrap_err();
        let mapped = map_sdk_error("sts:GetCallerIdentity", err);
        assert!(matches!(mapped, ApiError::Guard { .. }), "{mapped:?}");
    }

    fn test_session(endpoint_url: &str) -> Session {
        let dir = std::env::temp_dir().join(format!("awstudio-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(crate::provider::CA_FILE), TEST_CA).unwrap();
        std::fs::write(
            dir.join(crate::provider::CREDENTIALS_FILE),
            "[default]\naws_access_key_id = AKIDFAKEFAKEFAKE\naws_secret_access_key = fake-secret-for-tests-only-0000000000\n",
        )
        .unwrap();
        let mut ep = crate::provider::Endpoint::local(9297, PathBuf::from(&dir));
        ep.url = endpoint_url.to_string();
        let s = Session::load(&ep).unwrap();
        let _ = std::fs::remove_dir_all(dir);
        s
    }

    /// A throwaway self-signed CA certificate with no private key, only so the TLS context builds.
    const TEST_CA: &str = include_str!("../tests/fixtures/test-ca.pem");
}
