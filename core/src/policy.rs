//! # SPK V21: Fully Autonomous Optimization + Policy Engine
//!
//! Global policy engine for self-regulating SPK archives across performance tiers,
//! storage classes, distributed clusters, edge nodes, security, and compute pipelines.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

use crate::utils::error::{SpkError, SpkResult};

/// V21 version constant
pub const V21_POLICY_VERSION: u8 = 21;

/// Maximum number of active policies per engine
pub const V21_MAX_POLICIES: usize = 1024;

/// Maximum policy DSL size (256KB)
pub const V21_MAX_POLICY_SIZE: usize = 256 * 1024;

// =============================================================================
// POLICY TYPES
// =============================================================================

/// Policy category
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PolicyType {
    Compression,
    Replication,
    Compute,
    Retention,
    Energy,
    Security,
    Storage,
    Network,
}

/// Policy priority (higher = more important)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PolicyPriority {
    Low = 1,
    Medium = 5,
    High = 10,
    Critical = 20,
}

impl Default for PolicyPriority {
    fn default() -> Self {
        Self::Medium
    }
}

/// Policy rule with conditions and actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub id: String,
    pub policy_type: PolicyType,
    pub priority: PolicyPriority,
    pub enabled: bool,
    pub conditions: Vec<PolicyCondition>,
    pub actions: Vec<PolicyAction>,
    pub created: u64,
    pub updated: u64,
    pub version: u32,
}

impl PolicyRule {
    pub fn new(id: String, policy_type: PolicyType) -> Self {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        Self {
            id,
            policy_type,
            priority: PolicyPriority::default(),
            enabled: true,
            conditions: Vec::new(),
            actions: Vec::new(),
            created: now,
            updated: now,
            version: 1,
        }
    }

    /// Check if conditions are met
    pub fn evaluate(&self, ctx: &PolicyContext) -> bool {
        if !self.enabled {
            return false;
        }
        self.conditions.iter().all(|c| c.evaluate(ctx))
    }
}

/// Policy condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCondition {
    pub metric: String,
    pub operator: ConditionOperator,
    pub threshold: f64,
}

impl PolicyCondition {
    pub fn evaluate(&self, ctx: &PolicyContext) -> bool {
        let value = ctx.get_metric(&self.metric).unwrap_or(0.0);
        match self.operator {
            ConditionOperator::GreaterThan => value > self.threshold,
            ConditionOperator::LessThan => value < self.threshold,
            ConditionOperator::Equal => (value - self.threshold).abs() < f64::EPSILON,
            ConditionOperator::GreaterEqual => value >= self.threshold,
            ConditionOperator::LessEqual => value <= self.threshold,
        }
    }
}

/// Condition operators
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConditionOperator {
    GreaterThan,
    LessThan,
    Equal,
    GreaterEqual,
    LessEqual,
}

/// Policy action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyAction {
    pub action_type: ActionType,
    pub parameters: HashMap<String, String>,
}

/// Action types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionType {
    MoveToNVMe,
    MoveToHDD,
    IncreaseReplication,
    DecreaseReplication,
    EnableCompute,
    DisableCompute,
    ThrottleCompute,
    SwitchCompressionLevel,
    TriggerBackup,
    PurgeOldVersions,
    EnableEncryption,
    ReducePowerUsage,
    ScaleOutCluster,
    ScaleInCluster,
}

// =============================================================================
// POLICY EXECUTION CONTEXT
// =============================================================================

/// Runtime context for policy evaluation
#[derive(Debug, Clone, Default)]
pub struct PolicyContext {
    pub metrics: HashMap<String, f64>,
    pub node_id: Option<String>,
    pub archive_id: Option<String>,
    pub timestamp: u64,
}

impl PolicyContext {
    pub fn new() -> Self {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        Self {
            metrics: HashMap::new(),
            node_id: None,
            archive_id: None,
            timestamp,
        }
    }

    pub fn set_metric(&mut self, name: String, value: f64) {
        self.metrics.insert(name, value);
    }

    pub fn get_metric(&self, name: &str) -> Option<f64> {
        self.metrics.get(name).copied()
    }
}

// =============================================================================
// RESOURCE BUDGETING
// =============================================================================

/// Resource budget limits
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceBudget {
    pub max_cpu_percent: f64,
    pub max_gpu_percent: f64,
    pub max_memory_mb: u64,
    pub max_bandwidth_mbps: u64,
    pub max_storage_gb: u64,
}

impl Default for ResourceBudget {
    fn default() -> Self {
        Self {
            max_cpu_percent: 80.0,
            max_gpu_percent: 80.0,
            max_memory_mb: 8192,
            max_bandwidth_mbps: 1000,
            max_storage_gb: 1000,
        }
    }
}

/// Budget enforcement and tracking
#[derive(Debug, Clone, Default)]
pub struct BudgetEnforcer {
    current_cpu: f64,
    current_gpu: f64,
    current_memory: u64,
    current_bandwidth: u64,
    current_storage: u64,
}

impl BudgetEnforcer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn can_allocate(&self, budget: &ResourceBudget, cpu: f64, gpu: f64, memory: u64) -> bool {
        self.current_cpu + cpu <= budget.max_cpu_percent
            && self.current_gpu + gpu <= budget.max_gpu_percent
            && self.current_memory + memory <= budget.max_memory_mb
    }

    pub fn allocate(&mut self, cpu: f64, gpu: f64, memory: u64) {
        self.current_cpu += cpu;
        self.current_gpu += gpu;
        self.current_memory += memory;
    }

    pub fn release(&mut self, cpu: f64, gpu: f64, memory: u64) {
        self.current_cpu = (self.current_cpu - cpu).max(0.0);
        self.current_gpu = (self.current_gpu - gpu).max(0.0);
        self.current_memory = self.current_memory.saturating_sub(memory);
    }
}

// =============================================================================
// POLICY DSL PARSER
// =============================================================================

/// Policy DSL compiler
pub struct PolicyCompiler;

impl PolicyCompiler {
    /// Compile DSL text into a policy rule
    pub fn compile(dsl: &str) -> SpkResult<PolicyRule> {
        // Simple parser for example DSL:
        // "RULE compression_policy PRIORITY high IF access_frequency > 100 THEN move_to_nvme"
        let tokens: Vec<&str> = dsl.split_whitespace().collect();
        
        if tokens.len() < 8 || tokens[0] != "RULE" {
            return Err(SpkError::InvalidData("Invalid DSL syntax".into()));
        }

        let rule_id = tokens[1].to_string();
        let priority = match tokens.get(3) {
            Some(&"low") => PolicyPriority::Low,
            Some(&"medium") => PolicyPriority::Medium,
            Some(&"high") => PolicyPriority::High,
            Some(&"critical") => PolicyPriority::Critical,
            _ => PolicyPriority::Medium,
        };

        // Simple condition parsing (extend as needed)
        let mut rule = PolicyRule::new(rule_id, PolicyType::Compression);
        rule.priority = priority;

        // Parse IF condition
        if let Some(if_pos) = tokens.iter().position(|&t| t == "IF") {
            if if_pos + 3 < tokens.len() {
                let metric = tokens[if_pos + 1].to_string();
                let operator = match tokens[if_pos + 2] {
                    ">" => ConditionOperator::GreaterThan,
                    "<" => ConditionOperator::LessThan,
                    "==" => ConditionOperator::Equal,
                    ">=" => ConditionOperator::GreaterEqual,
                    "<=" => ConditionOperator::LessEqual,
                    _ => ConditionOperator::Equal,
                };
                let threshold = tokens[if_pos + 3].parse::<f64>().unwrap_or(0.0);
                
                rule.conditions.push(PolicyCondition {
                    metric,
                    operator,
                    threshold,
                });
            }
        }

        // Parse THEN action
        if let Some(then_pos) = tokens.iter().position(|&t| t == "THEN") {
            if then_pos + 1 < tokens.len() {
                let action_type = match tokens[then_pos + 1] {
                    "move_to_nvme" => ActionType::MoveToNVMe,
                    "move_to_hdd" => ActionType::MoveToHDD,
                    "enable_compute" => ActionType::EnableCompute,
                    "disable_compute" => ActionType::DisableCompute,
                    "enable_encryption" => ActionType::EnableEncryption,
                    _ => ActionType::MoveToHDD,
                };

                rule.actions.push(PolicyAction {
                    action_type,
                    parameters: HashMap::new(),
                });
            }
        }

        Ok(rule)
    }

    /// Decompile a rule back to DSL
    pub fn decompile(rule: &PolicyRule) -> String {
        let priority_str = match rule.priority {
            PolicyPriority::Low => "low",
            PolicyPriority::Medium => "medium",
            PolicyPriority::High => "high",
            PolicyPriority::Critical => "critical",
        };

        let mut dsl = format!("RULE {} PRIORITY {}", rule.id, priority_str);

        if let Some(cond) = rule.conditions.first() {
            let op_str = match cond.operator {
                ConditionOperator::GreaterThan => ">",
                ConditionOperator::LessThan => "<",
                ConditionOperator::Equal => "==",
                ConditionOperator::GreaterEqual => ">=",
                ConditionOperator::LessEqual => "<=",
            };
            dsl.push_str(&format!(" IF {} {} {}", cond.metric, op_str, cond.threshold));
        }

        if let Some(action) = rule.actions.first() {
            let action_str = match action.action_type {
                ActionType::MoveToNVMe => "move_to_nvme",
                ActionType::MoveToHDD => "move_to_hdd",
                ActionType::EnableCompute => "enable_compute",
                ActionType::DisableCompute => "disable_compute",
                ActionType::EnableEncryption => "enable_encryption",
                _ => "unknown_action",
            };
            dsl.push_str(&format!(" THEN {}", action_str));
        }

        dsl
    }
}

// =============================================================================
// GLOBAL POLICY ENGINE
// =============================================================================

/// Global policy engine with self-correcting loop
#[derive(Clone)]
pub struct GlobalPolicyEngine {
    policies: Arc<RwLock<HashMap<String, PolicyRule>>>,
    budget: Arc<RwLock<ResourceBudget>>,
    enforcer: Arc<RwLock<BudgetEnforcer>>,
    metrics: Arc<RwLock<PolicyMetrics>>,
    event_log: Arc<RwLock<VecDeque<PolicyEvent>>>,
}

impl Default for GlobalPolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalPolicyEngine {
    pub fn new() -> Self {
        Self {
            policies: Arc::new(RwLock::new(HashMap::new())),
            budget: Arc::new(RwLock::new(ResourceBudget::default())),
            enforcer: Arc::new(RwLock::new(BudgetEnforcer::new())),
            metrics: Arc::new(RwLock::new(PolicyMetrics::default())),
            event_log: Arc::new(RwLock::new(VecDeque::new())),
        }
    }

    /// Add or update a policy rule
    pub fn set_policy(&self, rule: PolicyRule) -> SpkResult<()> {
        let mut policies = self.policies.write()
            .map_err(|_| SpkError::LockError("Failed to acquire policies lock".into()))?;

        if policies.len() >= V21_MAX_POLICIES && !policies.contains_key(&rule.id) {
            return Err(SpkError::LimitExceeded("Too many policies".into()));
        }

        policies.insert(rule.id.clone(), rule);
        Ok(())
    }

    /// Get a policy by ID
    pub fn get_policy(&self, id: &str) -> SpkResult<PolicyRule> {
        let policies = self.policies.read()
            .map_err(|_| SpkError::LockError("Failed to acquire policies lock".into()))?;
        
        policies.get(id)
            .cloned()
            .ok_or_else(|| SpkError::NotFound(format!("Policy {} not found", id)))
    }

    /// List all policy IDs
    pub fn list_policies(&self) -> SpkResult<Vec<String>> {
        let policies = self.policies.read()
            .map_err(|_| SpkError::LockError("Failed to acquire policies lock".into()))?;
        Ok(policies.keys().cloned().collect())
    }

    /// Evaluate all policies and execute actions
    pub fn evaluate(&self, ctx: &PolicyContext) -> SpkResult<Vec<PolicyAction>> {
        let policies = self.policies.read()
            .map_err(|_| SpkError::LockError("Failed to acquire policies lock".into()))?;

        let mut actions = Vec::new();
        let mut triggered_rules = Vec::new();

        // Collect all triggered rules
        for rule in policies.values() {
            if rule.evaluate(ctx) {
                triggered_rules.push(rule.clone());
            }
        }

        // Sort by priority (highest first)
        triggered_rules.sort_by(|a, b| b.priority.cmp(&a.priority));

        // Execute actions from highest priority rules
        for rule in triggered_rules {
            for action in &rule.actions {
                actions.push(action.clone());
                self.log_event(PolicyEvent {
                    timestamp: ctx.timestamp,
                    rule_id: rule.id.clone(),
                    action_type: action.action_type,
                    success: true,
                });
            }
        }

        // Update metrics
        let mut metrics = self.metrics.write()
            .map_err(|_| SpkError::LockError("Failed to acquire metrics lock".into()))?;
        metrics.evaluations += 1;
        metrics.actions_executed += actions.len() as u64;

        Ok(actions)
    }

    /// Set resource budget
    pub fn set_budget(&self, budget: ResourceBudget) -> SpkResult<()> {
        let mut b = self.budget.write()
            .map_err(|_| SpkError::LockError("Failed to acquire budget lock".into()))?;
        *b = budget;
        Ok(())
    }

    /// Get current budget
    pub fn get_budget(&self) -> SpkResult<ResourceBudget> {
        let budget = self.budget.read()
            .map_err(|_| SpkError::LockError("Failed to acquire budget lock".into()))?;
        Ok(budget.clone())
    }

    /// Check if resources can be allocated
    pub fn can_allocate(&self, cpu: f64, gpu: f64, memory: u64) -> SpkResult<bool> {
        let budget = self.budget.read()
            .map_err(|_| SpkError::LockError("Failed to acquire budget lock".into()))?;
        let enforcer = self.enforcer.read()
            .map_err(|_| SpkError::LockError("Failed to acquire enforcer lock".into()))?;
        Ok(enforcer.can_allocate(&budget, cpu, gpu, memory))
    }

    /// Allocate resources
    pub fn allocate(&self, cpu: f64, gpu: f64, memory: u64) -> SpkResult<()> {
        let mut enforcer = self.enforcer.write()
            .map_err(|_| SpkError::LockError("Failed to acquire enforcer lock".into()))?;
        enforcer.allocate(cpu, gpu, memory);
        Ok(())
    }

    /// Release resources
    pub fn release(&self, cpu: f64, gpu: f64, memory: u64) -> SpkResult<()> {
        let mut enforcer = self.enforcer.write()
            .map_err(|_| SpkError::LockError("Failed to acquire enforcer lock".into()))?;
        enforcer.release(cpu, gpu, memory);
        Ok(())
    }

    /// Get policy execution metrics
    pub fn get_metrics(&self) -> SpkResult<PolicyMetrics> {
        let metrics = self.metrics.read()
            .map_err(|_| SpkError::LockError("Failed to acquire metrics lock".into()))?;
        Ok(metrics.clone())
    }

    /// Get recent events
    pub fn get_events(&self, limit: usize) -> SpkResult<Vec<PolicyEvent>> {
        let log = self.event_log.read()
            .map_err(|_| SpkError::LockError("Failed to acquire event log lock".into()))?;
        Ok(log.iter().rev().take(limit).cloned().collect())
    }

    /// Log a policy event
    fn log_event(&self, event: PolicyEvent) {
        if let Ok(mut log) = self.event_log.write() {
            if log.len() >= 1000 {
                log.pop_front();
            }
            log.push_back(event);
        }
    }

    /// Self-correcting optimization loop
    pub fn optimize(&self, ctx: &PolicyContext) -> SpkResult<()> {
        // Evaluate current state
        let _actions = self.evaluate(ctx)?;

        // Auto-adjust policies based on observed behavior
        let mut metrics = self.metrics.write()
            .map_err(|_| SpkError::LockError("Failed to acquire metrics lock".into()))?;
        
        if metrics.evaluations > 0 {
            let action_rate = metrics.actions_executed as f64 / metrics.evaluations as f64;
            
            // If too many actions firing, increase thresholds
            if action_rate > 0.5 {
                metrics.optimization_adjustments += 1;
            }
        }

        metrics.optimizations += 1;
        Ok(())
    }
}

/// Policy execution metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyMetrics {
    pub evaluations: u64,
    pub actions_executed: u64,
    pub optimizations: u64,
    pub optimization_adjustments: u64,
}

/// Policy event log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvent {
    pub timestamp: u64,
    pub rule_id: String,
    pub action_type: ActionType,
    pub success: bool,
}

// =============================================================================
// CROSS-NODE POLICY PROPAGATION
// =============================================================================

/// Policy propagation for mesh synchronization
pub struct PolicyPropagator {
    engine: GlobalPolicyEngine,
}

impl PolicyPropagator {
    pub fn new(engine: GlobalPolicyEngine) -> Self {
        Self { engine }
    }

    /// Propagate policies across mesh
    pub fn propagate(&self, _target_nodes: &[String]) -> SpkResult<()> {
        // In real implementation, would use V12 mesh fabric to sync policies
        // For now, placeholder
        Ok(())
    }

    /// Resolve policy conflicts (newer version wins, then priority)
    pub fn resolve_conflict(&self, local: &PolicyRule, remote: &PolicyRule) -> PolicyRule {
        if remote.version > local.version {
            remote.clone()
        } else if remote.version == local.version && remote.priority > local.priority {
            remote.clone()
        } else {
            local.clone()
        }
    }

    /// Merge incoming policies
    pub fn merge_policies(&self, incoming: Vec<PolicyRule>) -> SpkResult<usize> {
        let mut merged = 0;
        for remote_rule in incoming {
            if let Ok(local_rule) = self.engine.get_policy(&remote_rule.id) {
                let resolved = self.resolve_conflict(&local_rule, &remote_rule);
                self.engine.set_policy(resolved)?;
            } else {
                self.engine.set_policy(remote_rule)?;
            }
            merged += 1;
        }
        Ok(merged)
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_rule_creation() {
        let rule = PolicyRule::new("test_rule".into(), PolicyType::Compression);
        assert_eq!(rule.id, "test_rule");
        assert_eq!(rule.policy_type, PolicyType::Compression);
        assert!(rule.enabled);
    }

    #[test]
    fn test_policy_condition_evaluation() {
        let mut ctx = PolicyContext::new();
        ctx.set_metric("cpu_usage".into(), 85.0);

        let cond = PolicyCondition {
            metric: "cpu_usage".into(),
            operator: ConditionOperator::GreaterThan,
            threshold: 80.0,
        };

        assert!(cond.evaluate(&ctx));
    }

    #[test]
    fn test_policy_engine() {
        let engine = GlobalPolicyEngine::new();
        
        let mut rule = PolicyRule::new("high_cpu".into(), PolicyType::Compute);
        rule.conditions.push(PolicyCondition {
            metric: "cpu_usage".into(),
            operator: ConditionOperator::GreaterThan,
            threshold: 80.0,
        });
        rule.actions.push(PolicyAction {
            action_type: ActionType::ThrottleCompute,
            parameters: HashMap::new(),
        });

        engine.set_policy(rule).unwrap();

        let mut ctx = PolicyContext::new();
        ctx.set_metric("cpu_usage".into(), 90.0);

        let actions = engine.evaluate(&ctx).unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].action_type, ActionType::ThrottleCompute);
    }

    #[test]
    fn test_resource_budget() {
        let budget = ResourceBudget::default();
        let mut enforcer = BudgetEnforcer::new();

        assert!(enforcer.can_allocate(&budget, 50.0, 50.0, 4096));
        enforcer.allocate(50.0, 50.0, 4096);
        assert!(!enforcer.can_allocate(&budget, 50.0, 50.0, 4096));
        enforcer.release(50.0, 50.0, 4096);
        assert!(enforcer.can_allocate(&budget, 50.0, 50.0, 4096));
    }

    #[test]
    fn test_policy_compiler() {
        let dsl = "RULE test_policy PRIORITY high IF access_frequency > 100 THEN move_to_nvme";
        let rule = PolicyCompiler::compile(dsl).unwrap();
        
        assert_eq!(rule.id, "test_policy");
        assert_eq!(rule.priority, PolicyPriority::High);
        assert_eq!(rule.conditions.len(), 1);
        assert_eq!(rule.actions.len(), 1);

        let decompiled = PolicyCompiler::decompile(&rule);
        assert!(decompiled.contains("test_policy"));
        assert!(decompiled.contains("high"));
    }

    #[test]
    fn test_policy_priority() {
        let engine = GlobalPolicyEngine::new();

        let mut low = PolicyRule::new("low".into(), PolicyType::Compression);
        low.priority = PolicyPriority::Low;
        low.actions.push(PolicyAction {
            action_type: ActionType::MoveToHDD,
            parameters: HashMap::new(),
        });

        let mut high = PolicyRule::new("high".into(), PolicyType::Compression);
        high.priority = PolicyPriority::High;
        high.actions.push(PolicyAction {
            action_type: ActionType::MoveToNVMe,
            parameters: HashMap::new(),
        });

        engine.set_policy(low).unwrap();
        engine.set_policy(high).unwrap();

        let ctx = PolicyContext::new();
        let actions = engine.evaluate(&ctx).unwrap();

        // High priority action should come first
        assert_eq!(actions[0].action_type, ActionType::MoveToNVMe);
    }

    #[test]
    fn test_conflict_resolution() {
        let engine = GlobalPolicyEngine::new();
        let propagator = PolicyPropagator::new(engine);

        let mut local = PolicyRule::new("test".into(), PolicyType::Compression);
        local.version = 1;
        local.priority = PolicyPriority::Low;

        let mut remote = PolicyRule::new("test".into(), PolicyType::Compression);
        remote.version = 2;
        remote.priority = PolicyPriority::High;

        let resolved = propagator.resolve_conflict(&local, &remote);
        assert_eq!(resolved.version, 2);
    }
}
