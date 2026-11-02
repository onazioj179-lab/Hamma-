//! # SPK Account System - Wallet-Style User Authentication
//! 
//! Trust Wallet-style account system with:
//! - 12/24-word recovery phrase (mnemonic) generation
//! - Password-protected encrypted storage
//! - Up to 100GB storage per user
//! - Quota tracking and enforcement
//! - Multi-device sync support
//! - HAMMA-managed compression settings per user

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// Maximum storage per user: 100GB
pub const USER_MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;

/// Default storage per user: 10GB (free tier)
pub const USER_DEFAULT_STORAGE_BYTES: u64 = 10 * 1024 * 1024 * 1024;

/// BIP39 word list (simplified - first 256 words for demo)
const BIP39_WORDS: &[&str] = &[
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
    "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
    "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
    "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
    "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
    "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
    "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone",
    "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
    "amount", "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry",
    "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
    "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april",
    "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
    "army", "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact",
    "artist", "artwork", "ask", "aspect", "assault", "asset", "assist", "assume",
    "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction",
    "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado",
    "avoid", "awake", "aware", "away", "awesome", "awful", "awkward", "axis",
    "baby", "bachelor", "bacon", "badge", "bag", "balance", "balcony", "ball",
    "bamboo", "banana", "banner", "bar", "barely", "bargain", "barrel", "base",
    "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
    "beef", "before", "begin", "behave", "behind", "believe", "below", "belt",
    "bench", "benefit", "best", "betray", "better", "between", "beyond", "bicycle",
    "bid", "bike", "bind", "biology", "bird", "birth", "bitter", "black",
    "blade", "blame", "blanket", "blast", "bleak", "bless", "blind", "blood",
    "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body",
    "boil", "bomb", "bone", "bonus", "book", "boost", "border", "boring",
    "borrow", "boss", "bottom", "bounce", "box", "boy", "bracket", "brain",
    "brand", "brass", "brave", "bread", "breeze", "brick", "bridge", "brief",
    "bright", "bring", "brisk", "broccoli", "broken", "bronze", "broom", "brother",
    "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
    "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus",
    "business", "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable",
    "cactus", "cage", "cake", "call", "calm", "camera", "camp", "can",
];

/// User account status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountStatus {
    /// Active account
    Active,
    /// Account suspended (quota exceeded, etc.)
    Suspended,
    /// Account pending verification
    Pending,
    /// Account locked (too many failed attempts)
    Locked,
    /// Account deleted (soft delete)
    Deleted,
}

/// Storage tier for users
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StorageTier {
    /// Free tier: 10GB
    Free,
    /// Basic tier: 50GB
    Basic,
    /// Pro tier: 100GB
    Pro,
    /// Enterprise: Unlimited (managed separately)
    Enterprise,
}

impl StorageTier {
    /// Get storage quota for tier
    pub fn quota_bytes(&self) -> u64 {
        match self {
            StorageTier::Free => 10 * 1024 * 1024 * 1024,      // 10GB
            StorageTier::Basic => 50 * 1024 * 1024 * 1024,     // 50GB
            StorageTier::Pro => 100 * 1024 * 1024 * 1024,      // 100GB
            StorageTier::Enterprise => u64::MAX,                // Unlimited
        }
    }
    
    /// Get tier name
    pub fn name(&self) -> &'static str {
        match self {
            StorageTier::Free => "Free",
            StorageTier::Basic => "Basic",
            StorageTier::Pro => "Pro",
            StorageTier::Enterprise => "Enterprise",
        }
    }
}

/// Recovery phrase (mnemonic) for wallet-style account recovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryPhrase {
    /// 12 or 24 words
    words: Vec<String>,
    /// Checksum for validation
    checksum: String,
}

impl RecoveryPhrase {
    /// Generate a new 12-word recovery phrase
    pub fn generate_12() -> Self {
        Self::generate(12)
    }
    
    /// Generate a new 24-word recovery phrase
    pub fn generate_24() -> Self {
        Self::generate(24)
    }
    
    /// Generate recovery phrase with specified word count
    fn generate(word_count: usize) -> Self {
        let mut words = Vec::with_capacity(word_count);
        
        // Use current time + random as entropy source
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        
        let mut hasher = Sha256::new();
        hasher.update(now.to_le_bytes());
        hasher.update(uuid::Uuid::new_v4().as_bytes());
        let entropy = hasher.finalize();
        
        // Generate words from entropy
        for i in 0..word_count {
            let byte_idx = i % 32;
            let word_idx = (entropy[byte_idx] as usize + i * 17) % BIP39_WORDS.len();
            words.push(BIP39_WORDS[word_idx].to_string());
        }
        
        // Calculate checksum
        let mut checksum_hasher = Sha256::new();
        checksum_hasher.update(words.join(" ").as_bytes());
        let checksum = hex::encode(&checksum_hasher.finalize()[..4]);
        
        Self { words, checksum }
    }
    
    /// Validate recovery phrase
    pub fn validate(&self) -> bool {
        if self.words.len() != 12 && self.words.len() != 24 {
            return false;
        }
        
        // Check all words are valid
        for word in &self.words {
            if !BIP39_WORDS.contains(&word.as_str()) {
                return false;
            }
        }
        
        // Verify checksum
        let mut hasher = Sha256::new();
        hasher.update(self.words.join(" ").as_bytes());
        let expected = hex::encode(&hasher.finalize()[..4]);
        
        self.checksum == expected
    }
    
    /// Get words as string (for display)
    pub fn to_string(&self) -> String {
        self.words.join(" ")
    }
    
    /// Get words as numbered list
    pub fn to_numbered_list(&self) -> String {
        self.words
            .iter()
            .enumerate()
            .map(|(i, w)| format!("{}. {}", i + 1, w))
            .collect::<Vec<_>>()
            .join("\n")
    }
    
    /// Create from string (for recovery)
    pub fn from_string(phrase: &str) -> Option<Self> {
        let words: Vec<String> = phrase
            .split_whitespace()
            .map(|s| s.to_lowercase())
            .collect();
        
        if words.len() != 12 && words.len() != 24 {
            return None;
        }
        
        // Calculate checksum
        let mut hasher = Sha256::new();
        hasher.update(words.join(" ").as_bytes());
        let checksum = hex::encode(&hasher.finalize()[..4]);
        
        let phrase = Self { words, checksum };
        
        if phrase.validate() {
            Some(phrase)
        } else {
            None
        }
    }
    
    /// Derive account ID from phrase
    pub fn derive_account_id(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.words.join(" ").as_bytes());
        hasher.update(b"SPK_ACCOUNT_V1");
        let hash = hasher.finalize();
        format!("spk_{}", hex::encode(&hash[..16]))
    }
}

/// Password-protected credentials
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    /// Encrypted recovery phrase (AES-256-GCM)
    pub encrypted_phrase: Vec<u8>,
    /// Salt for password derivation
    pub salt: [u8; 32],
    /// Password hash for verification
    pub password_hash: String,
    /// Number of failed login attempts
    pub failed_attempts: u32,
    /// Last failed attempt timestamp
    pub last_failed: u64,
}

impl Credentials {
    /// Create new credentials with password
    pub fn new(phrase: &RecoveryPhrase, password: &str) -> Self {
        // Generate salt
        let mut salt = [0u8; 32];
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut hasher = Sha256::new();
        hasher.update(now.to_le_bytes());
        hasher.update(uuid::Uuid::new_v4().as_bytes());
        salt.copy_from_slice(&hasher.finalize()[..32]);
        
        // Derive key from password
        let key = Self::derive_key(password, &salt);
        
        // Encrypt phrase (simplified - in production use AES-GCM)
        let phrase_bytes = phrase.to_string().as_bytes().to_vec();
        let encrypted_phrase = Self::xor_encrypt(&phrase_bytes, &key);
        
        // Hash password for verification
        let mut pwd_hasher = Sha256::new();
        pwd_hasher.update(password.as_bytes());
        pwd_hasher.update(&salt);
        let password_hash = hex::encode(pwd_hasher.finalize());
        
        Self {
            encrypted_phrase,
            salt,
            password_hash,
            failed_attempts: 0,
            last_failed: 0,
        }
    }
    
    /// Derive encryption key from password
    fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        let mut hasher = Sha256::new();
        
        // PBKDF2-like derivation (simplified)
        hasher.update(password.as_bytes());
        hasher.update(salt);
        let mut result = hasher.finalize();
        
        for _ in 0..10000 {
            let mut h = Sha256::new();
            h.update(&result);
            h.update(salt);
            result = h.finalize();
        }
        
        key.copy_from_slice(&result);
        key
    }
    
    /// Simple XOR encryption (in production, use AES-GCM)
    fn xor_encrypt(data: &[u8], key: &[u8; 32]) -> Vec<u8> {
        data.iter()
            .enumerate()
            .map(|(i, b)| b ^ key[i % 32])
            .collect()
    }
    
    /// Verify password
    pub fn verify_password(&self, password: &str) -> bool {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hasher.update(&self.salt);
        let hash = hex::encode(hasher.finalize());
        hash == self.password_hash
    }
    
    /// Decrypt and get recovery phrase
    pub fn decrypt_phrase(&self, password: &str) -> Option<RecoveryPhrase> {
        if !self.verify_password(password) {
            return None;
        }
        
        let key = Self::derive_key(password, &self.salt);
        let decrypted = Self::xor_encrypt(&self.encrypted_phrase, &key);
        
        let phrase_str = String::from_utf8(decrypted).ok()?;
        RecoveryPhrase::from_string(&phrase_str)
    }
    
    /// Change password
    pub fn change_password(&mut self, old_password: &str, new_password: &str) -> bool {
        // Decrypt with old password
        if let Some(phrase) = self.decrypt_phrase(old_password) {
            // Re-encrypt with new password
            *self = Self::new(&phrase, new_password);
            true
        } else {
            false
        }
    }
    
    /// Record failed login attempt
    pub fn record_failed_attempt(&mut self) {
        self.failed_attempts += 1;
        self.last_failed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }
    
    /// Check if account is locked (5 failed attempts in 15 minutes)
    pub fn is_locked(&self) -> bool {
        if self.failed_attempts < 5 {
            return false;
        }
        
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // 15 minute lockout
        now - self.last_failed < 900
    }
    
    /// Reset failed attempts on successful login
    pub fn reset_attempts(&mut self) {
        self.failed_attempts = 0;
        self.last_failed = 0;
    }
}

/// User account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAccount {
    /// Unique account ID (derived from recovery phrase)
    pub account_id: String,
    /// Display name
    pub display_name: String,
    /// Account creation timestamp
    pub created_at: u64,
    /// Last active timestamp
    pub last_active: u64,
    /// Account status
    pub status: AccountStatus,
    /// Storage tier
    pub tier: StorageTier,
    /// Current storage used (bytes)
    pub storage_used: u64,
    /// Total files stored
    pub file_count: u64,
    /// Total archives created
    pub archive_count: u64,
    /// Linked device IDs
    pub devices: Vec<String>,
    /// HAMMA compression preferences
    pub hamma_preferences: HammaPreferences,
    /// Custom metadata
    pub metadata: HashMap<String, String>,
}

/// User's HAMMA compression preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HammaPreferences {
    /// Preferred speed mode (fast/balanced/max/auto)
    pub speed_mode: String,
    /// Preferred codec
    pub codec: String,
    /// Enable deduplication
    pub enable_dedup: bool,
    /// Enable delta compression
    pub enable_delta: bool,
    /// Enable dictionary compression
    pub enable_dictionary: bool,
    /// Auto-organize files
    pub auto_organize: bool,
    /// Auto-label files
    pub auto_label: bool,
}

impl Default for HammaPreferences {
    fn default() -> Self {
        Self {
            speed_mode: "auto".to_string(),
            codec: "zstd".to_string(),
            enable_dedup: true,
            enable_delta: true,
            enable_dictionary: true,
            auto_organize: true,
            auto_label: true,
        }
    }
}

impl UserAccount {
    /// Create a new user account from recovery phrase
    pub fn new(phrase: &RecoveryPhrase, display_name: String) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        Self {
            account_id: phrase.derive_account_id(),
            display_name,
            created_at: now,
            last_active: now,
            status: AccountStatus::Active,
            tier: StorageTier::Free,
            storage_used: 0,
            file_count: 0,
            archive_count: 0,
            devices: Vec::new(),
            hamma_preferences: HammaPreferences::default(),
            metadata: HashMap::new(),
        }
    }
    
    /// Get available storage space
    pub fn available_storage(&self) -> u64 {
        let quota = self.tier.quota_bytes();
        quota.saturating_sub(self.storage_used)
    }
    
    /// Check if user can store additional bytes
    pub fn can_store(&self, bytes: u64) -> bool {
        self.storage_used + bytes <= self.tier.quota_bytes()
    }
    
    /// Get storage usage percentage
    pub fn storage_usage_percent(&self) -> f64 {
        let quota = self.tier.quota_bytes();
        if quota == 0 || quota == u64::MAX {
            return 0.0;
        }
        (self.storage_used as f64 / quota as f64) * 100.0
    }
    
    /// Add storage usage
    pub fn add_storage(&mut self, bytes: u64) -> Result<(), AccountError> {
        if !self.can_store(bytes) {
            return Err(AccountError::QuotaExceeded {
                used: self.storage_used,
                quota: self.tier.quota_bytes(),
                requested: bytes,
            });
        }
        self.storage_used += bytes;
        self.update_activity();
        Ok(())
    }
    
    /// Remove storage usage
    pub fn remove_storage(&mut self, bytes: u64) {
        self.storage_used = self.storage_used.saturating_sub(bytes);
        self.update_activity();
    }
    
    /// Update last active timestamp
    pub fn update_activity(&mut self) {
        self.last_active = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }
    
    /// Add a device
    pub fn add_device(&mut self, device_id: String) {
        if !self.devices.contains(&device_id) {
            self.devices.push(device_id);
        }
    }
    
    /// Remove a device
    pub fn remove_device(&mut self, device_id: &str) {
        self.devices.retain(|d| d != device_id);
    }
    
    /// Get storage info as formatted string
    pub fn storage_info(&self) -> String {
        format!(
            "{} / {} ({:.1}%)",
            format_bytes(self.storage_used),
            format_bytes(self.tier.quota_bytes()),
            self.storage_usage_percent()
        )
    }
}

/// Account error types
#[derive(Debug, Clone)]
pub enum AccountError {
    /// Storage quota exceeded
    QuotaExceeded {
        used: u64,
        quota: u64,
        requested: u64,
    },
    /// Account not found
    AccountNotFound(String),
    /// Account already exists
    AccountExists(String),
    /// Account suspended
    AccountSuspended(String),
    /// Account locked
    AccountLocked(String),
    /// Invalid password
    InvalidPassword,
    /// Invalid recovery phrase
    InvalidPhrase,
    /// IO error
    IoError(String),
    /// Serialization error
    SerializationError(String),
}

impl std::fmt::Display for AccountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AccountError::QuotaExceeded { used, quota, requested } => {
                write!(f, "Storage quota exceeded: using {} of {}, requested {} more",
                    format_bytes(*used), format_bytes(*quota), format_bytes(*requested))
            }
            AccountError::AccountNotFound(id) => write!(f, "Account not found: {}", id),
            AccountError::AccountExists(id) => write!(f, "Account already exists: {}", id),
            AccountError::AccountSuspended(id) => write!(f, "Account suspended: {}", id),
            AccountError::AccountLocked(id) => write!(f, "Account locked due to failed attempts: {}", id),
            AccountError::InvalidPassword => write!(f, "Invalid password"),
            AccountError::InvalidPhrase => write!(f, "Invalid recovery phrase"),
            AccountError::IoError(msg) => write!(f, "IO error: {}", msg),
            AccountError::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
        }
    }
}

impl std::error::Error for AccountError {}

/// Format bytes to human readable
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;
    
    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Account manager for handling user accounts
pub struct AccountManager {
    /// Path to account storage directory
    storage_path: PathBuf,
    /// In-memory account cache
    accounts: Arc<RwLock<HashMap<String, UserAccount>>>,
    /// Credentials storage
    credentials: Arc<RwLock<HashMap<String, Credentials>>>,
}

impl AccountManager {
    /// Create a new account manager
    pub fn new<P: AsRef<Path>>(storage_path: P) -> Result<Self, AccountError> {
        let storage_path = storage_path.as_ref().to_path_buf();
        fs::create_dir_all(&storage_path)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        
        let manager = Self {
            storage_path,
            accounts: Arc::new(RwLock::new(HashMap::new())),
            credentials: Arc::new(RwLock::new(HashMap::new())),
        };
        
        // Load existing accounts
        manager.load_all_accounts()?;
        
        Ok(manager)
    }
    
    /// Load all accounts from disk
    fn load_all_accounts(&self) -> Result<(), AccountError> {
        let accounts_dir = self.storage_path.join("accounts");
        if !accounts_dir.exists() {
            fs::create_dir_all(&accounts_dir)
                .map_err(|e| AccountError::IoError(e.to_string()))?;
            return Ok(());
        }
        
        let entries = fs::read_dir(&accounts_dir)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok((account, creds)) = self.load_account_from_file(&path) {
                    let mut accounts = self.accounts.write().unwrap();
                    let mut credentials = self.credentials.write().unwrap();
                    credentials.insert(account.account_id.clone(), creds);
                    accounts.insert(account.account_id.clone(), account);
                }
            }
        }
        
        Ok(())
    }
    
    /// Load a single account from file
    fn load_account_from_file(&self, path: &Path) -> Result<(UserAccount, Credentials), AccountError> {
        let mut file = File::open(path)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        
        #[derive(Deserialize)]
        struct StoredAccount {
            account: UserAccount,
            credentials: Credentials,
        }
        
        let stored: StoredAccount = serde_json::from_str(&contents)
            .map_err(|e| AccountError::SerializationError(e.to_string()))?;
        
        Ok((stored.account, stored.credentials))
    }
    
    /// Save account to disk
    fn save_account(&self, account: &UserAccount, creds: &Credentials) -> Result<(), AccountError> {
        let accounts_dir = self.storage_path.join("accounts");
        fs::create_dir_all(&accounts_dir)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        
        #[derive(Serialize)]
        struct StoredAccount<'a> {
            account: &'a UserAccount,
            credentials: &'a Credentials,
        }
        
        let stored = StoredAccount { account, credentials: creds };
        
        let path = accounts_dir.join(format!("{}.json", account.account_id));
        let json = serde_json::to_string_pretty(&stored)
            .map_err(|e| AccountError::SerializationError(e.to_string()))?;
        
        let mut file = File::create(&path)
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        file.write_all(json.as_bytes())
            .map_err(|e| AccountError::IoError(e.to_string()))?;
        
        Ok(())
    }
    
    /// Create a new account (returns recovery phrase - MUST be shown to user!)
    pub fn create_account(&self, display_name: String, password: &str) -> Result<(UserAccount, RecoveryPhrase), AccountError> {
        // Generate recovery phrase
        let phrase = RecoveryPhrase::generate_12();
        let account_id = phrase.derive_account_id();
        
        // Check if account already exists
        {
            let accounts = self.accounts.read().unwrap();
            if accounts.contains_key(&account_id) {
                return Err(AccountError::AccountExists(account_id));
            }
        }
        
        // Create account and credentials
        let account = UserAccount::new(&phrase, display_name);
        let credentials = Credentials::new(&phrase, password);
        
        // Save to disk
        self.save_account(&account, &credentials)?;
        
        // Update cache
        {
            let mut accounts = self.accounts.write().unwrap();
            let mut creds = self.credentials.write().unwrap();
            creds.insert(account.account_id.clone(), credentials);
            accounts.insert(account.account_id.clone(), account.clone());
        }
        
        Ok((account, phrase))
    }
    
    /// Login with account ID and password
    pub fn login(&self, account_id: &str, password: &str) -> Result<UserAccount, AccountError> {
        let mut credentials = self.credentials.write().unwrap();
        let creds = credentials.get_mut(account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))?;
        
        // Check if locked
        if creds.is_locked() {
            return Err(AccountError::AccountLocked(account_id.to_string()));
        }
        
        // Verify password
        if !creds.verify_password(password) {
            creds.record_failed_attempt();
            
            // Save updated credentials
            let accounts = self.accounts.read().unwrap();
            if let Some(account) = accounts.get(account_id) {
                let _ = self.save_account(account, creds);
            }
            
            return Err(AccountError::InvalidPassword);
        }
        
        // Reset failed attempts
        creds.reset_attempts();
        
        // Get account and update activity
        drop(credentials);
        
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.get_mut(account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))?;
        
        // Check account status
        match account.status {
            AccountStatus::Suspended => return Err(AccountError::AccountSuspended(account_id.to_string())),
            AccountStatus::Locked => return Err(AccountError::AccountLocked(account_id.to_string())),
            AccountStatus::Deleted => return Err(AccountError::AccountNotFound(account_id.to_string())),
            _ => {}
        }
        
        account.update_activity();
        
        // Save updated account
        let creds = self.credentials.read().unwrap();
        if let Some(c) = creds.get(account_id) {
            let _ = self.save_account(account, c);
        }
        
        Ok(account.clone())
    }
    
    /// Recover account with phrase
    pub fn recover_account(&self, phrase_str: &str, new_password: &str) -> Result<UserAccount, AccountError> {
        let phrase = RecoveryPhrase::from_string(phrase_str)
            .ok_or(AccountError::InvalidPhrase)?;
        
        let account_id = phrase.derive_account_id();
        
        // Check if account exists
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.get_mut(&account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.clone()))?;
        
        // Create new credentials with new password
        let credentials = Credentials::new(&phrase, new_password);
        
        // Update status if locked
        if account.status == AccountStatus::Locked {
            account.status = AccountStatus::Active;
        }
        
        account.update_activity();
        
        // Save
        self.save_account(account, &credentials)?;
        
        // Update credentials cache
        let mut creds = self.credentials.write().unwrap();
        creds.insert(account_id.clone(), credentials);
        
        Ok(account.clone())
    }
    
    /// Change password
    pub fn change_password(&self, account_id: &str, old_password: &str, new_password: &str) -> Result<(), AccountError> {
        let mut credentials = self.credentials.write().unwrap();
        let creds = credentials.get_mut(account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))?;
        
        if !creds.change_password(old_password, new_password) {
            return Err(AccountError::InvalidPassword);
        }
        
        // Save updated credentials
        let accounts = self.accounts.read().unwrap();
        if let Some(account) = accounts.get(account_id) {
            self.save_account(account, creds)?;
        }
        
        Ok(())
    }
    
    /// Get account by ID
    pub fn get_account(&self, account_id: &str) -> Result<UserAccount, AccountError> {
        let accounts = self.accounts.read().unwrap();
        accounts.get(account_id)
            .cloned()
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))
    }
    
    /// Update account
    pub fn update_account(&self, account: UserAccount) -> Result<(), AccountError> {
        let creds = self.credentials.read().unwrap();
        let credentials = creds.get(&account.account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account.account_id.clone()))?;
        
        self.save_account(&account, credentials)?;
        
        let mut accounts = self.accounts.write().unwrap();
        accounts.insert(account.account_id.clone(), account);
        
        Ok(())
    }
    
    /// Add storage to account
    pub fn add_storage(&self, account_id: &str, bytes: u64) -> Result<(), AccountError> {
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.get_mut(account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))?;
        
        account.add_storage(bytes)?;
        
        let creds = self.credentials.read().unwrap();
        if let Some(c) = creds.get(account_id) {
            self.save_account(account, c)?;
        }
        
        Ok(())
    }
    
    /// Remove storage from account
    pub fn remove_storage(&self, account_id: &str, bytes: u64) -> Result<(), AccountError> {
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.get_mut(account_id)
            .ok_or_else(|| AccountError::AccountNotFound(account_id.to_string()))?;
        
        account.remove_storage(bytes);
        
        let creds = self.credentials.read().unwrap();
        if let Some(c) = creds.get(account_id) {
            self.save_account(account, c)?;
        }
        
        Ok(())
    }
    
    /// List all accounts (admin)
    pub fn list_accounts(&self) -> Vec<UserAccount> {
        let accounts = self.accounts.read().unwrap();
        accounts.values().cloned().collect()
    }
    
    /// Get total storage used
    pub fn total_storage_used(&self) -> u64 {
        let accounts = self.accounts.read().unwrap();
        accounts.values().map(|a| a.storage_used).sum()
    }
    
    /// Get account count
    pub fn account_count(&self) -> usize {
        let accounts = self.accounts.read().unwrap();
        accounts.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[test]
    fn test_recovery_phrase_generation() {
        let phrase = RecoveryPhrase::generate_12();
        assert_eq!(phrase.words.len(), 12);
        assert!(phrase.validate());
        
        let phrase24 = RecoveryPhrase::generate_24();
        assert_eq!(phrase24.words.len(), 24);
        assert!(phrase24.validate());
    }
    
    #[test]
    fn test_account_creation() {
        let dir = tempdir().unwrap();
        let manager = AccountManager::new(dir.path()).unwrap();
        
        let (account, phrase) = manager.create_account(
            "TestUser".to_string(),
            "password123"
        ).unwrap();
        
        assert_eq!(account.display_name, "TestUser");
        assert_eq!(account.status, AccountStatus::Active);
        assert!(phrase.validate());
    }
    
    #[test]
    fn test_login() {
        let dir = tempdir().unwrap();
        let manager = AccountManager::new(dir.path()).unwrap();
        
        let (account, _phrase) = manager.create_account(
            "TestUser".to_string(),
            "password123"
        ).unwrap();
        
        // Login with correct password
        let logged_in = manager.login(&account.account_id, "password123").unwrap();
        assert_eq!(logged_in.account_id, account.account_id);
        
        // Login with wrong password
        let result = manager.login(&account.account_id, "wrongpassword");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_storage_quota() {
        let phrase = RecoveryPhrase::generate_12();
        let mut account = UserAccount::new(&phrase, "Test".to_string());
        
        // Free tier = 10GB
        assert_eq!(account.tier.quota_bytes(), 10 * 1024 * 1024 * 1024);
        
        // Add storage
        account.add_storage(5 * 1024 * 1024 * 1024).unwrap(); // 5GB
        assert_eq!(account.storage_used, 5 * 1024 * 1024 * 1024);
        
        // Try to exceed quota
        let result = account.add_storage(10 * 1024 * 1024 * 1024); // 10GB more
        assert!(result.is_err());
    }
    
    #[test]
    fn test_recovery() {
        let dir = tempdir().unwrap();
        let manager = AccountManager::new(dir.path()).unwrap();
        
        let (account, phrase) = manager.create_account(
            "TestUser".to_string(),
            "password123"
        ).unwrap();
        
        // Recover with phrase
        let recovered = manager.recover_account(
            &phrase.to_string(),
            "newpassword456"
        ).unwrap();
        
        assert_eq!(recovered.account_id, account.account_id);
        
        // Login with new password
        let logged_in = manager.login(&account.account_id, "newpassword456").unwrap();
        assert_eq!(logged_in.account_id, account.account_id);
    }
}
