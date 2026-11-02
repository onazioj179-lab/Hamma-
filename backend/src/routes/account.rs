//! Account Management Routes
//! Wallet-style authentication with recovery phrases

use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::services::account::AccountError;

/// Account creation request
#[derive(Debug, Deserialize)]
pub struct CreateAccountRequest {
    pub display_name: String,
    pub password: String,
}

/// Account creation response
#[derive(Debug, Serialize)]
pub struct CreateAccountResponse {
    pub success: bool,
    pub account_id: Option<String>,
    pub display_name: Option<String>,
    pub recovery_phrase: Option<Vec<String>>,
    pub tier: Option<String>,
    pub error: Option<String>,
}

/// Login request
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub account_id: String,
    pub password: String,
}

/// Login response
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub account_id: Option<String>,
    pub display_name: Option<String>,
    pub tier: Option<String>,
    pub storage_used: Option<u64>,
    pub storage_quota: Option<u64>,
    pub file_count: Option<u32>,
    pub archive_count: Option<u32>,
    pub created_at: Option<i64>,
    pub error: Option<String>,
}

/// Recovery request
#[derive(Debug, Deserialize)]
pub struct RecoverRequest {
    pub recovery_phrase: String,
    pub new_password: String,
}

/// Account state for routes
#[derive(Clone)]
pub struct AccountState {
    pub service: std::sync::Arc<crate::services::account::AccountService>,
}

impl AccountState {
    pub fn new() -> Self {
        Self {
            service: std::sync::Arc::new(crate::services::account::AccountService::new()),
        }
    }
}

/// Create a new account
pub async fn create_account(
    State(state): State<AppState>,
    Json(req): Json<CreateAccountRequest>,
) -> (StatusCode, Json<CreateAccountResponse>) {
    match state.account.service.create_account(&req.display_name, &req.password).await {
        Ok((account, phrase)) => (
            StatusCode::OK,
            Json(CreateAccountResponse {
                success: true,
                account_id: Some(account.account_id.clone()),
                display_name: Some(account.display_name.clone()),
                recovery_phrase: Some(phrase),
                tier: Some(account.tier.clone()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(CreateAccountResponse {
                success: false,
                account_id: None,
                display_name: None,
                recovery_phrase: None,
                tier: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// Login to existing account
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> (StatusCode, Json<LoginResponse>) {
    match state.account.service.login(&req.account_id, &req.password).await {
        Ok(account) => (
            StatusCode::OK,
            Json(LoginResponse {
                success: true,
                account_id: Some(account.account_id.clone()),
                display_name: Some(account.display_name.clone()),
                tier: Some(account.tier.clone()),
                storage_used: Some(account.storage_used),
                storage_quota: Some(account.storage_quota),
                file_count: Some(account.file_count),
                archive_count: Some(account.archive_count),
                created_at: Some(account.created_at),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(LoginResponse {
                success: false,
                account_id: None,
                display_name: None,
                tier: None,
                storage_used: None,
                storage_quota: None,
                file_count: None,
                archive_count: None,
                created_at: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// Recover account with recovery phrase
pub async fn recover_account(
    State(state): State<AppState>,
    Json(req): Json<RecoverRequest>,
) -> (StatusCode, Json<LoginResponse>) {
    let words: Vec<&str> = req.recovery_phrase.split_whitespace().collect();
    
    match state.account.service.recover_account(&words, &req.new_password).await {
        Ok(account) => (
            StatusCode::OK,
            Json(LoginResponse {
                success: true,
                account_id: Some(account.account_id.clone()),
                display_name: Some(account.display_name.clone()),
                tier: Some(account.tier.clone()),
                storage_used: Some(account.storage_used),
                storage_quota: Some(account.storage_quota),
                file_count: Some(account.file_count),
                archive_count: Some(account.archive_count),
                created_at: Some(account.created_at),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(LoginResponse {
                success: false,
                account_id: None,
                display_name: None,
                tier: None,
                storage_used: None,
                storage_quota: None,
                file_count: None,
                archive_count: None,
                created_at: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// Get account info
pub async fn get_account(
    State(state): State<AppState>,
    axum::extract::Path(account_id): axum::extract::Path<String>,
) -> (StatusCode, Json<LoginResponse>) {
    match state.account.service.get_account(&account_id).await {
        Ok(account) => (
            StatusCode::OK,
            Json(LoginResponse {
                success: true,
                account_id: Some(account.account_id.clone()),
                display_name: Some(account.display_name.clone()),
                tier: Some(account.tier.clone()),
                storage_used: Some(account.storage_used),
                storage_quota: Some(account.storage_quota),
                file_count: Some(account.file_count),
                archive_count: Some(account.archive_count),
                created_at: Some(account.created_at),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(LoginResponse {
                success: false,
                account_id: None,
                display_name: None,
                tier: None,
                storage_used: None,
                storage_quota: None,
                file_count: None,
                archive_count: None,
                created_at: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// Account routes - Not used directly, routes added to main router
#[allow(dead_code)]
pub fn account_routes() -> axum::Router<crate::AppState> {
    use axum::routing::{get, post};
    
    axum::Router::new()
        .route("/api/account/create", post(create_account))
        .route("/api/account/login", post(login))
        .route("/api/account/recover", post(recover_account))
        .route("/api/account/:account_id", get(get_account))
}
