//! SQLite account persistence. Every read/modify/write runs in one immediate transaction.
use super::account::{Account, AccountError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone)]
pub struct AccountRepository(Arc<Mutex<Connection>>, Arc<tokio::sync::Semaphore>);
impl AccountRepository {
    pub fn open(path: &Path) -> Result<Self, AccountError> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|_| AccountError::InternalError)?;
        }
        Self::initialize(Connection::open(path).map_err(|_| AccountError::InternalError)?)
    }
    pub fn memory() -> Result<Self, AccountError> {
        Self::initialize(Connection::open_in_memory().map_err(|_| AccountError::InternalError)?)
    }
    fn initialize(connection: Connection) -> Result<Self, AccountError> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| AccountError::InternalError)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| AccountError::InternalError)?;
        if version > 1 {
            return Err(AccountError::InternalError);
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, recovery_hash TEXT NOT NULL UNIQUE, record TEXT NOT NULL);
            PRAGMA user_version=1; COMMIT;").map_err(|_| AccountError::InternalError)?;
        Ok(Self(
            Arc::new(Mutex::new(connection)),
            Arc::new(tokio::sync::Semaphore::new(1)),
        ))
    }
    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, AccountError> + Send + 'static,
    ) -> Result<T, AccountError> {
        let permit = self
            .1
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AccountError::InternalError)?;
        let connection = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut guard = connection.lock().map_err(|_| AccountError::InternalError)?;
            work(&mut guard)
        })
        .await
        .map_err(|_| AccountError::InternalError)?
    }
    pub async fn insert(&self, account: Account) -> Result<(), AccountError> {
        self.run(move |connection| {
            let record =
                serde_json::to_string(&account).map_err(|_| AccountError::InternalError)?;
            connection
                .execute(
                    "INSERT INTO accounts(id,recovery_hash,record) VALUES (?1,?2,?3)",
                    params![account.account_id, account.recovery_hash, record],
                )
                .map_err(|_| AccountError::InternalError)?;
            Ok(())
        })
        .await
    }
    pub async fn get(&self, id: String) -> Result<Account, AccountError> {
        self.run(move |connection| read(connection, &id)).await
    }
    pub async fn by_recovery(&self, hash: String) -> Result<Account, AccountError> {
        self.run(move |connection| {
            let record: Option<String> = connection
                .query_row(
                    "SELECT record FROM accounts WHERE recovery_hash=?1",
                    [hash],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| AccountError::InternalError)?;
            serde_json::from_str(&record.ok_or(AccountError::InvalidRecoveryPhrase)?)
                .map_err(|_| AccountError::InternalError)
        })
        .await
    }
    pub async fn update(
        &self,
        id: String,
        change: impl FnOnce(&mut Account) -> Result<(), AccountError> + Send + 'static,
    ) -> Result<Account, AccountError> {
        self.run(move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| AccountError::InternalError)?;
            let mut account = read(&transaction, &id)?;
            change(&mut account)?;
            let record =
                serde_json::to_string(&account).map_err(|_| AccountError::InternalError)?;
            transaction
                .execute(
                    "UPDATE accounts SET record=?1,recovery_hash=?2 WHERE id=?3",
                    params![record, account.recovery_hash, id],
                )
                .map_err(|_| AccountError::InternalError)?;
            transaction
                .commit()
                .map_err(|_| AccountError::InternalError)?;
            Ok(account)
        })
        .await
    }
}
fn read(connection: &Connection, id: &str) -> Result<Account, AccountError> {
    let record: Option<String> = connection
        .query_row("SELECT record FROM accounts WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| AccountError::InternalError)?;
    serde_json::from_str(&record.ok_or(AccountError::AccountNotFound)?)
        .map_err(|_| AccountError::InternalError)
}
