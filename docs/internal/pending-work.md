# Pending and blocked work

## SHANTE brief follow-up (2026-11-02)

The new SHANTE master brief explicitly authorizes native-engine implementation.
The C++20 Zstandard kernel and durable-worker integration are now implemented
and locally verified. See shante-implementation.md and native/README.md for the
executed checks, release artifact and remaining master-brief requirements.
This authorization supersedes the older proposal-only restriction for that
requested work; the 100 discovery entries are not automatically marked done.

## Reliability follow-up (2026-11-02)

Branch `codex/remaining-reliability-fixes` addresses specific remaining gaps in IMP-036 (retry queue capacity), IMP-045 (cleanup after crashes), IMP-070 (bounded upload retries), and IMP-091/092 (worker launch failures and recovery). These items remain partially implemented: this batch does not provide resumable compression checkpoints or automatic replay of interrupted processing.

Next engineering checks: crash durability during output publication (IMP-048), disk-space preflight under concurrent workloads (IMP-043), native Rust/WASM validation and cross-platform release checks (IMP-098/099). Physical phone and browser save completion still require their actual environments. The 100-proposal document remains the discovery inventory; this follow-up does not mark all candidates complete.

Final processor deployment and launcher reuse completed. Changes are committed for review in PR #8; merging remains the owner’s action.
Blocked by available test environment: physical iPhone/Android verification and native browser file-save completion. The embedded browser cannot confirm blob saves, and the Chrome UI helper could not restore the minimized window.
Unapproved candidates: all new product features and major redesigns in 100-improvement-proposals.md. Choose scoped work explicitly before implementation. Native Rust/WASM, supply-chain scans, performance baselines and public deployment remain unverified rather than implicitly complete.
