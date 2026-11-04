# Mobile investigation — PARTIAL

Reported: 200–300 images with approximately 14 failures and slow processing.
Original failing files, their formats, phone diagnostics and network trace were
not supplied. Root causes of those 14 failures are not established.

Confirmed code defect: duplicate names, including normalized Unicode/case
collisions, rejected the entire newly selected group. Repaired by retaining stable
file identities and File references while assigning collision paths such as
duplicate-2/photo.jpg. Basenames and file bytes remain unchanged; relative paths
are adjusted only for collisions. Generated paths are shown in the selection.

Confirmed resource gap: scheduler previously admitted up to two workers regardless
of free memory. New admission policy keeps a 512 MiB reserve and budgets 768 MiB
per worker, bounded by CPU count and the existing two-worker maximum. Unknown
memory admits one worker. Low memory defers queued work without killing workers.
These estimates are not measured codec peaks or hard process memory enforcement.

Layout changes allow conversion controls and project actions to wrap and shrink.
iPhone 16 Pro, smaller iPhone, Android, foldable transitions, touch and safe-area
behavior are NOT VERIFIED on physical devices.

Existing 300-submission/14-rejection test exercises mocked HTTP queue isolation;
it does not validate real image decoding, mobile memory or the reported incident.

The separate real desktop codec run completed 286 valid fixtures and rejected
exactly 14 deliberately invalid fixtures out of 300, in 389.017 seconds. This
confirms independent sequential codec outcomes across JPEG/PNG/WebP/GIF/AVIF;
it does not reproduce the original incident or certify phone behavior.
