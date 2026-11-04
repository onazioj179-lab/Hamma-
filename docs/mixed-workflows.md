# Mixed-file workflows

Add files or folders to one project and open **Mixed-file workflow** beneath the
selection. Choose an action for each file type, then choose **Run grouped
workflow**. **Leave selected** keeps that group's inputs available for another
action. Nothing starts merely because files or actions were selected.

For example, one selection can convert PNG images, extract ZIP archives and put
text documents into a new ZIP. Each group's menu comes from the processor's
signature-based capability registry. Unsupported conversions are omitted.
Documents and PDFs can be archived; this does not add PDF optimization or
document conversion. Available media formats still depend on the installed
processor codecs.

Quality defaults to lossless. Targets requiring quality loss, such as JPEG and
MP3, require the **Allow quality loss** setting before the grouped workflow can
start. The existing metadata preference applies to conversions.

Independent files are queued as soon as their upload is ready. Uploads rotate
through the active groups one file at a time, so a large archive group does not
hold back every smaller group. An archive group is submitted only when all of
its selected members are ready. A rejected member leaves the entire archive
group selected rather than silently producing an archive with missing files.

File-specific rejections leave successful submissions intact and allow unrelated
groups to continue. Network, capacity and cancellation conditions stop further
submissions and keep unsubmitted work available. Verified outputs appear in the
existing processing queue/download controls while other jobs continue.

On processors advertising `groupedWorkflows: true`, per-type choices are saved
with the owner's project settings. Complete-upload recovery restores the choices
and pending input references after refresh. They are checked again against the
current capabilities. A saved unsupported choice must be changed before running.
Configured choices remain available even when just one failed group is left.
Incomplete uploads and unuploaded local selections still need their original
files after closing the page.

## Planner and executor boundaries

The planner reads the selected manifest and existing inspection metadata. It
performs no full-content scans or decoding. It groups compatible actions,
validates stable identities and configured file/input limits, and counts planned
jobs, selected bytes and last-known remaining upload bytes. The displayed output
limit is a configured budget, not a compression-size prediction. Source bytes
cannot be compared directly to that output limit before compression.

The executor uses the same submission path for ordinary and grouped actions.
Grouped ZIP jobs use the default compression profile and comment settings.
Only one upload is active, with the existing chunk buffers and resume
offsets; the processor's existing admission/fairness policy controls workers.
Native formats still use the existing C++ kernel integration. This metadata
planner is not a replacement native processing runtime.

There is no runtime duration prediction, CPU/GPU strategy optimizer, cloud route,
compression preview, general processing DAG or cross-project browser uploader in
this increment. Signature hints are not a substitute for the worker's real codec
validation. Physical iPhone/foldable behavior remains unverified.
