# Account storage and authentication

The optional Rust backend now persists accounts in SQLite. The local free
workspace remains independent of accounts and the server.

## Implemented

- `SPK_ACCOUNT_DB` selects the database file; the default is
  `data/accounts.sqlite3`. Runtime data is ignored by Git.
- A versioned schema stores account records and indexes recovery hashes uniquely.
  Startup rejects a newer schema version or an unreadable database. It never
  silently falls back to memory-only storage.
- SQLite WAL mode and FULL synchronization are configured. Every quota or
  counter change reads and updates its record in one immediate transaction.
  Arithmetic failures roll back without changing the stored record.
- SQL values are bound parameters. Account IDs use UUID randomness and database
  uniqueness prevents replacing another account on collision.
- Argon2id passwords use independent random salts. Hashing/verification run on
  blocking workers with a shared two-operation semaphore. Expensive password
  work does not hold database locks or execute on the async request threads.
- Database work also runs off the async executor. Async admission queues calls
  before they consume a blocking thread waiting for the same connection.
- Recovery secrets now contain 24 randomly chosen words. The recovery hash,
  not the secret, is persisted. The response reveals the secret only on creation.
- Login and recovery return a `session_token`. Account metadata requires
  `Authorization: Bearer <session_token>` for the matching account. A token for
  one account cannot access another. POST `/api/account/logout` revokes a token.
- Sessions store token hashes in bounded process memory, expire after 24 hours,
  and become invalid when the password changes or the server restarts.
  Clients must log in again after restart. Tokens are not written to the database.
- Display names and password sizes are bounded. File counters use checked
  updates; quotas use checked unsigned addition and saturating subtraction.

## Verification

Tests exercise unique password salts, wrong-password rejection, recovery
invalidating the old password and sessions, account isolation, logout,
reopening the database after service shutdown, concurrent updates through two
connections, and overflow rollback. Run:

```sh
cargo test -p spk-backend --locked
```

The old service had no durable account database to migrate. Accounts that existed
only in a previous process cannot be recovered from nonexistent disk records.
No legacy SHA-256 password is accepted as an Argon2 credential.

## Remaining boundaries

This persists account metadata and authenticates the account-read endpoint.
File payload storage, quota reconciliation with actual disk files, remote file
ownership checks, authenticated sessions across multiple API instances, backups,
and production deployment review remain separate work. The legacy file/mesh/
prototype endpoints are not certified by these account tests. Do not interpret
SQLite persistence as completed cloud storage or a whole-platform security audit.

The other agent's processor and frontend files are excluded from this change.
