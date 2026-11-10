# Test results — 2026-11-04

- Baseline processor suite: 113 tests run, OK, 9 optional OAuth tests skipped.
  Started before the new failure/admission changes; not final regression proof.
- Selection/workspace/upload targeted suite after selection repair: 45 passed.
- Resource admission unit suite: 3 passed (pressure/recovery, limits, platform probe).
- Failure category suite: 2 passed (classification and private-detail suppression).
- Project suite after structured failure changes: 4 passed.
- Production web build after initial selection repair: passed.
- Existing 4 MiB ZIP benchmark: two verified outputs; see performance-baseline.md.

- Full frontend run: 35 files passed, 1 skipped; 469 tests passed, 23 skipped.
  Started before subsequent error-center changes; targeted tests below cover them.
- Rebuilt production web application with error-center changes: passed.
- Workspace/selection targeted rerun: 33 tests passed.
- Error-center interaction test: 1 passed.
- Updated project integration suite: 5 passed, including memory-pressure deferral,
  disk exhaustion and durable error/retry metadata.
- Native C++ rebuild: passed. CTest native_contract: 1/1 passed.

- Final processor regression: 119 tests run, OK, 9 optional OAuth tests skipped.
- Final selection edge-case suite: 4 passed, including 10,000 colliding filenames
  and generated folder/file collision avoidance.
- Final project summary projection check: 5 project tests passed; detailed input
  IDs remain durable but are omitted from lightweight history summaries.

- Final TypeScript typecheck: passed.
- Real 300-image desktop codec validation: 286 verified outputs, 14 deliberately
  invalid inputs failed, no additional failures. Assertions checked that only the
  first 14 invalid fixtures failed and every later fixture completed.
  JPEG/PNG/WebP/GIF/AVIF fixtures, Unicode filenames and repeated basenames in
  separate directories; sequential engine execution without browser/network.
  Duration: 389.017 seconds. Peak traced Python allocations: 2,342,923 bytes;
  excludes FFmpeg RSS. Report: validation/shante-image-batch.json.

No physical mobile test has run. This verifies desktop codec isolation, not the
reported iPhone failure, mobile memory, upload resilience or concurrency at scale.

## Recovery continuation

- New recovery HTTP integration suite: 7 passed. Covers durable settings,
  revision conflicts, owner isolation, complete/partial/expired inputs, lost
  submission acknowledgment, reordered input idempotency, limits and cursor paging.
- Workspace/account/deletion/upload regression selection: 57 passed.
- Final recovery component suite: 5 passed (refresh without reupload, account
  change, same-owner recovery after an account action, expired-input removal and
  durable empty-project creation).
- Recovery client protocol suite: 4 passed (serialized saves, lost-save response,
  changing totals/expired inputs and invalid cursor termination).
- Production web build and TypeScript typecheck passed during this continuation.
- Initial broad processor run failed the existing quota and one-tick worker tests:
  the quota test assumed full host admission and was changed to use a controlled
  two-worker budget while testing plan limits. In the worker test, a job
  correctly deferred admission remained queued because the test never ticked
  again. Updated it to exercise the production polling loop with initial memory
  pressure; focused real-worker rerun passed in 2.024 seconds. Initial evidence:
  validation/shante-recovery-processor-initial.txt.
- Broad processor rerun: 135 tests run, OK, 10 skipped, 249.801 seconds. This was
  the shared working tree and also discovered separate, concurrently developed
  indexing/container-memory tests. Those unrelated changes are not included in
  this recovery commit. Report: validation/shante-recovery-processor-results.txt.
- The final missing-folder deletion regression was added after that broad run;
  the complete 7-test recovery HTTP suite passed afterward.
- Focused account-quota test with controlled resource admission: passed.
- Final recovery HTTP rerun after the route-name edge case: 7 passed in 18.445
  seconds; validation/shante-recovery-focused-results.txt. Final typecheck passed.
