# Security review — PARTIAL

Existing owner checks, CSRF/origin guards, path validation, archive expansion
budgets, retention rules and verified-download gating were retained.

New failure records contain opaque job/upload IDs, processing stage, category and
retry eligibility. Worker logs now use job ID and category without exception
tracebacks that can contain private paths. Unknown exceptions return a fixed
message. Detailed media tool logs still exist in owner-scoped temporary storage;
this change does not claim a comprehensive logging audit.

New admission controls inspect available memory and free disk space; they do not
replace OS isolation or prevent other processes consuming resources afterward.
Windows whole-process memory enforcement and container-aware memory admission
remain unverified. Linux host memory does not reflect a smaller cgroup limit.

Encryption at rest, encrypted recovery vault, cross-host worker isolation,
provider credential handling and externally accessible sharing are NOT VERIFIED.
No production deployment, destructive migration, paid service or user-data
deletion was performed.

Project recovery is scoped by the server's authenticated/guest owner, with revision
checks, a 20-project owner limit, a 10,000-project installation limit, per-project
file limits and one reference per upload per project. Recovery stores references
and settings, not extra copies of private files, cookies or browser credentials.
Complete uploads are hashed before checkpointing; workers still verify their
contents before processing. Expiry is never extended. Old-owner server-only input
references are cleared from the UI during account changes. Recovery is not an
encrypted vault or a guarantee of continued execution after an iPhone closes.
