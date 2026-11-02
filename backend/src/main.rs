//! SPK Backend Server
//!
//! Axum-based REST API for compression operations.

mod routes;
mod services;
mod rate_limit;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use services::storage::StorageService;
use services::account::AccountService;
use routes::mesh::MeshNetworkState;
use routes::compute::ComputeState;
use routes::policy::PolicyState;
use routes::media::MediaState;
use routes::account::AccountState;

/// Application state
#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<StorageService>,
    pub mesh: Arc<MeshNetworkState>,
    pub compute: Arc<std::sync::RwLock<ComputeState>>,
    pub policy: Arc<std::sync::RwLock<PolicyState>>,
    pub media: Arc<std::sync::RwLock<MediaState>>,
    pub account: AccountState,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "spk_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load env vars
    dotenvy::dotenv().ok();

    // Create storage service
    let storage = Arc::new(StorageService::new());
    
    // Create mesh network state
    let mesh = Arc::new(MeshNetworkState::new());

    // Create compute state
    let compute = Arc::new(std::sync::RwLock::new(ComputeState { manager: spk_core::ComputeManager::new() }));
    
    // Create policy state
    let policy = Arc::new(std::sync::RwLock::new(PolicyState::default()));
    
    // Create media state
    let media = Arc::new(std::sync::RwLock::new(MediaState::default()));
    
    // Create account state
    let account = AccountState::new();
    
    // Create app state
    let state = AppState { storage, mesh, compute, policy, media, account };

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        .route("/version", get(version))
        
        // Compression endpoints
        .route("/api/compress", post(routes::compress::compress_files))
        .route("/api/compress/stream", post(routes::compress::compress_stream))
        
        // Decompression endpoints
        .route("/api/decompress", post(routes::decompress::decompress_archive))
        .route("/api/decompress/info", post(routes::decompress::get_archive_info))
        .route("/api/decompress/file", post(routes::decompress::extract_single_file))
        .route("/api/decompress/preview", post(routes::decompress::preview_file))
        
        // Session endpoints (V2)
        .route("/api/session/create", post(routes::compress::create_session))
        .route("/api/session/:id/upload", post(routes::compress::upload_chunk))
        .route("/api/session/:id/finalize", post(routes::compress::finalize_session))
        .route("/api/session/:id/status", get(routes::compress::session_status))
        .route("/api/session/:id/pause", post(routes::compress::pause_session))
        .route("/api/session/:id/resume", post(routes::compress::resume_session))
        
        // File operations
        .route("/api/files/upload", post(routes::compress::upload_file))
        .route("/api/files/:id", get(routes::decompress::download_file))
        
        // Large-scale compression jobs (100TB support)
        .route("/api/compression/jobs", post(routes::compression_job::create_job))
        .route("/api/compression/jobs/:job_id", get(routes::compression_job::get_job_status))
        .route("/api/compression/jobs/:job_id/upload", post(routes::compression_job::upload_chunk))
        .route("/api/compression/jobs/:job_id/pause", post(routes::compression_job::pause_job))
        .route("/api/compression/jobs/:job_id/resume", post(routes::compression_job::resume_job))
        .route("/api/compression/jobs/:job_id/cancel", post(routes::compression_job::cancel_job))
        .route("/api/compression/jobs/:job_id/share", post(routes::compression_job::share_job))
        .route("/api/compression/shared/:token", get(routes::compression_job::download_shared))
        .route("/api/compression/users/:user_id/jobs", get(routes::compression_job::list_jobs))
        
        // V9 Health & Maintenance endpoints
        .route("/api/v9/health/scan", post(routes::health::scan_health))
        .route("/api/v9/health/repair", post(routes::health::repair_archive))
        .route("/api/v9/health/predict", post(routes::health::predict_failures))
        .route("/api/v9/health/status/:archive_id", get(routes::health::health_status))
        .route("/api/v9/integrity/logs", post(routes::health::get_integrity_logs))
        .route("/api/v9/maintenance/config", post(routes::health::configure_maintenance))
        
        // V10 Interoperability endpoints
        .route("/api/v10/plugins/register", post(routes::interop::register_plugin))
        .route("/api/v10/plugins/list", get(routes::interop::list_plugins))
        .route("/api/v10/plugins/:plugin_id", get(routes::interop::plugin_info))
        .route("/api/v10/format/detect/:path", get(routes::interop::detect_format))
        .route("/api/v10/container/mount", post(routes::interop::mount_container))
        .route("/api/v10/container/unmount/:mount_point", post(routes::interop::unmount_container))
        .route("/api/v10/container/list", get(routes::interop::list_containers))
        .route("/api/v10/interop/import", post(routes::interop::import_archive))
        .route("/api/v10/interop/export", post(routes::interop::export_archive))
        .route("/api/v10/extensions/add", post(routes::interop::add_extension))
        .route("/api/v10/extensions/:archive_id", get(routes::interop::get_extensions))
        
        // V12 Mesh Network endpoints
        .route("/api/v12/mesh/join", post(routes::mesh::join_mesh))
        .route("/api/v12/mesh/leave", post(routes::mesh::leave_mesh))
        .route("/api/v12/mesh/peers", get(routes::mesh::list_peers))
        .route("/api/v12/mesh/routes", get(routes::mesh::get_routes))
        .route("/api/v12/mesh/chunk/:id", get(routes::mesh::request_chunk))
        .route("/api/v12/mesh/chunk", post(routes::mesh::store_chunk))
        .route("/api/v12/mesh/replicate", post(routes::mesh::configure_replication))
        .route("/api/v12/mesh/federate", post(routes::mesh::configure_federation))
        .route("/api/v12/mesh/stats", get(routes::mesh::get_mesh_stats))

        // V20 Compute endpoints
        .merge(routes::compute::compute_routes())
        
        // V21 Policy endpoints
        .merge(routes::policy::policy_routes())
        
        // Media-Safe Compression endpoints
        .merge(routes::media::media_routes())
        
        // V22 AI Media Intelligence endpoints
        .merge(routes::ai_media_routes::ai_media_routes())
        
        // HAMMA Performance Controller endpoints
        .merge(routes::hamma::hamma_routes())
        
        // Account management endpoints
        .route("/api/account/create", post(routes::account::create_account))
        .route("/api/account/login", post(routes::account::login))
        .route("/api/account/logout", post(routes::account::logout))
        .route("/api/account/recover", post(routes::account::recover_account))
        .route("/api/account/:account_id", get(routes::account::get_account))
        
        // Add state and middleware
        .with_state(state)
        .fallback_service(tower_http::services::ServeDir::new(
            std::env::var_os("SPK_WEB_DIR").map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_exe().unwrap_or_default().parent().unwrap_or(std::path::Path::new(".")).join("web"))
        ))
        .layer(axum::middleware::from_fn_with_state(
            Arc::new(rate_limit::RequestLimiter::from_environment()), rate_limit::enforce,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers([axum::http::header::RETRY_AFTER]),
        )
        .layer(TraceLayer::new_for_http());

    // Get port from env or default
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let host = std::env::var("SPK_BIND_HOST").unwrap_or_else(|_| "127.0.0.1".into())
        .parse::<std::net::IpAddr>().expect("SPK_BIND_HOST must be an IP address");
    let addr = SocketAddr::new(host, port);
    tracing::info!("Starting SPK server on {}", addr);

    // Start server
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}

/// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}

/// Version endpoint
async fn version() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "name": "spk-backend",
        "version": env!("CARGO_PKG_VERSION"),
        "features": [
            "compress", "decompress", "stream", "session", "preview",
            "health-monitoring", "autonomous-repair", "plugins", "interop",
            "compute-sandbox", "policy-engine", "media-safe-compression",
            "ai-media-intelligence"
        ],
        "versions": ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v12", "v20", "v21", "media", "v22", "hamma"]
    }))
}
