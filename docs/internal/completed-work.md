# Completed authorized work

## Worker recovery follow-up (2026-11-02)

Worker creation/start failures now mark the affected job interrupted with retry guidance and a finish timestamp, then continue scheduling other jobs. Restart recovery removes unfinished output and expanded files even when a crash followed persistence of a failed/cancelled/interrupted state. Completed downloads and queued jobs survive recovery. Retry clears prior start/finish timestamps. Regression coverage verifies worker-start failures, successful retry, restart cleanup and completed-output checksums. Missing/incomplete input regression coverage also protects the repaired job intake validation.

Implemented session-owned SPK output URLs, independent batch results, history visibility separate from file lifetime, deletion controls, operation/download filters, metadata durations/file counts, cancellation isolation, correct byte-per-second progress units, expired upload recreation, early abort and network deadlines, reconnect refresh, live processor status and Overview synchronization.

Implemented launcher serialization, live-instance/process-start validation, processor code revision checking and local instance-bound restart preparation. Added focused regressions. No new engine language, index database, distributed system, analytics or product feature candidate was activated from the proposal list.

## Approved API reliability batch

Rejected non-object JSON with HTTP 400 instead of server exceptions; added configurable `HAMMA_REQUESTS_PER_MINUTE` (default remains 2000), expired-window cleanup and HTTP Retry-After for throttled requests; exposed retry guidance without automatic mutation resubmission; preserved AbortError when cancellation interrupts response parsing. Added two server and two client regression tests. Collected the checked 4 MiB baseline without claiming improvements.

## Upload and queue recovery batch

Expired or missing upload bodies now return HTTP 410 before cleanup; job submission rejects missing input bodies. Retrying failed jobs respects the same 100-active/paused-job queue limit as new submissions. Upload chunks no longer retry permanent or throttling responses; transient retries use short exponential backoff with immediate cancellation. Existing committed byte offsets are reconciled before retrying. The shared checkout also received worker-start/crash cleanup fixes; combined processor regression coverage passed without discarding those edits.
