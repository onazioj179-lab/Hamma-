# Indexed directory jobs

Status: PARTIAL. The directory index now drives real TAR-family compression in
the existing durable scheduler. The browser upload workflow and ZIP central
directory are still memory backed and do not inherit this scalability claim.

## Operator workflow

Stop the other server using the same processor data directory, then run:

```
python -m processor.local_job AUTHORIZED_FOLDER --data PRIVATE_DATA --target tar.gz
```

Supported targets: tar, tar.gz, tar.bz2, tar.xz. The command prints the durable job
ID and owner, then its verified artifact path when completed. It never deletes
source files. Use `--owner OWNER_ID --project PROJECT_ID` to explicitly associate
an operator-authorized job with an existing local scope. The operator already
controls the host; no HTTP client can pass a root path or choose another owner.

Resume with the same source/data/owner and `--resume-job JOB_ID`. Completed jobs
return the existing output; interrupted discovery replays unfinished directories.
Compression retries rebuild the archive from its source index. This is not
mid-codec continuation. Changed inputs fail verification; create a fresh job to
reindex changed content. A stable source tree is required, not a snapshot claim.

The command owns the same exclusive data-directory lock as the HTTP service and
uses normal worker scheduling, quotas, project fairness, retention and states.
Browser monitoring/downloads for an explicitly associated owner are available
when the HTTP service is subsequently started. Default operator history is a
separate scope. No cloud/distributed executor or browser folder bridge is added.

## Resource policy

Preserved defaults are policy, not demonstrated maximum capacity. Explicit
operator environment configuration is read by both the server and local command:

| Setting | Environment variable |
| --- | --- |
| Logical files/directories | SHANTE_MAX_FILES |
| Aggregate input bytes | SHANTE_MAX_INPUT_BYTES |
| Output bytes | SHANTE_MAX_OUTPUT_BYTES |
| Stored upload/output/index bytes | SHANTE_MAX_STORAGE_BYTES |
| Job time | SHANTE_MAX_JOB_SECONDS |
| Archive expansion ratio | SHANTE_MAX_EXPANSION_RATIO |
| Archive recursion depth | SHANTE_MAX_ARCHIVE_DEPTH |

For example, setting SHANTE_MAX_FILES to 10000000 configures an admission quota;
it does not establish that workload as verified. Use the same policy after a
restart. Resource probes and free-space checks still apply. Metadata is charged
to storage at durable batch boundaries, with bounded batch overshoot possible.
These checks are advisory preflight/accounting, not OS filesystem quotas.

## Integrity and security

Discovery, archive path conflicts and output SHA-256 manifests stay disk backed.
TAR writer and reader member caches are cleared after each entry. Processing reads
one file at a time, retains ancestor handles, rejects links/reparse points and
special files, and verifies source size/mtime against discovery. Windows handles
block ancestor replacement during reads; POSIX uses relative no-follow opens.
This is not an OS sandbox or a complete defense against an adversarial host.

The archive is decoded and compared in order against disk-backed names, types,
sizes and SHA-256 values before exclusive atomic publication. Verification
reads compressed streams through EOF to check the codec trailer. A whole-output
SHA-256 gates the normal download state. Failed or cancelled jobs cannot download
partial outputs. Every discovered entry must be supported; links/errors are not
silently omitted. Unsupported paths/formats fail explicitly.

Indexed manifest API: existing owner-scoped `GET /api/process/jobs/ID/manifest`
returns a bounded first page with `total` and `nextCursor`. Follow
`?after=CURSOR&limit=100` (maximum 1000). Incomplete/expired manifests return 410.
Normal job/history responses contain counts, not every filename or local root.
Deletion/expiry clears the stored index and root reference, preserving originals.

## Validation

Run `python -m unittest discover -s processor/tests -p test_indexed_jobs.py -v`
to exercise all four TAR variants, paged manifests, owner isolation, interrupted
job recovery, storage exhaustion, and publication failures on corrupt payloads
or a corrupt gzip trailer. The CLI regression runs a real scheduled worker
with a controlled admission probe.

The repeatable real-payload command is:

```
python -m processor.indexed_benchmark --files 10000 --output validation/indexed-tar-10000.json
```

This creates deterministic random 4096-byte payloads, discovers directories,
processes and verifies TAR.GZ, then independently checks extracted payload hashes.
Fixture generation and independent post-run verification are outside its timed
interval. Tracemalloc excludes native SQLite/codec memory and OS caches. This is
Python/library processing, not a native C++ throughput result.

The safe-opener leak regression repeats opens, checks retained Python memory and
verifies Windows handles were released. Unicode normalization is applied to archive
names while preserving the original filesystem spelling when opening sources.
