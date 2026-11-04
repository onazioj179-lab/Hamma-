# Project recovery (local processor API v1)

The workspace now saves project settings and recovery references on the processor.
Fully uploaded inputs can be restored after refresh without copying or uploading
their bytes again. Unfinished uploads and files not yet uploaded still require
the original local file selection after the page closes. Browser SPK tasks are
not covered by this server recovery mechanism.

Recovery uses the existing HttpOnly guest/account session, same-origin checks and
request authorization header. Project IDs do not grant access to another owner.
No credentials or file bytes are written to browser storage by this feature.

## Internal endpoints

All paths below are relative to `/api/process`. Check `projectRecovery: true` in
`GET /capabilities` before using them. These are internal application contracts,
not a published external SDK.

| Endpoint | Behavior |
| --- | --- |
| `GET /projects` | Owner's saved project settings, at most 20 records |
| `GET /projects/{id}` | Current project settings and revision |
| `PUT /projects/{id}` | Save `{revision, settings}`; creation uses revision 0 |
| `PUT /projects/{id}/inputs/{sourceId}` | Checkpoint `{upload}` after complete upload and integrity hashing |
| `GET /projects/{id}/inputs?after=&limit=100` | Cursor page with available source metadata, signature hints and unavailable count |
| `DELETE /projects/{id}/inputs/{sourceId}` | Forget a recovery reference; does not delete its source bytes |

Settings contain `target`, `conversion`, `qualityMode`, `metadataPolicy` and
`recursive`. A revision mismatch returns 409 rather than silently overwriting
another tab's settings. The client serializes its own saves and reconciles a lost
save acknowledgment against the current revision.

Source IDs and upload IDs are distinct 32-character hexadecimal identifiers.
Project IDs use 1–64 ASCII letters, digits, underscores or hyphens. Complete
checkpoint uploads are immutable through the upload API. The worker independently
checks their integrity before processing.

The recovery input page uses `nextCursor`, not the reported total, to advance.
Totals may change while expired/deleted inputs are cleaned up. A response with
`nextCursor: null` is the last page. Unavailable entries count toward `scanned`
but do not appear in `sources`; their source bytes must be selected again.

## Idempotent submission and retention

After checkpointing, `POST /jobs` accepts `recoverable: true` with the existing
project ID, upload list and operation settings. The processor derives a stable
request identity from the owner, project, input set and settings. Retrying after
a lost response, refresh or input reordering finds the same retained job.
Successful queue creation forgets only that project's recovery references.

The job commit precedes reference cleanup. If the processor stops between them,
the next identical submission finds the committed job and finishes cleanup.
Repeated identical recoverable submissions reuse that job, including completed
or failed states; use the job's retry action to rerun failed work deliberately.

References expire with the original upload, normally 24 hours, and never extend
its retention or duplicate its contents. Retained job outputs follow the existing
job retention policy. Projects have a 20-record owner limit and 10,000-record
installation limit; each project is bounded by the configured input file limit.
The workspace clears server-only recovered inputs when the owner changes.

This is not encrypted recovery storage, a remote cloud service, or a guarantee
that an iPhone can continue client processing after closing its browser.
