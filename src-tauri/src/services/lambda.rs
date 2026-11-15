//! AWS Lambda commands of the console pages: functions, code, test invocations, versions, aliases
//! and the read-only configuration views.
//!
//! The emulator hands out a function's deployment package as a presigned URL on its own endpoint;
//! the backend downloads it (the WebView never fetches an emulator URL) and unpacks it so the Code
//! tab can edit the text files in it, then packs the edited files into a new archive to deploy.

use super::{build_error, is_code, time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_lambda::primitives::Blob;
use aws_sdk_lambda::types::{Architecture, Environment, FunctionCode, FunctionConfiguration, LastUpdateStatus, LogType, Runtime, State as FnState};
use aws_sdk_lambda::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use tauri::State;

/// Largest deployment package the Code tab downloads.
const MAX_PACKAGE_BYTES: usize = 50 * 1024 * 1024;
/// Largest file the Code tab opens as text.
const MAX_TEXT_BYTES: u64 = 512 * 1024;
/// Most entries the Code tab lists.
const MAX_ENTRIES: usize = 2000;

fn lambda(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.lambda_in(region)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LambdaFunction {
    pub name: String,
    pub arn: String,
    pub runtime: Option<String>,
    pub handler: Option<String>,
    pub description: Option<String>,
    pub role: Option<String>,
    pub version: Option<String>,
    /// `Pending`, `Active`, `Inactive` or `Failed`.
    pub state: Option<String>,
    pub state_reason: Option<String>,
    /// `InProgress`, `Successful` or `Failed`.
    pub last_update_status: Option<String>,
    /// RFC 3339 text of the last modification when the emulator's text parses, else the text itself.
    pub last_modified: Option<String>,
    pub code_size: f64,
    pub memory_size: Option<f64>,
    pub timeout: Option<f64>,
    pub ephemeral_storage: Option<f64>,
    pub package_type: Option<String>,
    pub architectures: Vec<String>,
    pub environment: HashMap<String, String>,
}

fn function_of(c: &FunctionConfiguration) -> LambdaFunction {
    LambdaFunction {
        name: c.function_name().unwrap_or_default().to_string(),
        arn: c.function_arn().unwrap_or_default().to_string(),
        runtime: c.runtime().map(|r| r.as_str().to_string()),
        handler: c.handler().map(str::to_string),
        description: c.description().filter(|d| !d.is_empty()).map(str::to_string),
        role: c.role().map(str::to_string),
        version: c.version().map(str::to_string),
        state: c.state().map(|s| s.as_str().to_string()),
        state_reason: c.state_reason().map(str::to_string),
        last_update_status: c.last_update_status().map(|s| s.as_str().to_string()),
        last_modified: c.last_modified().map(str::to_string),
        code_size: c.code_size() as f64,
        memory_size: c.memory_size().map(f64::from),
        timeout: c.timeout().map(f64::from),
        ephemeral_storage: c.ephemeral_storage().map(|e| f64::from(e.size())),
        package_type: c.package_type().map(|p| p.as_str().to_string()),
        architectures: c.architectures().iter().map(|a| a.as_str().to_string()).collect(),
        environment: c.environment().and_then(|e| e.variables()).cloned().unwrap_or_default(),
    }
}

// Account and functions ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct LambdaAccount {
    pub function_count: f64,
    pub total_code_size: f64,
    pub code_size_limit: f64,
    pub concurrent_executions: f64,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_account_settings(state: State<'_, AppState>, region: String) -> Result<LambdaAccount, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let r = client.get_account_settings().send().await.map_err(|e| map_sdk_error("lambda:GetAccountSettings", e))?;
    Ok(LambdaAccount {
        function_count: r.account_usage().map(|u| u.function_count() as f64).unwrap_or(0.0),
        total_code_size: r.account_usage().map(|u| u.total_code_size() as f64).unwrap_or(0.0),
        code_size_limit: r.account_limit().map(|l| l.total_code_size() as f64).unwrap_or(0.0),
        concurrent_executions: r.account_limit().map(|l| f64::from(l.concurrent_executions())).unwrap_or(0.0),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_list_functions(state: State<'_, AppState>, region: String) -> Result<Vec<LambdaFunction>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut pages = client.list_functions().into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("lambda:ListFunctions", e))?.functions().iter().map(function_of));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LambdaFunctionDetails {
    pub function: LambdaFunction,
    /// `S3` for a .zip package, `ECR` for a container image.
    pub code_repository: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_get_function(state: State<'_, AppState>, region: String, name: String, qualifier: Option<String>) -> Result<LambdaFunctionDetails, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let r = client.get_function().function_name(name).set_qualifier(qualifier).send().await.map_err(|e| map_sdk_error("lambda:GetFunction", e))?;
    let function = r.configuration().map(function_of).ok_or_else(|| build_error("GetFunction returned no configuration"))?;
    Ok(LambdaFunctionDetails { function, code_repository: r.code().and_then(|c| c.repository_type()).map(str::to_string) })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateFunctionInput {
    pub name: String,
    pub runtime: String,
    pub handler: String,
    /// ARN of the execution role.
    pub role: String,
    pub description: Option<String>,
    pub architecture: String,
    pub memory_size: f64,
    pub timeout: f64,
    pub environment: HashMap<String, String>,
    pub tags: Vec<Tag>,
    /// The file inside the package that holds the handler, for example `index.js`.
    pub file_name: String,
    pub source: String,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_create_function(state: State<'_, AppState>, region: String, input: CreateFunctionInput) -> Result<String, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let package = write_zip(None, &[CodeFileInput { name: input.file_name, text: Some(input.source) }])?;
    let env = if input.environment.is_empty() { None } else { Some(Environment::builder().set_variables(Some(input.environment)).build()) };
    let tags: HashMap<String, String> = input.tags.into_iter().map(|t| (t.key, t.value)).collect();
    let r = client
        .create_function()
        .function_name(&input.name)
        .runtime(Runtime::from(input.runtime.as_str()))
        .handler(input.handler)
        .role(input.role)
        .set_description(input.description.filter(|d| !d.is_empty()))
        .architectures(Architecture::from(input.architecture.as_str()))
        .memory_size(input.memory_size as i32)
        .timeout(input.timeout as i32)
        .set_environment(env)
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .code(FunctionCode::builder().zip_file(Blob::new(package)).build())
        .send()
        .await
        .map_err(|e| map_sdk_error("lambda:CreateFunction", e))?;
    Ok(r.function_name().map(str::to_string).unwrap_or(input.name))
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_delete_function(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    client.delete_function().function_name(name).send().await.map_err(|e| map_sdk_error("lambda:DeleteFunction", e))?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct UpdateConfigurationInput {
    pub description: String,
    pub handler: String,
    pub memory_size: f64,
    pub timeout: f64,
    pub environment: HashMap<String, String>,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_update_configuration(state: State<'_, AppState>, region: String, name: String, input: UpdateConfigurationInput) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    wait_ready(&client, &name, &None).await?;
    client
        .update_function_configuration()
        .function_name(name)
        .description(input.description)
        .handler(input.handler)
        .memory_size(input.memory_size as i32)
        .timeout(input.timeout as i32)
        .environment(Environment::builder().set_variables(Some(input.environment)).build())
        .send()
        .await
        .map_err(|e| map_sdk_error("lambda:UpdateFunctionConfiguration", e))?;
    Ok(())
}

// Code ---------------------------------------------------------------------------------------------

/// One file of a deployment package as the Code tab shows it.
#[derive(Debug, Clone, Serialize, Type)]
pub struct CodeFile {
    pub name: String,
    pub size: f64,
    /// The file's text; `None` for a file that is binary or too large to edit here.
    pub text: Option<String>,
}

/// One file of the package to deploy: new text, or `None` to keep the bytes the package holds now.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct CodeFileInput {
    pub name: String,
    pub text: Option<String>,
}

fn invalid(detail: impl Into<String>) -> ApiError {
    ApiError::Invalid { detail: detail.into() }
}

/// A path inside a package: relative, no `..`, no drive or backslash tricks.
fn valid_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 512
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && name.split('/').all(|part| part != ".." && part != ".")
        && !name.chars().any(char::is_control)
}

fn read_zip(bytes: &[u8]) -> Result<Vec<CodeFile>, ApiError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| invalid(format!("the deployment package is not a zip archive: {e}")))?;
    if archive.len() > MAX_ENTRIES {
        return Err(invalid(format!("the package holds {} entries; the Code tab lists at most {MAX_ENTRIES}", archive.len())));
    }
    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| invalid(e.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(|e| invalid(e.to_string()))?.into_owned();
        let size = entry.size();
        let text = if size <= MAX_TEXT_BYTES {
            let mut buf = Vec::with_capacity(size as usize);
            (&mut entry).take(MAX_TEXT_BYTES).read_to_end(&mut buf).map_err(|e| invalid(e.to_string()))?;
            String::from_utf8(buf).ok().filter(|t| !t.contains('\0'))
        } else {
            None
        };
        files.push(CodeFile { name, size: size as f64, text });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Packs `files` into a zip. A file with text is written from that text; a file without text is
/// copied as it is from `existing`, which the caller passes when some files keep their bytes.
fn write_zip(existing: Option<&[u8]>, files: &[CodeFileInput]) -> Result<Vec<u8>, ApiError> {
    if files.is_empty() {
        return Err(invalid("the package needs at least one file"));
    }
    let mut seen = std::collections::HashSet::new();
    for f in files {
        if !valid_entry_name(&f.name) {
            return Err(invalid(format!("{:?} is not a valid file name inside a package", f.name)));
        }
        if !seen.insert(f.name.as_str()) {
            return Err(invalid(format!("{:?} appears twice", f.name)));
        }
    }
    let mut old = match existing {
        Some(b) => Some(zip::ZipArchive::new(Cursor::new(b)).map_err(|e| invalid(e.to_string()))?),
        None => None,
    };
    let mut out = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for f in files {
            match &f.text {
                Some(text) => {
                    writer.start_file(&f.name, options).map_err(|e| invalid(e.to_string()))?;
                    writer.write_all(text.as_bytes()).map_err(|e| invalid(e.to_string()))?;
                }
                None => {
                    let archive = old.as_mut().ok_or_else(|| invalid(format!("{:?} has no text and no earlier package to copy from", f.name)))?;
                    let index = (0..archive.len()).find(|&i| archive.name_for_index(i).and_then(|n| n.ok()).is_some_and(|n| n == f.name.as_str())).ok_or_else(|| invalid(format!("{:?} is not in the current package", f.name)))?;
                    let entry = archive.by_index_raw(index).map_err(|e| invalid(e.to_string()))?;
                    writer.raw_copy_file(entry).map_err(|e| invalid(e.to_string()))?;
                }
            }
        }
        writer.finish().map_err(|e| invalid(e.to_string()))?;
    }
    Ok(out.into_inner())
}

/// The deployment package of a function (or one of its versions), downloaded through the backend.
async fn package_of(client: &Client, c: &Clients, name: &str, qualifier: Option<String>) -> Result<Vec<u8>, ApiError> {
    let r = client.get_function().function_name(name).set_qualifier(qualifier).send().await.map_err(|e| map_sdk_error("lambda:GetFunction", e))?;
    let location = r.code().and_then(|c| c.location()).ok_or_else(|| invalid("the function has no downloadable code (a container image has none)"))?;
    c.fetch("lambda:GetFunction", location, MAX_PACKAGE_BYTES).await
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_get_function_code(state: State<'_, AppState>, region: String, name: String, qualifier: Option<String>) -> Result<Vec<CodeFile>, ApiError> {
    let c = clients(&state).await?;
    let client = lambda(&c, &region)?;
    read_zip(&package_of(&client, &c, &name, qualifier).await?)
}

/// Packs the files and deploys them with `UpdateFunctionCode`. Files with no text keep the bytes of
/// the package the function holds now.
#[tauri::command]
#[specta::specta]
pub async fn lambda_deploy_code(state: State<'_, AppState>, region: String, name: String, files: Vec<CodeFileInput>) -> Result<LambdaFunction, ApiError> {
    let c = clients(&state).await?;
    let client = lambda(&c, &region)?;
    // An earlier create or update may still be running; Lambda refuses a second update meanwhile.
    wait_ready(&client, &name, &None).await?;
    let existing = if files.iter().any(|f| f.text.is_none()) { Some(package_of(&client, &c, &name, None).await?) } else { None };
    let package = write_zip(existing.as_deref(), &files)?;
    let r = client.update_function_code().function_name(name).zip_file(Blob::new(package)).send().await.map_err(|e| map_sdk_error("lambda:UpdateFunctionCode", e))?;
    Ok(LambdaFunction {
        name: r.function_name().unwrap_or_default().to_string(),
        arn: r.function_arn().unwrap_or_default().to_string(),
        runtime: r.runtime().map(|v| v.as_str().to_string()),
        handler: r.handler().map(str::to_string),
        description: None,
        role: r.role().map(str::to_string),
        version: r.version().map(str::to_string),
        state: r.state().map(|s| s.as_str().to_string()),
        state_reason: r.state_reason().map(str::to_string),
        last_update_status: r.last_update_status().map(|s| s.as_str().to_string()),
        last_modified: r.last_modified().map(str::to_string),
        code_size: r.code_size() as f64,
        memory_size: r.memory_size().map(f64::from),
        timeout: r.timeout().map(f64::from),
        ephemeral_storage: None,
        package_type: None,
        architectures: Vec::new(),
        environment: HashMap::new(),
    })
}

// Test invocations ---------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct InvokeResult {
    pub status: f64,
    /// `Handled` or `Unhandled` when the function failed.
    pub function_error: Option<String>,
    pub executed_version: Option<String>,
    /// The last 4 KB of the function's log, decoded.
    pub log: Option<String>,
    pub payload: String,
}

/// Waits until a function that was just created or updated has finished: Lambda refuses an invoke
/// while the function is `Pending` or its last update is in progress.
async fn wait_ready(client: &Client, name: &str, qualifier: &Option<String>) -> Result<(), ApiError> {
    for _ in 0..80 {
        let c = client.get_function_configuration().function_name(name).set_qualifier(qualifier.clone()).send().await.map_err(|e| map_sdk_error("lambda:GetFunctionConfiguration", e))?;
        let pending = c.state() == Some(&FnState::Pending) || c.last_update_status() == Some(&LastUpdateStatus::InProgress);
        if !pending {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err(invalid("the function is still being created or updated after 40 seconds"))
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_invoke(state: State<'_, AppState>, region: String, name: String, qualifier: Option<String>, payload: String) -> Result<InvokeResult, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let call = || {
        client.invoke().function_name(&name).set_qualifier(qualifier.clone()).log_type(LogType::Tail).payload(Blob::new(payload.clone().into_bytes())).send()
    };
    let r = match call().await {
        Ok(r) => r,
        Err(e) => {
            let mapped = map_sdk_error("lambda:Invoke", e);
            if !is_code(&mapped, &["ResourceConflictException"]) {
                return Err(mapped);
            }
            wait_ready(&client, &name, &qualifier).await?;
            call().await.map_err(|e| map_sdk_error("lambda:Invoke", e))?
        }
    };
    let log = r
        .log_result()
        .and_then(|l| aws_smithy_types::base64::decode(l).ok())
        .map(|b| String::from_utf8_lossy(&b).to_string());
    Ok(InvokeResult {
        status: f64::from(r.status_code()),
        function_error: r.function_error().map(str::to_string),
        executed_version: r.executed_version().map(str::to_string),
        log,
        payload: r.payload().map(|b| String::from_utf8_lossy(b.as_ref()).to_string()).unwrap_or_default(),
    })
}

// Versions and aliases -----------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn lambda_list_versions(state: State<'_, AppState>, region: String, name: String) -> Result<Vec<LambdaFunction>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut pages = client.list_versions_by_function().function_name(name).into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("lambda:ListVersionsByFunction", e))?.versions().iter().map(function_of));
    }
    Ok(out)
}

/// Publishes the function's `$LATEST` as a new version and returns its number.
#[tauri::command]
#[specta::specta]
pub async fn lambda_publish_version(state: State<'_, AppState>, region: String, name: String, description: Option<String>) -> Result<String, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    wait_ready(&client, &name, &None).await?;
    let r = client
        .publish_version()
        .function_name(name)
        .set_description(description.filter(|d| !d.is_empty()))
        .send()
        .await
        .map_err(|e| map_sdk_error("lambda:PublishVersion", e))?;
    Ok(r.version().unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LambdaAlias {
    pub name: String,
    pub arn: String,
    pub version: String,
    pub description: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_list_aliases(state: State<'_, AppState>, region: String, name: String) -> Result<Vec<LambdaAlias>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut pages = client.list_aliases().function_name(name).into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("lambda:ListAliases", e))?.aliases().iter().map(|a| LambdaAlias {
            name: a.name().unwrap_or_default().to_string(),
            arn: a.alias_arn().unwrap_or_default().to_string(),
            version: a.function_version().unwrap_or_default().to_string(),
            description: a.description().filter(|d| !d.is_empty()).map(str::to_string),
        }));
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_create_alias(state: State<'_, AppState>, region: String, name: String, alias: String, version: String, description: Option<String>) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    client
        .create_alias()
        .function_name(name)
        .name(alias)
        .function_version(version)
        .set_description(description.filter(|d| !d.is_empty()))
        .send()
        .await
        .map_err(|e| map_sdk_error("lambda:CreateAlias", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_update_alias(state: State<'_, AppState>, region: String, name: String, alias: String, version: String, description: String) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    client
        .update_alias()
        .function_name(name)
        .name(alias)
        .function_version(version)
        .description(description)
        .send()
        .await
        .map_err(|e| map_sdk_error("lambda:UpdateAlias", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_delete_alias(state: State<'_, AppState>, region: String, name: String, alias: String) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    client.delete_alias().function_name(name).name(alias).send().await.map_err(|e| map_sdk_error("lambda:DeleteAlias", e))?;
    Ok(())
}

// Triggers, permissions and tags -------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct EventSourceMapping {
    pub uuid: String,
    pub event_source_arn: Option<String>,
    pub state: Option<String>,
    pub batch_size: Option<f64>,
    pub last_modified: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_list_event_source_mappings(state: State<'_, AppState>, region: String, name: String) -> Result<Vec<EventSourceMapping>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut pages = client.list_event_source_mappings().function_name(name).into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("lambda:ListEventSourceMappings", e))?.event_source_mappings().iter().map(|m| EventSourceMapping {
            uuid: m.uuid().unwrap_or_default().to_string(),
            event_source_arn: m.event_source_arn().map(str::to_string),
            state: m.state().map(str::to_string),
            batch_size: m.batch_size().map(f64::from),
            last_modified: time(m.last_modified()),
        }));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct FunctionUrl {
    pub url: String,
    pub auth_type: String,
}

/// The function URL of a function, or none when it has none.
#[tauri::command]
#[specta::specta]
pub async fn lambda_get_function_url(state: State<'_, AppState>, region: String, name: String) -> Result<Option<FunctionUrl>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    match client.get_function_url_config().function_name(name).send().await {
        Ok(r) => Ok(Some(FunctionUrl { url: r.function_url().to_string(), auth_type: r.auth_type().as_str().to_string() })),
        Err(e) => {
            let mapped = map_sdk_error("lambda:GetFunctionUrlConfig", e);
            if is_code(&mapped, &["ResourceNotFoundException"]) {
                Ok(None)
            } else {
                Err(mapped)
            }
        }
    }
}

/// The function's resource-based policy as JSON text, or none when it has none.
#[tauri::command]
#[specta::specta]
pub async fn lambda_get_policy(state: State<'_, AppState>, region: String, name: String) -> Result<Option<String>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    match client.get_policy().function_name(name).send().await {
        Ok(r) => Ok(r.policy().map(str::to_string)),
        Err(e) => {
            let mapped = map_sdk_error("lambda:GetPolicy", e);
            if is_code(&mapped, &["ResourceNotFoundException"]) {
                Ok(None)
            } else {
                Err(mapped)
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_list_tags(state: State<'_, AppState>, region: String, arn: String) -> Result<Vec<Tag>, ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    let r = client.list_tags().resource(arn).send().await.map_err(|e| map_sdk_error("lambda:ListTags", e))?;
    let mut tags: Vec<Tag> = r.tags().map(|m| m.iter().map(|(k, v)| Tag { key: k.clone(), value: v.clone() }).collect()).unwrap_or_default();
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(tags)
}

#[tauri::command]
#[specta::specta]
pub async fn lambda_update_tags(state: State<'_, AppState>, region: String, arn: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = lambda(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_resource()
            .resource(&arn)
            .set_tags(Some(set.into_iter().map(|t| (t.key, t.value)).collect()))
            .send()
            .await
            .map_err(|e| map_sdk_error("lambda:TagResource", e))?;
    }
    if !remove.is_empty() {
        client.untag_resource().resource(&arn).set_tag_keys(Some(remove)).send().await.map_err(|e| map_sdk_error("lambda:UntagResource", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, text: Option<&str>) -> CodeFileInput {
        CodeFileInput { name: name.into(), text: text.map(str::to_string) }
    }

    #[test]
    fn a_package_round_trips_its_text_files() {
        let zip = write_zip(None, &[input("index.js", Some("exports.handler = async () => 1;")), input("lib/util.js", Some("module.exports = {};"))]).unwrap();
        let files = read_zip(&zip).unwrap();
        assert_eq!(files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["index.js", "lib/util.js"]);
        assert_eq!(files[0].text.as_deref(), Some("exports.handler = async () => 1;"));
    }

    #[test]
    fn a_file_without_text_keeps_the_bytes_it_had() {
        let first = write_zip(None, &[input("a.txt", Some("keep me")), input("b.txt", Some("old"))]).unwrap();
        let second = write_zip(Some(&first), &[input("a.txt", None), input("b.txt", Some("new")), input("c.txt", Some("added"))]).unwrap();
        let files = read_zip(&second).unwrap();
        let text = |n: &str| files.iter().find(|f| f.name == n).and_then(|f| f.text.clone());
        assert_eq!(text("a.txt").as_deref(), Some("keep me"));
        assert_eq!(text("b.txt").as_deref(), Some("new"));
        assert_eq!(text("c.txt").as_deref(), Some("added"));
    }

    #[test]
    fn a_file_dropped_from_the_list_leaves_the_package() {
        let first = write_zip(None, &[input("a.txt", Some("a")), input("b.txt", Some("b"))]).unwrap();
        let second = write_zip(Some(&first), &[input("a.txt", None)]).unwrap();
        assert_eq!(read_zip(&second).unwrap().len(), 1);
    }

    #[test]
    fn binary_content_is_listed_without_text() {
        let mut out = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut out);
            w.start_file("blob.bin", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(&[0xff, 0xfe, 0x00, 0x01]).unwrap();
            w.finish().unwrap();
        }
        let files = read_zip(&out.into_inner()).unwrap();
        assert_eq!(files[0].size, 4.0);
        assert!(files[0].text.is_none());
    }

    #[test]
    fn unsafe_or_duplicate_names_are_refused() {
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a\\b", "c:x", "a/./b"] {
            assert!(write_zip(None, &[input(bad, Some("x"))]).is_err(), "{bad:?}");
        }
        assert!(write_zip(None, &[input("a", Some("1")), input("a", Some("2"))]).is_err());
        assert!(write_zip(None, &[]).is_err());
    }

    #[test]
    fn keeping_a_file_that_is_not_there_is_refused() {
        let first = write_zip(None, &[input("a.txt", Some("a"))]).unwrap();
        assert!(write_zip(Some(&first), &[input("missing.txt", None)]).is_err());
        assert!(write_zip(None, &[input("a.txt", None)]).is_err());
    }

    #[test]
    fn something_that_is_not_a_zip_is_refused() {
        assert!(read_zip(b"not a zip").is_err());
    }
}
