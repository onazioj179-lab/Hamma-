# Universal detection and project recovery

## Implemented

One primary Add Files or Folders disclosure opens native file or folder choices.
Selections append to the current project. Existing recursive folder handling,
permissions, upload limits and virtual selection list remain active.

Detection reads at most 512 bytes per file sequentially and sends groups of at
most 32 headers to the same private processor used for jobs. The server reuses
the worker signature function and returns structured format/action hints without
storing the header, creating uploads or making jobs. Full files upload only when
the user chooses an operation. Unknown signatures and failed inspections hide
conversion/extraction; read/network errors offer Retry detection. Codec probing
and output verification still run during actual processing. A recognized signature
is not proof of valid contents. HEIC and AVIF sequences receive no video actions.
Mixed detected formats can be selected by type to reveal their compatible actions.

Projects have separate in-tab selections, selected entries, format/quality/metadata
settings and errors. The UI creates up to 20 projects in a tab. Each server job has
an owner-scoped projectId, bound into idempotency checks and retained in SQLite.
Existing records belong to the default project. Jobs rediscover their projects
when reloaded; the history screen continues to show all owner-authorized projects.

Scheduling retains the existing two-worker/global and guest/free concurrency
limits. Dispatch chooses projects by least recent scheduling time, then oldest
job, while retaining owner fairness and admission limits. One long running job is
not preempted. Project-level controls pause waiting jobs, resume waiting jobs,
cancel active jobs, retry only failed/interrupted jobs and download ready outputs.
Recovery mutations use at most four concurrent requests and leave successful
outputs intact. Summaries count actual jobs and downloads require verified output.

## Limits

File handles, unqueued selections and editable draft settings are tab-local.
Reloading requires reselecting files that were not queued. Each queued job retains
its actual settings; there is no mid-codec checkpoint, cross-device sync or promise
of mobile browser background execution. Multiple output downloads remain subject
to browser permission. SPK uses the original browser workspace (Project 1); other
projects use the server processing engines. Project lists are bounded by retained
history and are not ten-million-entry or distributed storage implementations.

## Verification

Focused frontend tests cover bounded reads, signature precedence, pending-action
hiding, project selections/settings, restored project IDs, and retrying only the
active project's failures. HTTP tests verify inspection bounds, no created uploads,
separate verified project outputs, project-aware idempotency and fair dispatch.
The full processor suite passed 103 tests, including the HEIC/sequence guard.
Four focused project tests also passed, including cancellation and retry preserving
another project output. The production build passed. Final frontend regression
counts are recorded in the PR.

Google and Apple remain unavailable until developer registration, a production
HTTPS domain and verified OAuth adapters are supplied; see account-providers.md.
Physical mobile layout and whole-process memory tests remain unverified.
