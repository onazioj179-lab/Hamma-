# Account and storage review

The optional account service currently uses in-memory HashMaps, not a durable database.
Restarting it loses its account records. Passwords currently use unsalted SHA-256;
this must be replaced with a dedicated password hashing scheme before public account use.
This review does not certify authentication or authorize exposing the server publicly.

The first implementation fix replaces signed casts in storage quota accounting
with checked unsigned addition and saturating subtraction. Rejected overflow
leaves the existing total unchanged. A regression test covers overflow and the
minimum signed delta.

Next implementation boundaries:

1. Put durable account and recovery records behind a repository interface.
2. Choose a transactional embedded database for a single server, with schema migrations,
   unique account identifiers, atomic quota updates, and restart/recovery tests.
3. Replace password hashes with a salted password KDF; define explicit migration
   behavior rather than silently accepting old hashes.
4. Add authenticated sessions and per-account authorization before exposing account
   metadata or file storage. Rate limiting alone does not establish authorization.
5. Keep file bytes separate from account metadata; write files atomically and only
   commit quota changes after successful persistence. Add rollback and backup tests.

The processor and primary app are being edited concurrently by another agent;
this pass deliberately changes the documentation, shared layout, and isolated
backend account arithmetic instead of those files.
