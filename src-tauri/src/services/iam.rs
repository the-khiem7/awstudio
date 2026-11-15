//! AWS IAM commands of the console pages: users, user groups, roles, policies and access keys.
//!
//! IAM is a global service, so these commands take no Region: every call goes to the Region the
//! emulator session was started with. Users, groups and roles share their policy commands through
//! [`PrincipalKind`], and every error names the operation of the kind it ran (for example
//! `iam:AttachRolePolicy`), so a 501 disables only that kind's control.

use super::{build_error, time, Tag};
use crate::aws::{map_sdk_error, ApiError};
use crate::commands::{clients, AppState};
use aws_sdk_iam::types::PolicyScopeType;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::State;

/// Which kind of principal a policy command works on.
#[derive(Debug, Clone, Copy, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalKind {
    User,
    Group,
    Role,
}

impl PrincipalKind {
    fn label(self) -> &'static str {
        match self {
            PrincipalKind::User => "User",
            PrincipalKind::Group => "Group",
            PrincipalKind::Role => "Role",
        }
    }

    /// `iam:<Verb><Kind><Noun>`, for example `iam:AttachRolePolicy`.
    fn op(self, verb: &str, noun: &str) -> String {
        format!("iam:{verb}{}{noun}", self.label())
    }
}

/// What a tag command works on.
#[derive(Debug, Clone, Copy, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaggableKind {
    User,
    Role,
    Policy,
}

/// IAM returns policy documents URL-encoded (`%7B%22Version%22...`); the console shows them as
/// JSON. Text that does not start with an encoded `{` is returned as it came.
pub(crate) fn decode_document(text: &str) -> String {
    if !text.starts_with("%7B") && !text.starts_with("%7b") {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(v) = hex {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

fn iam_tags(tags: Vec<Tag>) -> Result<Vec<aws_sdk_iam::types::Tag>, ApiError> {
    tags.into_iter().map(|t| aws_sdk_iam::types::Tag::builder().key(t.key).value(t.value).build().map_err(build_error)).collect()
}

fn opt<T>(v: Vec<T>) -> Option<Vec<T>> {
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

// Account ------------------------------------------------------------------------------------------

/// The account summary: resource counts and quotas by their API names (`Users`, `UsersQuota`).
#[tauri::command]
#[specta::specta]
pub async fn iam_account_summary(state: State<'_, AppState>) -> Result<HashMap<String, f64>, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_account_summary().send().await.map_err(|e| map_sdk_error("iam:GetAccountSummary", e))?;
    Ok(r.summary_map().map(|m| m.iter().map(|(k, v)| (k.as_str().to_string(), *v as f64)).collect()).unwrap_or_default())
}

// Users --------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamUser {
    pub name: String,
    pub arn: String,
    pub id: String,
    pub path: String,
    pub created: Option<String>,
    pub password_last_used: Option<String>,
}

fn user_of(u: &aws_sdk_iam::types::User) -> IamUser {
    IamUser {
        name: u.user_name().to_string(),
        arn: u.arn().to_string(),
        id: u.user_id().to_string(),
        path: u.path().to_string(),
        created: time(Some(u.create_date())),
        password_last_used: time(u.password_last_used()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_users(state: State<'_, AppState>) -> Result<Vec<IamUser>, ApiError> {
    let client = clients(&state).await?.iam();
    let mut out = Vec::new();
    let mut pages = client.list_users().into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("iam:ListUsers", e))?.users().iter().map(user_of));
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_user(state: State<'_, AppState>, name: String) -> Result<IamUser, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_user().user_name(name).send().await.map_err(|e| map_sdk_error("iam:GetUser", e))?;
    r.user().map(user_of).ok_or_else(|| build_error("GetUser returned no user"))
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateUserInput {
    pub name: String,
    pub path: Option<String>,
    pub tags: Vec<Tag>,
    /// Groups the user joins once created.
    pub groups: Vec<String>,
    /// Managed policies attached once created.
    pub policy_arns: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_create_user(state: State<'_, AppState>, input: CreateUserInput) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    let tags = iam_tags(input.tags)?;
    let r = client
        .create_user()
        .user_name(&input.name)
        .set_path(input.path.filter(|p| !p.is_empty()))
        .set_tags(opt(tags))
        .send()
        .await
        .map_err(|e| map_sdk_error("iam:CreateUser", e))?;
    for g in &input.groups {
        client.add_user_to_group().group_name(g).user_name(&input.name).send().await.map_err(|e| map_sdk_error("iam:AddUserToGroup", e))?;
    }
    for arn in &input.policy_arns {
        client.attach_user_policy().user_name(&input.name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:AttachUserPolicy", e))?;
    }
    Ok(r.user().map(|u| u.user_name().to_string()).unwrap_or(input.name))
}

/// Deletes a user after removing everything IAM refuses to delete it with: access keys, inline
/// and attached policies, group memberships and the console password, as the console does.
#[tauri::command]
#[specta::specta]
pub async fn iam_delete_user(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    for k in iam_access_keys(&client, &name).await? {
        client.delete_access_key().user_name(&name).access_key_id(k.id).send().await.map_err(|e| map_sdk_error("iam:DeleteAccessKey", e))?;
    }
    for p in client.list_user_policies().user_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListUserPolicies", e))?.policy_names() {
        client.delete_user_policy().user_name(&name).policy_name(p).send().await.map_err(|e| map_sdk_error("iam:DeleteUserPolicy", e))?;
    }
    for p in client.list_attached_user_policies().user_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListAttachedUserPolicies", e))?.attached_policies() {
        if let Some(arn) = p.policy_arn() {
            client.detach_user_policy().user_name(&name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:DetachUserPolicy", e))?;
        }
    }
    for g in client.list_groups_for_user().user_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListGroupsForUser", e))?.groups() {
        client.remove_user_from_group().user_name(&name).group_name(g.group_name()).send().await.map_err(|e| map_sdk_error("iam:RemoveUserFromGroup", e))?;
    }
    // A user without a console password answers NoSuchEntity, which is the state wanted.
    if let Err(e) = client.delete_login_profile().user_name(&name).send().await {
        let mapped = map_sdk_error("iam:DeleteLoginProfile", e);
        if !super::is_code(&mapped, &["NoSuchEntity"]) {
            return Err(mapped);
        }
    }
    client.delete_user().user_name(name).send().await.map_err(|e| map_sdk_error("iam:DeleteUser", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_groups_for_user(state: State<'_, AppState>, name: String) -> Result<Vec<IamGroup>, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.list_groups_for_user().user_name(name).send().await.map_err(|e| map_sdk_error("iam:ListGroupsForUser", e))?;
    Ok(r.groups().iter().map(group_of).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_add_user_to_group(state: State<'_, AppState>, group: String, user: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.add_user_to_group().group_name(group).user_name(user).send().await.map_err(|e| map_sdk_error("iam:AddUserToGroup", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_remove_user_from_group(state: State<'_, AppState>, group: String, user: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.remove_user_from_group().group_name(group).user_name(user).send().await.map_err(|e| map_sdk_error("iam:RemoveUserFromGroup", e))?;
    Ok(())
}

// Groups -------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamGroup {
    pub name: String,
    pub arn: String,
    pub id: String,
    pub path: String,
    pub created: Option<String>,
}

fn group_of(g: &aws_sdk_iam::types::Group) -> IamGroup {
    IamGroup { name: g.group_name().to_string(), arn: g.arn().to_string(), id: g.group_id().to_string(), path: g.path().to_string(), created: time(Some(g.create_date())) }
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_groups(state: State<'_, AppState>) -> Result<Vec<IamGroup>, ApiError> {
    let client = clients(&state).await?.iam();
    let mut out = Vec::new();
    let mut pages = client.list_groups().into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("iam:ListGroups", e))?.groups().iter().map(group_of));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamGroupDetails {
    pub group: IamGroup,
    pub users: Vec<IamUser>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_group(state: State<'_, AppState>, name: String) -> Result<IamGroupDetails, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_group().group_name(name).send().await.map_err(|e| map_sdk_error("iam:GetGroup", e))?;
    let group = r.group().map(group_of).ok_or_else(|| build_error("GetGroup returned no group"))?;
    Ok(IamGroupDetails { group, users: r.users().iter().map(user_of).collect() })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateGroupInput {
    pub name: String,
    pub path: Option<String>,
    pub users: Vec<String>,
    pub policy_arns: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_create_group(state: State<'_, AppState>, input: CreateGroupInput) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    client.create_group().group_name(&input.name).set_path(input.path.filter(|p| !p.is_empty())).send().await.map_err(|e| map_sdk_error("iam:CreateGroup", e))?;
    for u in &input.users {
        client.add_user_to_group().group_name(&input.name).user_name(u).send().await.map_err(|e| map_sdk_error("iam:AddUserToGroup", e))?;
    }
    for arn in &input.policy_arns {
        client.attach_group_policy().group_name(&input.name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:AttachGroupPolicy", e))?;
    }
    Ok(input.name)
}

/// Deletes a group after removing its members, attached policies and inline policies.
#[tauri::command]
#[specta::specta]
pub async fn iam_delete_group(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let g = client.get_group().group_name(&name).send().await.map_err(|e| map_sdk_error("iam:GetGroup", e))?;
    for u in g.users() {
        client.remove_user_from_group().group_name(&name).user_name(u.user_name()).send().await.map_err(|e| map_sdk_error("iam:RemoveUserFromGroup", e))?;
    }
    for p in client.list_group_policies().group_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListGroupPolicies", e))?.policy_names() {
        client.delete_group_policy().group_name(&name).policy_name(p).send().await.map_err(|e| map_sdk_error("iam:DeleteGroupPolicy", e))?;
    }
    for p in client.list_attached_group_policies().group_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListAttachedGroupPolicies", e))?.attached_policies() {
        if let Some(arn) = p.policy_arn() {
            client.detach_group_policy().group_name(&name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:DetachGroupPolicy", e))?;
        }
    }
    client.delete_group().group_name(name).send().await.map_err(|e| map_sdk_error("iam:DeleteGroup", e))?;
    Ok(())
}

// Roles --------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamRole {
    pub name: String,
    pub arn: String,
    pub id: String,
    pub path: String,
    pub created: Option<String>,
    pub description: Option<String>,
    pub max_session_duration: Option<f64>,
    /// The trust policy as JSON text.
    pub trust_policy: Option<String>,
    pub last_used: Option<String>,
}

fn role_of(r: &aws_sdk_iam::types::Role) -> IamRole {
    IamRole {
        name: r.role_name().to_string(),
        arn: r.arn().to_string(),
        id: r.role_id().to_string(),
        path: r.path().to_string(),
        created: time(Some(r.create_date())),
        description: r.description().filter(|d| !d.is_empty()).map(str::to_string),
        max_session_duration: r.max_session_duration().map(f64::from),
        trust_policy: r.assume_role_policy_document().map(decode_document),
        last_used: time(r.role_last_used().and_then(|l| l.last_used_date())),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_roles(state: State<'_, AppState>) -> Result<Vec<IamRole>, ApiError> {
    let client = clients(&state).await?.iam();
    let mut out = Vec::new();
    let mut pages = client.list_roles().into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("iam:ListRoles", e))?.roles().iter().map(role_of));
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_role(state: State<'_, AppState>, name: String) -> Result<IamRole, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_role().role_name(name).send().await.map_err(|e| map_sdk_error("iam:GetRole", e))?;
    r.role().map(role_of).ok_or_else(|| build_error("GetRole returned no role"))
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreateRoleInput {
    pub name: String,
    pub path: Option<String>,
    pub description: Option<String>,
    pub trust_policy: String,
    pub max_session_duration: Option<f64>,
    pub tags: Vec<Tag>,
    pub policy_arns: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_create_role(state: State<'_, AppState>, input: CreateRoleInput) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    let tags = iam_tags(input.tags)?;
    let r = client
        .create_role()
        .role_name(&input.name)
        .assume_role_policy_document(input.trust_policy)
        .set_path(input.path.filter(|p| !p.is_empty()))
        .set_description(input.description.filter(|d| !d.is_empty()))
        .set_max_session_duration(input.max_session_duration.map(|d| d as i32))
        .set_tags(opt(tags))
        .send()
        .await
        .map_err(|e| map_sdk_error("iam:CreateRole", e))?;
    for arn in &input.policy_arns {
        client.attach_role_policy().role_name(&input.name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:AttachRolePolicy", e))?;
    }
    Ok(r.role().map(|r| r.arn().to_string()).unwrap_or_default())
}

/// Deletes a role after detaching its managed policies, deleting its inline policies and taking it
/// out of instance profiles.
#[tauri::command]
#[specta::specta]
pub async fn iam_delete_role(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    for p in client.list_role_policies().role_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListRolePolicies", e))?.policy_names() {
        client.delete_role_policy().role_name(&name).policy_name(p).send().await.map_err(|e| map_sdk_error("iam:DeleteRolePolicy", e))?;
    }
    for p in client.list_attached_role_policies().role_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListAttachedRolePolicies", e))?.attached_policies() {
        if let Some(arn) = p.policy_arn() {
            client.detach_role_policy().role_name(&name).policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:DetachRolePolicy", e))?;
        }
    }
    for ip in client.list_instance_profiles_for_role().role_name(&name).send().await.map_err(|e| map_sdk_error("iam:ListInstanceProfilesForRole", e))?.instance_profiles() {
        client.remove_role_from_instance_profile().role_name(&name).instance_profile_name(ip.instance_profile_name()).send().await.map_err(|e| map_sdk_error("iam:RemoveRoleFromInstanceProfile", e))?;
    }
    client.delete_role().role_name(name).send().await.map_err(|e| map_sdk_error("iam:DeleteRole", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_update_assume_role_policy(state: State<'_, AppState>, name: String, document: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.update_assume_role_policy().role_name(name).policy_document(document).send().await.map_err(|e| map_sdk_error("iam:UpdateAssumeRolePolicy", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_update_role(state: State<'_, AppState>, name: String, description: String, max_session_duration: f64) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client
        .update_role()
        .role_name(name)
        .description(description)
        .max_session_duration(max_session_duration as i32)
        .send()
        .await
        .map_err(|e| map_sdk_error("iam:UpdateRole", e))?;
    Ok(())
}

// Tags ---------------------------------------------------------------------------------------------

/// Tags of a user, role or managed policy. `id` is the name, or the ARN for a policy.
#[tauri::command]
#[specta::specta]
pub async fn iam_list_tags(state: State<'_, AppState>, kind: TaggableKind, id: String) -> Result<Vec<Tag>, ApiError> {
    let client = clients(&state).await?.iam();
    let conv = |t: &aws_sdk_iam::types::Tag| Tag { key: t.key().to_string(), value: t.value().to_string() };
    Ok(match kind {
        TaggableKind::User => client.list_user_tags().user_name(id).send().await.map_err(|e| map_sdk_error("iam:ListUserTags", e))?.tags().iter().map(conv).collect(),
        TaggableKind::Role => client.list_role_tags().role_name(id).send().await.map_err(|e| map_sdk_error("iam:ListRoleTags", e))?.tags().iter().map(conv).collect(),
        TaggableKind::Policy => client.list_policy_tags().policy_arn(id).send().await.map_err(|e| map_sdk_error("iam:ListPolicyTags", e))?.tags().iter().map(conv).collect(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn iam_update_tags(state: State<'_, AppState>, kind: TaggableKind, id: String, set: Vec<Tag>, remove: Vec<String>) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    if !set.is_empty() {
        let tags = iam_tags(set)?;
        match kind {
            TaggableKind::User => drop(client.tag_user().user_name(&id).set_tags(Some(tags)).send().await.map_err(|e| map_sdk_error("iam:TagUser", e))?),
            TaggableKind::Role => drop(client.tag_role().role_name(&id).set_tags(Some(tags)).send().await.map_err(|e| map_sdk_error("iam:TagRole", e))?),
            TaggableKind::Policy => drop(client.tag_policy().policy_arn(&id).set_tags(Some(tags)).send().await.map_err(|e| map_sdk_error("iam:TagPolicy", e))?),
        }
    }
    if !remove.is_empty() {
        match kind {
            TaggableKind::User => drop(client.untag_user().user_name(&id).set_tag_keys(Some(remove)).send().await.map_err(|e| map_sdk_error("iam:UntagUser", e))?),
            TaggableKind::Role => drop(client.untag_role().role_name(&id).set_tag_keys(Some(remove)).send().await.map_err(|e| map_sdk_error("iam:UntagRole", e))?),
            TaggableKind::Policy => drop(client.untag_policy().policy_arn(&id).set_tag_keys(Some(remove)).send().await.map_err(|e| map_sdk_error("iam:UntagPolicy", e))?),
        }
    }
    Ok(())
}

// Policies attached to a user, group or role -------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct AttachedPolicy {
    pub name: String,
    pub arn: String,
}

fn attached(items: &[aws_sdk_iam::types::AttachedPolicy]) -> Vec<AttachedPolicy> {
    items
        .iter()
        .filter_map(|p| Some(AttachedPolicy { name: p.policy_name()?.to_string(), arn: p.policy_arn()?.to_string() }))
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_attached_policies(state: State<'_, AppState>, kind: PrincipalKind, name: String) -> Result<Vec<AttachedPolicy>, ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("ListAttached", "Policies");
    Ok(match kind {
        PrincipalKind::User => attached(client.list_attached_user_policies().user_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.attached_policies()),
        PrincipalKind::Group => attached(client.list_attached_group_policies().group_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.attached_policies()),
        PrincipalKind::Role => attached(client.list_attached_role_policies().role_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.attached_policies()),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn iam_attach_policy(state: State<'_, AppState>, kind: PrincipalKind, name: String, policy_arn: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("Attach", "Policy");
    match kind {
        PrincipalKind::User => drop(client.attach_user_policy().user_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Group => drop(client.attach_group_policy().group_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Role => drop(client.attach_role_policy().role_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_detach_policy(state: State<'_, AppState>, kind: PrincipalKind, name: String, policy_arn: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("Detach", "Policy");
    match kind {
        PrincipalKind::User => drop(client.detach_user_policy().user_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Group => drop(client.detach_group_policy().group_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Role => drop(client.detach_role_policy().role_name(name).policy_arn(policy_arn).send().await.map_err(|e| map_sdk_error(&op, e))?),
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_inline_policies(state: State<'_, AppState>, kind: PrincipalKind, name: String) -> Result<Vec<String>, ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("List", "Policies");
    Ok(match kind {
        PrincipalKind::User => client.list_user_policies().user_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_names().to_vec(),
        PrincipalKind::Group => client.list_group_policies().group_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_names().to_vec(),
        PrincipalKind::Role => client.list_role_policies().role_name(name).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_names().to_vec(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_inline_policy(state: State<'_, AppState>, kind: PrincipalKind, name: String, policy: String) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("Get", "Policy");
    let doc = match kind {
        PrincipalKind::User => client.get_user_policy().user_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_document().to_string(),
        PrincipalKind::Group => client.get_group_policy().group_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_document().to_string(),
        PrincipalKind::Role => client.get_role_policy().role_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?.policy_document().to_string(),
    };
    Ok(decode_document(&doc))
}

#[tauri::command]
#[specta::specta]
pub async fn iam_put_inline_policy(state: State<'_, AppState>, kind: PrincipalKind, name: String, policy: String, document: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("Put", "Policy");
    match kind {
        PrincipalKind::User => drop(client.put_user_policy().user_name(name).policy_name(policy).policy_document(document).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Group => drop(client.put_group_policy().group_name(name).policy_name(policy).policy_document(document).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Role => drop(client.put_role_policy().role_name(name).policy_name(policy).policy_document(document).send().await.map_err(|e| map_sdk_error(&op, e))?),
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_delete_inline_policy(state: State<'_, AppState>, kind: PrincipalKind, name: String, policy: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let op = kind.op("Delete", "Policy");
    match kind {
        PrincipalKind::User => drop(client.delete_user_policy().user_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Group => drop(client.delete_group_policy().group_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?),
        PrincipalKind::Role => drop(client.delete_role_policy().role_name(name).policy_name(policy).send().await.map_err(|e| map_sdk_error(&op, e))?),
    }
    Ok(())
}

// Managed policies ---------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamPolicy {
    pub name: String,
    pub arn: String,
    pub id: Option<String>,
    pub path: Option<String>,
    pub default_version: Option<String>,
    pub attachment_count: f64,
    pub attachable: bool,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub description: Option<String>,
    /// `AWS managed` for a policy under the `aws` account, else `Customer managed`.
    pub kind: String,
}

fn policy_of(p: &aws_sdk_iam::types::Policy) -> IamPolicy {
    let arn = p.arn().unwrap_or_default().to_string();
    IamPolicy {
        name: p.policy_name().unwrap_or_default().to_string(),
        id: p.policy_id().map(str::to_string),
        path: p.path().map(str::to_string),
        default_version: p.default_version_id().map(str::to_string),
        attachment_count: p.attachment_count().map(f64::from).unwrap_or(0.0),
        attachable: p.is_attachable(),
        created: time(p.create_date()),
        updated: time(p.update_date()),
        description: p.description().filter(|d| !d.is_empty()).map(str::to_string),
        kind: if arn.starts_with("arn:aws:iam::aws:") { "AWS managed" } else { "Customer managed" }.to_string(),
        arn,
    }
}

/// Managed policies of a scope: `local` (customer managed), `aws` or `all`. `only_attached` keeps
/// the ones attached to at least one user, group or role.
#[tauri::command]
#[specta::specta]
pub async fn iam_list_policies(state: State<'_, AppState>, scope: String, only_attached: bool) -> Result<Vec<IamPolicy>, ApiError> {
    let client = clients(&state).await?.iam();
    let scope = match scope.as_str() {
        "local" => PolicyScopeType::Local,
        "aws" => PolicyScopeType::Aws,
        "all" => PolicyScopeType::All,
        other => return Err(ApiError::Invalid { detail: format!("{other:?} is not a policy scope") }),
    };
    let mut out = Vec::new();
    let mut pages = client.list_policies().scope(scope).only_attached(only_attached).into_paginator().send();
    while let Some(page) = pages.next().await {
        out.extend(page.map_err(|e| map_sdk_error("iam:ListPolicies", e))?.policies().iter().map(policy_of));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct IamPolicyDetails {
    pub policy: IamPolicy,
    /// The default version's document as JSON text.
    pub document: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_policy(state: State<'_, AppState>, arn: String) -> Result<IamPolicyDetails, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_policy().policy_arn(&arn).send().await.map_err(|e| map_sdk_error("iam:GetPolicy", e))?;
    let policy = r.policy().map(policy_of).ok_or_else(|| build_error("GetPolicy returned no policy"))?;
    let document = match &policy.default_version {
        Some(v) => {
            let d = client.get_policy_version().policy_arn(&arn).version_id(v).send().await.map_err(|e| map_sdk_error("iam:GetPolicyVersion", e))?;
            d.policy_version().and_then(|v| v.document()).map(decode_document)
        }
        None => None,
    };
    Ok(IamPolicyDetails { policy, document })
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct CreatePolicyInput {
    pub name: String,
    pub path: Option<String>,
    pub description: Option<String>,
    pub document: String,
    pub tags: Vec<Tag>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_create_policy(state: State<'_, AppState>, input: CreatePolicyInput) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    let tags = iam_tags(input.tags)?;
    let r = client
        .create_policy()
        .policy_name(input.name)
        .policy_document(input.document)
        .set_path(input.path.filter(|p| !p.is_empty()))
        .set_description(input.description.filter(|d| !d.is_empty()))
        .set_tags(opt(tags))
        .send()
        .await
        .map_err(|e| map_sdk_error("iam:CreatePolicy", e))?;
    Ok(r.policy().and_then(|p| p.arn()).unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct PolicyVersion {
    pub id: String,
    pub is_default: bool,
    pub created: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_policy_versions(state: State<'_, AppState>, arn: String) -> Result<Vec<PolicyVersion>, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.list_policy_versions().policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:ListPolicyVersions", e))?;
    Ok(r.versions()
        .iter()
        .map(|v| PolicyVersion { id: v.version_id().unwrap_or_default().to_string(), is_default: v.is_default_version(), created: time(v.create_date()) })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_get_policy_version(state: State<'_, AppState>, arn: String, version: String) -> Result<String, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.get_policy_version().policy_arn(arn).version_id(version).send().await.map_err(|e| map_sdk_error("iam:GetPolicyVersion", e))?;
    Ok(r.policy_version().and_then(|v| v.document()).map(decode_document).unwrap_or_default())
}

/// Adds a version holding `document` and makes it the default; IAM keeps at most five versions, so
/// the caller deletes one first when the policy already has five.
#[tauri::command]
#[specta::specta]
pub async fn iam_create_policy_version(state: State<'_, AppState>, arn: String, document: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.create_policy_version().policy_arn(arn).policy_document(document).set_as_default(true).send().await.map_err(|e| map_sdk_error("iam:CreatePolicyVersion", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_set_default_policy_version(state: State<'_, AppState>, arn: String, version: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.set_default_policy_version().policy_arn(arn).version_id(version).send().await.map_err(|e| map_sdk_error("iam:SetDefaultPolicyVersion", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_delete_policy_version(state: State<'_, AppState>, arn: String, version: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.delete_policy_version().policy_arn(arn).version_id(version).send().await.map_err(|e| map_sdk_error("iam:DeletePolicyVersion", e))?;
    Ok(())
}

/// Deletes a policy after its non-default versions, which IAM requires first.
#[tauri::command]
#[specta::specta]
pub async fn iam_delete_policy(state: State<'_, AppState>, arn: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    let versions = client.list_policy_versions().policy_arn(&arn).send().await.map_err(|e| map_sdk_error("iam:ListPolicyVersions", e))?;
    for v in versions.versions().iter().filter(|v| !v.is_default_version()) {
        if let Some(id) = v.version_id() {
            client.delete_policy_version().policy_arn(&arn).version_id(id).send().await.map_err(|e| map_sdk_error("iam:DeletePolicyVersion", e))?;
        }
    }
    client.delete_policy().policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:DeletePolicy", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct PolicyEntity {
    /// `User`, `Group` or `Role`.
    pub kind: String,
    pub name: String,
}

/// The users, groups and roles a policy is attached to.
#[tauri::command]
#[specta::specta]
pub async fn iam_list_policy_entities(state: State<'_, AppState>, arn: String) -> Result<Vec<PolicyEntity>, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.list_entities_for_policy().policy_arn(arn).send().await.map_err(|e| map_sdk_error("iam:ListEntitiesForPolicy", e))?;
    let mut out = Vec::new();
    out.extend(r.policy_users().iter().filter_map(|u| u.user_name()).map(|n| PolicyEntity { kind: "User".into(), name: n.to_string() }));
    out.extend(r.policy_groups().iter().filter_map(|g| g.group_name()).map(|n| PolicyEntity { kind: "Group".into(), name: n.to_string() }));
    out.extend(r.policy_roles().iter().filter_map(|r| r.role_name()).map(|n| PolicyEntity { kind: "Role".into(), name: n.to_string() }));
    Ok(out)
}

// Access keys --------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
pub struct AccessKeyInfo {
    pub id: String,
    /// `Active` or `Inactive`.
    pub status: String,
    pub created: Option<String>,
}

async fn iam_access_keys(client: &aws_sdk_iam::Client, user: &str) -> Result<Vec<AccessKeyInfo>, ApiError> {
    let r = client.list_access_keys().user_name(user).send().await.map_err(|e| map_sdk_error("iam:ListAccessKeys", e))?;
    Ok(r.access_key_metadata()
        .iter()
        .map(|k| AccessKeyInfo {
            id: k.access_key_id().unwrap_or_default().to_string(),
            status: k.status().map(|s| s.as_str().to_string()).unwrap_or_default(),
            created: time(k.create_date()),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_list_access_keys(state: State<'_, AppState>, user: String) -> Result<Vec<AccessKeyInfo>, ApiError> {
    let client = clients(&state).await?.iam();
    iam_access_keys(&client, &user).await
}

/// A freshly created access key. The secret exists only in this answer: it is shown once and is
/// never stored or logged, and this type has no `Debug` so a log line cannot print it.
#[derive(Serialize, Type)]
pub struct NewAccessKey {
    pub id: String,
    pub secret: String,
}

#[tauri::command]
#[specta::specta]
pub async fn iam_create_access_key(state: State<'_, AppState>, user: String) -> Result<NewAccessKey, ApiError> {
    let client = clients(&state).await?.iam();
    let r = client.create_access_key().user_name(user).send().await.map_err(|e| map_sdk_error("iam:CreateAccessKey", e))?;
    let k = r.access_key().ok_or_else(|| build_error("CreateAccessKey returned no key"))?;
    Ok(NewAccessKey { id: k.access_key_id().to_string(), secret: k.secret_access_key().to_string() })
}

#[tauri::command]
#[specta::specta]
pub async fn iam_set_access_key_status(state: State<'_, AppState>, user: String, id: String, active: bool) -> Result<(), ApiError> {
    use aws_sdk_iam::types::StatusType;
    let client = clients(&state).await?.iam();
    client
        .update_access_key()
        .user_name(user)
        .access_key_id(id)
        .status(if active { StatusType::Active } else { StatusType::Inactive })
        .send()
        .await
        .map_err(|e| map_sdk_error("iam:UpdateAccessKey", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn iam_delete_access_key(state: State<'_, AppState>, user: String, id: String) -> Result<(), ApiError> {
    let client = clients(&state).await?.iam();
    client.delete_access_key().user_name(user).access_key_id(id).send().await.map_err(|e| map_sdk_error("iam:DeleteAccessKey", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_encoded_document_is_decoded() {
        assert_eq!(decode_document("%7B%22Version%22%3A%222012-10-17%22%7D"), r#"{"Version":"2012-10-17"}"#);
        assert_eq!(decode_document("%7B%22a%22%3A%22caf%C3%A9%22%7D"), "{\"a\":\"café\"}");
    }

    #[test]
    fn a_plain_document_is_kept() {
        let plain = r#"{"Statement":"100%"}"#;
        assert_eq!(decode_document(plain), plain);
        assert_eq!(decode_document(""), "");
    }

    #[test]
    fn a_truncated_escape_is_kept() {
        assert_eq!(decode_document("%7B%2"), "{%2");
    }

    #[test]
    fn principal_operations_name_the_kind() {
        assert_eq!(PrincipalKind::Role.op("Attach", "Policy"), "iam:AttachRolePolicy");
        assert_eq!(PrincipalKind::Group.op("ListAttached", "Policies"), "iam:ListAttachedGroupPolicies");
        assert_eq!(PrincipalKind::User.op("Put", "Policy"), "iam:PutUserPolicy");
    }
}
