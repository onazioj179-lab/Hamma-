# HAMMA release readiness

## Web release evidence — 2026-11-12

The release remains open. The [web engineering audit](hammer-directive-audit.md)
defines the six acceptance areas. See the [local test report](../../validation/hamma-operational-readiness.json)
for measured results.

| Area | Evidence | Remaining acceptance |
| --- | --- | --- |
| Mixed project recovery | Chromium, Firefox, and WebKit reopened a project with an unstarted file, a partial upload, and a completed upload. The partial file continued from 4 MiB and the completed file sent no further bytes. The downloaded ZIP contained all three original files. In Chromium, one injected admission rejection left the other TIFF job independent, and a file-only retry completed the rejected job. | Verify the flow on physical devices. Exercise interrupted transfers and per-file retry under sustained mixed-project load. |
| Browser job scale | Chromium submitted 225 files in three selection pages and verified every ZIP entry. In a separate one-slot run, a guest with one project received a turn between another guest's bulk jobs. All 11 ZIPs restored byte-for-byte, and the other guest was denied each download. | Bound the sealed selection and admission input list. Measure sustained mixed and large-payload workloads. |
| Responsive UI and devices | Chromium, Firefox, and WebKit each passed 112 layouts across eight views, seven widths, and two themes with reduced motion. The skip link moved focus to the main content in all three. Headless WebKit required explicit focus on the link. In Chromium at 375 px, the folder picker fallback preserved a nested path and file bytes. | Verify native Tab order in Safari, plus file picking, touch, fold transitions, and recovery on the physical device matrix. Reproducing the reported image failures requires the original files and phone diagnostics. |
| Worker isolation and dependencies | Windows CLI and C ABI contracts passed. The processor tests cover worker limits, ownership, signed downloads and transport. Client disconnects close quietly. The web npm audit returned zero findings, and the SHANTE dependency check returned no advisories for its pinned Zstandard source. | Validate filesystem and network isolation for the deployment model and expand the dependency inventory, SBOM and fuzz coverage. |
| Formats and fidelity | The TIFF codec test round-trips 16-bit RGBA pixels and rejects a multipage source. Eight loopback clients completed 100 ZIP, gzip, bzip2, and XZ jobs with exact restoration, SHA-256, and range checks. HAMMA and bsdtar 3.8.9 verified exact extraction in both directions for ZIP, TAR, TAR.GZ, TAR.BZ2, and TAR.XZ. | Expand interoperability fixtures and cover encryption, split/join, broader codecs, and isolated PDF and Office conversion. |
| Production operations | A disposable Windows loopback upgrade added the dispatch index and passed SQLite quick_check. The guest downloaded the same verified ZIP after upgrade and after restoring a pre-upgrade snapshot to the old version. The old version ran a new job after rollback. Web CI runs lint. | Repeat the drill with the chosen release and target environment. Validate monitored alerts, retention, backup restore, and multi-node recovery with authorized infrastructure. |

For a local rollback drill, finish the test jobs and wait for the worker count
to reach zero. Stop the processor, copy its complete data directory, and keep
the source version and port recorded. Start the candidate against the working
copy and verify health, SQLite integrity, and a known download. Stop it before
restoring the pre-upgrade snapshot to a separate directory. Start the previous
version on the same port with that restored copy and verify the known download
and a new job. Keep the upgraded directory for diagnosis. Use disposable
fixtures for the drill.

Reproduce the two-owner worker test with
`python -m processor.scheduler_benchmark --multiple-owners --output report.json`.
The one-slot fixture checks dispatch order, owner boundaries and exact bytes.

## Historical baseline — 2026-11-04

Status: PARTIAL. SHANTE is not production complete.

Verified this increment: directory index unit/real-crash tests; cgroup admission
fixture tests; existing native CTest; current-workspace processor regression;
TypeScript typecheck and production web build. Detailed scale data and caveats
are in large-scale-tests.md and the JSON validation artifacts.

Local build artifacts remain web/dist and native/build/shante-core.exe. Native
build reported no work required, then native_contract passed. No binary or source
was deployed. The new index is a Python runtime component and CLI, not a native
kernel scheduler or a browser upload replacement.

Open acceptance includes processing-scale integration, native runtime breadth,
full media/archive matrix, complete project checkpoint semantics, real large-file
and distributed workloads, hardware fallback matrix, mobile/device QA, secure
public hosting, OS sandboxing and unfinished product capabilities. See
completion-matrix.md and unfinished-work.md. Marking the full directive COMPLETE
or VERIFIED would be inaccurate.

Verification detail: current workspace frontend suite passed 476 tests with 23
skipped; processor suite passed 124 tests with 9 optional skips. Isolated new
index/cgroup/resource suites ran 13 tests: 12 passed and 1 symlink test skipped.
TypeScript typecheck and web production build passed. Native contract 1/1 passed.
Production npm audit reported zero vulnerabilities.

Lint status: FAILED. The existing npm lint command invokes ESLint, but neither
its dependency nor a configuration is present. This is an unresolved repository
check, not a successful lint result. Full native sanitizers and physical device
QA were not performed.
