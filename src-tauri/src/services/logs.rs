//! Amazon CloudWatch Logs commands of the console pages: log groups, streams, events, metric and subscription filters, tags and Logs Insights queries.

use super::{build_error, time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_cloudwatchlogs::types::{InputLogEvent, MetricTransformation, OrderBy};
use aws_sdk_cloudwatchlogs::Client;
use aws_smithy_types::DateTime;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

/// Upper bound of pages one list command reads, so a misbehaving token cannot loop forever.
const MAX_PAGES: usize = 100;

fn logs(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.logs_in(region)
}

/// RFC 3339 text of an epoch-milliseconds value.
fn millis_time(ms: Option<i64>) -> Option<String> {
    ms.and_then(|ms| time(Some(&DateTime::from_millis(ms))))
}

/// Epoch milliseconds or seconds sent as `f64` by the frontend, as the integer the API wants.
fn whole(v: f64) -> i64 {
    v as i64
}

/// A log group ARN without the trailing `:*` the Logs API puts on `arn`.
fn plain_arn(arn: &str) -> String {
    arn.strip_suffix(":*").unwrap_or(arn).to_string()
}

fn non_empty<T>(v: Vec<T>) -> Option<Vec<T>> {
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn blank(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsGroup {
    pub name: String,
    /// The ARN without the trailing `:*`, the form the tag commands take.
    pub arn: String,
    pub retention_days: Option<i32>,
    pub stored_bytes: f64,
    pub created: Option<String>,
    pub kms_key_id: Option<String>,
    pub log_group_class: Option<String>,
    pub metric_filter_count: i32,
    pub deletion_protection: bool,
}

fn group_of(g: &aws_sdk_cloudwatchlogs::types::LogGroup) -> LogsGroup {
    let name = g.log_group_name().unwrap_or_default().to_string();
    LogsGroup {
        arn: g.log_group_arn().or(g.arn()).map(plain_arn).unwrap_or_default(),
        name,
        retention_days: g.retention_in_days(),
        stored_bytes: g.stored_bytes().unwrap_or(0) as f64,
        created: millis_time(g.creation_time()),
        kms_key_id: g.kms_key_id().map(str::to_string),
        log_group_class: g.log_group_class().map(|c| c.as_str().to_string()),
        metric_filter_count: g.metric_filter_count().unwrap_or(0),
        deletion_protection: g.deletion_protection_enabled().unwrap_or(false),
    }
}

/// Lists the log groups, optionally only those whose name starts with `name_prefix`.
#[tauri::command]
#[specta::specta]
pub async fn logs_list_groups(state: State<'_, AppState>, region: String, name_prefix: Option<String>) -> Result<Vec<LogsGroup>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .describe_log_groups()
            .set_log_group_name_prefix(blank(name_prefix.clone()))
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:DescribeLogGroups", e))?;
        out.extend(r.log_groups().iter().map(group_of));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Creates a log group, then applies the retention when one is given (CreateLogGroup has no retention argument).
#[tauri::command]
#[specta::specta]
pub async fn logs_create_group(
    state: State<'_, AppState>,
    region: String,
    name: String,
    retention_days: Option<i32>,
    kms_key_id: Option<String>,
    tags: Vec<Tag>,
) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let tags: HashMap<String, String> = tags.into_iter().map(|t| (t.key, t.value)).collect();
    client
        .create_log_group()
        .log_group_name(&name)
        .set_kms_key_id(blank(kms_key_id))
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:CreateLogGroup", e))?;
    if let Some(days) = retention_days {
        client
            .put_retention_policy()
            .log_group_name(&name)
            .retention_in_days(days)
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:PutRetentionPolicy", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_delete_group(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client.delete_log_group().log_group_name(name).send().await.map_err(|e| map_sdk_error("cloudwatch-logs:DeleteLogGroup", e))?;
    Ok(())
}

/// Sets the retention in days, or removes it (never expire) when `days` is `None`.
#[tauri::command]
#[specta::specta]
pub async fn logs_set_retention(state: State<'_, AppState>, region: String, group: String, days: Option<i32>) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    match days {
        Some(days) => {
            client
                .put_retention_policy()
                .log_group_name(group)
                .retention_in_days(days)
                .send()
                .await
                .map_err(|e| map_sdk_error("cloudwatch-logs:PutRetentionPolicy", e))?;
        }
        None => {
            client
                .delete_retention_policy()
                .log_group_name(group)
                .send()
                .await
                .map_err(|e| map_sdk_error("cloudwatch-logs:DeleteRetentionPolicy", e))?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsStream {
    pub name: String,
    pub arn: String,
    pub created: Option<String>,
    pub first_event: Option<String>,
    pub last_event: Option<String>,
    pub last_ingestion: Option<String>,
    pub stored_bytes: f64,
}

/// Lists the streams of a group, newest event first. With a prefix the API only orders by stream name.
#[tauri::command]
#[specta::specta]
pub async fn logs_list_streams(state: State<'_, AppState>, region: String, group: String, name_prefix: Option<String>) -> Result<Vec<LogsStream>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let prefix = blank(name_prefix);
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let req = client.describe_log_streams().log_group_name(&group).set_next_token(token.clone());
        let req = match &prefix {
            Some(p) => req.log_stream_name_prefix(p).order_by(OrderBy::LogStreamName),
            None => req.order_by(OrderBy::LastEventTime).descending(true),
        };
        let r = req.send().await.map_err(|e| map_sdk_error("cloudwatch-logs:DescribeLogStreams", e))?;
        out.extend(r.log_streams().iter().map(|s| LogsStream {
            name: s.log_stream_name().unwrap_or_default().to_string(),
            arn: s.arn().unwrap_or_default().to_string(),
            created: millis_time(s.creation_time()),
            first_event: millis_time(s.first_event_timestamp()),
            last_event: millis_time(s.last_event_timestamp()),
            last_ingestion: millis_time(s.last_ingestion_time()),
            #[allow(deprecated)]
            stored_bytes: s.stored_bytes().unwrap_or(0) as f64,
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn logs_create_stream(state: State<'_, AppState>, region: String, group: String, name: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .create_log_stream()
        .log_group_name(group)
        .log_stream_name(name)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:CreateLogStream", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_delete_stream(state: State<'_, AppState>, region: String, group: String, name: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .delete_log_stream()
        .log_group_name(group)
        .log_stream_name(name)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:DeleteLogStream", e))?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct LogsGetEventsInput {
    pub group: String,
    pub stream: String,
    /// Epoch milliseconds.
    pub start_ms: Option<f64>,
    /// Epoch milliseconds.
    pub end_ms: Option<f64>,
    pub start_from_head: bool,
    pub next_token: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsEvent {
    pub timestamp_ms: f64,
    pub timestamp: String,
    pub ingestion_time: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsEventsPage {
    pub events: Vec<LogsEvent>,
    /// Token for the page after this one. The API returns the same token again at the end of the stream.
    pub next_forward_token: Option<String>,
    /// Token for the page before this one.
    pub next_backward_token: Option<String>,
}

/// Reads one page of the events of a stream. Not paged to the end: the caller follows the tokens.
#[tauri::command]
#[specta::specta]
pub async fn logs_get_events(state: State<'_, AppState>, region: String, input: LogsGetEventsInput) -> Result<LogsEventsPage, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client
        .get_log_events()
        .log_group_name(input.group)
        .log_stream_name(input.stream)
        .set_start_time(input.start_ms.map(whole))
        .set_end_time(input.end_ms.map(whole))
        .start_from_head(input.start_from_head)
        .set_next_token(blank(input.next_token))
        .set_limit(input.limit)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:GetLogEvents", e))?;
    Ok(LogsEventsPage {
        events: r
            .events()
            .iter()
            .map(|e| {
                let ts = e.timestamp().unwrap_or(0);
                LogsEvent {
                    timestamp_ms: ts as f64,
                    timestamp: millis_time(Some(ts)).unwrap_or_default(),
                    ingestion_time: millis_time(e.ingestion_time()),
                    message: e.message().unwrap_or_default().to_string(),
                }
            })
            .collect(),
        next_forward_token: r.next_forward_token().map(str::to_string),
        next_backward_token: r.next_backward_token().map(str::to_string),
    })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct LogsFilterInput {
    pub group: String,
    /// Restricts the search to these streams; empty searches every stream.
    pub streams: Vec<String>,
    pub filter_pattern: Option<String>,
    /// Epoch milliseconds.
    pub start_ms: Option<f64>,
    /// Epoch milliseconds.
    pub end_ms: Option<f64>,
    pub next_token: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsFilteredEvent {
    pub stream_name: String,
    pub event_id: String,
    pub timestamp_ms: f64,
    pub timestamp: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsFilteredPage {
    pub events: Vec<LogsFilteredEvent>,
    pub next_token: Option<String>,
}

/// Searches the events of a group with a filter pattern. One page per call: the caller follows `next_token`.
#[tauri::command]
#[specta::specta]
pub async fn logs_filter_events(state: State<'_, AppState>, region: String, input: LogsFilterInput) -> Result<LogsFilteredPage, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client
        .filter_log_events()
        .log_group_name(input.group)
        .set_log_stream_names(non_empty(input.streams))
        .set_filter_pattern(blank(input.filter_pattern))
        .set_start_time(input.start_ms.map(whole))
        .set_end_time(input.end_ms.map(whole))
        .set_next_token(blank(input.next_token))
        .set_limit(input.limit)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:FilterLogEvents", e))?;
    Ok(LogsFilteredPage {
        events: r
            .events()
            .iter()
            .map(|e| {
                let ts = e.timestamp().unwrap_or(0);
                LogsFilteredEvent {
                    stream_name: e.log_stream_name().unwrap_or_default().to_string(),
                    event_id: e.event_id().unwrap_or_default().to_string(),
                    timestamp_ms: ts as f64,
                    timestamp: millis_time(Some(ts)).unwrap_or_default(),
                    message: e.message().unwrap_or_default().to_string(),
                }
            })
            .collect(),
        next_token: r.next_token().map(str::to_string),
    })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct LogsNewEvent {
    /// Epoch milliseconds.
    pub timestamp_ms: f64,
    pub message: String,
}

/// Writes events to a stream. The caller should send them in timestamp order, as the API requires.
#[tauri::command]
#[specta::specta]
pub async fn logs_put_events(state: State<'_, AppState>, region: String, group: String, stream: String, events: Vec<LogsNewEvent>) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let events = events
        .into_iter()
        .map(|e| InputLogEvent::builder().timestamp(whole(e.timestamp_ms)).message(e.message).build().map_err(build_error))
        .collect::<Result<Vec<_>, ApiError>>()?;
    client
        .put_log_events()
        .log_group_name(group)
        .log_stream_name(stream)
        .set_log_events(Some(events))
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:PutLogEvents", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsMetricFilter {
    pub name: String,
    pub pattern: String,
    /// The first metric transformation; empty text when the filter has none.
    pub metric_name: String,
    pub metric_namespace: String,
    pub metric_value: String,
    pub default_value: Option<f64>,
    /// How many transformations the filter has; only the first one is flattened into the fields above.
    pub transformation_count: i32,
    pub created: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn logs_list_metric_filters(state: State<'_, AppState>, region: String, group: String) -> Result<Vec<LogsMetricFilter>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .describe_metric_filters()
            .log_group_name(&group)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:DescribeMetricFilters", e))?;
        out.extend(r.metric_filters().iter().map(|f| {
            let first = f.metric_transformations().first();
            LogsMetricFilter {
                name: f.filter_name().unwrap_or_default().to_string(),
                pattern: f.filter_pattern().unwrap_or_default().to_string(),
                metric_name: first.map(|t| t.metric_name().to_string()).unwrap_or_default(),
                metric_namespace: first.map(|t| t.metric_namespace().to_string()).unwrap_or_default(),
                metric_value: first.map(|t| t.metric_value().to_string()).unwrap_or_default(),
                default_value: first.and_then(|t| t.default_value()),
                transformation_count: i32::try_from(f.metric_transformations().len()).unwrap_or(i32::MAX),
                created: millis_time(f.creation_time()),
            }
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Creates or replaces a metric filter with a single metric transformation.
#[tauri::command]
#[specta::specta]
pub async fn logs_put_metric_filter(
    state: State<'_, AppState>,
    region: String,
    group: String,
    name: String,
    pattern: String,
    metric_name: String,
    metric_namespace: String,
    metric_value: String,
    default_value: Option<f64>,
) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let transformation = MetricTransformation::builder()
        .metric_name(metric_name)
        .metric_namespace(metric_namespace)
        .metric_value(metric_value)
        .set_default_value(default_value)
        .build()
        .map_err(build_error)?;
    client
        .put_metric_filter()
        .log_group_name(group)
        .filter_name(name)
        .filter_pattern(pattern)
        .metric_transformations(transformation)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:PutMetricFilter", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_delete_metric_filter(state: State<'_, AppState>, region: String, group: String, name: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .delete_metric_filter()
        .log_group_name(group)
        .filter_name(name)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:DeleteMetricFilter", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsSubscriptionFilter {
    pub name: String,
    pub pattern: String,
    pub destination_arn: String,
    pub role_arn: Option<String>,
    pub distribution: Option<String>,
    pub created: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn logs_list_subscription_filters(state: State<'_, AppState>, region: String, group: String) -> Result<Vec<LogsSubscriptionFilter>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .describe_subscription_filters()
            .log_group_name(&group)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:DescribeSubscriptionFilters", e))?;
        out.extend(r.subscription_filters().iter().map(|f| LogsSubscriptionFilter {
            name: f.filter_name().unwrap_or_default().to_string(),
            pattern: f.filter_pattern().unwrap_or_default().to_string(),
            destination_arn: f.destination_arn().unwrap_or_default().to_string(),
            role_arn: f.role_arn().map(str::to_string),
            distribution: f.distribution().map(|d| d.as_str().to_string()),
            created: millis_time(f.creation_time()),
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Creates or replaces a subscription filter. The emulator supports this only partly; its errors come through unchanged.
#[tauri::command]
#[specta::specta]
pub async fn logs_put_subscription_filter(
    state: State<'_, AppState>,
    region: String,
    group: String,
    name: String,
    pattern: String,
    destination_arn: String,
    role_arn: Option<String>,
) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .put_subscription_filter()
        .log_group_name(group)
        .filter_name(name)
        .filter_pattern(pattern)
        .destination_arn(destination_arn)
        .set_role_arn(blank(role_arn))
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:PutSubscriptionFilter", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_delete_subscription_filter(state: State<'_, AppState>, region: String, group: String, name: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .delete_subscription_filter()
        .log_group_name(group)
        .filter_name(name)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:DeleteSubscriptionFilter", e))?;
    Ok(())
}

/// Lists the tags of a log group; `group_arn` may carry the trailing `:*`, which is removed.
#[tauri::command]
#[specta::specta]
pub async fn logs_list_tags(state: State<'_, AppState>, region: String, group_arn: String) -> Result<Vec<Tag>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client
        .list_tags_for_resource()
        .resource_arn(plain_arn(&group_arn))
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:ListTagsForResource", e))?;
    let mut tags: Vec<Tag> = r.tags().map(|m| m.iter().map(|(k, v)| Tag { key: k.clone(), value: v.clone() }).collect()).unwrap_or_default();
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(tags)
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn logs_update_tags(state: State<'_, AppState>, region: String, group_arn: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let arn = plain_arn(&group_arn);
    if !set.is_empty() {
        client
            .tag_resource()
            .resource_arn(&arn)
            .set_tags(Some(set.into_iter().map(|t| (t.key, t.value)).collect()))
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:TagResource", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_resource()
            .resource_arn(&arn)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:UntagResource", e))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct LogsStartQueryInput {
    pub groups: Vec<String>,
    pub query: String,
    /// Epoch seconds.
    pub start_secs: f64,
    /// Epoch seconds.
    pub end_secs: f64,
    pub limit: Option<i32>,
}

/// Starts a Logs Insights query and returns its query id.
#[tauri::command]
#[specta::specta]
pub async fn logs_start_query(state: State<'_, AppState>, region: String, input: LogsStartQueryInput) -> Result<String, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client
        .start_query()
        .set_log_group_names(non_empty(input.groups))
        .query_string(input.query)
        .start_time(whole(input.start_secs))
        .end_time(whole(input.end_secs))
        .set_limit(input.limit)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:StartQuery", e))?;
    Ok(r.query_id().unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsResultField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsQueryResults {
    /// `Scheduled`, `Running`, `Complete`, `Failed`, `Cancelled`, `Timeout` or `Unknown`; the caller polls until it is not `Scheduled` or `Running`.
    pub status: String,
    pub rows: Vec<Vec<LogsResultField>>,
    pub records_matched: f64,
    pub records_scanned: f64,
    pub bytes_scanned: f64,
}

#[tauri::command]
#[specta::specta]
pub async fn logs_get_query_results(state: State<'_, AppState>, region: String, query_id: String) -> Result<LogsQueryResults, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client.get_query_results().query_id(query_id).send().await.map_err(|e| map_sdk_error("cloudwatch-logs:GetQueryResults", e))?;
    let stats = r.statistics();
    Ok(LogsQueryResults {
        status: r.status().map(|s| s.as_str().to_string()).unwrap_or_default(),
        rows: r
            .results()
            .iter()
            .map(|row| {
                row.iter()
                    .map(|f| LogsResultField { field: f.field().unwrap_or_default().to_string(), value: f.value().unwrap_or_default().to_string() })
                    .collect()
            })
            .collect(),
        records_matched: stats.map(|s| s.records_matched()).unwrap_or(0.0),
        records_scanned: stats.map(|s| s.records_scanned()).unwrap_or(0.0),
        bytes_scanned: stats.map(|s| s.bytes_scanned()).unwrap_or(0.0),
    })
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LogsQueryDefinition {
    pub id: String,
    pub name: String,
    pub query_string: String,
    pub log_groups: Vec<String>,
    /// Epoch milliseconds.
    pub last_modified: f64,
}

#[tauri::command]
#[specta::specta]
pub async fn logs_list_query_definitions(state: State<'_, AppState>, region: String) -> Result<Vec<LogsQueryDefinition>, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .describe_query_definitions()
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("cloudwatch-logs:DescribeQueryDefinitions", e))?;
        out.extend(r.query_definitions().iter().map(|d| LogsQueryDefinition {
            id: d.query_definition_id().unwrap_or_default().to_string(),
            name: d.name().unwrap_or_default().to_string(),
            query_string: d.query_string().unwrap_or_default().to_string(),
            log_groups: d.log_group_names().to_vec(),
            last_modified: d.last_modified().unwrap_or(0) as f64,
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Saves a query definition and returns its id. A given `id` replaces that definition; `None` creates a new one.
#[tauri::command]
#[specta::specta]
pub async fn logs_put_query_definition(
    state: State<'_, AppState>,
    region: String,
    name: String,
    query_string: String,
    log_groups: Vec<String>,
    id: Option<String>,
) -> Result<String, ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    let r = client
        .put_query_definition()
        .name(name)
        .query_string(query_string)
        .set_log_group_names(non_empty(log_groups))
        .set_query_definition_id(blank(id))
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:PutQueryDefinition", e))?;
    Ok(r.query_definition_id().unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_delete_query_definition(state: State<'_, AppState>, region: String, id: String) -> Result<(), ApiError> {
    let client = logs(&clients(&state).await?, &region)?;
    client
        .delete_query_definition()
        .query_definition_id(id)
        .send()
        .await
        .map_err(|e| map_sdk_error("cloudwatch-logs:DeleteQueryDefinition", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_arn_drops_only_the_trailing_wildcard() {
        assert_eq!(plain_arn("arn:aws:logs:us-east-1:000000000000:log-group:app:*"), "arn:aws:logs:us-east-1:000000000000:log-group:app");
        assert_eq!(plain_arn("arn:aws:logs:us-east-1:000000000000:log-group:app"), "arn:aws:logs:us-east-1:000000000000:log-group:app");
    }

    #[test]
    fn millis_time_formats_rfc3339() {
        assert_eq!(millis_time(Some(0)).as_deref(), Some("1970-01-01T00:00:00Z"));
        assert_eq!(millis_time(None), None);
    }

    #[test]
    fn blank_and_non_empty_drop_empty_values() {
        assert_eq!(blank(Some(String::new())), None);
        assert_eq!(blank(Some("a".into())).as_deref(), Some("a"));
        assert_eq!(non_empty::<String>(vec![]), None);
        assert_eq!(non_empty(vec![1]), Some(vec![1]));
    }
}
