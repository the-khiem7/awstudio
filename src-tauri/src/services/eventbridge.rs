//! Amazon EventBridge commands of the console pages: event buses, rules, targets, events, archives and tags.

use super::{build_error, time, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_eventbridge::types::{ArchiveState, DeadLetterConfig, InputTransformer, PutEventsRequestEntry, RuleState, SqsParameters, Target};
use aws_sdk_eventbridge::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

/// Most pages a list command follows before it stops.
const MAX_PAGES: usize = 100;

/// `RemoveTargets` accepts at most this many ids per call.
const REMOVE_BATCH: usize = 100;

fn events(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.eventbridge_in(region)
}

/// An empty or blank text is "not given".
fn blank(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.trim().is_empty())
}

/// The bus argument of the API: an empty name means the default bus, which the API takes as absent.
fn bus_arg(bus: &str) -> Option<String> {
    blank(Some(bus.to_string()))
}

/// True when `source_arn` is the ARN of the event bus called `bus`.
fn is_bus_arn(source_arn: &str, bus: &str) -> bool {
    source_arn.rsplit_once(":event-bus/").is_some_and(|(_, name)| name == bus)
}

fn api_tags(tags: Vec<Tag>) -> Result<Vec<aws_sdk_eventbridge::types::Tag>, ApiError> {
    tags.into_iter().map(|t| aws_sdk_eventbridge::types::Tag::builder().key(t.key).value(t.value).build().map_err(build_error)).collect()
}

/// A failed entry of a batch call as the error the page shows: the first entry's code and message.
fn failed_entry(op: &str, code: Option<&str>, message: Option<&str>) -> ApiError {
    ApiError::Aws {
        op: op.to_string(),
        code: code.unwrap_or("InternalFailure").to_string(),
        message: message.unwrap_or_default().to_string(),
        status: None,
    }
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EventsBus {
    pub name: String,
    pub arn: String,
    pub description: Option<String>,
    pub created: Option<String>,
    pub last_modified: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn events_list_buses(state: State<'_, AppState>, region: String) -> Result<Vec<EventsBus>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client.list_event_buses().set_next_token(token.clone()).send().await.map_err(|e| map_sdk_error("eventbridge:ListEventBuses", e))?;
        out.extend(r.event_buses().iter().map(|b| EventsBus {
            name: b.name().unwrap_or_default().to_string(),
            arn: b.arn().unwrap_or_default().to_string(),
            description: b.description().filter(|d| !d.is_empty()).map(str::to_string),
            created: time(b.creation_time()),
            last_modified: time(b.last_modified_time()),
        }));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Creates a custom event bus and returns its ARN.
#[tauri::command]
#[specta::specta]
pub async fn events_create_bus(state: State<'_, AppState>, region: String, name: String, description: Option<String>) -> Result<String, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let r = client
        .create_event_bus()
        .name(name)
        .set_description(blank(description))
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:CreateEventBus", e))?;
    Ok(r.event_bus_arn().unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn events_delete_bus(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    client.delete_event_bus().name(name).send().await.map_err(|e| map_sdk_error("eventbridge:DeleteEventBus", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EventsRule {
    pub name: String,
    pub arn: String,
    /// `ENABLED` or `DISABLED`.
    pub state: String,
    pub description: Option<String>,
    pub schedule_expression: Option<String>,
    pub event_pattern: Option<String>,
    pub event_bus_name: String,
    pub role_arn: Option<String>,
    pub managed_by: Option<String>,
}

fn rule_state(s: Option<&RuleState>) -> String {
    s.map(|s| s.as_str().to_string()).unwrap_or_else(|| "ENABLED".to_string())
}

fn text(s: Option<&str>) -> Option<String> {
    s.filter(|s| !s.is_empty()).map(str::to_string)
}

/// Lists the rules of a bus; an empty `bus` is the default bus.
#[tauri::command]
#[specta::specta]
pub async fn events_list_rules(state: State<'_, AppState>, region: String, bus: String) -> Result<Vec<EventsRule>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let bus_name = bus_arg(&bus);
    let shown_bus = bus_name.clone().unwrap_or_else(|| "default".to_string());
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_rules()
            .set_event_bus_name(bus_name.clone())
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("eventbridge:ListRules", e))?;
        out.extend(r.rules().iter().map(|x| EventsRule {
            name: x.name().unwrap_or_default().to_string(),
            arn: x.arn().unwrap_or_default().to_string(),
            state: rule_state(x.state()),
            description: text(x.description()),
            schedule_expression: text(x.schedule_expression()),
            event_pattern: text(x.event_pattern()),
            event_bus_name: x.event_bus_name().unwrap_or(&shown_bus).to_string(),
            role_arn: text(x.role_arn()),
            managed_by: text(x.managed_by()),
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
pub async fn events_describe_rule(state: State<'_, AppState>, region: String, bus: String, name: String) -> Result<EventsRule, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let bus_name = bus_arg(&bus);
    let r = client
        .describe_rule()
        .name(&name)
        .set_event_bus_name(bus_name.clone())
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:DescribeRule", e))?;
    Ok(EventsRule {
        name: r.name().unwrap_or(&name).to_string(),
        arn: r.arn().unwrap_or_default().to_string(),
        state: rule_state(r.state()),
        description: text(r.description()),
        schedule_expression: text(r.schedule_expression()),
        event_pattern: text(r.event_pattern()),
        event_bus_name: r.event_bus_name().map(str::to_string).or(bus_name).unwrap_or_else(|| "default".to_string()),
        role_arn: text(r.role_arn()),
        managed_by: text(r.managed_by()),
    })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct EventsPutRuleInput {
    pub name: String,
    /// Empty for the default bus.
    pub bus: String,
    pub description: Option<String>,
    pub event_pattern: Option<String>,
    pub schedule_expression: Option<String>,
    pub enabled: bool,
    pub role_arn: Option<String>,
    pub tags: Vec<Tag>,
}

/// Creates or updates a rule and returns its ARN.
#[tauri::command]
#[specta::specta]
pub async fn events_put_rule(state: State<'_, AppState>, region: String, input: EventsPutRuleInput) -> Result<String, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let tags = api_tags(input.tags)?;
    let r = client
        .put_rule()
        .name(input.name)
        .set_event_bus_name(bus_arg(&input.bus))
        .set_description(blank(input.description))
        .set_event_pattern(blank(input.event_pattern))
        .set_schedule_expression(blank(input.schedule_expression))
        .state(if input.enabled { RuleState::Enabled } else { RuleState::Disabled })
        .set_role_arn(blank(input.role_arn))
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:PutRule", e))?;
    Ok(r.rule_arn().unwrap_or_default().to_string())
}

/// Enables or disables a rule (`EnableRule` or `DisableRule`).
#[tauri::command]
#[specta::specta]
pub async fn events_set_rule_state(state: State<'_, AppState>, region: String, bus: String, name: String, enabled: bool) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    if enabled {
        client.enable_rule().name(name).set_event_bus_name(bus_arg(&bus)).send().await.map_err(|e| map_sdk_error("eventbridge:EnableRule", e))?;
    } else {
        client.disable_rule().name(name).set_event_bus_name(bus_arg(&bus)).send().await.map_err(|e| map_sdk_error("eventbridge:DisableRule", e))?;
    }
    Ok(())
}

async fn list_targets(client: &Client, bus: &str, rule: &str) -> Result<Vec<Target>, ApiError> {
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client
            .list_targets_by_rule()
            .rule(rule)
            .set_event_bus_name(bus_arg(bus))
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("eventbridge:ListTargetsByRule", e))?;
        out.extend(r.targets().iter().cloned());
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

async fn remove_targets(client: &Client, bus: &str, rule: &str, ids: Vec<String>) -> Result<(), ApiError> {
    for chunk in ids.chunks(REMOVE_BATCH) {
        let r = client
            .remove_targets()
            .rule(rule)
            .set_event_bus_name(bus_arg(bus))
            .set_ids(Some(chunk.to_vec()))
            .send()
            .await
            .map_err(|e| map_sdk_error("eventbridge:RemoveTargets", e))?;
        if let Some(f) = r.failed_entries().first() {
            return Err(failed_entry("eventbridge:RemoveTargets", f.error_code(), f.error_message()));
        }
    }
    Ok(())
}

/// Deletes a rule. AWS refuses to delete a rule that still has targets, so this lists the targets (`ListTargetsByRule`) and removes them all (`RemoveTargets`) before it calls `DeleteRule`.
#[tauri::command]
#[specta::specta]
pub async fn events_delete_rule(state: State<'_, AppState>, region: String, bus: String, name: String) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let ids: Vec<String> = list_targets(&client, &bus, &name).await?.iter().map(|t| t.id().to_string()).collect();
    if !ids.is_empty() {
        remove_targets(&client, &bus, &name, ids).await?;
    }
    client.delete_rule().name(name).set_event_bus_name(bus_arg(&bus)).send().await.map_err(|e| map_sdk_error("eventbridge:DeleteRule", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct EventsInputTransformer {
    pub paths_map: HashMap<String, String>,
    pub template: String,
}

/// A rule target, as listed and as put. `input`, `input_path` and `input_transformer` are mutually exclusive in the API.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct EventsTarget {
    pub id: String,
    pub arn: String,
    pub role_arn: Option<String>,
    /// A constant JSON text sent instead of the event.
    pub input: Option<String>,
    pub input_path: Option<String>,
    pub input_transformer: Option<EventsInputTransformer>,
    pub dead_letter_arn: Option<String>,
    /// Message group of an SQS FIFO target.
    pub sqs_message_group_id: Option<String>,
}

fn target_of(t: &Target) -> EventsTarget {
    EventsTarget {
        id: t.id().to_string(),
        arn: t.arn().to_string(),
        role_arn: text(t.role_arn()),
        input: text(t.input()),
        input_path: text(t.input_path()),
        input_transformer: t.input_transformer().map(|x| EventsInputTransformer {
            paths_map: x.input_paths_map().cloned().unwrap_or_default(),
            template: x.input_template().to_string(),
        }),
        dead_letter_arn: t.dead_letter_config().and_then(|d| text(d.arn())),
        sqs_message_group_id: t.sqs_parameters().and_then(|p| text(p.message_group_id())),
    }
}

fn target_to_api(t: EventsTarget) -> Result<Target, ApiError> {
    let transformer = match t.input_transformer {
        Some(x) => Some(
            InputTransformer::builder()
                .set_input_paths_map(if x.paths_map.is_empty() { None } else { Some(x.paths_map) })
                .input_template(x.template)
                .build()
                .map_err(build_error)?,
        ),
        None => None,
    };
    Target::builder()
        .id(t.id)
        .arn(t.arn)
        .set_role_arn(blank(t.role_arn))
        .set_input(blank(t.input))
        .set_input_path(blank(t.input_path))
        .set_input_transformer(transformer)
        .set_dead_letter_config(blank(t.dead_letter_arn).map(|arn| DeadLetterConfig::builder().arn(arn).build()))
        .set_sqs_parameters(blank(t.sqs_message_group_id).map(|g| SqsParameters::builder().message_group_id(g).build()))
        .build()
        .map_err(build_error)
}

#[tauri::command]
#[specta::specta]
pub async fn events_list_targets(state: State<'_, AppState>, region: String, bus: String, rule: String) -> Result<Vec<EventsTarget>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    Ok(list_targets(&client, &bus, &rule).await?.iter().map(target_of).collect())
}

/// Adds or replaces targets by id. A response that lists failed entries becomes an `Aws` error with the first entry's code and message.
#[tauri::command]
#[specta::specta]
pub async fn events_put_targets(state: State<'_, AppState>, region: String, bus: String, rule: String, targets: Vec<EventsTarget>) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let targets = targets.into_iter().map(target_to_api).collect::<Result<Vec<_>, _>>()?;
    let r = client
        .put_targets()
        .rule(rule)
        .set_event_bus_name(bus_arg(&bus))
        .set_targets(Some(targets))
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:PutTargets", e))?;
    match r.failed_entries().first() {
        Some(f) => Err(failed_entry("eventbridge:PutTargets", f.error_code(), f.error_message())),
        None => Ok(()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn events_remove_targets(state: State<'_, AppState>, region: String, bus: String, rule: String, ids: Vec<String>) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    remove_targets(&client, &bus, &rule, ids).await
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct EventsEntry {
    /// Absent or empty for the default bus.
    pub bus: Option<String>,
    pub source: String,
    pub detail_type: String,
    /// The event detail as JSON text.
    pub detail: String,
    pub resources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EventsPutResult {
    pub event_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// Sends events. A rejected entry is reported in its result with an error code, not as a command error; the results keep the order of `entries`.
#[tauri::command]
#[specta::specta]
pub async fn events_put_events(state: State<'_, AppState>, region: String, entries: Vec<EventsEntry>) -> Result<Vec<EventsPutResult>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let entries: Vec<PutEventsRequestEntry> = entries
        .into_iter()
        .map(|e| {
            PutEventsRequestEntry::builder()
                .set_event_bus_name(blank(e.bus))
                .source(e.source)
                .detail_type(e.detail_type)
                .detail(e.detail)
                .set_resources(if e.resources.is_empty() { None } else { Some(e.resources) })
                .build()
        })
        .collect();
    let r = client.put_events().set_entries(Some(entries)).send().await.map_err(|e| map_sdk_error("eventbridge:PutEvents", e))?;
    Ok(r.entries()
        .iter()
        .map(|e| EventsPutResult {
            event_id: text(e.event_id()),
            error_code: text(e.error_code()),
            error_message: text(e.error_message()),
        })
        .collect())
}

/// True when the event matches the pattern.
#[tauri::command]
#[specta::specta]
pub async fn events_test_event_pattern(state: State<'_, AppState>, region: String, pattern: String, event: String) -> Result<bool, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let r = client
        .test_event_pattern()
        .event_pattern(pattern)
        .event(event)
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:TestEventPattern", e))?;
    Ok(r.result())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EventsArchive {
    pub name: String,
    pub event_source_arn: String,
    pub state: String,
    /// Absent when events are kept forever.
    pub retention_days: Option<i32>,
    pub size_bytes: f64,
    pub event_count: f64,
    pub created: Option<String>,
}

/// Lists archives. `bus_name` keeps only the archives of that bus, matched on the bus ARN in the archive's event source, so the filter applies here and not in the request.
#[tauri::command]
#[specta::specta]
pub async fn events_list_archives(state: State<'_, AppState>, region: String, bus_name: Option<String>) -> Result<Vec<EventsArchive>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let bus = blank(bus_name);
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let r = client.list_archives().set_next_token(token.clone()).send().await.map_err(|e| map_sdk_error("eventbridge:ListArchives", e))?;
        out.extend(
            r.archives()
                .iter()
                .filter(|a| bus.as_deref().is_none_or(|b| is_bus_arn(a.event_source_arn().unwrap_or_default(), b)))
                .map(|a| EventsArchive {
                    name: a.archive_name().unwrap_or_default().to_string(),
                    event_source_arn: a.event_source_arn().unwrap_or_default().to_string(),
                    state: a.state().map(ArchiveState::as_str).unwrap_or_default().to_string(),
                    retention_days: a.retention_days(),
                    size_bytes: a.size_bytes() as f64,
                    event_count: a.event_count() as f64,
                    created: time(a.creation_time()),
                }),
        );
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn events_create_archive(
    state: State<'_, AppState>,
    region: String,
    name: String,
    event_source_arn: String,
    description: Option<String>,
    event_pattern: Option<String>,
    retention_days: Option<i32>,
) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    client
        .create_archive()
        .archive_name(name)
        .event_source_arn(event_source_arn)
        .set_description(blank(description))
        .set_event_pattern(blank(event_pattern))
        .set_retention_days(retention_days)
        .send()
        .await
        .map_err(|e| map_sdk_error("eventbridge:CreateArchive", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn events_delete_archive(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    client.delete_archive().archive_name(name).send().await.map_err(|e| map_sdk_error("eventbridge:DeleteArchive", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn events_list_tags(state: State<'_, AppState>, region: String, arn: String) -> Result<Vec<Tag>, ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    let r = client.list_tags_for_resource().resource_arn(arn).send().await.map_err(|e| map_sdk_error("eventbridge:ListTagsForResource", e))?;
    Ok(r.tags().iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect())
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn events_update_tags(state: State<'_, AppState>, region: String, arn: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = events(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_resource()
            .resource_arn(&arn)
            .set_tags(Some(api_tags(set)?))
            .send()
            .await
            .map_err(|e| map_sdk_error("eventbridge:TagResource", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_resource()
            .resource_arn(&arn)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("eventbridge:UntagResource", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_bus_is_the_default_bus() {
        assert_eq!(bus_arg(""), None);
        assert_eq!(bus_arg("  "), None);
        assert_eq!(bus_arg("orders"), Some("orders".to_string()));
    }

    #[test]
    fn bus_arn_matches_on_the_whole_name() {
        let arn = "arn:aws:events:us-east-1:000000000000:event-bus/orders";
        assert!(is_bus_arn(arn, "orders"));
        assert!(!is_bus_arn(arn, "order"));
        assert!(!is_bus_arn("arn:aws:events:us-east-1:000000000000:rule/orders", "orders"));
    }

    #[test]
    fn target_survives_the_api_round_trip() {
        let t = EventsTarget {
            id: "t1".into(),
            arn: "arn:aws:sqs:us-east-1:000000000000:q.fifo".into(),
            role_arn: None,
            input: None,
            input_path: None,
            input_transformer: Some(EventsInputTransformer { paths_map: HashMap::from([("a".to_string(), "$.detail.a".to_string())]), template: "<a>".into() }),
            dead_letter_arn: Some("arn:aws:sqs:us-east-1:000000000000:dlq".into()),
            sqs_message_group_id: Some("g".into()),
        };
        let back = target_of(&target_to_api(t.clone()).unwrap());
        assert_eq!(back, t);
    }

    #[test]
    fn failed_entry_defaults_the_code() {
        let e = failed_entry("eventbridge:PutTargets", None, Some("nope"));
        assert_eq!(e, ApiError::Aws { op: "eventbridge:PutTargets".into(), code: "InternalFailure".into(), message: "nope".into(), status: None });
    }
}
