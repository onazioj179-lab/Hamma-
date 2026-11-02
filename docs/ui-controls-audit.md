# Dropdown and page audit

Shared SelectField controls use solid theme-aware menus, visible selected states,
keyboard navigation, type-to-find, focus return, Escape and outside dismissal.
Menus render in a portal to avoid clipped cards, choose above/below placement,
and reserve the mobile navigation area. Escape from an open menu does not reach
the app-wide cancellation shortcut.

Active integration in the processor checkout covers archive and conversion
formats, job status and sorting, history and file retention, and SPK history.
Options/Retention are consistent disclosure panels. Mobile filters use two
columns with search above them; embedded SPK panels receive normal padding.
SPK Overview explicitly identifies its measurements as SPK-only.

The processor checkout also resets search/status/sort when submitting a new job.
A Completed-only filter previously hid new work and could stop polling it.
These UniversalWorkspace integration edits remain with the separate processor
feature; the shared-control PR deliberately excludes that feature's unrelated
server/client implementation.

Validation: production build and TypeScript passed; 4 select-control tests,
5 processor-workspace tests and 1 SPK-history test passed. Browser checks covered
Workspace, SPK archives, My files, History, Overview, and General/Privacy/Storage/
About settings, with desktop and narrow layouts and light/dark appearances.
Destructive clear/delete controls were checked with unit fixtures, not clicked
against existing user data.

Real disposable browser jobs completed ZIP compression, extraction, and
WAV-to-FLAC conversion. ZIP and extraction contents matched the input bytes;
FLAC decoding preserved all 16000 PCM samples. Search and status filtering
returned matching jobs and an empty state for a nonmatching query.

The browser check also exposed an interrupted worker in the old preview.
Its checkout lacked processor source files. The preview was restarted from the
processor checkout on port 5010 using the existing data directory; retry succeeded.
Three test jobs and their downloaded artifacts were retained as real evidence.
