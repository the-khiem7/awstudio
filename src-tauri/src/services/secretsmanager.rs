//! AWS Secrets Manager commands of the console pages: secrets, values, versions, tags, resource policies and rotation.
//!
//! Secret values and generated passwords are sensitive: they are never logged, and the structs that carry them do not derive `Debug`.

use super::{time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_secretsmanager::types::RotationRulesType;
use aws_sdk_secretsmanager::Client;
use aws_smithy_types::Blob;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

/// Pages read before a list call gives up, so a misbehaving next token cannot loop forever.
const MAX_PAGES: usize = 100;

fn sm(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.secretsmanager_in(region)
}

/// An empty text field of a form means "not set".
fn blank(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

/// Decodes a base64 secret payload into the blob the API takes.
fn decode_blob(b64: &str) -> Result<Blob, ApiError> {
    aws_smithy_types::base64::decode(b64.trim())
        .map(Blob::new)
        .map_err(|_| ApiError::Invalid { detail: "the binary secret is not valid base64".into() })
}

fn sm_tags(tags: Vec<Tag>) -> Vec<aws_sdk_secretsmanager::types::Tag> {
    tags.into_iter().map(|t| aws_sdk_secretsmanager::types::Tag::builder().key(t.key).value(t.value).build()).collect()
}

fn tags_of(tags: &[aws_sdk_secretsmanager::types::Tag]) -> Vec<Tag> {
    tags.iter().map(|t| Tag { key: t.key().unwrap_or_default().to_string(), value: t.value().unwrap_or_default().to_string() }).collect()
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SmSecretSummary {
    pub name: String,
    pub arn: String,
    pub description: Option<String>,
    pub kms_key_id: Option<String>,
    pub rotation_enabled: bool,
    pub last_changed: Option<String>,
    pub last_accessed: Option<String>,
    pub created: Option<String>,
    /// Set while the secret is scheduled for deletion.
    pub deleted: Option<String>,
    pub tags: Vec<Tag>,
}

fn summary_of(s: &aws_sdk_secretsmanager::types::SecretListEntry) -> SmSecretSummary {
    SmSecretSummary {
        name: s.name().unwrap_or_default().to_string(),
        arn: s.arn().unwrap_or_default().to_string(),
        description: s.description().filter(|d| !d.is_empty()).map(str::to_string),
        kms_key_id: s.kms_key_id().filter(|d| !d.is_empty()).map(str::to_string),
        rotation_enabled: s.rotation_enabled().unwrap_or(false),
        last_changed: time(s.last_changed_date()),
        last_accessed: time(s.last_accessed_date()),
        created: time(s.created_date()),
        deleted: time(s.deleted_date()),
        tags: tags_of(s.tags()),
    }
}

/// Lists the secrets of the Region, including the ones scheduled for deletion.
#[tauri::command]
#[specta::specta]
pub async fn sm_list_secrets(state: State<'_, AppState>, region: String) -> Result<Vec<SmSecretSummary>, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_secrets()
            .include_planned_deletion(true)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("secrets-manager:ListSecrets", e))?;
        out.extend(r.secret_list().iter().map(summary_of));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SmVersionStages {
    pub version_id: String,
    pub stages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SmReplication {
    pub region: String,
    pub status: Option<String>,
    pub status_message: Option<String>,
    pub kms_key_id: Option<String>,
    pub last_accessed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SmSecretDetails {
    pub summary: SmSecretSummary,
    pub rotation_lambda_arn: Option<String>,
    pub automatically_after_days: Option<f64>,
    pub last_rotated: Option<String>,
    pub next_rotation: Option<String>,
    pub primary_region: Option<String>,
    pub owning_service: Option<String>,
    pub version_ids_to_stages: Vec<SmVersionStages>,
    pub replication_status: Vec<SmReplication>,
}

/// Describes one secret. `id` is the name or the ARN.
#[tauri::command]
#[specta::specta]
pub async fn sm_describe_secret(state: State<'_, AppState>, region: String, id: String) -> Result<SmSecretDetails, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let r = client.describe_secret().secret_id(id).send().await.map_err(|e| map_sdk_error("secrets-manager:DescribeSecret", e))?;
    let mut versions: Vec<SmVersionStages> = r
        .version_ids_to_stages()
        .map(|m| m.iter().map(|(v, s)| SmVersionStages { version_id: v.clone(), stages: s.clone() }).collect())
        .unwrap_or_default();
    versions.sort_by(|a, b| a.version_id.cmp(&b.version_id));
    Ok(SmSecretDetails {
        summary: SmSecretSummary {
            name: r.name().unwrap_or_default().to_string(),
            arn: r.arn().unwrap_or_default().to_string(),
            description: r.description().filter(|d| !d.is_empty()).map(str::to_string),
            kms_key_id: r.kms_key_id().filter(|d| !d.is_empty()).map(str::to_string),
            rotation_enabled: r.rotation_enabled().unwrap_or(false),
            last_changed: time(r.last_changed_date()),
            last_accessed: time(r.last_accessed_date()),
            created: time(r.created_date()),
            deleted: time(r.deleted_date()),
            tags: tags_of(r.tags()),
        },
        rotation_lambda_arn: r.rotation_lambda_arn().filter(|d| !d.is_empty()).map(str::to_string),
        automatically_after_days: r.rotation_rules().and_then(|x| x.automatically_after_days()).map(|d| d as f64),
        last_rotated: time(r.last_rotated_date()),
        next_rotation: time(r.next_rotation_date()),
        primary_region: r.primary_region().map(str::to_string),
        owning_service: r.owning_service().map(str::to_string),
        version_ids_to_stages: versions,
        replication_status: r
            .replication_status()
            .iter()
            .map(|x| SmReplication {
                region: x.region().unwrap_or_default().to_string(),
                status: x.status().map(|s| s.as_str().to_string()),
                status_message: x.status_message().map(str::to_string),
                kms_key_id: x.kms_key_id().map(str::to_string),
                last_accessed: time(x.last_accessed_date()),
            })
            .collect(),
    })
}

/// Input of `sm_create_secret`. Carries the secret value, so it does not derive `Debug`.
#[derive(Clone, Deserialize, Type)]
pub struct SmCreateInput {
    pub name: String,
    pub description: Option<String>,
    pub kms_key_id: Option<String>,
    pub secret_string: Option<String>,
    pub secret_binary_base64: Option<String>,
    pub tags: Vec<Tag>,
}

/// Creates a secret and returns its ARN.
#[tauri::command]
#[specta::specta]
pub async fn sm_create_secret(state: State<'_, AppState>, region: String, input: SmCreateInput) -> Result<String, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let tags = sm_tags(input.tags);
    let binary = blank(input.secret_binary_base64).map(|b| decode_blob(&b)).transpose()?;
    let r = client
        .create_secret()
        .name(input.name)
        .set_description(blank(input.description))
        .set_kms_key_id(blank(input.kms_key_id))
        .set_secret_string(input.secret_string)
        .set_secret_binary(binary)
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:CreateSecret", e))?;
    Ok(r.arn().unwrap_or_default().to_string())
}

/// A secret version with its value. Sensitive: no `Debug`.
#[derive(Clone, Serialize, Type)]
pub struct SmSecretValue {
    pub name: String,
    pub arn: String,
    pub version_id: Option<String>,
    pub version_stages: Vec<String>,
    pub created: Option<String>,
    pub secret_string: Option<String>,
    pub secret_binary_base64: Option<String>,
}

/// Reads a secret value; without `version_id` and `version_stage` it returns `AWSCURRENT`.
#[tauri::command]
#[specta::specta]
pub async fn sm_get_secret_value(
    state: State<'_, AppState>,
    region: String,
    id: String,
    version_id: Option<String>,
    version_stage: Option<String>,
) -> Result<SmSecretValue, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let r = client
        .get_secret_value()
        .secret_id(id)
        .set_version_id(blank(version_id))
        .set_version_stage(blank(version_stage))
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:GetSecretValue", e))?;
    Ok(SmSecretValue {
        name: r.name().unwrap_or_default().to_string(),
        arn: r.arn().unwrap_or_default().to_string(),
        version_id: r.version_id().map(str::to_string),
        version_stages: r.version_stages().to_vec(),
        created: time(r.created_date()),
        secret_string: r.secret_string().map(str::to_string),
        secret_binary_base64: r.secret_binary().map(|b| aws_smithy_types::base64::encode(b.as_ref())),
    })
}

/// Stores a new version and returns its version id.
#[tauri::command]
#[specta::specta]
pub async fn sm_put_secret_value(
    state: State<'_, AppState>,
    region: String,
    id: String,
    secret_string: Option<String>,
    secret_binary_base64: Option<String>,
) -> Result<String, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let binary = blank(secret_binary_base64).map(|b| decode_blob(&b)).transpose()?;
    let r = client
        .put_secret_value()
        .secret_id(id)
        .set_secret_string(secret_string)
        .set_secret_binary(binary)
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:PutSecretValue", e))?;
    Ok(r.version_id().unwrap_or_default().to_string())
}

/// Changes the description and the KMS key; `None` leaves a field as it is.
#[tauri::command]
#[specta::specta]
pub async fn sm_update_secret(
    state: State<'_, AppState>,
    region: String,
    id: String,
    description: Option<String>,
    kms_key_id: Option<String>,
) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    client
        .update_secret()
        .secret_id(id)
        .set_description(description)
        .set_kms_key_id(blank(kms_key_id))
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:UpdateSecret", e))?;
    Ok(())
}

/// Deletes a secret: scheduled after `recovery_window_days` (default 30 on the service side) or at once with `force_delete`.
#[tauri::command]
#[specta::specta]
pub async fn sm_delete_secret(
    state: State<'_, AppState>,
    region: String,
    id: String,
    recovery_window_days: Option<i32>,
    force_delete: bool,
) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let req = client.delete_secret().secret_id(id);
    // The API refuses a recovery window together with force-delete, so only one of them is sent.
    let req = if force_delete {
        req.force_delete_without_recovery(true)
    } else {
        req.set_recovery_window_in_days(recovery_window_days.map(i64::from))
    };
    req.send().await.map_err(|e| map_sdk_error("secrets-manager:DeleteSecret", e))?;
    Ok(())
}

/// Cancels the scheduled deletion of a secret.
#[tauri::command]
#[specta::specta]
pub async fn sm_restore_secret(state: State<'_, AppState>, region: String, id: String) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    client.restore_secret().secret_id(id).send().await.map_err(|e| map_sdk_error("secrets-manager:RestoreSecret", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SmSecretVersion {
    pub version_id: String,
    pub stages: Vec<String>,
    pub created: Option<String>,
    pub last_accessed: Option<String>,
}

/// Lists the versions of a secret, deprecated ones included.
#[tauri::command]
#[specta::specta]
pub async fn sm_list_secret_versions(state: State<'_, AppState>, region: String, id: String) -> Result<Vec<SmSecretVersion>, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_secret_version_ids()
            .secret_id(&id)
            .include_deprecated(true)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("secrets-manager:ListSecretVersionIds", e))?;
        out.extend(r.versions().iter().map(|v| SmSecretVersion {
            version_id: v.version_id().unwrap_or_default().to_string(),
            stages: v.version_stages().to_vec(),
            created: time(v.created_date()),
            last_accessed: time(v.last_accessed_date()),
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn sm_update_tags(state: State<'_, AppState>, region: String, id: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_resource()
            .secret_id(&id)
            .set_tags(Some(sm_tags(set)))
            .send()
            .await
            .map_err(|e| map_sdk_error("secrets-manager:TagResource", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_resource()
            .secret_id(&id)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("secrets-manager:UntagResource", e))?;
    }
    Ok(())
}

/// Reads the resource policy; `None` when the secret has none.
#[tauri::command]
#[specta::specta]
pub async fn sm_get_resource_policy(state: State<'_, AppState>, region: String, id: String) -> Result<Option<String>, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let r = client.get_resource_policy().secret_id(id).send().await.map_err(|e| map_sdk_error("secrets-manager:GetResourcePolicy", e))?;
    Ok(r.resource_policy().filter(|p| !p.trim().is_empty()).map(str::to_string))
}

#[tauri::command]
#[specta::specta]
pub async fn sm_put_resource_policy(state: State<'_, AppState>, region: String, id: String, policy: String, block_public: bool) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    client
        .put_resource_policy()
        .secret_id(id)
        .resource_policy(policy)
        .block_public_policy(block_public)
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:PutResourcePolicy", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sm_delete_resource_policy(state: State<'_, AppState>, region: String, id: String) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    client.delete_resource_policy().secret_id(id).send().await.map_err(|e| map_sdk_error("secrets-manager:DeleteResourcePolicy", e))?;
    Ok(())
}

/// Configures rotation (Lambda and schedule) and optionally rotates at once.
#[tauri::command]
#[specta::specta]
pub async fn sm_rotate_secret(
    state: State<'_, AppState>,
    region: String,
    id: String,
    rotation_lambda_arn: Option<String>,
    automatically_after_days: Option<i32>,
    rotate_immediately: bool,
) -> Result<(), ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let rules = automatically_after_days.map(|d| RotationRulesType::builder().automatically_after_days(i64::from(d)).build());
    client
        .rotate_secret()
        .secret_id(id)
        .set_rotation_lambda_arn(blank(rotation_lambda_arn))
        .set_rotation_rules(rules)
        .rotate_immediately(rotate_immediately)
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:RotateSecret", e))?;
    Ok(())
}

/// Generates a random password. The result is sensitive.
#[tauri::command]
#[specta::specta]
pub async fn sm_get_random_password(state: State<'_, AppState>, region: String, length: i32, exclude_punctuation: bool) -> Result<String, ApiError> {
    let client = sm(&clients(&state).await?, &region)?;
    let r = client
        .get_random_password()
        .password_length(i64::from(length))
        .exclude_punctuation(exclude_punctuation)
        .send()
        .await
        .map_err(|e| map_sdk_error("secrets-manager:GetRandomPassword", e))?;
    Ok(r.random_password().unwrap_or_default().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_drops_empty_text() {
        assert_eq!(blank(Some(String::new())), None);
        assert_eq!(blank(Some("a".into())), Some("a".into()));
        assert_eq!(blank(None), None);
    }

    #[test]
    fn decode_blob_accepts_base64_and_rejects_text() {
        assert_eq!(decode_blob("aGk=").unwrap().as_ref(), b"hi");
        assert!(matches!(decode_blob("not base64 !"), Err(ApiError::Invalid { .. })));
    }
}
