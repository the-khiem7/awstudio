//! Amazon SQS commands of the console pages: queues, queue attributes, messages and tags.

use super::{build_error, epoch_millis, epoch_secs, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_sqs::types::{MessageAttributeValue, MessageSystemAttributeName, QueueAttributeName};
use aws_sdk_sqs::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

fn sqs(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.sqs_in(region)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SqsQueue {
    pub url: String,
    pub name: String,
    pub arn: Option<String>,
    pub fifo: bool,
    pub created: Option<String>,
    pub messages_available: f64,
    pub messages_in_flight: f64,
    pub messages_delayed: f64,
    /// `SSE-SQS`, `SSE-KMS`, or none.
    pub encryption: Option<String>,
    pub content_based_deduplication: bool,
}

/// The queue's name: the last path segment of its URL.
fn name_of(url: &str) -> String {
    url.rsplit('/').next().unwrap_or(url).to_string()
}

fn number(attrs: &HashMap<String, String>, name: &str) -> f64 {
    attrs.get(name).and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

fn queue_of(url: String, attrs: &HashMap<String, String>) -> SqsQueue {
    let encryption = if attrs.get("KmsMasterKeyId").is_some_and(|k| !k.is_empty()) {
        Some("SSE-KMS".to_string())
    } else if attrs.get("SqsManagedSseEnabled").map(String::as_str) == Some("true") {
        Some("SSE-SQS".to_string())
    } else {
        None
    };
    SqsQueue {
        name: name_of(&url),
        arn: attrs.get("QueueArn").cloned(),
        fifo: attrs.get("FifoQueue").map(String::as_str) == Some("true") || url.ends_with(".fifo"),
        created: epoch_secs(attrs.get("CreatedTimestamp")),
        messages_available: number(attrs, "ApproximateNumberOfMessages"),
        messages_in_flight: number(attrs, "ApproximateNumberOfMessagesNotVisible"),
        messages_delayed: number(attrs, "ApproximateNumberOfMessagesDelayed"),
        encryption,
        content_based_deduplication: attrs.get("ContentBasedDeduplication").map(String::as_str) == Some("true"),
        url,
    }
}

async fn attributes(client: &Client, url: &str) -> Result<HashMap<String, String>, ApiError> {
    let r = client
        .get_queue_attributes()
        .queue_url(url)
        .attribute_names(QueueAttributeName::All)
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:GetQueueAttributes", e))?;
    Ok(r.attributes().map(|m| m.iter().map(|(k, v)| (k.as_str().to_string(), v.clone())).collect()).unwrap_or_default())
}

/// Every queue of the Region with the columns of the console's queues list.
#[tauri::command]
#[specta::specta]
pub async fn sqs_list_queues(state: State<'_, AppState>, region: String) -> Result<Vec<SqsQueue>, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let mut urls = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = client
            .list_queues()
            .max_results(1000)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("sqs:ListQueues", e))?;
        urls.extend(r.queue_urls().iter().cloned());
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    let mut out = Vec::with_capacity(urls.len());
    for url in urls {
        let attrs = attributes(&client, &url).await?;
        out.push(queue_of(url, &attrs));
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateQueueInput {
    pub name: String,
    /// Queue attributes by their API names (`VisibilityTimeout`, `FifoQueue`, `RedrivePolicy`).
    pub attributes: HashMap<String, String>,
    pub tags: Vec<Tag>,
}

fn queue_attributes(a: HashMap<String, String>) -> Option<HashMap<QueueAttributeName, String>> {
    if a.is_empty() {
        return None;
    }
    Some(a.into_iter().map(|(k, v)| (QueueAttributeName::from(k.as_str()), v)).collect())
}

/// Creates a queue and returns its URL.
#[tauri::command]
#[specta::specta]
pub async fn sqs_create_queue(state: State<'_, AppState>, region: String, input: CreateQueueInput) -> Result<String, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let tags: HashMap<String, String> = input.tags.into_iter().map(|t| (t.key, t.value)).collect();
    let r = client
        .create_queue()
        .queue_name(input.name)
        .set_attributes(queue_attributes(input.attributes))
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:CreateQueue", e))?;
    Ok(r.queue_url().unwrap_or_default().to_string())
}

/// Every attribute of one queue by its API name, plus the summary the details page shows.
#[derive(Debug, Clone, Serialize, Type)]
pub struct SqsQueueDetails {
    pub queue: SqsQueue,
    pub attributes: HashMap<String, String>,
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_get_queue(state: State<'_, AppState>, region: String, url: String) -> Result<SqsQueueDetails, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let attributes = attributes(&client, &url).await?;
    Ok(SqsQueueDetails { queue: queue_of(url, &attributes), attributes })
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_set_queue_attributes(
    state: State<'_, AppState>,
    region: String,
    url: String,
    attributes: HashMap<String, String>,
) -> Result<(), ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    client
        .set_queue_attributes()
        .queue_url(url)
        .set_attributes(queue_attributes(attributes))
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:SetQueueAttributes", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_delete_queue(state: State<'_, AppState>, region: String, url: String) -> Result<(), ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    client.delete_queue().queue_url(url).send().await.map_err(|e| map_sdk_error("sqs:DeleteQueue", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_purge_queue(state: State<'_, AppState>, region: String, url: String) -> Result<(), ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    client.purge_queue().queue_url(url).send().await.map_err(|e| map_sdk_error("sqs:PurgeQueue", e))?;
    Ok(())
}

/// A message attribute: `String`, `Number` or `Binary` (base64 text), as the console's form has them.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct MessageAttribute {
    pub name: String,
    pub data_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct SendMessageInput {
    pub body: String,
    pub delay_seconds: Option<i32>,
    pub group_id: Option<String>,
    pub deduplication_id: Option<String>,
    pub attributes: Vec<MessageAttribute>,
}

fn message_attributes(attrs: Vec<MessageAttribute>) -> Result<Option<HashMap<String, MessageAttributeValue>>, ApiError> {
    if attrs.is_empty() {
        return Ok(None);
    }
    attrs
        .into_iter()
        .map(|a| {
            let b = MessageAttributeValue::builder().data_type(&a.data_type);
            let b = if a.data_type.starts_with("Binary") {
                let bytes = aws_smithy_types::base64::decode(&a.value)
                    .map_err(|_| ApiError::Invalid { detail: format!("attribute {}: the value is not base64", a.name) })?;
                b.binary_value(aws_smithy_types::Blob::new(bytes))
            } else {
                b.string_value(&a.value)
            };
            Ok((a.name, b.build().map_err(build_error)?))
        })
        .collect::<Result<HashMap<_, _>, ApiError>>()
        .map(Some)
}

fn blank_to_none(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

/// Sends one message and returns its message id.
#[tauri::command]
#[specta::specta]
pub async fn sqs_send_message(state: State<'_, AppState>, region: String, url: String, input: SendMessageInput) -> Result<String, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let r = client
        .send_message()
        .queue_url(url)
        .message_body(input.body)
        .set_delay_seconds(input.delay_seconds)
        .set_message_group_id(blank_to_none(input.group_id))
        .set_message_deduplication_id(blank_to_none(input.deduplication_id))
        .set_message_attributes(message_attributes(input.attributes)?)
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:SendMessage", e))?;
    Ok(r.message_id().unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SqsMessage {
    pub message_id: String,
    pub receipt_handle: String,
    pub body: String,
    pub md5_of_body: Option<String>,
    pub sent: Option<String>,
    pub first_received: Option<String>,
    pub receive_count: f64,
    pub group_id: Option<String>,
    pub deduplication_id: Option<String>,
    pub attributes: Vec<MessageAttribute>,
}

/// Polls for messages as the console's "Poll for messages" does. Received messages stay in the
/// queue and become visible again after the visibility timeout unless they are deleted.
#[tauri::command]
#[specta::specta]
pub async fn sqs_receive_messages(
    state: State<'_, AppState>,
    region: String,
    url: String,
    max_messages: i32,
    wait_seconds: i32,
    visibility_timeout: Option<i32>,
) -> Result<Vec<SqsMessage>, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let r = client
        .receive_message()
        .queue_url(url)
        .max_number_of_messages(max_messages.clamp(1, 10))
        .wait_time_seconds(wait_seconds.clamp(0, 20))
        .set_visibility_timeout(visibility_timeout)
        .message_system_attribute_names(MessageSystemAttributeName::All)
        .message_attribute_names("All")
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:ReceiveMessage", e))?;
    Ok(r.messages()
        .iter()
        .map(|m| {
            let sys: HashMap<String, String> =
                m.attributes().map(|a| a.iter().map(|(k, v)| (k.as_str().to_string(), v.clone())).collect()).unwrap_or_default();
            let mut attributes: Vec<MessageAttribute> = m
                .message_attributes()
                .map(|a| {
                    a.iter()
                        .map(|(name, v)| MessageAttribute {
                            name: name.clone(),
                            data_type: v.data_type().to_string(),
                            value: v
                                .string_value()
                                .map(str::to_string)
                                .or_else(|| v.binary_value().map(|b| aws_smithy_types::base64::encode(b.as_ref())))
                                .unwrap_or_default(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            attributes.sort_by(|a, b| a.name.cmp(&b.name));
            SqsMessage {
                message_id: m.message_id().unwrap_or_default().to_string(),
                receipt_handle: m.receipt_handle().unwrap_or_default().to_string(),
                body: m.body().unwrap_or_default().to_string(),
                md5_of_body: m.md5_of_body().map(str::to_string),
                sent: epoch_millis(sys.get("SentTimestamp")),
                first_received: epoch_millis(sys.get("ApproximateFirstReceiveTimestamp")),
                receive_count: number(&sys, "ApproximateReceiveCount"),
                group_id: sys.get("MessageGroupId").cloned(),
                deduplication_id: sys.get("MessageDeduplicationId").cloned(),
                attributes,
            }
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_delete_message(state: State<'_, AppState>, region: String, url: String, receipt_handle: String) -> Result<(), ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    client
        .delete_message()
        .queue_url(url)
        .receipt_handle(receipt_handle)
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:DeleteMessage", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sqs_list_tags(state: State<'_, AppState>, region: String, url: String) -> Result<Vec<Tag>, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let r = client.list_queue_tags().queue_url(url).send().await.map_err(|e| map_sdk_error("sqs:ListQueueTags", e))?;
    let mut tags: Vec<Tag> = r.tags().map(|t| t.iter().map(|(k, v)| Tag { key: k.clone(), value: v.clone() }).collect()).unwrap_or_default();
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(tags)
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn sqs_update_tags(state: State<'_, AppState>, region: String, url: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_queue()
            .queue_url(&url)
            .set_tags(Some(set.into_iter().map(|t| (t.key, t.value)).collect()))
            .send()
            .await
            .map_err(|e| map_sdk_error("sqs:TagQueue", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_queue()
            .queue_url(&url)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("sqs:UntagQueue", e))?;
    }
    Ok(())
}

/// URLs of the queues whose redrive policy names this queue as their dead-letter queue.
#[tauri::command]
#[specta::specta]
pub async fn sqs_list_dead_letter_sources(state: State<'_, AppState>, region: String, url: String) -> Result<Vec<String>, ApiError> {
    let client = sqs(&clients(&state).await?, &region)?;
    let r = client
        .list_dead_letter_source_queues()
        .queue_url(url)
        .send()
        .await
        .map_err(|e| map_sdk_error("sqs:ListDeadLetterSourceQueues", e))?;
    Ok(r.queue_urls().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_summary_reads_the_attributes() {
        let attrs: HashMap<String, String> = [
            ("QueueArn", "arn:aws:sqs:us-east-1:000000000000:orders.fifo"),
            ("FifoQueue", "true"),
            ("ApproximateNumberOfMessages", "3"),
            ("SqsManagedSseEnabled", "true"),
            ("CreatedTimestamp", "1763200000"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let q = queue_of("https://sqs.us-east-1.amazonaws.com/000000000000/orders.fifo".into(), &attrs);
        assert_eq!(q.name, "orders.fifo");
        assert!(q.fifo);
        assert_eq!(q.messages_available, 3.0);
        assert_eq!(q.encryption.as_deref(), Some("SSE-SQS"));
        assert!(q.created.unwrap().starts_with("2025-11-15T"));
    }
}
