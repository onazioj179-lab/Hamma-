//! Bounded, in-process request admission for the optional Rust API.
//! Uses the socket peer address, never an untrusted forwarding header.

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const WINDOW: Duration = Duration::from_secs(60);
const MAX_BUCKETS: usize = 4096;

struct Bucket {
    started: Instant,
    used: u32,
}
pub struct RequestLimiter {
    buckets: Mutex<HashMap<(IpAddr, bool), Bucket>>,
    api_limit: u32,
    auth_limit: u32,
}

impl RequestLimiter {
    pub fn from_environment() -> Self {
        fn limit(name: &str, default: u32) -> u32 {
            std::env::var(name)
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(default)
        }
        Self::new(limit("SPK_API_RPM", 120), limit("SPK_AUTH_RPM", 10))
    }

    fn new(api_limit: u32, auth_limit: u32) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            api_limit: api_limit.max(1),
            auth_limit: auth_limit.max(1),
        }
    }

    fn admit(&self, ip: IpAddr, authentication: bool, now: Instant) -> Result<(), u64> {
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buckets.retain(|_, bucket| now.saturating_duration_since(bucket.started) < WINDOW);
        let key = (ip, authentication);
        if !buckets.contains_key(&key) && buckets.len() >= MAX_BUCKETS {
            return Err(60);
        }
        let bucket = buckets.entry(key).or_insert(Bucket {
            started: now,
            used: 0,
        });
        let limit = if authentication {
            self.auth_limit
        } else {
            self.api_limit
        };
        if bucket.used >= limit {
            let remaining = WINDOW.saturating_sub(now.saturating_duration_since(bucket.started));
            return Err(remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0));
        }
        bucket.used += 1;
        Ok(())
    }
}

pub async fn enforce(
    State(limiter): State<Arc<RequestLimiter>>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !path.starts_with("/api/") || request.method() == Method::OPTIONS {
        return next.run(request).await;
    }
    let auth = matches!(
        path,
        "/api/account/create" | "/api/account/login" | "/api/account/recover"
    );
    let ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    // Authentication requests must fit both their strict bucket and the general API bucket.
    let now = Instant::now();
    let admission = limiter.admit(ip, false, now).and_then(|_| {
        if auth {
            limiter.admit(ip, true, now)
        } else {
            Ok(())
        }
    });
    let mut response = match admission {
        Ok(()) => next.run(request).await,
        Err(seconds) => (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, seconds.max(1).to_string())], Json(serde_json::json!({ "error": "Too many requests. Try again after the Retry-After interval." }))).into_response(),
    };
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    fn ip(last: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, last))
    }
    #[test]
    fn isolates_peers_and_resets_the_window() {
        let limiter = RequestLimiter::new(2, 1);
        let now = Instant::now();
        assert!(limiter.admit(ip(1), false, now).is_ok());
        assert!(limiter.admit(ip(1), false, now).is_ok());
        assert_eq!(limiter.admit(ip(1), false, now), Err(60));
        assert!(limiter.admit(ip(2), false, now).is_ok());
        assert!(limiter.admit(ip(1), false, now + WINDOW).is_ok());
    }
    #[test]
    fn authentication_has_a_separate_stricter_bucket() {
        let limiter = RequestLimiter::new(120, 1);
        let now = Instant::now();
        assert!(limiter.admit(ip(1), true, now).is_ok());
        assert_eq!(limiter.admit(ip(1), true, now), Err(60));
        assert!(limiter.admit(ip(1), false, now).is_ok());
    }
    #[test]
    fn concurrent_requests_cannot_exceed_the_limit() {
        let limiter = Arc::new(RequestLimiter::new(5, 1));
        let now = Instant::now();
        let handles: Vec<_> = (0..24)
            .map(|_| {
                let limiter = limiter.clone();
                std::thread::spawn(move || limiter.admit(ip(1), false, now).is_ok())
            })
            .collect();
        let accepted = handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .filter(|allowed| *allowed)
            .count();
        assert_eq!(accepted, 5);
    }
    #[tokio::test]
    async fn returns_retry_after_and_keeps_health_available() {
        let limiter = Arc::new(RequestLimiter::new(1, 1));
        let app = Router::new()
            .route("/api/test", get(|| async { "ok" }))
            .route("/health", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(limiter, enforce));
        let request = || {
            let mut request = Request::builder()
                .uri("/api/test")
                .body(Body::empty())
                .unwrap();
            request
                .extensions_mut()
                .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 1234))));
            request
        };
        assert_eq!(
            app.clone().oneshot(request()).await.unwrap().status(),
            StatusCode::OK
        );
        let response = app.clone().oneshot(request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(response.headers().contains_key(header::RETRY_AFTER));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            app.oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .unwrap()
            .status(),
            StatusCode::OK
        );
    }
}
