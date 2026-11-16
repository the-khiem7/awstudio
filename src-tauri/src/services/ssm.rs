//! AWS Systems Manager commands of the console pages: Parameter Store, OpsCenter, documents,
//! automation, hybrid activations, resource data syncs, service settings, patch baselines, and the
//! partly supported run command, associations, managed instances and inventory reads.

use super::{build_error, time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_ssm::types::{
    AutomationExecutionFilter, AutomationExecutionFilterKey, DocumentFormat, DocumentType, OperatingSystem, OpsItemStatus, ParameterTier,
    ParameterType, ResourceDataSyncS3Destination, ResourceDataSyncS3Format, ResourceTypeForTagging, Target,
};
use aws_sdk_ssm::Client;
use aws_smithy_types::date_time::Format;
use aws_smithy_types::DateTime;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

/// Upper bound of pages one list command reads, so a misbehaving token cannot loop forever.
const MAX_PAGES: usize = 100;

fn ssm(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.ssm_in(region)
}

/// Reads every page of a list call: `$req` builds the request from the token `$tok`, `$each`
/// collects one page `$r`, and the page's `next_token` continues the loop.
macro_rules! paged {
    ($op:literal, |$tok:ident| $req:expr, |$r:ident| $each:expr) => {{
        let mut $tok: Option<String> = None;
        let mut pages = 0usize;
        loop {
            let $r = $req.send().await.map_err(|e| map_sdk_error($op, e))?;
            $each;
            $tok = $r.next_token().map(str::to_string);
            pages += 1;
            if $tok.is_none() || pages >= MAX_PAGES {
                break;
            }
        }
    }};
}

fn s(v: Option<&str>) -> Option<String> {
    v.map(str::to_string)
}

/// Text of an SDK enum value.
fn en<T: AsRef<str>>(v: Option<&T>) -> Option<String> {
    v.map(|e| e.as_ref().to_string())
}

fn blank(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.trim().is_empty())
}

fn non_empty<T>(v: Vec<T>) -> Option<Vec<T>> {
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn ssm_tags(tags: Vec<Tag>) -> Result<Vec<aws_sdk_ssm::types::Tag>, ApiError> {
    tags.into_iter().map(|t| aws_sdk_ssm::types::Tag::builder().key(t.key).value(t.value).build().map_err(build_error)).collect()
}

fn tags_of(tags: &[aws_sdk_ssm::types::Tag]) -> Vec<Tag> {
    tags.iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect()
}

fn parse_time(text: &str) -> Result<DateTime, ApiError> {
    DateTime::from_str(text.trim(), Format::DateTime).map_err(|_| ApiError::Invalid { detail: format!("{text:?} is not an RFC 3339 date and time") })
}

// ---------------------------------------------------------------- Parameter Store

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmParameterMeta {
    pub name: String,
    pub param_type: String,
    pub tier: String,
    pub description: Option<String>,
    pub last_modified: Option<String>,
    pub last_modified_user: Option<String>,
    pub version: f64,
    pub data_type: Option<String>,
    pub key_id: Option<String>,
    pub arn: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_describe_parameters(state: State<'_, AppState>, region: String) -> Result<Vec<SsmParameterMeta>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:DescribeParameters", |token| client.describe_parameters().set_next_token(token.clone()), |r| {
        out.extend(r.parameters().iter().map(|p| SsmParameterMeta {
            name: p.name().unwrap_or_default().to_string(),
            param_type: en(p.r#type()).unwrap_or_else(|| "String".into()),
            tier: en(p.tier()).unwrap_or_else(|| "Standard".into()),
            description: s(p.description()).filter(|d| !d.is_empty()),
            last_modified: time(p.last_modified_date()),
            last_modified_user: s(p.last_modified_user()),
            version: p.version() as f64,
            data_type: s(p.data_type()),
            key_id: s(p.key_id()),
            arn: s(p.arn()),
        }))
    });
    Ok(out)
}

/// A parameter with its value. The value can be a decrypted secret: no `Debug`.
#[derive(Clone, Serialize, Type)]
pub struct SsmParameterValue {
    pub name: String,
    pub param_type: String,
    /// The plain value, or the ciphertext of a `SecureString` read without decryption.
    pub value: String,
    pub version: f64,
    pub last_modified: Option<String>,
    pub arn: Option<String>,
    pub data_type: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_get_parameter(state: State<'_, AppState>, region: String, name: String, decrypt: bool) -> Result<SsmParameterValue, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client.get_parameter().name(&name).with_decryption(decrypt).send().await.map_err(|e| map_sdk_error("ssm:GetParameter", e))?;
    let p = r.parameter().ok_or_else(|| ApiError::Invalid { detail: format!("the emulator returned no parameter {name}") })?;
    Ok(SsmParameterValue {
        name: p.name().unwrap_or(&name).to_string(),
        param_type: en(p.r#type()).unwrap_or_else(|| "String".into()),
        value: p.value().unwrap_or_default().to_string(),
        version: p.version() as f64,
        last_modified: time(p.last_modified_date()),
        arn: s(p.arn()),
        data_type: s(p.data_type()),
    })
}

/// One stored version of a parameter. The value can be a decrypted secret: no `Debug`.
#[derive(Clone, Serialize, Type)]
pub struct SsmParameterVersion {
    pub version: f64,
    pub value: String,
    pub param_type: String,
    pub last_modified: Option<String>,
    pub last_modified_user: Option<String>,
    pub description: Option<String>,
    pub labels: Vec<String>,
    pub tier: Option<String>,
    /// The text of each parameter policy.
    pub policies: Vec<String>,
    pub key_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_get_parameter_history(state: State<'_, AppState>, region: String, name: String, decrypt: bool) -> Result<Vec<SsmParameterVersion>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!(
        "ssm:GetParameterHistory",
        |token| client.get_parameter_history().name(&name).with_decryption(decrypt).set_next_token(token.clone()),
        |r| {
            out.extend(r.parameters().iter().map(|p| SsmParameterVersion {
                version: p.version() as f64,
                value: p.value().unwrap_or_default().to_string(),
                param_type: en(p.r#type()).unwrap_or_else(|| "String".into()),
                last_modified: time(p.last_modified_date()),
                last_modified_user: s(p.last_modified_user()),
                description: s(p.description()).filter(|d| !d.is_empty()),
                labels: p.labels().to_vec(),
                tier: en(p.tier()),
                policies: p.policies().iter().filter_map(|x| s(x.policy_text())).collect(),
                key_id: s(p.key_id()),
            }))
        }
    );
    Ok(out)
}

/// The value is the content to store, possibly a secret: no `Debug`.
#[derive(Clone, Deserialize, Type)]
pub struct SsmPutParameterInput {
    pub name: String,
    pub description: Option<String>,
    pub value: String,
    /// `String`, `StringList` or `SecureString`.
    pub param_type: String,
    pub key_id: Option<String>,
    pub overwrite: bool,
    pub tier: Option<String>,
    pub data_type: Option<String>,
    pub allowed_pattern: Option<String>,
    /// Ignored when `overwrite` is true: AWS refuses tags together with an overwrite.
    pub tags: Vec<Tag>,
}

/// Creates or overwrites a parameter and returns the new version.
#[tauri::command]
#[specta::specta]
pub async fn ssm_put_parameter(state: State<'_, AppState>, region: String, input: SsmPutParameterInput) -> Result<f64, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let tags = if input.overwrite { Vec::new() } else { ssm_tags(input.tags)? };
    let r = client
        .put_parameter()
        .name(input.name)
        .value(input.value)
        .r#type(ParameterType::from(input.param_type.as_str()))
        .set_description(blank(input.description))
        .set_key_id(blank(input.key_id))
        .overwrite(input.overwrite)
        .set_tier(blank(input.tier).map(|t| ParameterTier::from(t.as_str())))
        .set_data_type(blank(input.data_type))
        .set_allowed_pattern(blank(input.allowed_pattern))
        .set_tags(non_empty(tags))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:PutParameter", e))?;
    Ok(r.version() as f64)
}

/// Deletes parameters; one name uses `DeleteParameter`, several use `DeleteParameters` in batches of ten, the API limit.
#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_parameters(state: State<'_, AppState>, region: String, names: Vec<String>) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    if names.len() == 1 {
        client.delete_parameter().name(&names[0]).send().await.map_err(|e| map_sdk_error("ssm:DeleteParameter", e))?;
        return Ok(());
    }
    for batch in names.chunks(10) {
        client.delete_parameters().set_names(Some(batch.to_vec())).send().await.map_err(|e| map_sdk_error("ssm:DeleteParameters", e))?;
    }
    Ok(())
}

/// Attaches labels to a version, to the latest one when `version` is empty.
#[tauri::command]
#[specta::specta]
pub async fn ssm_label_version(state: State<'_, AppState>, region: String, name: String, version: Option<f64>, labels: Vec<String>) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .label_parameter_version()
        .name(name)
        .set_parameter_version(version.map(|v| v as i64))
        .set_labels(Some(labels))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:LabelParameterVersion", e))?;
    if !r.invalid_labels().is_empty() {
        return Err(ApiError::Invalid { detail: format!("these labels were refused: {}", r.invalid_labels().join(", ")) });
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_unlabel_version(state: State<'_, AppState>, region: String, name: String, version: f64, labels: Vec<String>) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client
        .unlabel_parameter_version()
        .name(name)
        .parameter_version(version as i64)
        .set_labels(Some(labels))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:UnlabelParameterVersion", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_list_tags(state: State<'_, AppState>, region: String, resource_type: String, resource_id: String) -> Result<Vec<Tag>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .list_tags_for_resource()
        .resource_type(ResourceTypeForTagging::from(resource_type.as_str()))
        .resource_id(resource_id)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:ListTagsForResource", e))?;
    Ok(tags_of(r.tag_list()))
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves. `resource_type` is `Parameter`, `Document`, `OpsItem` and so on.
#[tauri::command]
#[specta::specta]
pub async fn ssm_update_tags(
    state: State<'_, AppState>,
    region: String,
    resource_type: String,
    resource_id: String,
    set: Vec<Tag>,
    remove: Vec<String>,
) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let kind = ResourceTypeForTagging::from(resource_type.as_str());
    if !set.is_empty() {
        client
            .add_tags_to_resource()
            .resource_type(kind.clone())
            .resource_id(&resource_id)
            .set_tags(Some(ssm_tags(set)?))
            .send()
            .await
            .map_err(|e| map_sdk_error("ssm:AddTagsToResource", e))?;
    }
    if !remove.is_empty() {
        client
            .remove_tags_from_resource()
            .resource_type(kind)
            .resource_id(&resource_id)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("ssm:RemoveTagsFromResource", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- OpsCenter

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmOpsItemSummary {
    pub id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub source: Option<String>,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub created: Option<String>,
    pub last_modified: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_list_ops_items(state: State<'_, AppState>, region: String) -> Result<Vec<SsmOpsItemSummary>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:DescribeOpsItems", |token| client.describe_ops_items().set_next_token(token.clone()), |r| {
        out.extend(r.ops_item_summaries().iter().map(|o| SsmOpsItemSummary {
            id: o.ops_item_id().unwrap_or_default().to_string(),
            title: s(o.title()),
            status: en(o.status()),
            priority: o.priority(),
            source: s(o.source()),
            category: s(o.category()),
            severity: s(o.severity()),
            created: time(o.created_time()),
            last_modified: time(o.last_modified_time()),
        }))
    });
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmOpsItem {
    pub id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub source: Option<String>,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub created: Option<String>,
    pub last_modified: Option<String>,
    pub description: Option<String>,
    pub created_by: Option<String>,
    pub operational_data: HashMap<String, String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_get_ops_item(state: State<'_, AppState>, region: String, id: String) -> Result<SsmOpsItem, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client.get_ops_item().ops_item_id(&id).send().await.map_err(|e| map_sdk_error("ssm:GetOpsItem", e))?;
    let o = r.ops_item().ok_or_else(|| ApiError::Invalid { detail: format!("the emulator returned no OpsItem {id}") })?;
    Ok(SsmOpsItem {
        id: o.ops_item_id().unwrap_or(&id).to_string(),
        title: s(o.title()),
        status: en(o.status()),
        priority: o.priority(),
        source: s(o.source()),
        category: s(o.category()),
        severity: s(o.severity()),
        created: time(o.created_time()),
        last_modified: time(o.last_modified_time()),
        description: s(o.description()),
        created_by: s(o.created_by()),
        operational_data: o
            .operational_data()
            .map(|d| d.iter().map(|(k, v)| (k.clone(), v.value().unwrap_or_default().to_string())).collect())
            .unwrap_or_default(),
    })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct SsmCreateOpsItemInput {
    pub title: String,
    pub description: String,
    pub source: String,
    pub priority: Option<i32>,
    pub category: Option<String>,
    pub severity: Option<String>,
}

/// Creates an OpsItem and returns its id.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_ops_item(state: State<'_, AppState>, region: String, input: SsmCreateOpsItemInput) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .create_ops_item()
        .title(input.title)
        .description(input.description)
        .source(input.source)
        .set_priority(input.priority)
        .set_category(blank(input.category))
        .set_severity(blank(input.severity))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreateOpsItem", e))?;
    Ok(r.ops_item_id().unwrap_or_default().to_string())
}

/// Changes only the fields that are set.
#[tauri::command]
#[specta::specta]
pub async fn ssm_update_ops_item(
    state: State<'_, AppState>,
    region: String,
    id: String,
    title: Option<String>,
    description: Option<String>,
    status: Option<String>,
    priority: Option<i32>,
) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client
        .update_ops_item()
        .ops_item_id(id)
        .set_title(blank(title))
        .set_description(description)
        .set_status(blank(status).map(|v| OpsItemStatus::from(v.as_str())))
        .set_priority(priority)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:UpdateOpsItem", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_ops_item(state: State<'_, AppState>, region: String, id: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client.delete_ops_item().ops_item_id(id).send().await.map_err(|e| map_sdk_error("ssm:DeleteOpsItem", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Documents

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmDocumentInfo {
    pub name: String,
    pub document_type: String,
    pub document_format: String,
    pub status: String,
    pub owner: Option<String>,
    pub created: Option<String>,
    pub document_version: String,
    pub default_version: Option<String>,
    pub latest_version: Option<String>,
    pub description: Option<String>,
    pub platform_types: Vec<String>,
    pub target_type: Option<String>,
    pub schema_version: Option<String>,
    pub tags: Vec<Tag>,
}

fn document_info(d: &aws_sdk_ssm::types::DocumentDescription) -> SsmDocumentInfo {
    SsmDocumentInfo {
        name: d.name().unwrap_or_default().to_string(),
        document_type: en(d.document_type()).unwrap_or_default(),
        document_format: en(d.document_format()).unwrap_or_else(|| "JSON".into()),
        status: en(d.status()).unwrap_or_else(|| "Active".into()),
        owner: s(d.owner()),
        created: time(d.created_date()),
        document_version: s(d.document_version()).unwrap_or_else(|| "1".into()),
        default_version: s(d.default_version()),
        latest_version: s(d.latest_version()),
        description: s(d.description()).filter(|x| !x.is_empty()),
        platform_types: d.platform_types().iter().map(|p| p.as_str().to_string()).collect(),
        target_type: s(d.target_type()),
        schema_version: s(d.schema_version()),
        tags: tags_of(d.tags()),
    }
}

async fn describe_document_in(client: &Client, name: &str) -> Result<SsmDocumentInfo, ApiError> {
    let r = client.describe_document().name(name).send().await.map_err(|e| map_sdk_error("ssm:DescribeDocument", e))?;
    let d = r.document().ok_or_else(|| ApiError::Invalid { detail: format!("the emulator returned no document {name}") })?;
    Ok(document_info(d))
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_describe_document(state: State<'_, AppState>, region: String, name: String) -> Result<SsmDocumentInfo, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    describe_document_in(&client, &name).await
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmDocumentContent {
    pub name: String,
    pub content: String,
    pub document_type: String,
    pub document_format: String,
    pub document_version: String,
}

/// Reads the content of a document version, the default version when `version` is empty.
#[tauri::command]
#[specta::specta]
pub async fn ssm_get_document(state: State<'_, AppState>, region: String, name: String, version: Option<String>) -> Result<SsmDocumentContent, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .get_document()
        .name(&name)
        .set_document_version(blank(version))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:GetDocument", e))?;
    Ok(SsmDocumentContent {
        name: r.name().unwrap_or(&name).to_string(),
        content: r.content().unwrap_or_default().to_string(),
        document_type: en(r.document_type()).unwrap_or_default(),
        document_format: en(r.document_format()).unwrap_or_else(|| "JSON".into()),
        document_version: s(r.document_version()).unwrap_or_default(),
    })
}

/// `document_type` is `Command`, `Automation`, `Session` and so on; `document_format` is `JSON`, `YAML` or `TEXT`.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_document(
    state: State<'_, AppState>,
    region: String,
    name: String,
    content: String,
    document_type: String,
    document_format: String,
    target_type: Option<String>,
    tags: Vec<Tag>,
) -> Result<SsmDocumentInfo, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .create_document()
        .name(&name)
        .content(content)
        .document_type(DocumentType::from(document_type.as_str()))
        .document_format(DocumentFormat::from(document_format.as_str()))
        .set_target_type(blank(target_type))
        .set_tags(non_empty(ssm_tags(tags)?))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreateDocument", e))?;
    match r.document_description() {
        Some(d) => Ok(document_info(d)),
        None => describe_document_in(&client, &name).await,
    }
}

/// Stores `content` as a new version of the document and returns its version number.
#[tauri::command]
#[specta::specta]
pub async fn ssm_update_document(
    state: State<'_, AppState>,
    region: String,
    name: String,
    content: String,
    document_format: Option<String>,
) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .update_document()
        .name(name)
        .content(content)
        .document_version("$LATEST")
        .set_document_format(blank(document_format).map(|f| DocumentFormat::from(f.as_str())))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:UpdateDocument", e))?;
    Ok(r.document_description().and_then(|d| d.document_version().or(d.latest_version())).unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_set_default_document_version(state: State<'_, AppState>, region: String, name: String, version: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client
        .update_document_default_version()
        .name(name)
        .document_version(version)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:UpdateDocumentDefaultVersion", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_document(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client.delete_document().name(name).send().await.map_err(|e| map_sdk_error("ssm:DeleteDocument", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Automation

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmAutomationExecution {
    pub id: String,
    pub document_name: String,
    pub document_version: Option<String>,
    pub status: String,
    pub mode: Option<String>,
    pub executed_by: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub failure_message: Option<String>,
    /// Filled only when one execution is asked for by id: the list API does not return parameters.
    pub parameters: HashMap<String, Vec<String>>,
    pub outputs: HashMap<String, Vec<String>>,
}

/// Lists executions, or the one execution `execution_id` names (then with its parameters).
#[tauri::command]
#[specta::specta]
pub async fn ssm_describe_automation_executions(
    state: State<'_, AppState>,
    region: String,
    execution_id: Option<String>,
) -> Result<Vec<SsmAutomationExecution>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let id = blank(execution_id);
    let filters = match &id {
        Some(id) => Some(vec![AutomationExecutionFilter::builder()
            .key(AutomationExecutionFilterKey::ExecutionId)
            .values(id)
            .build()
            .map_err(build_error)?]),
        None => None,
    };
    let mut out = Vec::new();
    paged!(
        "ssm:DescribeAutomationExecutions",
        |token| client.describe_automation_executions().set_filters(filters.clone()).set_next_token(token.clone()),
        |r| {
            out.extend(r.automation_execution_metadata_list().iter().map(|e| SsmAutomationExecution {
                id: e.automation_execution_id().unwrap_or_default().to_string(),
                document_name: e.document_name().unwrap_or_default().to_string(),
                document_version: s(e.document_version()),
                status: en(e.automation_execution_status()).unwrap_or_default(),
                mode: en(e.mode()),
                executed_by: s(e.executed_by()),
                start_time: time(e.execution_start_time()),
                end_time: time(e.execution_end_time()),
                failure_message: s(e.failure_message()).filter(|m| !m.is_empty()),
                parameters: HashMap::new(),
                outputs: e.outputs().cloned().unwrap_or_default(),
            }))
        }
    );
    if let Some(id) = &id {
        // Best effort: the detail read only adds the parameters, so a failure leaves them empty.
        if let Ok(r) = client.get_automation_execution().automation_execution_id(id).send().await {
            if let Some(p) = r.automation_execution().and_then(|a| a.parameters()) {
                for e in out.iter_mut().filter(|e| &e.id == id) {
                    e.parameters = p.clone();
                }
            }
        }
    }
    Ok(out)
}

/// Starts an automation and returns its execution id.
#[tauri::command]
#[specta::specta]
pub async fn ssm_start_automation(
    state: State<'_, AppState>,
    region: String,
    document_name: String,
    parameters: HashMap<String, Vec<String>>,
    document_version: Option<String>,
) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .start_automation_execution()
        .document_name(document_name)
        .set_document_version(blank(document_version))
        .set_parameters(if parameters.is_empty() { None } else { Some(parameters) })
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:StartAutomationExecution", e))?;
    Ok(r.automation_execution_id().unwrap_or_default().to_string())
}

// ---------------------------------------------------------------- Hybrid activations

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmActivation {
    pub id: String,
    pub description: Option<String>,
    pub default_instance_name: Option<String>,
    pub iam_role: Option<String>,
    pub registration_limit: i32,
    pub registrations_count: i32,
    pub expiration_date: Option<String>,
    pub expired: bool,
    pub created: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_describe_activations(state: State<'_, AppState>, region: String) -> Result<Vec<SsmActivation>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:DescribeActivations", |token| client.describe_activations().set_next_token(token.clone()), |r| {
        out.extend(r.activation_list().iter().map(|a| SsmActivation {
            id: a.activation_id().unwrap_or_default().to_string(),
            description: s(a.description()).filter(|d| !d.is_empty()),
            default_instance_name: s(a.default_instance_name()),
            iam_role: s(a.iam_role()),
            registration_limit: a.registration_limit().unwrap_or(0),
            registrations_count: a.registrations_count().unwrap_or(0),
            expiration_date: time(a.expiration_date()),
            expired: a.expired(),
            created: time(a.created_date()),
        }))
    });
    Ok(out)
}

/// The activation code registers machines and AWS shows it once: no `Debug`.
#[derive(Clone, Serialize, Type)]
pub struct SsmNewActivation {
    pub activation_id: String,
    pub activation_code: String,
}

/// `expiration_date` is RFC 3339 text.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_activation(
    state: State<'_, AppState>,
    region: String,
    description: Option<String>,
    default_instance_name: Option<String>,
    iam_role: String,
    registration_limit: Option<i32>,
    expiration_date: Option<String>,
) -> Result<SsmNewActivation, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let expires = blank(expiration_date).map(|d| parse_time(&d)).transpose()?;
    let r = client
        .create_activation()
        .iam_role(iam_role)
        .set_description(blank(description))
        .set_default_instance_name(blank(default_instance_name))
        .set_registration_limit(registration_limit)
        .set_expiration_date(expires)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreateActivation", e))?;
    Ok(SsmNewActivation {
        activation_id: r.activation_id().unwrap_or_default().to_string(),
        activation_code: r.activation_code().unwrap_or_default().to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_activation(state: State<'_, AppState>, region: String, id: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client.delete_activation().activation_id(id).send().await.map_err(|e| map_sdk_error("ssm:DeleteActivation", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Resource data sync

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmDataSync {
    pub name: String,
    pub sync_type: Option<String>,
    pub s3_bucket: Option<String>,
    pub s3_prefix: Option<String>,
    pub s3_region: Option<String>,
    pub last_status: Option<String>,
    pub last_sync_time: Option<String>,
    pub created: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_list_resource_data_syncs(state: State<'_, AppState>, region: String) -> Result<Vec<SsmDataSync>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:ListResourceDataSync", |token| client.list_resource_data_sync().set_next_token(token.clone()), |r| {
        out.extend(r.resource_data_sync_items().iter().map(|d| {
            let dest = d.s3_destination();
            SsmDataSync {
                name: d.sync_name().unwrap_or_default().to_string(),
                sync_type: s(d.sync_type()),
                s3_bucket: dest.map(|x| x.bucket_name().to_string()),
                s3_prefix: dest.and_then(|x| s(x.prefix())),
                s3_region: dest.map(|x| x.region().to_string()),
                last_status: en(d.last_status()),
                last_sync_time: time(d.last_sync_time()),
                created: time(d.sync_created_time()),
            }
        }))
    });
    Ok(out)
}

/// Creates a `SyncToDestination` sync into an S3 bucket; `sync_format` defaults to `JsonSerDe`.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_resource_data_sync(
    state: State<'_, AppState>,
    region: String,
    name: String,
    bucket_name: String,
    prefix: Option<String>,
    bucket_region: String,
    sync_format: Option<String>,
) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let format = blank(sync_format).map(|f| ResourceDataSyncS3Format::from(f.as_str())).unwrap_or(ResourceDataSyncS3Format::JsonSerde);
    let destination = ResourceDataSyncS3Destination::builder()
        .bucket_name(bucket_name)
        .set_prefix(blank(prefix))
        .sync_format(format)
        .region(bucket_region)
        .build()
        .map_err(build_error)?;
    client
        .create_resource_data_sync()
        .sync_name(name)
        .sync_type("SyncToDestination")
        .s3_destination(destination)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreateResourceDataSync", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_resource_data_sync(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client.delete_resource_data_sync().sync_name(name).send().await.map_err(|e| map_sdk_error("ssm:DeleteResourceDataSync", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Service settings

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmServiceSetting {
    pub setting_id: String,
    pub setting_value: String,
    pub status: String,
    pub last_modified: Option<String>,
    pub last_modified_user: Option<String>,
    pub arn: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_get_service_setting(state: State<'_, AppState>, region: String, setting_id: String) -> Result<SsmServiceSetting, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client.get_service_setting().setting_id(&setting_id).send().await.map_err(|e| map_sdk_error("ssm:GetServiceSetting", e))?;
    let v = r.service_setting().ok_or_else(|| ApiError::Invalid { detail: format!("the emulator returned no setting {setting_id}") })?;
    Ok(SsmServiceSetting {
        setting_id: v.setting_id().unwrap_or(&setting_id).to_string(),
        setting_value: v.setting_value().unwrap_or_default().to_string(),
        status: v.status().unwrap_or_default().to_string(),
        last_modified: time(v.last_modified_date()),
        last_modified_user: s(v.last_modified_user()),
        arn: s(v.arn()),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_update_service_setting(state: State<'_, AppState>, region: String, setting_id: String, setting_value: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client
        .update_service_setting()
        .setting_id(setting_id)
        .setting_value(setting_value)
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:UpdateServiceSetting", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Patch Manager

/// Creates a patch baseline and returns its id. `operating_system` is `WINDOWS`, `AMAZON_LINUX_2` and so on.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_patch_baseline(
    state: State<'_, AppState>,
    region: String,
    name: String,
    operating_system: String,
    description: Option<String>,
    approved_patches: Vec<String>,
) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .create_patch_baseline()
        .name(name)
        .operating_system(OperatingSystem::from(operating_system.as_str()))
        .set_description(blank(description))
        .set_approved_patches(if approved_patches.is_empty() { None } else { Some(approved_patches) })
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreatePatchBaseline", e))?;
    Ok(r.baseline_id().unwrap_or_default().to_string())
}

/// Returns the id of the default patch baseline of an operating system (`WINDOWS` when empty on AWS).
#[tauri::command]
#[specta::specta]
pub async fn ssm_get_default_patch_baseline(state: State<'_, AppState>, region: String, operating_system: Option<String>) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .get_default_patch_baseline()
        .set_operating_system(blank(operating_system).map(|o| OperatingSystem::from(o.as_str())))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:GetDefaultPatchBaseline", e))?;
    Ok(r.baseline_id().unwrap_or_default().to_string())
}

// ---------------------------------------------------------------- Run Command (partly supported)

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmCommand {
    pub command_id: String,
    pub document_name: Option<String>,
    pub status: String,
    pub requested: Option<String>,
    pub comment: Option<String>,
    pub target_count: i32,
    pub completed_count: i32,
    pub error_count: i32,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_list_commands(state: State<'_, AppState>, region: String) -> Result<Vec<SsmCommand>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:ListCommands", |token| client.list_commands().set_next_token(token.clone()), |r| {
        out.extend(r.commands().iter().map(|c| SsmCommand {
            command_id: c.command_id().unwrap_or_default().to_string(),
            document_name: s(c.document_name()),
            status: en(c.status()).unwrap_or_default(),
            requested: time(c.requested_date_time()),
            comment: s(c.comment()).filter(|x| !x.is_empty()),
            target_count: c.target_count(),
            completed_count: c.completed_count(),
            error_count: c.error_count(),
        }))
    });
    Ok(out)
}

/// Sends a command to instances and returns the command id.
#[tauri::command]
#[specta::specta]
pub async fn ssm_send_command(
    state: State<'_, AppState>,
    region: String,
    document_name: String,
    instance_ids: Vec<String>,
    parameters: HashMap<String, Vec<String>>,
    comment: Option<String>,
) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let r = client
        .send_command()
        .document_name(document_name)
        .set_instance_ids(non_empty(instance_ids))
        .set_parameters(if parameters.is_empty() { None } else { Some(parameters) })
        .set_comment(blank(comment))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:SendCommand", e))?;
    Ok(r.command().and_then(|c| c.command_id()).unwrap_or_default().to_string())
}

// ---------------------------------------------------------------- Associations (partly supported)

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmAssociation {
    pub association_id: Option<String>,
    pub name: Option<String>,
    pub association_name: Option<String>,
    pub schedule: Option<String>,
    /// Each target as `key=value1,value2`.
    pub targets: Vec<String>,
    pub last_execution_date: Option<String>,
    pub overview_status: Option<String>,
}

/// `key=value1,value2`, the form the console shows a target in.
fn render_target(key: Option<&str>, values: &[String]) -> String {
    format!("{}={}", key.unwrap_or_default(), values.join(","))
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_list_associations(state: State<'_, AppState>, region: String) -> Result<Vec<SsmAssociation>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:ListAssociations", |token| client.list_associations().set_next_token(token.clone()), |r| {
        out.extend(r.associations().iter().map(|a| SsmAssociation {
            association_id: s(a.association_id()),
            name: s(a.name()),
            association_name: s(a.association_name()),
            schedule: s(a.schedule_expression()),
            targets: a.targets().iter().map(|t| render_target(t.key(), t.values())).collect(),
            last_execution_date: time(a.last_execution_date()),
            overview_status: a.overview().and_then(|o| s(o.status())),
        }))
    });
    Ok(out)
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct SsmTarget {
    /// `InstanceIds`, `tag:<name>` or `resource-groups:Name`.
    pub key: String,
    pub values: Vec<String>,
}

/// Creates an association and returns its id.
#[tauri::command]
#[specta::specta]
pub async fn ssm_create_association(
    state: State<'_, AppState>,
    region: String,
    name: String,
    targets: Vec<SsmTarget>,
    schedule_expression: Option<String>,
    association_name: Option<String>,
) -> Result<String, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let targets: Vec<Target> = targets.into_iter().map(|t| Target::builder().key(t.key).set_values(Some(t.values)).build()).collect();
    let r = client
        .create_association()
        .name(name)
        .set_targets(non_empty(targets))
        .set_schedule_expression(blank(schedule_expression))
        .set_association_name(blank(association_name))
        .send()
        .await
        .map_err(|e| map_sdk_error("ssm:CreateAssociation", e))?;
    Ok(r.association_description().and_then(|d| d.association_id()).unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_delete_association(state: State<'_, AppState>, region: String, association_id: String) -> Result<(), ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    client.delete_association().association_id(association_id).send().await.map_err(|e| map_sdk_error("ssm:DeleteAssociation", e))?;
    Ok(())
}

// ---------------------------------------------------------------- Managed instances and inventory (read only)

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmManagedInstance {
    pub instance_id: String,
    pub ping_status: Option<String>,
    pub platform_name: Option<String>,
    pub platform_type: Option<String>,
    pub platform_version: Option<String>,
    pub agent_version: Option<String>,
    pub ip_address: Option<String>,
    pub computer_name: Option<String>,
    pub last_ping: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_describe_instance_information(state: State<'_, AppState>, region: String) -> Result<Vec<SsmManagedInstance>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:DescribeInstanceInformation", |token| client.describe_instance_information().set_next_token(token.clone()), |r| {
        out.extend(r.instance_information_list().iter().map(|i| SsmManagedInstance {
            instance_id: i.instance_id().unwrap_or_default().to_string(),
            ping_status: en(i.ping_status()),
            platform_name: s(i.platform_name()),
            platform_type: en(i.platform_type()),
            platform_version: s(i.platform_version()),
            agent_version: s(i.agent_version()),
            ip_address: s(i.ip_address()),
            computer_name: s(i.computer_name()),
            last_ping: time(i.last_ping_date_time()),
        }))
    });
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SsmInventoryEntity {
    pub id: String,
    /// The earliest capture time among the entity's inventory types, as the API reports it.
    pub capture_time: Option<String>,
    /// The inventory type names, for example `AWS:InstanceInformation`.
    pub content_types: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ssm_get_inventory(state: State<'_, AppState>, region: String) -> Result<Vec<SsmInventoryEntity>, ApiError> {
    let client = ssm(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    paged!("ssm:GetInventory", |token| client.get_inventory().set_next_token(token.clone()), |r| {
        out.extend(r.entities().iter().map(|e| {
            let mut content_types: Vec<String> = e.data().map(|d| d.keys().cloned().collect()).unwrap_or_default();
            content_types.sort();
            let capture_time = e.data().and_then(|d| d.values().filter_map(|i| i.capture_time()).filter(|t| !t.is_empty()).min()).map(str::to_string);
            SsmInventoryEntity { id: e.id().unwrap_or_default().to_string(), capture_time, content_types }
        }))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_render_as_key_equals_values() {
        assert_eq!(render_target(Some("InstanceIds"), &["i-1".into(), "i-2".into()]), "InstanceIds=i-1,i-2");
        assert_eq!(render_target(Some("tag:Env"), &[]), "tag:Env=");
        assert_eq!(render_target(None, &["x".into()]), "=x");
    }

    #[test]
    fn expiration_is_read_as_rfc_3339() {
        assert_eq!(parse_time("2030-01-02T03:04:05Z").unwrap().secs(), 1893553445);
        assert!(parse_time("tomorrow").is_err());
    }

    #[test]
    fn blank_text_counts_as_absent() {
        assert_eq!(blank(Some("  ".into())), None);
        assert_eq!(blank(Some("a".into())), Some("a".into()));
        assert_eq!(blank(None), None);
    }
}
