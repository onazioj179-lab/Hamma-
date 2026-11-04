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
