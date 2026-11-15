//! Amazon S3 commands of the console pages: buckets, bucket properties and permissions, objects,
//! and file transfers.
//!
//! Uploads and downloads stream between a local file and the emulator: the WebView never holds
//! object bytes and never opens an emulator URL. The local file is picked by a native dialog that
//! the backend opens itself, so the WebView cannot name an arbitrary path to read or write.

use super::{build_error, is_code, time, Tag};
use crate::aws::{map_sdk_error, ApiError};
use crate::commands::{clients, AppState};
use aws_sdk_s3::primitives::{ByteStream, Length};
use aws_sdk_s3::types::{
    AbortIncompleteMultipartUpload, BucketLifecycleConfiguration, BucketLocationConstraint, BucketVersioningStatus,
    CompletedMultipartUpload, CompletedPart, CorsConfiguration, CorsRule, CreateBucketConfiguration, Delete,
    ExpirationStatus, LifecycleExpiration, LifecycleRule, LifecycleRuleFilter, NoncurrentVersionExpiration,
    ObjectIdentifier, PublicAccessBlockConfiguration, Tagging, VersioningConfiguration,
};
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

/// Objects at or above this size upload in parts, so progress is reported and a failure leaves no
/// half-written object.
pub const MULTIPART_THRESHOLD: u64 = 16 * 1024 * 1024;
/// Part size of a multipart upload; each part is read from the file only when it is sent.
pub const PART_SIZE: u64 = 8 * 1024 * 1024;
/// DeleteObjects accepts at most this many keys per request.
const DELETE_BATCH: usize = 1000;

#[derive(Debug, Clone, Serialize, Type)]
pub struct S3Bucket {
    pub name: String,
    pub creation_date: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Default)]
pub struct PublicAccessBlock {
    pub block_public_acls: bool,
    pub ignore_public_acls: bool,
    pub block_public_policy: bool,
    pub restrict_public_buckets: bool,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateBucketInput {
    pub name: String,
    pub versioning: bool,
    pub object_lock: bool,
    pub public_access_block: PublicAccessBlock,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct S3Object {
    pub key: String,
    pub size: f64,
    pub last_modified: Option<String>,
    pub storage_class: Option<String>,
    pub etag: Option<String>,
}

/// One level of a bucket: the folders (common prefixes) and objects directly under `prefix`.
#[derive(Debug, Clone, Serialize, Type)]
pub struct S3Listing {
    pub prefix: String,
    pub folders: Vec<String>,
    pub objects: Vec<S3Object>,
    /// Set when more keys exist; pass it back to read the next page.
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct S3ObjectDetails {
    pub key: String,
    pub size: f64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub content_type: Option<String>,
    pub storage_class: Option<String>,
    pub version_id: Option<String>,
    pub server_side_encryption: Option<String>,
    pub metadata: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct S3Version {
    pub key: String,
    pub version_id: String,
    pub is_latest: bool,
    pub delete_marker: bool,
    pub size: f64,
    pub last_modified: Option<String>,
}

/// The console's simplified lifecycle rule: a prefix filter and up to three day counts.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct LifecycleRuleInput {
    pub id: String,
    pub enabled: bool,
    pub prefix: String,
    pub expiration_days: Option<i32>,
    pub noncurrent_expiration_days: Option<i32>,
    pub abort_multipart_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct TransferProgress {
    pub key: String,
    pub transferred: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct TransferResult {
    pub key: String,
    pub size: f64,
    /// Local file the object came from or went to.
    pub path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct DeleteResult {
    pub deleted: u32,
    pub errors: Vec<String>,
}

fn io_error(path: &Path, e: std::io::Error) -> ApiError {
    ApiError::Invalid { detail: format!("{}: {e}", path.display()) }
}

fn s3(c: &crate::aws::Clients, region: &str) -> Result<Client, ApiError> {
    c.s3_in(region)
}

#[tauri::command]
#[specta::specta]
pub async fn s3_list_buckets(state: State<'_, AppState>, region: String) -> Result<Vec<S3Bucket>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = client
            .list_buckets()
            .set_continuation_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("s3:ListBuckets", e))?;
        out.extend(r.buckets().iter().map(|b| S3Bucket {
            name: b.name().unwrap_or_default().to_string(),
            creation_date: time(b.creation_date()),
            region: b.bucket_region().map(str::to_string),
        }));
        token = r.continuation_token().map(str::to_string);
        if token.is_none() {
            return Ok(out);
        }
    }
}

/// Creates a bucket in `region`, then applies the options the create page offers. A failure after
/// the bucket exists names the step that failed; the bucket is kept, as the console does.
#[tauri::command]
#[specta::specta]
pub async fn s3_create_bucket(state: State<'_, AppState>, region: String, input: CreateBucketInput) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let mut req = client.create_bucket().bucket(&input.name).object_lock_enabled_for_bucket(input.object_lock);
    // us-east-1 is the default location and must not be named as a constraint.
    if region != "us-east-1" {
        req = req.create_bucket_configuration(
            CreateBucketConfiguration::builder().location_constraint(BucketLocationConstraint::from(region.as_str())).build(),
        );
    }
    req.send().await.map_err(|e| map_sdk_error("s3:CreateBucket", e))?;
    put_public_access_block(&client, &input.name, &input.public_access_block).await?;
    if input.versioning && !input.object_lock {
        put_versioning(&client, &input.name, true).await?;
    }
    if !input.tags.is_empty() {
        put_bucket_tags(&client, &input.name, &input.tags).await?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn s3_delete_bucket(state: State<'_, AppState>, region: String, bucket: String) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    client.delete_bucket().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:DeleteBucket", e))?;
    Ok(())
}

/// Deletes every object version and delete marker in a bucket: the console's "Empty bucket".
#[tauri::command]
#[specta::specta]
pub async fn s3_empty_bucket(state: State<'_, AppState>, region: String, bucket: String) -> Result<DeleteResult, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let mut ids = Vec::new();
    let (mut key_marker, mut version_marker): (Option<String>, Option<String>) = (None, None);
    loop {
        let r = client
            .list_object_versions()
            .bucket(&bucket)
            .set_key_marker(key_marker.clone())
            .set_version_id_marker(version_marker.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("s3:ListObjectVersions", e))?;
        for v in r.versions() {
            ids.push(identifier(v.key().unwrap_or_default(), v.version_id())?);
        }
        for m in r.delete_markers() {
            ids.push(identifier(m.key().unwrap_or_default(), m.version_id())?);
        }
        if r.is_truncated() != Some(true) {
            break;
        }
        key_marker = r.next_key_marker().map(str::to_string);
        version_marker = r.next_version_id_marker().map(str::to_string);
    }
    delete_identifiers(&client, &bucket, ids).await
}

fn identifier(key: &str, version: Option<&str>) -> Result<ObjectIdentifier, ApiError> {
    // A bucket that was never versioned lists its objects with the version id "null".
    let version = version.filter(|v| *v != "null");
    ObjectIdentifier::builder().key(key).set_version_id(version.map(str::to_string)).build().map_err(build_error)
}

async fn delete_identifiers(client: &Client, bucket: &str, ids: Vec<ObjectIdentifier>) -> Result<DeleteResult, ApiError> {
    let mut result = DeleteResult { deleted: 0, errors: Vec::new() };
    for batch in ids.chunks(DELETE_BATCH) {
        let delete = Delete::builder().set_objects(Some(batch.to_vec())).quiet(false).build().map_err(build_error)?;
        let r = client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .map_err(|e| map_sdk_error("s3:DeleteObjects", e))?;
        result.deleted += r.deleted().len() as u32;
        result.errors.extend(
            r.errors()
                .iter()
                .map(|e| format!("{}: {}", e.key().unwrap_or_default(), e.message().or(e.code()).unwrap_or("not deleted"))),
        );
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_location(state: State<'_, AppState>, region: String, bucket: String) -> Result<String, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client.get_bucket_location().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:GetBucketLocation", e))?;
    // An empty constraint is the default location, us-east-1.
    Ok(r.location_constraint().map(|c| c.as_str().to_string()).filter(|c| !c.is_empty()).unwrap_or_else(|| "us-east-1".into()))
}

/// `Enabled`, `Suspended`, or `Disabled` for a bucket that was never versioned.
#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_versioning(state: State<'_, AppState>, region: String, bucket: String) -> Result<String, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client.get_bucket_versioning().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:GetBucketVersioning", e))?;
    Ok(r.status().map(|s| s.as_str().to_string()).unwrap_or_else(|| "Disabled".into()))
}

async fn put_versioning(client: &Client, bucket: &str, enabled: bool) -> Result<(), ApiError> {
    let status = if enabled { BucketVersioningStatus::Enabled } else { BucketVersioningStatus::Suspended };
    client
        .put_bucket_versioning()
        .bucket(bucket)
        .versioning_configuration(VersioningConfiguration::builder().status(status).build())
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutBucketVersioning", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn s3_put_bucket_versioning(state: State<'_, AppState>, region: String, bucket: String, enabled: bool) -> Result<(), ApiError> {
    put_versioning(&s3(&clients(&state).await?, &region)?, &bucket, enabled).await
}

#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_tagging(state: State<'_, AppState>, region: String, bucket: String) -> Result<Vec<Tag>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_bucket_tagging().bucket(bucket).send().await {
        Ok(r) => Ok(r.tag_set().iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect()),
        Err(e) => {
            let e = map_sdk_error("s3:GetBucketTagging", e);
            if is_code(&e, &["NoSuchTagSet", "NoSuchTagSetError"]) { Ok(Vec::new()) } else { Err(e) }
        }
    }
}

fn s3_tags(tags: &[Tag]) -> Result<Vec<aws_sdk_s3::types::Tag>, ApiError> {
    tags.iter()
        .map(|t| aws_sdk_s3::types::Tag::builder().key(&t.key).value(&t.value).build().map_err(build_error))
        .collect()
}

async fn put_bucket_tags(client: &Client, bucket: &str, tags: &[Tag]) -> Result<(), ApiError> {
    let tagging = Tagging::builder().set_tag_set(Some(s3_tags(tags)?)).build().map_err(build_error)?;
    client
        .put_bucket_tagging()
        .bucket(bucket)
        .tagging(tagging)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutBucketTagging", e))?;
    Ok(())
}

/// Replaces the bucket's tag set; an empty set deletes it.
#[tauri::command]
#[specta::specta]
pub async fn s3_put_bucket_tagging(state: State<'_, AppState>, region: String, bucket: String, tags: Vec<Tag>) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    if tags.is_empty() {
        client.delete_bucket_tagging().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:DeleteBucketTagging", e))?;
        return Ok(());
    }
    put_bucket_tags(&client, &bucket, &tags).await
}

/// The bucket policy document, or none.
#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_policy(state: State<'_, AppState>, region: String, bucket: String) -> Result<Option<String>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_bucket_policy().bucket(bucket).send().await {
        Ok(r) => Ok(r.policy().map(str::to_string)),
        Err(e) => {
            let e = map_sdk_error("s3:GetBucketPolicy", e);
            if is_code(&e, &["NoSuchBucketPolicy"]) { Ok(None) } else { Err(e) }
        }
    }
}

/// Writes the policy; an empty document deletes it.
#[tauri::command]
#[specta::specta]
pub async fn s3_put_bucket_policy(state: State<'_, AppState>, region: String, bucket: String, policy: String) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    if policy.trim().is_empty() {
        client.delete_bucket_policy().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:DeleteBucketPolicy", e))?;
        return Ok(());
    }
    serde_json::from_str::<serde_json::Value>(&policy)
        .map_err(|e| ApiError::Invalid { detail: format!("the policy is not valid JSON: {e}") })?;
    client.put_bucket_policy().bucket(bucket).policy(policy).send().await.map_err(|e| map_sdk_error("s3:PutBucketPolicy", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase", default)]
struct CorsJson {
    #[serde(rename = "ID", skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    allowed_headers: Vec<String>,
    allowed_methods: Vec<String>,
    allowed_origins: Vec<String>,
    expose_headers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_age_seconds: Option<i32>,
}

/// The CORS rules as the console's editor shows them: a JSON array in the S3 API's field names.
#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_cors(state: State<'_, AppState>, region: String, bucket: String) -> Result<Option<String>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_bucket_cors().bucket(bucket).send().await {
        Ok(r) => {
            let rules: Vec<CorsJson> = r
                .cors_rules()
                .iter()
                .map(|c| CorsJson {
                    id: c.id().map(str::to_string),
                    allowed_headers: c.allowed_headers().to_vec(),
                    allowed_methods: c.allowed_methods().to_vec(),
                    allowed_origins: c.allowed_origins().to_vec(),
                    expose_headers: c.expose_headers().to_vec(),
                    max_age_seconds: c.max_age_seconds(),
                })
                .collect();
            Ok(Some(serde_json::to_string_pretty(&rules).unwrap_or_default()))
        }
        Err(e) => {
            let e = map_sdk_error("s3:GetBucketCors", e);
            if is_code(&e, &["NoSuchCORSConfiguration"]) { Ok(None) } else { Err(e) }
        }
    }
}

/// Writes the CORS rules from the editor's JSON array; an empty text deletes them.
#[tauri::command]
#[specta::specta]
pub async fn s3_put_bucket_cors(state: State<'_, AppState>, region: String, bucket: String, rules: String) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    if rules.trim().is_empty() || rules.trim() == "[]" {
        client.delete_bucket_cors().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:DeleteBucketCors", e))?;
        return Ok(());
    }
    let parsed: Vec<CorsJson> = serde_json::from_str(&rules)
        .map_err(|e| ApiError::Invalid { detail: format!("the CORS configuration is not a valid JSON array of rules: {e}") })?;
    let rules = parsed
        .into_iter()
        .map(|r| {
            CorsRule::builder()
                .set_id(r.id)
                .set_allowed_headers(Some(r.allowed_headers))
                .set_allowed_methods(Some(r.allowed_methods))
                .set_allowed_origins(Some(r.allowed_origins))
                .set_expose_headers(Some(r.expose_headers))
                .set_max_age_seconds(r.max_age_seconds)
                .build()
                .map_err(build_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let config = CorsConfiguration::builder().set_cors_rules(Some(rules)).build().map_err(build_error)?;
    client.put_bucket_cors().bucket(bucket).cors_configuration(config).send().await.map_err(|e| map_sdk_error("s3:PutBucketCors", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct BucketEncryption {
    /// `AES256` (SSE-S3), `aws:kms` or `aws:kms:dsse`.
    pub algorithm: String,
    pub kms_key_id: Option<String>,
    pub bucket_key: bool,
}

/// The bucket's default encryption rule, or none when the bucket has no configuration.
#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_encryption(state: State<'_, AppState>, region: String, bucket: String) -> Result<Option<BucketEncryption>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_bucket_encryption().bucket(bucket).send().await {
        Ok(r) => Ok(r.server_side_encryption_configuration().and_then(|c| c.rules().first()).map(|rule| {
            let d = rule.apply_server_side_encryption_by_default();
            BucketEncryption {
                algorithm: d.map(|d| d.sse_algorithm().as_str().to_string()).unwrap_or_default(),
                kms_key_id: d.and_then(|d| d.kms_master_key_id()).map(str::to_string),
                bucket_key: rule.bucket_key_enabled().unwrap_or(false),
            }
        })),
        Err(e) => {
            let e = map_sdk_error("s3:GetBucketEncryption", e);
            if is_code(&e, &["ServerSideEncryptionConfigurationNotFoundError"]) { Ok(None) } else { Err(e) }
        }
    }
}

/// Block Public Access settings; a bucket without the configuration has every setting off.
#[tauri::command]
#[specta::specta]
pub async fn s3_get_public_access_block(state: State<'_, AppState>, region: String, bucket: String) -> Result<PublicAccessBlock, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_public_access_block().bucket(bucket).send().await {
        Ok(r) => {
            let c = r.public_access_block_configuration();
            Ok(PublicAccessBlock {
                block_public_acls: c.and_then(|c| c.block_public_acls()).unwrap_or(false),
                ignore_public_acls: c.and_then(|c| c.ignore_public_acls()).unwrap_or(false),
                block_public_policy: c.and_then(|c| c.block_public_policy()).unwrap_or(false),
                restrict_public_buckets: c.and_then(|c| c.restrict_public_buckets()).unwrap_or(false),
            })
        }
        Err(e) => {
            let e = map_sdk_error("s3:GetPublicAccessBlock", e);
            if is_code(&e, &["NoSuchPublicAccessBlockConfiguration"]) { Ok(PublicAccessBlock::default()) } else { Err(e) }
        }
    }
}

async fn put_public_access_block(client: &Client, bucket: &str, b: &PublicAccessBlock) -> Result<(), ApiError> {
    let config = PublicAccessBlockConfiguration::builder()
        .block_public_acls(b.block_public_acls)
        .ignore_public_acls(b.ignore_public_acls)
        .block_public_policy(b.block_public_policy)
        .restrict_public_buckets(b.restrict_public_buckets)
        .build();
    client
        .put_public_access_block()
        .bucket(bucket)
        .public_access_block_configuration(config)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutPublicAccessBlock", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn s3_put_public_access_block(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    settings: PublicAccessBlock,
) -> Result<(), ApiError> {
    put_public_access_block(&s3(&clients(&state).await?, &region)?, &bucket, &settings).await
}

#[tauri::command]
#[specta::specta]
pub async fn s3_get_bucket_lifecycle(state: State<'_, AppState>, region: String, bucket: String) -> Result<Vec<LifecycleRuleInput>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    match client.get_bucket_lifecycle_configuration().bucket(bucket).send().await {
        Ok(r) => Ok(r
            .rules()
            .iter()
            .map(|rule| LifecycleRuleInput {
                id: rule.id().unwrap_or_default().to_string(),
                enabled: rule.status() == &ExpirationStatus::Enabled,
                prefix: rule.filter().and_then(|f| f.prefix()).unwrap_or_default().to_string(),
                expiration_days: rule.expiration().and_then(|e| e.days()),
                noncurrent_expiration_days: rule.noncurrent_version_expiration().and_then(|e| e.noncurrent_days()),
                abort_multipart_days: rule.abort_incomplete_multipart_upload().and_then(|a| a.days_after_initiation()),
            })
            .collect()),
        Err(e) => {
            let e = map_sdk_error("s3:GetBucketLifecycleConfiguration", e);
            if is_code(&e, &["NoSuchLifecycleConfiguration"]) { Ok(Vec::new()) } else { Err(e) }
        }
    }
}

/// Replaces every lifecycle rule; an empty list deletes the configuration.
#[tauri::command]
#[specta::specta]
pub async fn s3_put_bucket_lifecycle(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    rules: Vec<LifecycleRuleInput>,
) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    if rules.is_empty() {
        client.delete_bucket_lifecycle().bucket(bucket).send().await.map_err(|e| map_sdk_error("s3:DeleteBucketLifecycle", e))?;
        return Ok(());
    }
    let rules = rules
        .into_iter()
        .map(|r| {
            LifecycleRule::builder()
                .id(r.id)
                .status(if r.enabled { ExpirationStatus::Enabled } else { ExpirationStatus::Disabled })
                .filter(LifecycleRuleFilter::builder().prefix(r.prefix).build())
                .set_expiration(r.expiration_days.map(|d| LifecycleExpiration::builder().days(d).build()))
                .set_noncurrent_version_expiration(
                    r.noncurrent_expiration_days.map(|d| NoncurrentVersionExpiration::builder().noncurrent_days(d).build()),
                )
                .set_abort_incomplete_multipart_upload(
                    r.abort_multipart_days.map(|d| AbortIncompleteMultipartUpload::builder().days_after_initiation(d).build()),
                )
                .build()
                .map_err(build_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let config = BucketLifecycleConfiguration::builder().set_rules(Some(rules)).build().map_err(build_error)?;
    client
        .put_bucket_lifecycle_configuration()
        .bucket(bucket)
        .lifecycle_configuration(config)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutBucketLifecycleConfiguration", e))?;
    Ok(())
}

/// One page of the folders and objects directly under `prefix`.
#[tauri::command]
#[specta::specta]
pub async fn s3_list_objects(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    prefix: String,
    next_token: Option<String>,
) -> Result<S3Listing, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(&prefix)
        .delimiter("/")
        .set_continuation_token(next_token)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:ListObjectsV2", e))?;
    Ok(S3Listing {
        folders: r.common_prefixes().iter().filter_map(|p| p.prefix().map(str::to_string)).collect(),
        objects: r
            .contents()
            .iter()
            // The folder object itself (`photos/` under prefix `photos/`) is not listed inside it.
            .filter(|o| o.key() != Some(prefix.as_str()))
            .map(|o| S3Object {
                key: o.key().unwrap_or_default().to_string(),
                size: o.size().unwrap_or(0) as f64,
                last_modified: time(o.last_modified()),
                storage_class: o.storage_class().map(|s| s.as_str().to_string()),
                etag: o.e_tag().map(str::to_string),
            })
            .collect(),
        next_token: r.next_continuation_token().map(str::to_string),
        prefix,
    })
}

/// Creates a folder: an empty object whose key ends with `/`.
#[tauri::command]
#[specta::specta]
pub async fn s3_create_folder(state: State<'_, AppState>, region: String, bucket: String, key: String) -> Result<(), ApiError> {
    let key = if key.ends_with('/') { key } else { format!("{key}/") };
    let client = s3(&clients(&state).await?, &region)?;
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from_static(b""))
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutObject", e))?;
    Ok(())
}

/// Deletes objects by key, and every object under each folder prefix.
#[tauri::command]
#[specta::specta]
pub async fn s3_delete_objects(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    keys: Vec<String>,
    prefixes: Vec<String>,
) -> Result<DeleteResult, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let mut ids = keys.iter().map(|k| identifier(k, None)).collect::<Result<Vec<_>, _>>()?;
    for prefix in prefixes.iter().filter(|p| !p.is_empty()) {
        let mut token: Option<String> = None;
        loop {
            let r = client
                .list_objects_v2()
                .bucket(&bucket)
                .prefix(prefix)
                .set_continuation_token(token.clone())
                .send()
                .await
                .map_err(|e| map_sdk_error("s3:ListObjectsV2", e))?;
            for o in r.contents() {
                ids.push(identifier(o.key().unwrap_or_default(), None)?);
            }
            token = r.next_continuation_token().map(str::to_string);
            if token.is_none() {
                break;
            }
        }
    }
    delete_identifiers(&client, &bucket, ids).await
}

/// Deletes one version of an object, permanently.
#[tauri::command]
#[specta::specta]
pub async fn s3_delete_object_version(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    key: String,
    version_id: String,
) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .version_id(version_id)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:DeleteObject", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn s3_head_object(
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    key: String,
    version_id: Option<String>,
) -> Result<S3ObjectDetails, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client
        .head_object()
        .bucket(bucket)
        .key(&key)
        .set_version_id(version_id)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:HeadObject", e))?;
    let mut metadata: Vec<Tag> = r.metadata().map(|m| m.iter().map(|(k, v)| Tag { key: k.clone(), value: v.clone() }).collect()).unwrap_or_default();
    metadata.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(S3ObjectDetails {
        key,
        size: r.content_length().unwrap_or(0) as f64,
        last_modified: time(r.last_modified()),
        etag: r.e_tag().map(str::to_string),
        content_type: r.content_type().map(str::to_string),
        storage_class: r.storage_class().map(|s| s.as_str().to_string()),
        version_id: r.version_id().map(str::to_string),
        server_side_encryption: r.server_side_encryption().map(|s| s.as_str().to_string()),
        metadata,
    })
}

/// Every version and delete marker of one key, newest first.
#[tauri::command]
#[specta::specta]
pub async fn s3_list_object_versions(state: State<'_, AppState>, region: String, bucket: String, key: String) -> Result<Vec<S3Version>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client
        .list_object_versions()
        .bucket(bucket)
        .prefix(&key)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:ListObjectVersions", e))?;
    let mut out: Vec<S3Version> = r
        .versions()
        .iter()
        .filter(|v| v.key() == Some(key.as_str()))
        .map(|v| S3Version {
            key: key.clone(),
            version_id: v.version_id().unwrap_or("null").to_string(),
            is_latest: v.is_latest().unwrap_or(false),
            delete_marker: false,
            size: v.size().unwrap_or(0) as f64,
            last_modified: time(v.last_modified()),
        })
        .collect();
    out.extend(r.delete_markers().iter().filter(|m| m.key() == Some(key.as_str())).map(|m| S3Version {
        key: key.clone(),
        version_id: m.version_id().unwrap_or("null").to_string(),
        is_latest: m.is_latest().unwrap_or(false),
        delete_marker: true,
        size: 0.0,
        last_modified: time(m.last_modified()),
    }));
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn s3_get_object_tagging(state: State<'_, AppState>, region: String, bucket: String, key: String) -> Result<Vec<Tag>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let r = client.get_object_tagging().bucket(bucket).key(key).send().await.map_err(|e| map_sdk_error("s3:GetObjectTagging", e))?;
    Ok(r.tag_set().iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect())
}

/// Replaces the object's tag set; an empty set deletes it.
#[tauri::command]
#[specta::specta]
pub async fn s3_put_object_tagging(state: State<'_, AppState>, region: String, bucket: String, key: String, tags: Vec<Tag>) -> Result<(), ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    if tags.is_empty() {
        client.delete_object_tagging().bucket(bucket).key(key).send().await.map_err(|e| map_sdk_error("s3:DeleteObjectTagging", e))?;
        return Ok(());
    }
    let tagging = Tagging::builder().set_tag_set(Some(s3_tags(&tags)?)).build().map_err(build_error)?;
    client
        .put_object_tagging()
        .bucket(bucket)
        .key(key)
        .tagging(tagging)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:PutObjectTagging", e))?;
    Ok(())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("txt" | "log" | "md") => "text/plain",
        Some("html" | "htm") => "text/html",
        Some("css") => "text/css",
        Some("js" | "mjs") => "text/javascript",
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("csv") => "text/csv",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("zip") => "application/zip",
        Some("gz") => "application/gzip",
        _ => "application/octet-stream",
    }
}

/// Uploads one local file. Small files go in one PutObject streamed from the file; larger ones in
/// parts of [`PART_SIZE`], each read from the file only while it is sent, so memory use does not
/// grow with the file. A failed multipart upload is aborted so no parts are left behind.
pub async fn upload_file(client: &Client, bucket: &str, key: &str, path: &Path, progress: &(dyn Fn(f64, f64) + Sync)) -> Result<f64, ApiError> {
    let size = tokio::fs::metadata(path).await.map_err(|e| io_error(path, e))?.len();
    let total = size as f64;
    progress(0.0, total);
    if size < MULTIPART_THRESHOLD {
        let body = ByteStream::from_path(path).await.map_err(|e| ApiError::Invalid { detail: format!("{}: {e}", path.display()) })?;
        client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_type(content_type(path))
            .body(body)
            .send()
            .await
            .map_err(|e| map_sdk_error("s3:PutObject", e))?;
        progress(total, total);
        return Ok(total);
    }
    let created = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type(content_type(path))
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:CreateMultipartUpload", e))?;
    let upload_id = created.upload_id().unwrap_or_default().to_string();
    let parts = async {
        let mut parts = Vec::new();
        let mut offset = 0u64;
        let mut number = 1i32;
        while offset < size {
            let len = PART_SIZE.min(size - offset);
            let body = ByteStream::read_from()
                .path(path)
                .offset(offset)
                .length(Length::Exact(len))
                .build()
                .await
                .map_err(|e| ApiError::Invalid { detail: format!("{}: {e}", path.display()) })?;
            let r = client
                .upload_part()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .part_number(number)
                .body(body)
                .send()
                .await
                .map_err(|e| map_sdk_error("s3:UploadPart", e))?;
            parts.push(CompletedPart::builder().part_number(number).set_e_tag(r.e_tag().map(str::to_string)).build());
            offset += len;
            number += 1;
            progress(offset as f64, total);
        }
        client
            .complete_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(&upload_id)
            .multipart_upload(CompletedMultipartUpload::builder().set_parts(Some(parts)).build())
            .send()
            .await
            .map_err(|e| map_sdk_error("s3:CompleteMultipartUpload", e))?;
        Ok::<(), ApiError>(())
    }
    .await;
    if let Err(e) = parts {
        let _ = client.abort_multipart_upload().bucket(bucket).key(key).upload_id(&upload_id).send().await;
        return Err(e);
    }
    Ok(total)
}

/// Downloads one object into `path`, chunk by chunk as the body arrives. The data goes to a
/// `.part` file first and is renamed when complete, so a failed download leaves no partial file
/// under the chosen name.
pub async fn download_to(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: Option<String>,
    path: &Path,
    progress: &(dyn Fn(f64, f64) + Sync),
) -> Result<f64, ApiError> {
    let r = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .set_version_id(version_id)
        .send()
        .await
        .map_err(|e| map_sdk_error("s3:GetObject", e))?;
    let total = r.content_length().unwrap_or(0) as f64;
    let mut body = r.body;
    let mut partial = path.as_os_str().to_owned();
    partial.push(".part");
    let partial = PathBuf::from(partial);
    let result = async {
        let mut file = tokio::fs::File::create(&partial).await.map_err(|e| io_error(&partial, e))?;
        let mut done = 0f64;
        let mut reported = 0f64;
        progress(0.0, total);
        while let Some(chunk) = body
            .try_next()
            .await
            .map_err(|e| ApiError::Transport { op: "s3:GetObject".into(), detail: e.to_string() })?
        {
            file.write_all(&chunk).await.map_err(|e| io_error(&partial, e))?;
            done += chunk.len() as f64;
            // One report per MiB keeps the channel quiet on large objects.
            if done - reported >= 1_048_576.0 {
                reported = done;
                progress(done, total);
            }
        }
        file.flush().await.map_err(|e| io_error(&partial, e))?;
        drop(file);
        tokio::fs::rename(&partial, path).await.map_err(|e| io_error(path, e))?;
        progress(done, total);
        Ok::<f64, ApiError>(done)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    result
}

/// Opens the native file picker and uploads every picked file under `prefix`, reporting progress
/// per file. Returns an empty list when the picker is cancelled. One failed file does not stop the
/// others; its result carries the error.
#[tauri::command]
#[specta::specta]
pub async fn s3_upload_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    prefix: String,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<TransferResult>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let dialog = app.dialog().file().set_title(format!("Upload to s3://{bucket}/{prefix}"));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
        .await
        .map_err(|e| ApiError::Invalid { detail: e.to_string() })?;
    let paths: Vec<PathBuf> = picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect();
    let mut results = Vec::new();
    for path in paths {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let key = format!("{prefix}{name}");
        let channel = on_progress.clone();
        let reported_key = key.clone();
        let report = move |transferred: f64, total: f64| {
            let _ = channel.send(TransferProgress { key: reported_key.clone(), transferred, total });
        };
        let outcome = upload_file(&client, &bucket, &key, &path, &report).await;
        results.push(TransferResult {
            key,
            size: outcome.as_ref().copied().unwrap_or(0.0),
            path: path.display().to_string(),
            error: outcome.err().map(|e| e.to_string()),
        });
    }
    Ok(results)
}

/// Opens the native save dialog and downloads the object there. Returns none when cancelled.
#[tauri::command]
#[specta::specta]
pub async fn s3_download_object(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    region: String,
    bucket: String,
    key: String,
    version_id: Option<String>,
    on_progress: Channel<TransferProgress>,
) -> Result<Option<TransferResult>, ApiError> {
    let client = s3(&clients(&state).await?, &region)?;
    let name = key.rsplit('/').next().unwrap_or(&key).to_string();
    let dialog = app.dialog().file().set_title(format!("Download s3://{bucket}/{key}")).set_file_name(&name);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| ApiError::Invalid { detail: e.to_string() })?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let reported_key = key.clone();
    let report = move |transferred: f64, total: f64| {
        let _ = on_progress.send(TransferProgress { key: reported_key.clone(), transferred, total });
    };
    let size = download_to(&client, &bucket, &key, version_id, &path, &report).await?;
    Ok(Some(TransferResult { key, size, path: path.display().to_string(), error: None }))
}
