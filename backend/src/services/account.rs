//! Account Service
//! Handles account creation, authentication, and storage management

use super::account_repository::AccountRepository;
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};

use rand::Rng;
use sha2::{Digest, Sha256};

fn password_slots() -> std::sync::Arc<tokio::sync::Semaphore> {
    static SLOTS: std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>> =
        std::sync::OnceLock::new();
    SLOTS
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
}

/// Account information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
    InvalidDisplayName,
    InternalError,
}

impl std::fmt::Display for AccountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AccountError::InvalidDisplayName => {
                write!(f, "Display name must contain 1 to 80 characters")
            }
            AccountError::InternalError => write!(f, "Account operation could not be completed"),
            AccountError::InvalidCredentials => write!(f, "Invalid credentials"),
            AccountError::AccountNotFound => write!(f, "Account not found"),
            AccountError::AccountExists => write!(f, "Account already exists"),
            AccountError::InvalidRecoveryPhrase => write!(f, "Invalid recovery phrase"),
            AccountError::StorageFull => write!(f, "Storage quota exceeded"),
            AccountError::InvalidPassword => write!(
                f,
                "Password must be at least 8 characters with uppercase, lowercase, and number"
            ),
        }
    }
}

/// Storage tier quotas in bytes
const TIER_QUOTAS: &[(&str, u64)] = &[
    ("free", 10 * 1024 * 1024 * 1024),  // 10GB
    ("basic", 50 * 1024 * 1024 * 1024), // 50GB
    ("pro", 100 * 1024 * 1024 * 1024),  // 100GB
    ("enterprise", u64::MAX),           // Unlimited
];

/// BIP39-like word list for recovery phrases
const WORD_LIST: &[&str] = &[
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd",
    "abuse", "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire",
    "across", "act", "action", "actor", "actress", "actual", "adapt", "add", "addict", "address",
    "adjust", "admit", "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid",
    "again", "age", "agent", "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
    "alert", "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also",
    "alter", "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor",
    "ancient", "anger", "angle", "angry", "animal", "ankle", "announce", "annual", "another",
    "answer", "antenna", "antique", "anxiety", "any", "apart", "apology", "appear", "apple",
    "approve", "april", "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
    "army", "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact", "artist",
    "artwork", "ask", "aspect", "assault", "asset", "assist", "assume", "asthma", "athlete",
    "atom", "attack", "attend", "attitude", "attract", "auction", "audit", "august", "aunt",
    "author", "auto", "autumn", "average", "avocado", "avoid",
];

/// Account service
struct Session {
    account_id: String,
    credential: String,
    expires: std::time::Instant,
}
pub struct AccountService {
    repository: AccountRepository,
    sessions: std::sync::Mutex<std::collections::HashMap<String, Session>>,
}
impl AccountService {
    pub fn new() -> Self {
        #[cfg(test)]
        let repository = AccountRepository::memory().expect("test account database");
        #[cfg(not(test))]
        let repository = AccountRepository::open(
            &std::env::var_os("SPK_ACCOUNT_DB")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| "data/accounts.sqlite3".into()),
        )
        .expect("account database initialization failed; refusing memory-only fallback");
        Self {
            repository,
            sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
    pub fn open(path: &std::path::Path) -> Result<Self, AccountError> {
        Ok(Self {
            repository: AccountRepository::open(path)?,
            sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    pub fn issue_session(&self, account: &Account) -> Result<String, AccountError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AccountError::InternalError)?;
        let now = std::time::Instant::now();
        sessions.retain(|_, session| session.expires > now);
        if sessions.len() >= 4096 {
            return Err(AccountError::InternalError);
        }
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        sessions.insert(
            hash,
            Session {
                account_id: account.account_id.clone(),
                credential: account.password_hash.clone(),
                expires: now + std::time::Duration::from_secs(86400),
            },
        );
        Ok(token)
    }
    pub fn revoke_session(&self, token: &str) -> Result<(), AccountError> {
        self.sessions
            .lock()
            .map_err(|_| AccountError::InternalError)?
            .remove(&hex::encode(Sha256::digest(token.as_bytes())));
        Ok(())
    }
    pub async fn authenticate(
        &self,
        token: &str,
        account_id: &str,
    ) -> Result<Account, AccountError> {
        if token.len() != 64 {
            return Err(AccountError::InvalidCredentials);
        }
        let credential = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| AccountError::InternalError)?;
            let hash = hex::encode(Sha256::digest(token.as_bytes()));
            let session = sessions
                .get(&hash)
                .ok_or(AccountError::InvalidCredentials)?;
            if session.account_id != account_id || session.expires <= std::time::Instant::now() {
                return Err(AccountError::InvalidCredentials);
            }
            session.credential.clone()
        };
        let account = self.repository.get(account_id.to_owned()).await?;
        if account.password_hash != credential {
            return Err(AccountError::InvalidCredentials);
        }
        Ok(account)
    }

    /// Generate a 24-word recovery secret (168 bits from this 128-word list).
    fn generate_recovery_phrase() -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..24)
            .map(|_| WORD_LIST[rng.gen_range(0..WORD_LIST.len())].to_string())
            .collect()
    }

    /// Globally random IDs; database uniqueness prevents accidental replacement.
    fn generate_account_id() -> String {
        format!("SPK-{}", uuid::Uuid::new_v4().simple())
    }

    /// Memory-hard password hashing runs off the async request executor.
    async fn hash_password(password: String) -> Result<String, AccountError> {
        let permit = password_slots()
            .acquire_owned()
            .await
            .map_err(|_| AccountError::InternalError)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let salt = SaltString::generate(&mut rand::rngs::OsRng);
            Argon2::default()
                .hash_password(password.as_bytes(), &salt)
                .map(|hash| hash.to_string())
                .map_err(|_| AccountError::InternalError)
        })
        .await
        .map_err(|_| AccountError::InternalError)?
    }

    async fn verify_password(password: String, stored: String) -> Result<bool, AccountError> {
        let permit = password_slots()
            .acquire_owned()
            .await
            .map_err(|_| AccountError::InternalError)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let hash = PasswordHash::new(&stored).map_err(|_| AccountError::InvalidCredentials)?;
            Ok(Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok())
        })
        .await
        .map_err(|_| AccountError::InternalError)?
    }

    /// Hash recovery phrase
    fn hash_recovery(phrase: &[&str]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(phrase.join(" ").as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Validate password strength
    fn validate_password(password: &str) -> bool {
        password.len() <= 1024
            && password.len() >= 8
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
    pub async fn create_account(
        &self,
        display_name: &str,
        password: &str,
    ) -> Result<(Account, Vec<String>), AccountError> {
        if display_name.trim().is_empty() || display_name.chars().count() > 80 {
            return Err(AccountError::InvalidDisplayName);
        }
        if !Self::validate_password(password) {
            return Err(AccountError::InvalidPassword);
        }

        let account_id = Self::generate_account_id();
        let recovery_phrase = Self::generate_recovery_phrase();
        let password_hash = Self::hash_password(password.to_owned()).await?;
        let recovery_hash = Self::hash_recovery(
            &recovery_phrase
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>(),
        );

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

        self.repository.insert(account.clone()).await?;

        Ok((account, recovery_phrase))
    }

    /// Login with account ID and password
    pub async fn login(&self, account_id: &str, password: &str) -> Result<Account, AccountError> {
        let stored = self
            .repository
            .get(account_id.to_owned())
            .await
            .map_err(|error| match error {
                AccountError::AccountNotFound => AccountError::InvalidCredentials,
                other => other,
            })?
            .password_hash;
        if password.len() > 1024
            || !Self::verify_password(password.to_owned(), stored.clone()).await?
        {
            return Err(AccountError::InvalidCredentials);
        }
        self.repository
            .update(account_id.to_owned(), move |account| {
                if account.password_hash != stored {
                    return Err(AccountError::InvalidCredentials);
                }
                account.last_active = chrono::Utc::now().timestamp_millis();
                Ok(())
            })
            .await
    }

    /// Recover account with recovery phrase
    pub async fn recover_account(
        &self,
        phrase: &[&str],
        new_password: &str,
    ) -> Result<Account, AccountError> {
        if phrase.len() != 12 && phrase.len() != 24 {
            return Err(AccountError::InvalidRecoveryPhrase);
        }

        if !Self::validate_password(new_password) {
            return Err(AccountError::InvalidPassword);
        }

        let recovery_hash = Self::hash_recovery(phrase);

        let account = self.repository.by_recovery(recovery_hash).await?;
        let password_hash = Self::hash_password(new_password.to_owned()).await?;
        self.repository
            .update(account.account_id, move |account| {
                account.password_hash = password_hash;
                account.last_active = chrono::Utc::now().timestamp_millis();
                Ok(())
            })
            .await
    }

    /// Get account info
    pub async fn get_account(&self, account_id: &str) -> Result<Account, AccountError> {
        self.repository.get(account_id.to_owned()).await
    }

    /// Update storage usage
    pub async fn update_storage(
        &self,
        account_id: &str,
        bytes_added: i64,
    ) -> Result<(), AccountError> {
        self.repository
            .update(account_id.to_owned(), move |account| {
                let new_usage = if bytes_added >= 0 {
                    account
                        .storage_used
                        .checked_add(bytes_added as u64)
                        .ok_or(AccountError::StorageFull)?
                } else {
                    account
                        .storage_used
                        .saturating_sub(bytes_added.unsigned_abs())
                };
                if new_usage > account.storage_quota {
                    return Err(AccountError::StorageFull);
                }

                account.storage_used = new_usage;
                Ok(())
            })
            .await
            .map(|_| ())
    }

    /// Increment file count
    pub async fn add_file(&self, account_id: &str, is_archive: bool) -> Result<(), AccountError> {
        self.repository
            .update(account_id.to_owned(), move |account| {
                let files = account
                    .file_count
                    .checked_add(1)
                    .ok_or(AccountError::StorageFull)?;
                let archives = if is_archive {
                    account
                        .archive_count
                        .checked_add(1)
                        .ok_or(AccountError::StorageFull)?
                } else {
                    account.archive_count
                };
                account.file_count = files;
                account.archive_count = archives;

                Ok(())
            })
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod accounting_tests {
    use super::*;
    #[tokio::test]
    async fn rejects_overflow_without_mutating_usage() {
        let service = AccountService::new();
        let (account, _) = service.create_account("test", "Password123").await.unwrap();
        service
            .repository
            .update(account.account_id.clone(), |stored| {
                stored.storage_used = u64::MAX;
                stored.storage_quota = u64::MAX;
                Ok(())
            })
            .await
            .unwrap();
        assert!(matches!(
            service.update_storage(&account.account_id, 1).await,
            Err(AccountError::StorageFull)
        ));
        assert_eq!(
            service
                .get_account(&account.account_id)
                .await
                .unwrap()
                .storage_used,
            u64::MAX
        );
        service
            .update_storage(&account.account_id, i64::MIN)
            .await
            .unwrap();
        assert_eq!(
            service
                .get_account(&account.account_id)
                .await
                .unwrap()
                .storage_used,
            i64::MAX as u64
        );
    }
}

#[cfg(test)]
mod password_tests {
    use super::*;
    #[tokio::test]
    async fn salts_passwords_and_recovery_revokes_old_password() {
        let service = AccountService::new();
        let (first, phrase) = service.create_account("one", "Password123").await.unwrap();
        let (second, _) = service.create_account("two", "Password123").await.unwrap();
        assert!(first.password_hash.starts_with("$argon2id$"));
        assert_ne!(first.password_hash, second.password_hash);
        assert!(service.login(&first.account_id, "wrong").await.is_err());
        assert!(service
            .login(&first.account_id, "Password123")
            .await
            .is_ok());
        let logged_out = service.issue_session(&first).unwrap();
        service.revoke_session(&logged_out).unwrap();
        assert!(service
            .authenticate(&logged_out, &first.account_id)
            .await
            .is_err());
        let token = service.issue_session(&first).unwrap();
        assert!(service
            .authenticate(&token, &first.account_id)
            .await
            .is_ok());
        assert!(service
            .authenticate(&token, &second.account_id)
            .await
            .is_err());
        let words: Vec<&str> = phrase.iter().map(String::as_str).collect();
        service
            .recover_account(&words, "Different456")
            .await
            .unwrap();
        assert!(service
            .login(&first.account_id, "Password123")
            .await
            .is_err());
        assert!(service
            .login(&first.account_id, "Different456")
            .await
            .is_ok());
        assert!(service
            .authenticate(&token, &first.account_id)
            .await
            .is_err());
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    #[tokio::test]
    async fn persists_accounts_and_atomic_updates_across_connections() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.sqlite3");
        let first = AccountService::open(&path).unwrap();
        let (account, _) = first
            .create_account("persistent", "Password123")
            .await
            .unwrap();
        first
            .update_storage(&account.account_id, 123)
            .await
            .unwrap();
        drop(first);
        let second = AccountService::open(&path).unwrap();
        assert_eq!(
            second
                .login(&account.account_id, "Password123")
                .await
                .unwrap()
                .storage_used,
            123
        );
        let third = AccountService::open(&path).unwrap();
        let (a, b) = tokio::join!(
            second.update_storage(&account.account_id, 10),
            third.update_storage(&account.account_id, 20)
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(
            second
                .get_account(&account.account_id)
                .await
                .unwrap()
                .storage_used,
            153
        );
    }
}
