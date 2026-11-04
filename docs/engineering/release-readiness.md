# Release readiness — 2026-11-04

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


## Indexed processing follow-up - 2026-11-04

Status: PARTIAL. The prior index-to-job gap is now implemented for operator-
authorized TAR-family jobs: bounded discovery and archive manifests, scheduler
integration, indexed manifest pages, storage accounting and checkpoint retention.
See local-indexed-jobs.md for exact scope and validation. Browser source arrays,
ZIP metadata, distributed execution and remaining release requirements are still
open. This update supersedes earlier statements that no processing path consumes
the index; it does not mark the complete platform verified.

Indexed follow-up validation: full processor suite ran 139 tests, OK with 10
skips (optional OAuth and unavailable symlink creation). The latest targeted
suite ran 12 tests, all passed, covering the final binding cache and Unicode
source-path changes after the full-suite run started. Python compilation and
diff whitespace checks passed. No frontend/native code changed in this follow-up;
the prior web/native build results are not claimed as a new rebuild.

The production-scale readiness gates remain open, including the existing missing
ESLint setup, browser source virtualization, bounded ZIP/extraction manifests,
physical device QA, public-host sandboxing and distributed infrastructure.

The final discovery suite passed six tests with one unavailable-symlink skip
after removing a redundant full count on index reopen. The final real-payload
repeat verified 10,000 checksums and measured a 3,577,722-byte traced allocation
peak. Timing increased; release performance targets are not accepted by this
single-machine benchmark. Source review branch remains scoped to this increment.

## Cross-platform CI evidence - 2026-11-04

Status: VERIFIED for the checked source revision and CI workloads. GitHub run
41811212150 passed native builds/contracts and processor integration on Windows
2022, macOS and Ubuntu, plus the native address/undefined-behavior sanitizer job,
provider-auth tests with local signing fixtures, and dependency checks.
Run: https://github.com/onazioj179-lab/Hamma-/actions/runs/41811212150
Metadata: validation/indexed-jobs-ci.json.

This supersedes the earlier statement that sanitizer execution was unavailable
for this increment. It does not verify physical mobile devices, GPU acceleration,
a long-running fuzz campaign, public-host security or distributed workloads.
The CI run precedes this documentation-only evidence update.
