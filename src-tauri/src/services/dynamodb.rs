//! Amazon DynamoDB commands of the console pages: tables, items, PartiQL, backups and time to
//! live.
//!
//! Items cross the IPC boundary in DynamoDB JSON (`{"name": {"S": "x"}}`), the form the console's
//! JSON item editor shows, so the frontend never guesses a number from a string.

use super::{build_error, time, Json, Tag};
use crate::aws::{map_sdk_error, ApiError, Clients};
use crate::commands::{clients, AppState};
use aws_sdk_dynamodb::types::{
    AttributeDefinition, AttributeValue, BillingMode, GlobalSecondaryIndex, KeySchemaElement, KeyType, Projection,
    ProjectionType, ProvisionedThroughput, ScalarAttributeType, TimeToLiveSpecification,
};
use aws_sdk_dynamodb::Client;
use aws_smithy_types::base64;
use aws_smithy_types::Blob;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

fn ddb(c: &Clients, region: &str) -> Result<Client, ApiError> {
    c.dynamodb_in(region)
}

fn invalid(detail: impl Into<String>) -> ApiError {
    ApiError::Invalid { detail: detail.into() }
}

/// One attribute value to DynamoDB JSON.
pub fn to_json(v: &AttributeValue) -> Value {
    let tagged = |k: &str, v: Value| Value::Object(Map::from_iter([(k.to_string(), v)]));
    match v {
        AttributeValue::S(s) => tagged("S", Value::String(s.clone())),
        AttributeValue::N(n) => tagged("N", Value::String(n.clone())),
        AttributeValue::B(b) => tagged("B", Value::String(base64::encode(b.as_ref()))),
        AttributeValue::Bool(b) => tagged("BOOL", Value::Bool(*b)),
        AttributeValue::Null(b) => tagged("NULL", Value::Bool(*b)),
        AttributeValue::Ss(v) => tagged("SS", v.iter().cloned().map(Value::String).collect()),
        AttributeValue::Ns(v) => tagged("NS", v.iter().cloned().map(Value::String).collect()),
        AttributeValue::Bs(v) => tagged("BS", v.iter().map(|b| Value::String(base64::encode(b.as_ref()))).collect()),
        AttributeValue::L(v) => tagged("L", v.iter().map(to_json).collect()),
        AttributeValue::M(m) => tagged("M", item_to_json(m)),
        _ => Value::Null,
    }
}

pub fn item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    Value::Object(item.iter().map(|(k, v)| (k.clone(), to_json(v))).collect())
}

fn strings(v: &Value, what: &str) -> Result<Vec<String>, ApiError> {
    v.as_array()
        .ok_or_else(|| invalid(format!("{what} must be an array")))?
        .iter()
        .map(|s| s.as_str().map(str::to_string).ok_or_else(|| invalid(format!("{what} must hold strings"))))
        .collect()
}

fn blob(s: &Value) -> Result<Blob, ApiError> {
    let text = s.as_str().ok_or_else(|| invalid("B must be a base64 string"))?;
    base64::decode(text).map(Blob::new).map_err(|_| invalid(format!("{text:?} is not base64")))
}

/// DynamoDB JSON to one attribute value; the error names the attribute path that is wrong.
pub fn from_json(v: &Value, path: &str) -> Result<AttributeValue, ApiError> {
    let obj = v.as_object().filter(|o| o.len() == 1).ok_or_else(|| {
        invalid(format!("{path} must be an object with one type key such as {{\"S\": \"text\"}}"))
    })?;
    let (kind, inner) = obj.iter().next().expect("one entry");
    let text = |what: &str| inner.as_str().map(str::to_string).ok_or_else(|| invalid(format!("{path}: {what} must be a string")));
    Ok(match kind.as_str() {
        "S" => AttributeValue::S(text("S")?),
        "N" => {
            let n = text("N")?;
            n.parse::<f64>().map_err(|_| invalid(format!("{path}: {n:?} is not a number")))?;
            AttributeValue::N(n)
        }
        "B" => AttributeValue::B(blob(inner)?),
        "BOOL" => AttributeValue::Bool(inner.as_bool().ok_or_else(|| invalid(format!("{path}: BOOL must be true or false")))?),
        "NULL" => AttributeValue::Null(true),
        "SS" => AttributeValue::Ss(strings(inner, &format!("{path}.SS"))?),
        "NS" => AttributeValue::Ns(strings(inner, &format!("{path}.NS"))?),
        "BS" => AttributeValue::Bs(
            inner.as_array().ok_or_else(|| invalid(format!("{path}.BS must be an array")))?.iter().map(blob).collect::<Result<_, _>>()?,
        ),
        "L" => AttributeValue::L(
            inner
                .as_array()
                .ok_or_else(|| invalid(format!("{path}.L must be an array")))?
                .iter()
                .enumerate()
                .map(|(i, v)| from_json(v, &format!("{path}[{i}]")))
                .collect::<Result<_, _>>()?,
        ),
        "M" => AttributeValue::M(item_from_json(inner, path)?),
        other => return Err(invalid(format!("{path}: {other} is not a DynamoDB type"))),
    })
}

pub fn item_from_json(v: &Value, path: &str) -> Result<HashMap<String, AttributeValue>, ApiError> {
    v.as_object()
        .ok_or_else(|| invalid(format!("{} must be an object of attributes", if path.is_empty() { "the item" } else { path })))?
        .iter()
        .map(|(k, v)| {
            let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
            Ok((k.clone(), from_json(v, &p)?))
        })
        .collect()
}

fn optional_item(v: Option<Json>) -> Result<Option<HashMap<String, AttributeValue>>, ApiError> {
    v.filter(|v| !v.0.is_null()).map(|v| item_from_json(&v.0, "")).transpose()
}

fn items(items: &[HashMap<String, AttributeValue>]) -> Vec<Json> {
    items.iter().map(|i| Json(item_to_json(i))).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct KeyAttribute {
    pub name: String,
    /// `S`, `N` or `B`.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct DdbIndex {
    pub name: String,
    pub status: Option<String>,
    pub partition_key: Option<KeyAttribute>,
    pub sort_key: Option<KeyAttribute>,
    pub projection: Option<String>,
    pub item_count: f64,
    pub size_bytes: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct DdbTable {
    pub name: String,
    pub arn: Option<String>,
    pub status: Option<String>,
    pub created: Option<String>,
    pub partition_key: Option<KeyAttribute>,
    pub sort_key: Option<KeyAttribute>,
    /// `PAY_PER_REQUEST` or `PROVISIONED`.
    pub billing_mode: String,
    pub read_capacity: f64,
    pub write_capacity: f64,
    pub item_count: f64,
    pub size_bytes: f64,
    pub table_class: Option<String>,
    pub deletion_protection: bool,
    pub stream: Option<String>,
    pub global_indexes: Vec<DdbIndex>,
    pub local_indexes: Vec<DdbIndex>,
}

fn key_of(schema: &[KeySchemaElement], defs: &[AttributeDefinition], kind: KeyType) -> Option<KeyAttribute> {
    let el = schema.iter().find(|k| k.key_type() == &kind)?;
    let name = el.attribute_name().to_string();
    let kind = defs
        .iter()
        .find(|d| d.attribute_name() == name)
        .map(|d| d.attribute_type().as_str().to_string())
        .unwrap_or_default();
    Some(KeyAttribute { name, kind })
}

fn table_of(t: &aws_sdk_dynamodb::types::TableDescription) -> DdbTable {
    let defs = t.attribute_definitions();
    let throughput = t.provisioned_throughput();
    let billing = t
        .billing_mode_summary()
        .and_then(|b| b.billing_mode())
        .map(|b| b.as_str().to_string())
        .unwrap_or_else(|| {
            // A table created as provisioned may have no billing summary.
            if throughput.and_then(|p| p.read_capacity_units()).unwrap_or(0) > 0 { "PROVISIONED".into() } else { "PAY_PER_REQUEST".into() }
        });
    let stream = t
        .stream_specification()
        .filter(|s| s.stream_enabled())
        .map(|s| s.stream_view_type().map(|v| v.as_str().to_string()).unwrap_or_else(|| "Enabled".into()));
    DdbTable {
        name: t.table_name().unwrap_or_default().to_string(),
        arn: t.table_arn().map(str::to_string),
        status: t.table_status().map(|s| s.as_str().to_string()),
        created: time(t.creation_date_time()),
        partition_key: key_of(t.key_schema(), defs, KeyType::Hash),
        sort_key: key_of(t.key_schema(), defs, KeyType::Range),
        billing_mode: billing,
        read_capacity: throughput.and_then(|p| p.read_capacity_units()).unwrap_or(0) as f64,
        write_capacity: throughput.and_then(|p| p.write_capacity_units()).unwrap_or(0) as f64,
        item_count: t.item_count().unwrap_or(0) as f64,
        size_bytes: t.table_size_bytes().unwrap_or(0) as f64,
        table_class: t.table_class_summary().and_then(|c| c.table_class()).map(|c| c.as_str().to_string()),
        deletion_protection: t.deletion_protection_enabled().unwrap_or(false),
        stream,
        global_indexes: t
            .global_secondary_indexes()
            .iter()
            .map(|i| DdbIndex {
                name: i.index_name().unwrap_or_default().to_string(),
                status: i.index_status().map(|s| s.as_str().to_string()),
                partition_key: key_of(i.key_schema(), defs, KeyType::Hash),
                sort_key: key_of(i.key_schema(), defs, KeyType::Range),
                projection: i.projection().and_then(|p| p.projection_type()).map(|p| p.as_str().to_string()),
                item_count: i.item_count().unwrap_or(0) as f64,
                size_bytes: i.index_size_bytes().unwrap_or(0) as f64,
            })
            .collect(),
        local_indexes: t
            .local_secondary_indexes()
            .iter()
            .map(|i| DdbIndex {
                name: i.index_name().unwrap_or_default().to_string(),
                status: None,
                partition_key: key_of(i.key_schema(), defs, KeyType::Hash),
                sort_key: key_of(i.key_schema(), defs, KeyType::Range),
                projection: i.projection().and_then(|p| p.projection_type()).map(|p| p.as_str().to_string()),
                item_count: i.item_count().unwrap_or(0) as f64,
                size_bytes: i.index_size_bytes().unwrap_or(0) as f64,
            })
            .collect(),
    }
}

async fn describe(client: &Client, name: &str) -> Result<DdbTable, ApiError> {
    let r = client.describe_table().table_name(name).send().await.map_err(|e| map_sdk_error("dynamodb:DescribeTable", e))?;
    r.table().map(table_of).ok_or_else(|| invalid(format!("DescribeTable returned no table for {name}")))
}

/// Every table of the Region with the columns of the console's tables list.
#[tauri::command]
#[specta::specta]
pub async fn ddb_list_tables(state: State<'_, AppState>, region: String) -> Result<Vec<DdbTable>, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let mut names = Vec::new();
    let mut start: Option<String> = None;
    loop {
        let r = client
            .list_tables()
            .set_exclusive_start_table_name(start.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("dynamodb:ListTables", e))?;
        names.extend(r.table_names().iter().cloned());
        start = r.last_evaluated_table_name().map(str::to_string);
        if start.is_none() {
            break;
        }
    }
    let mut out = Vec::with_capacity(names.len());
    for n in names {
        out.push(describe(&client, &n).await?);
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_describe_table(state: State<'_, AppState>, region: String, name: String) -> Result<DdbTable, ApiError> {
    describe(&ddb(&clients(&state).await?, &region)?, &name).await
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateIndexInput {
    pub name: String,
    pub partition_key: KeyAttribute,
    pub sort_key: Option<KeyAttribute>,
    /// `ALL` or `KEYS_ONLY`.
    pub projection: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateTableInput {
    pub name: String,
    pub partition_key: KeyAttribute,
    pub sort_key: Option<KeyAttribute>,
    /// `PAY_PER_REQUEST` or `PROVISIONED`.
    pub billing_mode: String,
    pub read_capacity: i32,
    pub write_capacity: i32,
    pub global_indexes: Vec<CreateIndexInput>,
    pub deletion_protection: bool,
    pub tags: Vec<Tag>,
}

fn key_schema(pk: &KeyAttribute, sk: Option<&KeyAttribute>) -> Result<Vec<KeySchemaElement>, ApiError> {
    let mut out = vec![KeySchemaElement::builder().attribute_name(&pk.name).key_type(KeyType::Hash).build().map_err(build_error)?];
    if let Some(sk) = sk {
        out.push(KeySchemaElement::builder().attribute_name(&sk.name).key_type(KeyType::Range).build().map_err(build_error)?);
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_create_table(state: State<'_, AppState>, region: String, input: CreateTableInput) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let provisioned = input.billing_mode == "PROVISIONED";
    let throughput = |r: i32, w: i32| {
        ProvisionedThroughput::builder().read_capacity_units(r as i64).write_capacity_units(w as i64).build().map_err(build_error)
    };
    // Each key attribute is defined once, whether a table key or an index key names it.
    let mut defs: Vec<KeyAttribute> = Vec::new();
    let mut define = |k: &KeyAttribute| -> Result<(), ApiError> {
        match defs.iter().find(|d| d.name == k.name) {
            Some(d) if d.kind != k.kind => Err(invalid(format!("attribute {} is declared as both {} and {}", k.name, d.kind, k.kind))),
            Some(_) => Ok(()),
            None => {
                defs.push(k.clone());
                Ok(())
            }
        }
    };
    define(&input.partition_key)?;
    if let Some(sk) = &input.sort_key {
        define(sk)?;
    }
    let mut indexes = Vec::new();
    for i in &input.global_indexes {
        define(&i.partition_key)?;
        if let Some(sk) = &i.sort_key {
            define(sk)?;
        }
        let projection = Projection::builder().projection_type(ProjectionType::from(i.projection.as_str())).build();
        let mut b = GlobalSecondaryIndex::builder()
            .index_name(&i.name)
            .set_key_schema(Some(key_schema(&i.partition_key, i.sort_key.as_ref())?))
            .projection(projection);
        if provisioned {
            b = b.provisioned_throughput(throughput(input.read_capacity, input.write_capacity)?);
        }
        indexes.push(b.build().map_err(build_error)?);
    }
    let definitions = defs
        .iter()
        .map(|d| {
            AttributeDefinition::builder()
                .attribute_name(&d.name)
                .attribute_type(ScalarAttributeType::from(d.kind.as_str()))
                .build()
                .map_err(build_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let tags = input
        .tags
        .iter()
        .map(|t| aws_sdk_dynamodb::types::Tag::builder().key(&t.key).value(&t.value).build().map_err(build_error))
        .collect::<Result<Vec<_>, _>>()?;
    let mut req = client
        .create_table()
        .table_name(&input.name)
        .set_attribute_definitions(Some(definitions))
        .set_key_schema(Some(key_schema(&input.partition_key, input.sort_key.as_ref())?))
        .billing_mode(if provisioned { BillingMode::Provisioned } else { BillingMode::PayPerRequest })
        .deletion_protection_enabled(input.deletion_protection)
        .set_global_secondary_indexes(if indexes.is_empty() { None } else { Some(indexes) })
        .set_tags(if tags.is_empty() { None } else { Some(tags) });
    if provisioned {
        req = req.provisioned_throughput(throughput(input.read_capacity, input.write_capacity)?);
    }
    req.send().await.map_err(|e| map_sdk_error("dynamodb:CreateTable", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_delete_table(state: State<'_, AppState>, region: String, name: String) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    client.delete_table().table_name(name).send().await.map_err(|e| map_sdk_error("dynamodb:DeleteTable", e))?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct ReadInput {
    pub table: String,
    pub index: Option<String>,
    /// Query only: the key condition. A read without one is a Scan.
    pub key_condition: Option<String>,
    pub filter: Option<String>,
    pub names: HashMap<String, String>,
    /// DynamoDB JSON map of every `:value` the condition and filter use.
    pub values: Json,
    pub limit: Option<i32>,
    pub forward: bool,
    pub start_key: Option<Json>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct ItemPage {
    pub items: Vec<Json>,
    pub last_key: Option<Json>,
    pub count: i32,
    pub scanned_count: i32,
}

fn values_of(v: &Json) -> Result<Option<HashMap<String, AttributeValue>>, ApiError> {
    match &v.0 {
        Value::Null => Ok(None),
        Value::Object(o) if o.is_empty() => Ok(None),
        other => item_from_json(other, "values").map(Some),
    }
}

fn names_of(n: HashMap<String, String>) -> Option<HashMap<String, String>> {
    if n.is_empty() { None } else { Some(n) }
}

fn not_blank(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.trim().is_empty())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_scan(state: State<'_, AppState>, region: String, input: ReadInput) -> Result<ItemPage, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let r = client
        .scan()
        .table_name(&input.table)
        .set_index_name(not_blank(input.index))
        .set_filter_expression(not_blank(input.filter))
        .set_expression_attribute_names(names_of(input.names))
        .set_expression_attribute_values(values_of(&input.values)?)
        .set_limit(input.limit)
        .set_exclusive_start_key(optional_item(input.start_key)?)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:Scan", e))?;
    Ok(ItemPage {
        items: items(r.items()),
        last_key: r.last_evaluated_key().map(|k| Json(item_to_json(k))),
        count: r.count(),
        scanned_count: r.scanned_count(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_query(state: State<'_, AppState>, region: String, input: ReadInput) -> Result<ItemPage, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let condition = not_blank(input.key_condition).ok_or_else(|| invalid("a query needs a partition key value"))?;
    let r = client
        .query()
        .table_name(&input.table)
        .set_index_name(not_blank(input.index))
        .key_condition_expression(condition)
        .set_filter_expression(not_blank(input.filter))
        .set_expression_attribute_names(names_of(input.names))
        .set_expression_attribute_values(values_of(&input.values)?)
        .set_limit(input.limit)
        .scan_index_forward(input.forward)
        .set_exclusive_start_key(optional_item(input.start_key)?)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:Query", e))?;
    Ok(ItemPage {
        items: items(r.items()),
        last_key: r.last_evaluated_key().map(|k| Json(item_to_json(k))),
        count: r.count(),
        scanned_count: r.scanned_count(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_get_item(state: State<'_, AppState>, region: String, table: String, key: Json) -> Result<Option<Json>, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let r = client
        .get_item()
        .table_name(table)
        .set_key(Some(item_from_json(&key.0, "key")?))
        .consistent_read(true)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:GetItem", e))?;
    Ok(r.item().map(|i| Json(item_to_json(i))))
}

/// Writes an item. `create` refuses to replace an item that already has this key, as the
/// console's "Create item" does; without it the item is replaced.
#[tauri::command]
#[specta::specta]
pub async fn ddb_put_item(
    state: State<'_, AppState>,
    region: String,
    table: String,
    item: Json,
    create_only_key: Option<String>,
) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let mut req = client.put_item().table_name(table).set_item(Some(item_from_json(&item.0, "")?));
    if let Some(pk) = create_only_key {
        req = req.condition_expression("attribute_not_exists(#pk)").expression_attribute_names("#pk", pk);
    }
    req.send().await.map_err(|e| map_sdk_error("dynamodb:PutItem", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_delete_items(state: State<'_, AppState>, region: String, table: String, keys: Vec<Json>) -> Result<u32, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let mut deleted = 0;
    for key in keys {
        client
            .delete_item()
            .table_name(&table)
            .set_key(Some(item_from_json(&key.0, "key")?))
            .send()
            .await
            .map_err(|e| map_sdk_error("dynamodb:DeleteItem", e))?;
        deleted += 1;
    }
    Ok(deleted)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct StatementPage {
    pub items: Vec<Json>,
    pub next_token: Option<String>,
}

/// Runs one PartiQL statement; `parameters` is a DynamoDB JSON array for its `?` placeholders.
#[tauri::command]
#[specta::specta]
pub async fn ddb_execute_statement(
    state: State<'_, AppState>,
    region: String,
    statement: String,
    parameters: Option<Json>,
    next_token: Option<String>,
) -> Result<StatementPage, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let params = match parameters.map(|p| p.0) {
        Some(Value::Array(a)) if !a.is_empty() => {
            Some(a.iter().enumerate().map(|(i, v)| from_json(v, &format!("parameter {}", i + 1))).collect::<Result<Vec<_>, _>>()?)
        }
        _ => None,
    };
    let r = client
        .execute_statement()
        .statement(statement)
        .set_parameters(params)
        .set_next_token(next_token)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:ExecuteStatement", e))?;
    Ok(StatementPage { items: items(r.items()), next_token: r.next_token().map(str::to_string) })
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct DdbBackup {
    pub arn: String,
    pub name: String,
    pub table: String,
    pub status: Option<String>,
    pub kind: Option<String>,
    pub created: Option<String>,
    pub size_bytes: f64,
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_list_backups(state: State<'_, AppState>, region: String, table: Option<String>) -> Result<Vec<DdbBackup>, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let mut out = Vec::new();
    let mut start: Option<String> = None;
    loop {
        let r = client
            .list_backups()
            .set_table_name(table.clone())
            .set_exclusive_start_backup_arn(start.clone())
            .send()
            .await
            .map_err(|e| map_sdk_error("dynamodb:ListBackups", e))?;
        out.extend(r.backup_summaries().iter().map(|b| DdbBackup {
            arn: b.backup_arn().unwrap_or_default().to_string(),
            name: b.backup_name().unwrap_or_default().to_string(),
            table: b.table_name().unwrap_or_default().to_string(),
            status: b.backup_status().map(|s| s.as_str().to_string()),
            kind: b.backup_type().map(|s| s.as_str().to_string()),
            created: time(b.backup_creation_date_time()),
            size_bytes: b.backup_size_bytes().unwrap_or(0) as f64,
        }));
        start = r.last_evaluated_backup_arn().map(str::to_string);
        if start.is_none() {
            return Ok(out);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_create_backup(state: State<'_, AppState>, region: String, table: String, name: String) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    client.create_backup().table_name(table).backup_name(name).send().await.map_err(|e| map_sdk_error("dynamodb:CreateBackup", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_delete_backup(state: State<'_, AppState>, region: String, arn: String) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    client.delete_backup().backup_arn(arn).send().await.map_err(|e| map_sdk_error("dynamodb:DeleteBackup", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_restore_backup(state: State<'_, AppState>, region: String, arn: String, target: String) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    client
        .restore_table_from_backup()
        .backup_arn(arn)
        .target_table_name(target)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:RestoreTableFromBackup", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct TimeToLive {
    pub status: String,
    pub attribute: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_describe_ttl(state: State<'_, AppState>, region: String, table: String) -> Result<TimeToLive, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let r = client.describe_time_to_live().table_name(table).send().await.map_err(|e| map_sdk_error("dynamodb:DescribeTimeToLive", e))?;
    let d = r.time_to_live_description();
    Ok(TimeToLive {
        status: d.and_then(|d| d.time_to_live_status()).map(|s| s.as_str().to_string()).unwrap_or_else(|| "DISABLED".into()),
        attribute: d.and_then(|d| d.attribute_name()).map(str::to_string),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_update_ttl(state: State<'_, AppState>, region: String, table: String, enabled: bool, attribute: String) -> Result<(), ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let spec = TimeToLiveSpecification::builder().enabled(enabled).attribute_name(attribute).build().map_err(build_error)?;
    client
        .update_time_to_live()
        .table_name(table)
        .time_to_live_specification(spec)
        .send()
        .await
        .map_err(|e| map_sdk_error("dynamodb:UpdateTimeToLive", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ddb_list_tags(state: State<'_, AppState>, region: String, arn: String) -> Result<Vec<Tag>, ApiError> {
    let client = ddb(&clients(&state).await?, &region)?;
    let r = client.list_tags_of_resource().resource_arn(arn).send().await.map_err(|e| map_sdk_error("dynamodb:ListTagsOfResource", e))?;
    Ok(r.tags().iter().map(|t| Tag { key: t.key().to_string(), value: t.value().to_string() }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamodb_json_round_trips_every_type() {
        let item = serde_json::json!({
            "s": {"S": "text"}, "n": {"N": "1.5"}, "b": {"B": "AAEC"}, "t": {"BOOL": true}, "z": {"NULL": true},
            "ss": {"SS": ["a", "b"]}, "ns": {"NS": ["1", "2"]}, "bs": {"BS": ["AA=="]},
            "l": {"L": [{"S": "x"}, {"N": "2"}]}, "m": {"M": {"inner": {"S": "y"}}}
        });
        let parsed = item_from_json(&item, "").unwrap();
        assert_eq!(item_to_json(&parsed), item);
    }

    #[test]
    fn a_wrong_value_names_its_path() {
        let err = item_from_json(&serde_json::json!({"m": {"M": {"n": {"N": "x"}}}}), "").unwrap_err();
        assert!(err.to_string().contains("m.n"), "{err}");
        let err = item_from_json(&serde_json::json!({"a": "plain"}), "").unwrap_err();
        assert!(err.to_string().contains("one type key"), "{err}");
    }
}
