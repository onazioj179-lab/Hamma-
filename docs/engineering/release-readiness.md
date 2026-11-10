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
