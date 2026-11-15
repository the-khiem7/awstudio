//! Amazon SNS commands of the console pages: topics, subscriptions, publishing and tags.

use super::{build_error, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_sns::types::MessageAttributeValue;
use aws_sdk_sns::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

use super::sqs::MessageAttribute;

fn sns(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.sns_in(region)
}

/// The resource name: the last `:` segment of an ARN.
fn name_of(arn: &str) -> String {
    arn.rsplit(':').next().unwrap_or(arn).to_string()
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SnsTopic {
    pub arn: String,
    pub name: String,
    pub fifo: bool,
    pub display_name: Option<String>,
    pub subscriptions_confirmed: f64,
    pub subscriptions_pending: f64,
}

fn topic_of(arn: String, attrs: &HashMap<String, String>) -> SnsTopic {
    let n = |k: &str| attrs.get(k).and_then(|v| v.parse().ok()).unwrap_or(0.0);
    SnsTopic {
        name: name_of(&arn),
        fifo: attrs.get("FifoTopic").map(String::as_str) == Some("true") || arn.ends_with(".fifo"),
        display_name: attrs.get("DisplayName").filter(|d| !d.is_empty()).cloned(),
        subscriptions_confirmed: n("SubscriptionsConfirmed"),
        subscriptions_pending: n("SubscriptionsPending"),
        arn,
    }
}

async fn topic_attributes(client: &Client, arn: &str) -> Result<HashMap<String, String>, ApiError> {
    let r = client.get_topic_attributes().topic_arn(arn).send().await.map_err(|e| map_sdk_error("sns:GetTopicAttributes", e))?;
    Ok(r.attributes().cloned().unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_list_topics(state: State<'_, AppState>, region: String) -> Result<Vec<SnsTopic>, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let mut arns = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = client.list_topics().set_next_token(token.clone()).send().await.map_err(|e| map_sdk_error("sns:ListTopics", e))?;
        arns.extend(r.topics().iter().filter_map(|t| t.topic_arn().map(str::to_string)));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            break;
        }
    }
    let mut out = Vec::with_capacity(arns.len());
    for arn in arns {
        let attrs = topic_attributes(&client, &arn).await?;
        out.push(topic_of(arn, &attrs));
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateTopicInput {
    pub name: String,
    /// Topic attributes by their API names (`FifoTopic`, `DisplayName`, `Policy`).
    pub attributes: HashMap<String, String>,
    pub tags: Vec<Tag>,
}

fn sns_tags(tags: Vec<Tag>) -> Result<Vec<aws_sdk_sns::types::Tag>, ApiError> {
    tags.into_iter().map(|t| aws_sdk_sns::types::Tag::builder().key(t.key).value(t.value).build().map_err(build_error)).collect()
}

/// Creates a topic and returns its ARN.
#[tauri::command]
#[specta::specta]
pub async fn sns_create_topic(state: State<'_, AppState>, region: String, input: CreateTopicInput) -> Result<String, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let tags = sns_tags(input.tags)?;
    let r = client
        .create_topic()
        .name(input.name)
        .set_attributes(if input.attributes.is_empty() { None } else { Some(input.attributes) })
        .set_tags(if tags.is_empty() { None } else { Some(tags) })
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:CreateTopic", e))?;
    Ok(r.topic_arn().unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SnsTopicDetails {
    pub topic: SnsTopic,
    pub attributes: HashMap<String, String>,
}

#[tauri::command]
#[specta::specta]
pub async fn sns_get_topic(state: State<'_, AppState>, region: String, arn: String) -> Result<SnsTopicDetails, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let attributes = topic_attributes(&client, &arn).await?;
    Ok(SnsTopicDetails { topic: topic_of(arn, &attributes), attributes })
}

#[tauri::command]
#[specta::specta]
pub async fn sns_set_topic_attribute(state: State<'_, AppState>, region: String, arn: String, name: String, value: String) -> Result<(), ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    client
        .set_topic_attributes()
        .topic_arn(arn)
        .attribute_name(name)
        .attribute_value(value)
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:SetTopicAttributes", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_delete_topic(state: State<'_, AppState>, region: String, arn: String) -> Result<(), ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    client.delete_topic().topic_arn(arn).send().await.map_err(|e| map_sdk_error("sns:DeleteTopic", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SnsSubscription {
    pub arn: String,
    pub topic_arn: String,
    pub protocol: String,
    pub endpoint: String,
    /// `Confirmed` or `Pending confirmation`, from the ARN as the console reads it.
    pub status: String,
}

fn subscription_of(s: &aws_sdk_sns::types::Subscription) -> SnsSubscription {
    let arn = s.subscription_arn().unwrap_or_default().to_string();
    let pending = arn == "PendingConfirmation" || !arn.starts_with("arn:");
    SnsSubscription {
        status: if pending { "Pending confirmation".into() } else { "Confirmed".into() },
        arn,
        topic_arn: s.topic_arn().unwrap_or_default().to_string(),
        protocol: s.protocol().unwrap_or_default().to_string(),
        endpoint: s.endpoint().unwrap_or_default().to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn sns_list_subscriptions_by_topic(state: State<'_, AppState>, region: String, arn: String) -> Result<Vec<SnsSubscription>, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = client
            .list_subscriptions_by_topic()
            .topic_arn(&arn)
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("sns:ListSubscriptionsByTopic", e))?;
        out.extend(r.subscriptions().iter().map(subscription_of));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            return Ok(out);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn sns_list_subscriptions(state: State<'_, AppState>, region: String) -> Result<Vec<SnsSubscription>, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = client
            .list_subscriptions()
            .set_next_token(token.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("sns:ListSubscriptions", e))?;
        out.extend(r.subscriptions().iter().map(subscription_of));
        token = r.next_token().map(str::to_string);
        if token.is_none() {
            return Ok(out);
        }
    }
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct SubscribeInput {
    pub topic_arn: String,
    pub protocol: String,
    pub endpoint: String,
    /// Subscription attributes by their API names (`FilterPolicy`, `RawMessageDelivery`).
    pub attributes: HashMap<String, String>,
}

/// Subscribes an endpoint and returns the subscription ARN (`pending confirmation` until confirmed).
#[tauri::command]
#[specta::specta]
pub async fn sns_subscribe(state: State<'_, AppState>, region: String, input: SubscribeInput) -> Result<String, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let r = client
        .subscribe()
        .topic_arn(input.topic_arn)
        .protocol(input.protocol)
        .endpoint(input.endpoint)
        .set_attributes(if input.attributes.is_empty() { None } else { Some(input.attributes) })
        .return_subscription_arn(true)
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:Subscribe", e))?;
    Ok(r.subscription_arn().unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_unsubscribe(state: State<'_, AppState>, region: String, arn: String) -> Result<(), ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    client.unsubscribe().subscription_arn(arn).send().await.map_err(|e| map_sdk_error("sns:Unsubscribe", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_get_subscription(state: State<'_, AppState>, region: String, arn: String) -> Result<HashMap<String, String>, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let r = client
        .get_subscription_attributes()
        .subscription_arn(arn)
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:GetSubscriptionAttributes", e))?;
    Ok(r.attributes().cloned().unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_set_subscription_attribute(
    state: State<'_, AppState>,
    region: String,
    arn: String,
    name: String,
    value: String,
) -> Result<(), ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    client
        .set_subscription_attributes()
        .subscription_arn(arn)
        .attribute_name(name)
        .attribute_value(value)
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:SetSubscriptionAttributes", e))?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct PublishInput {
    pub topic_arn: String,
    pub subject: Option<String>,
    pub message: String,
    /// True when `message` is a JSON object with one message per protocol.
    pub per_protocol: bool,
    pub group_id: Option<String>,
    pub deduplication_id: Option<String>,
    pub attributes: Vec<MessageAttribute>,
}

/// Publishes one message and returns its message id.
#[tauri::command]
#[specta::specta]
pub async fn sns_publish(state: State<'_, AppState>, region: String, input: PublishInput) -> Result<String, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let attributes = input
        .attributes
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
        .collect::<Result<HashMap<_, _>, ApiError>>()?;
    let blank = |s: Option<String>| s.filter(|s| !s.is_empty());
    let r = client
        .publish()
        .topic_arn(input.topic_arn)
        .message(input.message)
        .set_subject(blank(input.subject))
        .set_message_structure(input.per_protocol.then(|| "json".to_string()))
        .set_message_group_id(blank(input.group_id))
        .set_message_deduplication_id(blank(input.deduplication_id))
        .set_message_attributes(if attributes.is_empty() { None } else { Some(attributes) })
        .send()
        .await
        .map_err(|e| map_sdk_error("sns:Publish", e))?;
    Ok(r.message_id().unwrap_or_default().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn sns_list_tags(state: State<'_, AppState>, region: String, arn: String) -> Result<Vec<Tag>, ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    let r = client.list_tags_for_resource().resource_arn(arn).send().await.map_err(|e| map_sdk_error("sns:ListTagsForResource", e))?;
    Ok(r.tags().iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect())
}

/// Sets `set` and removes `remove`, the difference the "Manage tags" page saves.
#[tauri::command]
#[specta::specta]
pub async fn sns_update_tags(state: State<'_, AppState>, region: String, arn: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = sns(&clients(&state).await?, &region)?;
    if !set.is_empty() {
        client
            .tag_resource()
            .resource_arn(&arn)
            .set_tags(Some(sns_tags(set)?))
            .send()
            .await
            .map_err(|e| map_sdk_error("sns:TagResource", e))?;
    }
    if !remove.is_empty() {
        client
            .untag_resource()
            .resource_arn(&arn)
            .set_tag_keys(Some(remove))
            .send()
            .await
            .map_err(|e| map_sdk_error("sns:UntagResource", e))?;
    }
    Ok(())
}
