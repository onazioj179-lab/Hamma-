use axum::{routing::{get, post}, Router, Json};
use axum::extract::State;
use serde::{Deserialize, Serialize};

use crate::AppState;
use spk_core::{
    GlobalPolicyEngine, PolicyRule, PolicyContext, PolicyCompiler,
    ResourceBudget, PolicyMetrics, PolicyEvent, PolicyType, PolicyPriority,
    PolicyCondition, PolicyAction, ConditionOperator, ActionType
};

#[derive(Clone)]
pub struct PolicyState {
    pub engine: GlobalPolicyEngine,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            engine: GlobalPolicyEngine::new(),
        }
    }
}

/// Routes for V21 policy engine
pub fn policy_routes() -> Router<AppState> {
    Router::new()
        .route("/policy/get/:id", get(get_policy))
        .route("/policy/set", post(set_policy))
        .route("/policy/list", get(list_policies))
        .route("/policy/compile", post(compile_policy))
        .route("/policy/runtime", post(evaluate_policies))
        .route("/policy/metrics", get(get_metrics))
        .route("/policy/events", get(get_events))
        .route("/policy/budget", get(get_budget))
        .route("/policy/budget", post(set_budget))
        .route("/policy/optimize", post(run_optimization))
}

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

#[derive(Deserialize)]
pub struct SetPolicyRequest {
    pub id: String,
    pub policy_type: String,
    pub priority: String,
    pub enabled: bool,
    pub conditions: Vec<ConditionDto>,
    pub actions: Vec<ActionDto>,
}

#[derive(Deserialize, Serialize)]
pub struct ConditionDto {
    pub metric: String,
    pub operator: String,
    pub threshold: f64,
}

#[derive(Deserialize, Serialize)]
pub struct ActionDto {
    pub action_type: String,
}

#[derive(Deserialize)]
pub struct CompileDslRequest {
    pub dsl: String,
}

#[derive(Serialize)]
pub struct CompileDslResponse {
    pub rule: PolicyRuleDto,
}

#[derive(Deserialize)]
pub struct EvaluateRequest {
    pub metrics: std::collections::HashMap<String, f64>,
    pub node_id: Option<String>,
    pub archive_id: Option<String>,
}

#[derive(Serialize)]
pub struct EvaluateResponse {
    pub actions: Vec<ActionDto>,
}

#[derive(Serialize)]
pub struct PolicyRuleDto {
    pub id: String,
    pub policy_type: String,
    pub priority: String,
    pub enabled: bool,
    pub conditions: Vec<ConditionDto>,
    pub actions: Vec<ActionDto>,
    pub version: u32,
}

#[derive(Serialize)]
pub struct MetricsResponse {
    pub evaluations: u64,
    pub actions_executed: u64,
    pub optimizations: u64,
    pub optimization_adjustments: u64,
}

#[derive(Serialize)]
pub struct EventDto {
    pub timestamp: u64,
    pub rule_id: String,
    pub action_type: String,
    pub success: bool,
}

// =============================================================================
// HANDLERS
// =============================================================================

async fn get_policy(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<Result<PolicyRuleDto, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.get_policy(&id) {
        Ok(rule) => Json(Ok(rule_to_dto(&rule))),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn set_policy(
    State(state): State<AppState>,
    Json(req): Json<SetPolicyRequest>,
) -> Json<Result<String, String>> {
    let policy_state = state.policy.read().unwrap();
    
    let policy_type = match req.policy_type.as_str() {
        "compression" => PolicyType::Compression,
        "replication" => PolicyType::Replication,
        "compute" => PolicyType::Compute,
        "retention" => PolicyType::Retention,
        "energy" => PolicyType::Energy,
        "security" => PolicyType::Security,
        "storage" => PolicyType::Storage,
        "network" => PolicyType::Network,
        _ => PolicyType::Compression,
    };

    let priority = match req.priority.as_str() {
        "low" => PolicyPriority::Low,
        "medium" => PolicyPriority::Medium,
        "high" => PolicyPriority::High,
        "critical" => PolicyPriority::Critical,
        _ => PolicyPriority::Medium,
    };

    let mut rule = PolicyRule::new(req.id.clone(), policy_type);
    rule.priority = priority;
    rule.enabled = req.enabled;

    for cond_dto in req.conditions {
        let operator = match cond_dto.operator.as_str() {
            ">" => ConditionOperator::GreaterThan,
            "<" => ConditionOperator::LessThan,
            "==" => ConditionOperator::Equal,
            ">=" => ConditionOperator::GreaterEqual,
            "<=" => ConditionOperator::LessEqual,
            _ => ConditionOperator::Equal,
        };

        rule.conditions.push(PolicyCondition {
            metric: cond_dto.metric,
            operator,
            threshold: cond_dto.threshold,
        });
    }

    for action_dto in req.actions {
        let action_type = match action_dto.action_type.as_str() {
            "move_to_nvme" => ActionType::MoveToNVMe,
            "move_to_hdd" => ActionType::MoveToHDD,
            "increase_replication" => ActionType::IncreaseReplication,
            "decrease_replication" => ActionType::DecreaseReplication,
            "enable_compute" => ActionType::EnableCompute,
            "disable_compute" => ActionType::DisableCompute,
            "throttle_compute" => ActionType::ThrottleCompute,
            "enable_encryption" => ActionType::EnableEncryption,
            _ => ActionType::MoveToHDD,
        };

        rule.actions.push(PolicyAction {
            action_type,
            parameters: std::collections::HashMap::new(),
        });
    }

    match policy_state.engine.set_policy(rule) {
        Ok(()) => Json(Ok("Policy set successfully".into())),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn list_policies(
    State(state): State<AppState>,
) -> Json<Result<Vec<String>, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.list_policies() {
        Ok(ids) => Json(Ok(ids)),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn compile_policy(
    State(state): State<AppState>,
    Json(req): Json<CompileDslRequest>,
) -> Json<Result<CompileDslResponse, String>> {
    match PolicyCompiler::compile(&req.dsl) {
        Ok(rule) => {
            // Optionally auto-register the compiled policy
            let policy_state = state.policy.read().unwrap();
            let _ = policy_state.engine.set_policy(rule.clone());
            
            Json(Ok(CompileDslResponse {
                rule: rule_to_dto(&rule),
            }))
        }
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn evaluate_policies(
    State(state): State<AppState>,
    Json(req): Json<EvaluateRequest>,
) -> Json<Result<EvaluateResponse, String>> {
    let policy_state = state.policy.read().unwrap();
    
    let mut ctx = PolicyContext::new();
    for (k, v) in req.metrics {
        ctx.set_metric(k, v);
    }
    ctx.node_id = req.node_id;
    ctx.archive_id = req.archive_id;

    match policy_state.engine.evaluate(&ctx) {
        Ok(actions) => {
            let action_dtos: Vec<ActionDto> = actions.iter().map(|a| ActionDto {
                action_type: action_type_to_string(&a.action_type),
            }).collect();

            Json(Ok(EvaluateResponse { actions: action_dtos }))
        }
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn get_metrics(
    State(state): State<AppState>,
) -> Json<Result<MetricsResponse, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.get_metrics() {
        Ok(metrics) => Json(Ok(MetricsResponse {
            evaluations: metrics.evaluations,
            actions_executed: metrics.actions_executed,
            optimizations: metrics.optimizations,
            optimization_adjustments: metrics.optimization_adjustments,
        })),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn get_events(
    State(state): State<AppState>,
) -> Json<Result<Vec<EventDto>, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.get_events(100) {
        Ok(events) => {
            let event_dtos: Vec<EventDto> = events.iter().map(|e| EventDto {
                timestamp: e.timestamp,
                rule_id: e.rule_id.clone(),
                action_type: action_type_to_string(&e.action_type),
                success: e.success,
            }).collect();

            Json(Ok(event_dtos))
        }
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn get_budget(
    State(state): State<AppState>,
) -> Json<Result<ResourceBudget, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.get_budget() {
        Ok(budget) => Json(Ok(budget)),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn set_budget(
    State(state): State<AppState>,
    Json(budget): Json<ResourceBudget>,
) -> Json<Result<String, String>> {
    let policy_state = state.policy.read().unwrap();
    
    match policy_state.engine.set_budget(budget) {
        Ok(()) => Json(Ok("Budget updated successfully".into())),
        Err(e) => Json(Err(e.to_string())),
    }
}

async fn run_optimization(
    State(state): State<AppState>,
    Json(req): Json<EvaluateRequest>,
) -> Json<Result<String, String>> {
    let policy_state = state.policy.read().unwrap();
    
    let mut ctx = PolicyContext::new();
    for (k, v) in req.metrics {
        ctx.set_metric(k, v);
    }
    ctx.node_id = req.node_id;
    ctx.archive_id = req.archive_id;

    match policy_state.engine.optimize(&ctx) {
        Ok(()) => Json(Ok("Optimization cycle complete".into())),
        Err(e) => Json(Err(e.to_string())),
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

fn rule_to_dto(rule: &PolicyRule) -> PolicyRuleDto {
    PolicyRuleDto {
        id: rule.id.clone(),
        policy_type: format!("{:?}", rule.policy_type).to_lowercase(),
        priority: format!("{:?}", rule.priority).to_lowercase(),
        enabled: rule.enabled,
        conditions: rule.conditions.iter().map(|c| ConditionDto {
            metric: c.metric.clone(),
            operator: match c.operator {
                ConditionOperator::GreaterThan => ">".into(),
                ConditionOperator::LessThan => "<".into(),
                ConditionOperator::Equal => "==".into(),
                ConditionOperator::GreaterEqual => ">=".into(),
                ConditionOperator::LessEqual => "<=".into(),
            },
            threshold: c.threshold,
        }).collect(),
        actions: rule.actions.iter().map(|a| ActionDto {
            action_type: action_type_to_string(&a.action_type),
        }).collect(),
        version: rule.version,
    }
}

fn action_type_to_string(action_type: &ActionType) -> String {
    match action_type {
        ActionType::MoveToNVMe => "move_to_nvme",
        ActionType::MoveToHDD => "move_to_hdd",
        ActionType::IncreaseReplication => "increase_replication",
        ActionType::DecreaseReplication => "decrease_replication",
        ActionType::EnableCompute => "enable_compute",
        ActionType::DisableCompute => "disable_compute",
        ActionType::ThrottleCompute => "throttle_compute",
        ActionType::SwitchCompressionLevel => "switch_compression_level",
        ActionType::TriggerBackup => "trigger_backup",
        ActionType::PurgeOldVersions => "purge_old_versions",
        ActionType::EnableEncryption => "enable_encryption",
        ActionType::ReducePowerUsage => "reduce_power_usage",
        ActionType::ScaleOutCluster => "scale_out_cluster",
        ActionType::ScaleInCluster => "scale_in_cluster",
    }.to_string()
}
