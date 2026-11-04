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
The processing queue and browser do not yet consume this index. No new arbitrary
filesystem HTTP endpoint was introduced.

Linux worker admission now checks readable standard cgroup v1/v2 memory limits,
including visible ancestor limits. Host free memory alone can over-admit workers
inside a small container. This remains advisory, not process isolation. Custom
cgroup mount layouts and live container execution require further validation.

Existing recovery/UI modifications in the active workspace were preserved and
excluded from this increment's isolated review branch. Workspace regression
results may include those concurrent changes; isolated change tests are separate.
