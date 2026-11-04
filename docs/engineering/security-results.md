# Security results — 2026-11-04

Status: PARTIAL.

Existing processor regression includes per-owner jobs/uploads/download isolation,
CSRF/origin controls, archive traversal/link rejection, malformed headers,
expansion quotas, corrupted outputs, retention and queue admission. The workspace
suite passed 124 tests, with 9 optional OAuth tests skipped. This is regression
evidence, not a penetration test or public-hosting approval.

New discovery refuses a database inside its source tree and records links/reparse
points without following them. It has no HTTP filesystem endpoint. Permission
failures become durable diagnostics. Real crash replay and quota rollback tests
passed. Actual symlink creation was unavailable on this Windows account; that
specific test is skipped. Path checks are not an OS sandbox and cannot eliminate
all concurrent filesystem mutation races. Consumers must reopen safely and
revalidate metadata. Private paths and error details in manifests require private
operator storage; do not publish raw manifests to unrelated users.

Cgroup admission tests cover finite ancestor limits, unlimited leaves, v1 memory
controllers, usage above limit, absent/malformed controls and unsafe membership
paths. They use filesystem fixtures; live Linux cgroup enforcement is unverified.

Native contract includes a deterministic malformed-frame corpus; this is not a
long-running fuzz campaign. No sanitizer run was completed in this increment.
Encryption at rest, recovery-vault encryption, full worker sandboxing, production
TLS configuration and distributed tenant isolation remain incomplete.
Dependency audit evidence: validation/shante-index-production-audit.json.

Production npm audit: VERIFIED, zero reported vulnerabilities. This covers npm
production dependencies only; Python/native/FFmpeg dependency security and full
static analysis remain PARTIAL. Existing lint command: FAILED, ESLint missing.
