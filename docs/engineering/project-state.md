# Project state — 2026-11-04

Status: PARTIAL. Release acceptance has not been achieved.

The application is React/TypeScript plus a local Python HTTP service, SQLite,
C++20 Zstandard subprocess runtime, optional FFmpeg/ffprobe and Python archive
libraries. The native runtime is not a universal conversion kernel. The separate
singularity-pack checkout was not modified.

This engineering increment implements a real, operator-invoked local directory
index in processor/indexing.py: bounded discovery, transactional replay,
configurable entry quotas, stable disk IDs, keyset pages, JSON Lines manifests,
link exclusion and explicit per-entry errors. Run:

```
python -m processor.indexing AUTHORIZED_FOLDER --database PRIVATE_INDEX.sqlite3 --max-entries 10000000 > manifest.jsonl
```

The database must be outside the source tree. Keep it private. Reusing it resumes
unfinished directories. Stop discovery before starting another discoverer against
that database. This is a stable-tree inventory, not a filesystem snapshot or a
folder change detector. Quota failures preserve earlier committed batches.
Directory errors remain explicit in the manifest; CLI exits nonzero for errors.
The existing scheduler consumes this index for operator-authorized TAR-family
jobs. Browser source arrays and ZIP metadata remain separate limitations. No
arbitrary filesystem HTTP endpoint was introduced.

Linux worker admission now checks readable standard cgroup v1/v2 memory limits,
including visible ancestor limits. Host free memory alone can over-admit workers
inside a small container. This remains advisory, not process isolation. Custom
cgroup mount layouts and live container execution require further validation.

Existing recovery/UI modifications in the active workspace were preserved and
excluded from this increment's isolated review branch. Workspace regression
results may include those concurrent changes; isolated change tests are separate.


## Indexed processing follow-up - 2026-11-04

Status: PARTIAL. The prior index-to-job gap is now implemented for operator-
authorized TAR-family jobs: bounded discovery and archive manifests, scheduler
integration, indexed manifest pages, storage accounting and checkpoint retention.
See local-indexed-jobs.md for exact scope and validation. Browser source arrays,
ZIP metadata, distributed execution and remaining release requirements are still
open. This update supersedes earlier statements that no processing path consumes
the index; it does not mark the complete platform verified.
