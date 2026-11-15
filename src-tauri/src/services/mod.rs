//! Tauri commands of the services with console pages. Every command takes the Region of the
//! console's region selector, because the emulator keeps a separate state per Region, and reports
//! its failures as [`ApiError`] with the operation named `service:Operation`.

pub mod dynamodb;
pub mod iam;
pub mod lambda;
pub mod s3;
pub mod sns;
pub mod sqs;

use crate::aws::ApiError;
use aws_smithy_types::date_time::Format;
use aws_smithy_types::DateTime;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A resource tag as every service page shows it.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct Tag {
    pub key: String,
    pub value: String,
}

/// A JSON value that crosses IPC as TypeScript `unknown`. `serde_json::Value` itself cannot be
/// exported: specta refuses its 64-bit integer variant, which TypeScript `number` cannot hold.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(transparent)]
pub struct Json(pub serde_json::Value);

impl Type for Json {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <specta_typescript::Unknown as Type>::definition(types)
    }
}

/// RFC 3339 text of an SDK timestamp, the form the frontend's date columns parse.
pub(crate) fn time(dt: Option<&DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

/// Epoch milliseconds, as SQS and SNS attributes carry them, to RFC 3339 text.
pub(crate) fn epoch_millis(text: Option<&String>) -> Option<String> {
    let ms: i64 = text?.parse().ok()?;
    time(Some(&DateTime::from_millis(ms)))
}

/// Epoch seconds, as SQS `CreatedTimestamp` carries them, to RFC 3339 text.
pub(crate) fn epoch_secs(text: Option<&String>) -> Option<String> {
    let s: i64 = text?.parse().ok()?;
    time(Some(&DateTime::from_secs(s)))
}

/// A builder that refused its input: a required field is missing.
pub(crate) fn build_error(e: impl std::fmt::Display) -> ApiError {
    ApiError::Invalid { detail: e.to_string() }
}

/// True when an AWS error carries one of `codes`, for reads that answer "nothing configured" with
/// an error (`NoSuchTagSet`, `NoSuchBucketPolicy`).
pub(crate) fn is_code(e: &ApiError, codes: &[&str]) -> bool {
    matches!(e, ApiError::Aws { code, .. } if codes.contains(&code.as_str()))
}
