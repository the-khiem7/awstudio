//! AWS KMS commands of the console pages: keys, rotation, key policy, aliases, tags and grants.

use super::{build_error, time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_kms::types::{KeyMetadata, KeySpec, KeyUsageType};
use aws_sdk_kms::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

/// Upper bound of pages one listing follows, so a misbehaving marker cannot loop forever.
const MAX_PAGES: usize = 100;

fn kms(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.kms_in(region)
}

/// One key as the keys table and the details page show it.
#[derive(Debug, Clone, Serialize, Type)]
pub struct KmsKey {
    pub key_id: String,
    pub arn: String,
    pub description: String,
    /// `Enabled`, `Disabled`, `PendingDeletion` and the other KMS key states.
    pub key_state: String,
    pub enabled: bool,
    pub key_usage: String,
    pub key_spec: String,
    /// `AWS` or `CUSTOMER`.
    pub key_manager: String,
    pub origin: String,
    pub creation_date: Option<String>,
    /// Set while the key is pending deletion.
    pub deletion_date: Option<String>,
    pub multi_region: bool,
}

fn key_of(m: &KeyMetadata) -> KmsKey {
    KmsKey {
        key_id: m.key_id().to_string(),
        arn: m.arn().unwrap_or_default().to_string(),
        description: m.description().unwrap_or_default().to_string(),
        key_state: m.key_state().map(|s| s.as_str().to_string()).unwrap_or_default(),
        enabled: m.enabled(),
        key_usage: m.key_usage().map(|s| s.as_str().to_string()).unwrap_or_default(),
        key_spec: m.key_spec().map(|s| s.as_str().to_string()).unwrap_or_default(),
        key_manager: m.key_manager().map(|s| s.as_str().to_string()).unwrap_or_default(),
        origin: m.origin().map(|s| s.as_str().to_string()).unwrap_or_default(),
        creation_date: time(m.creation_date()),
        deletion_date: time(m.deletion_date()),
        multi_region: m.multi_region().unwrap_or(false),
    }
}

async fn describe(client: &Client, key_id: &str) -> Result<KmsKey, ApiError> {
    let r = client.describe_key().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:DescribeKey", e))?;
    r.key_metadata().map(key_of).ok_or_else(|| ApiError::Invalid { detail: format!("the response for key {key_id} carries no key metadata") })
}

/// Lists every key, then describes each one for its state and attributes.
#[tauri::command]
#[specta::specta]
pub async fn kms_list_keys(state: State<'_, AppState>, region: String) -> Result<Vec<KmsKey>, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let mut ids = Vec::new();
    let mut marker: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client.list_keys().set_marker(marker.clone()).send().await.map_err(|e| map_sdk_error("kms:ListKeys", e))?;
        ids.extend(r.keys().iter().filter_map(|k| k.key_id().map(str::to_string)));
        marker = if r.truncated() { r.next_marker().map(str::to_string) } else { None };
        if marker.is_none() {
            break;
        }
    }
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(describe(&client, &id).await?);
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn kms_describe_key(state: State<'_, AppState>, region: String, key_id: String) -> Result<KmsKey, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    describe(&client, &key_id).await
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct KmsCreateKeyInput {
    pub description: String,
    /// `ENCRYPT_DECRYPT`, `SIGN_VERIFY`, `GENERATE_VERIFY_MAC` or `KEY_AGREEMENT`; empty keeps the default.
    pub key_usage: String,
    /// `SYMMETRIC_DEFAULT`, `RSA_2048`, `ECC_NIST_P256`, `HMAC_256` and the other key specs; empty keeps the default.
    pub key_spec: String,
    pub multi_region: bool,
    /// Key policy JSON; `None` lets KMS apply the default policy.
    pub policy: Option<String>,
    pub tags: Vec<Tag>,
}

fn kms_tags(tags: Vec<Tag>) -> Result<Vec<aws_sdk_kms::types::Tag>, ApiError> {
    tags.into_iter().map(|t| aws_sdk_kms::types::Tag::builder().tag_key(t.key).tag_value(t.value).build().map_err(build_error)).collect()
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.trim().is_empty())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_create_key(state: State<'_, AppState>, region: String, input: KmsCreateKeyInput) -> Result<KmsKey, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let tags = kms_tags(input.tags)?;
    let r = client
        .create_key()
        .set_description(non_empty(Some(input.description)))
        .set_key_usage(non_empty(Some(input.key_usage)).map(|u| KeyUsageType::from(u.as_str())))
        .set_key_spec(non_empty(Some(input.key_spec)).map(|s| KeySpec::from(s.as_str())))
        .multi_region(input.multi_region)
        .set_policy(non_empty(input.policy))
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("kms:CreateKey", e))?;
    r.key_metadata().map(key_of).ok_or_else(|| ApiError::Invalid { detail: "the response carries no key metadata".into() })
}

#[tauri::command]
#[specta::specta]
pub async fn kms_enable_key(state: State<'_, AppState>, region: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.enable_key().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:EnableKey", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_disable_key(state: State<'_, AppState>, region: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.disable_key().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:DisableKey", e))?;
    Ok(())
}

/// Schedules the deletion and returns the deletion date as RFC 3339 text, when the response carries one.
#[tauri::command]
#[specta::specta]
pub async fn kms_schedule_key_deletion(
    state: State<'_, AppState>,
    region: String,
    key_id: String,
    pending_window_days: i32,
) -> Result<Option<String>, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let r = client
        .schedule_key_deletion()
        .key_id(key_id)
        .pending_window_in_days(pending_window_days)
        .send()
        .await
        .map_err(|e| map_sdk_error("kms:ScheduleKeyDeletion", e))?;
    Ok(time(r.deletion_date()))
}

#[tauri::command]
#[specta::specta]
pub async fn kms_cancel_key_deletion(state: State<'_, AppState>, region: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.cancel_key_deletion().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:CancelKeyDeletion", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct KmsRotation {
    pub enabled: bool,
    pub period_in_days: Option<i32>,
    pub next_rotation_date: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn kms_get_rotation_status(state: State<'_, AppState>, region: String, key_id: String) -> Result<KmsRotation, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let r = client.get_key_rotation_status().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:GetKeyRotationStatus", e))?;
    Ok(KmsRotation { enabled: r.key_rotation_enabled(), period_in_days: r.rotation_period_in_days(), next_rotation_date: time(r.next_rotation_date()) })
}

/// Turns automatic rotation on (with an optional period in days) or off. `period_in_days` is ignored when disabling.
#[tauri::command]
#[specta::specta]
pub async fn kms_set_rotation(
    state: State<'_, AppState>,
    region: String,
    key_id: String,
    enabled: bool,
    period_in_days: Option<i32>,
) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    if enabled {
        client
            .enable_key_rotation()
            .key_id(key_id)
            .set_rotation_period_in_days(period_in_days)
            .send()
            .await
            .map_err(|e| map_sdk_error("kms:EnableKeyRotation", e))?;
    } else {
        client.disable_key_rotation().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:DisableKeyRotation", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_rotate_on_demand(state: State<'_, AppState>, region: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.rotate_key_on_demand().key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:RotateKeyOnDemand", e))?;
    Ok(())
}

/// The key policy named `default`, the only policy name KMS supports.
#[tauri::command]
#[specta::specta]
pub async fn kms_get_key_policy(state: State<'_, AppState>, region: String, key_id: String) -> Result<String, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let r = client.get_key_policy().key_id(key_id).policy_name("default").send().await.map_err(|e| map_sdk_error("kms:GetKeyPolicy", e))?;
    Ok(r.policy().unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_put_key_policy(state: State<'_, AppState>, region: String, key_id: String, policy: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.put_key_policy().key_id(key_id).policy_name("default").policy(policy).send().await.map_err(|e| map_sdk_error("kms:PutKeyPolicy", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct KmsAlias {
    pub alias_name: String,
    pub alias_arn: String,
    pub target_key_id: Option<String>,
}

/// Lists aliases, of one key when `key_id` is given, otherwise of the whole Region.
#[tauri::command]
#[specta::specta]
pub async fn kms_list_aliases(state: State<'_, AppState>, region: String, key_id: Option<String>) -> Result<Vec<KmsAlias>, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut marker: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_aliases()
            .set_key_id(non_empty(key_id.clone()))
            .set_marker(marker.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("kms:ListAliases", e))?;
        out.extend(r.aliases().iter().map(|a| KmsAlias {
            alias_name: a.alias_name().unwrap_or_default().to_string(),
            alias_arn: a.alias_arn().unwrap_or_default().to_string(),
            target_key_id: a.target_key_id().map(str::to_string),
        }));
        marker = if r.truncated() { r.next_marker().map(str::to_string) } else { None };
        if marker.is_none() {
            break;
        }
    }
    Ok(out)
}

/// `alias_name` carries the `alias/` prefix KMS requires.
#[tauri::command]
#[specta::specta]
pub async fn kms_create_alias(state: State<'_, AppState>, region: String, alias_name: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.create_alias().alias_name(alias_name).target_key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:CreateAlias", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_delete_alias(state: State<'_, AppState>, region: String, alias_name: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.delete_alias().alias_name(alias_name).send().await.map_err(|e| map_sdk_error("kms:DeleteAlias", e))?;
    Ok(())
}

/// Points an existing alias at another key.
#[tauri::command]
#[specta::specta]
pub async fn kms_update_alias(state: State<'_, AppState>, region: String, alias_name: String, key_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.update_alias().alias_name(alias_name).target_key_id(key_id).send().await.map_err(|e| map_sdk_error("kms:UpdateAlias", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_list_tags(state: State<'_, AppState>, region: String, key_id: String) -> Result<Vec<Tag>, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut marker: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_resource_tags()
            .key_id(&key_id)
            .set_marker(marker.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("kms:ListResourceTags", e))?;
        out.extend(r.tags().iter().map(|t| Tag { key: t.tag_key().to_string(), value: t.tag_value().to_string() }));
        marker = if r.truncated() { r.next_marker().map(str::to_string) } else { None };
        if marker.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn kms_update_tags(state: State<'_, AppState>, region: String, key_id: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_resource()
            .key_id(&key_id)
            .set_tags(Some(kms_tags(set)?))
            .send()
            .await
            .map_err(|e| map_sdk_error("kms:TagResource", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_resource()
            .key_id(&key_id)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("kms:UntagResource", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kms_update_description(state: State<'_, AppState>, region: String, key_id: String, description: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client
        .update_key_description()
        .key_id(key_id)
        .description(description)
        .send()
        .await
        .map_err(|e| map_sdk_error("kms:UpdateKeyDescription", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct KmsGrant {
    pub grant_id: String,
    pub name: Option<String>,
    pub grantee_principal: String,
    pub retiring_principal: Option<String>,
    /// Operation names such as `Decrypt` and `GenerateDataKey`.
    pub operations: Vec<String>,
    pub creation_date: Option<String>,
    pub issuing_account: String,
}

#[tauri::command]
#[specta::specta]
pub async fn kms_list_grants(state: State<'_, AppState>, region: String, key_id: String) -> Result<Vec<KmsGrant>, ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut marker: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client.list_grants().key_id(&key_id).set_marker(marker.clone()).send().await.map_err(|e| map_sdk_error("kms:ListGrants", e))?;
        out.extend(r.grants().iter().map(|g| KmsGrant {
            grant_id: g.grant_id().unwrap_or_default().to_string(),
            name: g.name().filter(|n| !n.is_empty()).map(str::to_string),
            grantee_principal: g.grantee_principal().unwrap_or_default().to_string(),
            retiring_principal: g.retiring_principal().map(str::to_string),
            operations: g.operations().iter().map(|o| o.as_str().to_string()).collect(),
            creation_date: time(g.creation_date()),
            issuing_account: g.issuing_account().unwrap_or_default().to_string(),
        }));
        marker = if r.truncated() { r.next_marker().map(str::to_string) } else { None };
        if marker.is_none() {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn kms_revoke_grant(state: State<'_, AppState>, region: String, key_id: String, grant_id: String) -> Result<(), ApiError> {
    let client = kms(&clients(&state).await?, &region)?;
    client.revoke_grant().key_id(key_id).grant_id(grant_id).send().await.map_err(|e| map_sdk_error("kms:RevokeGrant", e))?;
    Ok(())
}
