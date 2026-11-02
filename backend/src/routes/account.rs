//! Account Management Routes
//! Wallet-style authentication with recovery phrases

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::services::account::AccountError;
use crate::AppState;

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
    pub session_token: Option<String>,
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
    match state
        .account
        .service
        .create_account(&req.display_name, &req.password)
        .await
    {
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
    match state
        .account
        .service
        .login(&req.account_id, &req.password)
        .await
    {
        Ok(account) => {
            let token = match state.account.service.issue_session(&account) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(LoginResponse {
                            success: false,
                            session_token: None,
                            account_id: None,
                            display_name: None,
                            tier: None,
                            storage_used: None,
                            storage_quota: None,
                            file_count: None,
                            archive_count: None,
                            created_at: None,
                            error: Some("Session capacity reached. Try again later.".into()),
                        }),
                    )
                }
            };
            (
                StatusCode::OK,
                Json(LoginResponse {
                    session_token: Some(token),
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
            )
        }
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(LoginResponse {
                session_token: None,
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

    match state
        .account
        .service
        .recover_account(&words, &req.new_password)
        .await
    {
        Ok(account) => {
            let token = match state.account.service.issue_session(&account) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(LoginResponse {
                            success: false,
                            session_token: None,
                            account_id: None,
                            display_name: None,
                            tier: None,
                            storage_used: None,
                            storage_quota: None,
                            file_count: None,
                            archive_count: None,
                            created_at: None,
                            error: Some("Session capacity reached. Try again later.".into()),
                        }),
                    )
                }
            };
            (
                StatusCode::OK,
                Json(LoginResponse {
                    session_token: Some(token),
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
            )
        }
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(LoginResponse {
                session_token: None,
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
    headers: axum::http::HeaderMap,
) -> (StatusCode, Json<LoginResponse>) {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    match state.account.service.authenticate(token, &account_id).await {
        Ok(account) => (
            StatusCode::OK,
            Json(LoginResponse {
                session_token: None,
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
                session_token: None,
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
        .route("/api/account/logout", post(logout))
        .route("/api/account/recover", post(recover_account))
        .route("/api/account/:account_id", get(get_account))
}

pub async fn logout(headers: axum::http::HeaderMap, State(state): State<AppState>) -> StatusCode {
    let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return StatusCode::UNAUTHORIZED;
    };
    match state.account.service.revoke_session(token) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

#[cfg(test)]
mod authorization_tests {
    use super::*;
    use std::sync::{Arc, RwLock};
    #[tokio::test]
    async fn protects_metadata_and_revokes_logout_sessions() {
        let state = AppState {
            storage: Arc::new(crate::services::storage::StorageService::new()),
            mesh: Arc::new(crate::routes::mesh::MeshNetworkState::new()),
            compute: Arc::new(RwLock::new(crate::routes::compute::ComputeState {
                manager: spk_core::ComputeManager::new(),
            })),
            policy: Arc::new(RwLock::new(crate::routes::policy::PolicyState::default())),
            media: Arc::new(RwLock::new(crate::routes::media::MediaState::default())),
            account: AccountState::new(),
        };
        let (account, _) = state
            .account
            .service
            .create_account("route", "Password123")
            .await
            .unwrap();
        let path = || axum::extract::Path(account.account_id.clone());
        assert_eq!(
            get_account(State(state.clone()), path(), axum::http::HeaderMap::new())
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, Json(response)) = login(
            State(state.clone()),
            Json(LoginRequest {
                account_id: account.account_id.clone(),
                password: "Password123".into(),
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", response.session_token.unwrap())
                .parse()
                .unwrap(),
        );
        assert_eq!(
            get_account(State(state.clone()), path(), headers.clone())
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            get_account(
                State(state.clone()),
                axum::extract::Path("another-account".into()),
                headers.clone()
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            logout(headers.clone(), State(state.clone())).await,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            get_account(State(state.clone()), path(), headers).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
}
