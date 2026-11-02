//! Account Service
//! Handles account creation, authentication, and storage management

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sha2::{Sha256, Digest};
use rand::Rng;

/// Account information
#[derive(Debug, Clone)]
pub struct Account {
    pub account_id: String,
    pub display_name: String,
    pub password_hash: String,
    pub recovery_hash: String,
    pub tier: String,
    pub storage_used: u64,
    pub storage_quota: u64,
    pub file_count: u32,
    pub archive_count: u32,
    pub created_at: i64,
    pub last_active: i64,
}

/// Account error
#[derive(Debug)]
pub enum AccountError {
    InvalidCredentials,
    AccountNotFound,
    AccountExists,
    InvalidRecoveryPhrase,
    StorageFull,
    InvalidPassword,
}

impl std::fmt::Display for AccountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AccountError::InvalidCredentials => write!(f, "Invalid credentials"),
            AccountError::AccountNotFound => write!(f, "Account not found"),
            AccountError::AccountExists => write!(f, "Account already exists"),
            AccountError::InvalidRecoveryPhrase => write!(f, "Invalid recovery phrase"),
            AccountError::StorageFull => write!(f, "Storage quota exceeded"),
            AccountError::InvalidPassword => write!(f, "Password must be at least 8 characters with uppercase, lowercase, and number"),
        }
    }
}

/// Storage tier quotas in bytes
const TIER_QUOTAS: &[(&str, u64)] = &[
    ("free", 10 * 1024 * 1024 * 1024),        // 10GB
    ("basic", 50 * 1024 * 1024 * 1024),       // 50GB
    ("pro", 100 * 1024 * 1024 * 1024),        // 100GB
    ("enterprise", u64::MAX),                  // Unlimited
];

/// BIP39-like word list for recovery phrases
const WORD_LIST: &[&str] = &[
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
    "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
    "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
    "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
    "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
    "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
    "alert", "alien", "all", "alley", "allow", "almost", "alone", "alpha",
    "already", "also", "alter", "always", "amateur", "amazing", "among", "amount",
    "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry", "animal",
    "ankle", "announce", "annual", "another", "answer", "antenna", "antique", "anxiety",
    "any", "apart", "apology", "appear", "apple", "approve", "april", "arch",
    "arctic", "area", "arena", "argue", "arm", "armed", "armor", "army",
    "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact", "artist",
    "artwork", "ask", "aspect", "assault", "asset", "assist", "assume", "asthma",
    "athlete", "atom", "attack", "attend", "attitude", "attract", "auction", "audit",
    "august", "aunt", "author", "auto", "autumn", "average", "avocado", "avoid",
];

/// Account service
pub struct AccountService {
    accounts: RwLock<HashMap<String, Account>>,
    recovery_map: RwLock<HashMap<String, String>>, // recovery_hash -> account_id
}

impl AccountService {
    pub fn new() -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            recovery_map: RwLock::new(HashMap::new()),
        }
    }

    /// Generate recovery phrase (12 words)
    fn generate_recovery_phrase() -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..12)
            .map(|_| WORD_LIST[rng.gen_range(0..WORD_LIST.len())].to_string())
            .collect()
    }

    /// Generate account ID
    fn generate_account_id() -> String {
        let mut rng = rand::thread_rng();
        let chars: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".chars().collect();
        let suffix: String = (0..8).map(|_| chars[rng.gen_range(0..chars.len())]).collect();
        format!("SPK-{}", suffix)
    }

    /// Hash password
    fn hash_password(password: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Hash recovery phrase
    fn hash_recovery(phrase: &[&str]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(phrase.join(" ").as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Validate password strength
    fn validate_password(password: &str) -> bool {
        password.len() >= 8
            && password.chars().any(|c| c.is_uppercase())
            && password.chars().any(|c| c.is_lowercase())
            && password.chars().any(|c| c.is_numeric())
    }

    /// Get storage quota for tier
    fn get_quota(tier: &str) -> u64 {
        TIER_QUOTAS
            .iter()
            .find(|(t, _)| *t == tier)
            .map(|(_, q)| *q)
            .unwrap_or(TIER_QUOTAS[0].1)
    }

    /// Create new account
    pub async fn create_account(&self, display_name: &str, password: &str) -> Result<(Account, Vec<String>), AccountError> {
        if !Self::validate_password(password) {
            return Err(AccountError::InvalidPassword);
        }

        let account_id = Self::generate_account_id();
        let recovery_phrase = Self::generate_recovery_phrase();
        let password_hash = Self::hash_password(password);
        let recovery_hash = Self::hash_recovery(&recovery_phrase.iter().map(|s| s.as_str()).collect::<Vec<_>>());

        let now = chrono::Utc::now().timestamp_millis();
        let account = Account {
            account_id: account_id.clone(),
            display_name: display_name.to_string(),
            password_hash,
            recovery_hash: recovery_hash.clone(),
            tier: "free".to_string(),
            storage_used: 0,
            storage_quota: Self::get_quota("free"),
            file_count: 0,
            archive_count: 0,
            created_at: now,
            last_active: now,
        };

        // Store account
        let mut accounts = self.accounts.write().await;
        accounts.insert(account_id.clone(), account.clone());

        // Store recovery mapping
        let mut recovery_map = self.recovery_map.write().await;
        recovery_map.insert(recovery_hash, account_id);

        Ok((account, recovery_phrase))
    }

    /// Login with account ID and password
    pub async fn login(&self, account_id: &str, password: &str) -> Result<Account, AccountError> {
        let accounts = self.accounts.read().await;
        
        let account = accounts.get(account_id).ok_or(AccountError::AccountNotFound)?;
        
        if account.password_hash != Self::hash_password(password) {
            return Err(AccountError::InvalidCredentials);
        }

        drop(accounts);

        // Update last active
        let mut accounts = self.accounts.write().await;
        if let Some(acc) = accounts.get_mut(account_id) {
            acc.last_active = chrono::Utc::now().timestamp_millis();
            Ok(acc.clone())
        } else {
            Err(AccountError::AccountNotFound)
        }
    }

    /// Recover account with recovery phrase
    pub async fn recover_account(&self, phrase: &[&str], new_password: &str) -> Result<Account, AccountError> {
        if phrase.len() != 12 && phrase.len() != 24 {
            return Err(AccountError::InvalidRecoveryPhrase);
        }

        if !Self::validate_password(new_password) {
            return Err(AccountError::InvalidPassword);
        }

        let recovery_hash = Self::hash_recovery(phrase);
        
        // Find account by recovery hash
        let recovery_map = self.recovery_map.read().await;
        let account_id = recovery_map.get(&recovery_hash)
            .ok_or(AccountError::InvalidRecoveryPhrase)?
            .clone();
        drop(recovery_map);

        // Update password
        let mut accounts = self.accounts.write().await;
        let account = accounts.get_mut(&account_id)
            .ok_or(AccountError::AccountNotFound)?;
        
        account.password_hash = Self::hash_password(new_password);
        account.last_active = chrono::Utc::now().timestamp_millis();

        Ok(account.clone())
    }

    /// Get account info
    pub async fn get_account(&self, account_id: &str) -> Result<Account, AccountError> {
        let accounts = self.accounts.read().await;
        accounts.get(account_id).cloned().ok_or(AccountError::AccountNotFound)
    }

    /// Update storage usage
    pub async fn update_storage(&self, account_id: &str, bytes_added: i64) -> Result<(), AccountError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts.get_mut(account_id).ok_or(AccountError::AccountNotFound)?;
        
        let new_usage = (account.storage_used as i64 + bytes_added).max(0) as u64;
        if new_usage > account.storage_quota {
            return Err(AccountError::StorageFull);
        }
        
        account.storage_used = new_usage;
        Ok(())
    }

    /// Increment file count
    pub async fn add_file(&self, account_id: &str, is_archive: bool) -> Result<(), AccountError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts.get_mut(account_id).ok_or(AccountError::AccountNotFound)?;
        
        account.file_count += 1;
        if is_archive {
            account.archive_count += 1;
        }
        
        Ok(())
    }
}
