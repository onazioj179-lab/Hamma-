# HAMMA workspace rebuild

Created by Onazi Treasure Oj. The active application is `web/src/App.tsx`.

## Screens and controls

The persistent desktop sidebar contains Workspace, My files, History, and
Overview. Settings and About are at its bottom left. Narrow screens use a fixed
bottom navigation bar. Main views have keyboard focus management, skip-to-content,
and keyboard shortcuts. `workspace.css` defines the neutral surfaces, one blue
accent, system sans-serif typography, and responsive layouts. Popups have no blur.

- `components/workspace/CompressionWorkspace.tsx`: file and folder pickers, drop
  handling, progress, cancellation, error recovery, measured results, downloads,
  direct-to-disk confirmation, and recent records. Initial engine setup displays
  a splash state; no artificial startup timer is added.
- `components/workspace/LocalFiles.tsx`: only the current real result. No account
  gate, invented cloud storage, or unavailable historical download controls.
- `components/files/ActivityHistory.tsx`: search, operation filters, individual
  removal, and clear-history. Restoration input/output sizes follow operation
  direction. History is metadata; bytes must be downloaded during the session.
- `components/workspace/LocalOverview.tsx`: counts and savings derived from
  actual records, device capability information, optional local performance totals.
- `components/ui/SettingsPanel.tsx`: General, Privacy, Storage, and About. Theme
  and auto-download affect the active app. Cache clearing targets only app-owned
  Cache Storage entries. Creator credit and a repository link appear in About;
  a subtle watermark remains in the sidebar and footer.

Core use is free and does not require a backend, account, or Python service.
Older account/dashboard/research components remain in source for compatibility;
the free app does not expose their unfinished controls as available features.

## Internals

`store/preferences.ts` defaults local learning to off. A clear privacy banner
lets users choose essential settings or opt into local aggregate learning.
Measurements contain only rolling input bytes, output bytes, and elapsed time,
with at most 100 observations represented. They stay in browser storage. No
cross-user learning service or remote collection is implemented. The aggregates
inform displayed performance, not engine strategy selection. Opt-out clears them.

History can be disabled independently. New records respect that preference.
Clearing current history also clears the legacy history array. Input file names
are stored only in history, not in the aggregate learning state.

The compression hook rejects overlapping jobs; preparing, initializing,
processing, and finalizing are treated as busy. Automatic downloading now also
applies to restoration. Completed JavaScript fallback execution is labeled as
JavaScript, rather than advertising native WASM from device capabilities.

The optional backend uses Rust middleware in `backend/src/rate_limit.rs`:
120 API requests/minute per socket peer by default; account creation/login/
recovery additionally use a 10/minute bucket. `SPK_API_RPM` and `SPK_AUTH_RPM`
configure positive limits. HTTP 429 includes Retry-After and API responses use
Cache-Control: no-store. Health checks and preflight requests are exempt.
The map is bounded to 4096 buckets; the limiter is in-process and does not trust
forwarding headers. A deployment with multiple instances needs shared edge
admission. Python research remains separate; a full language port is not claimed.

43 generated root logs were archived under ignored
`buildlogs/archive/2026-11-02/`. The active `windows-smoke-server.log` was left in
place because its running process holds it open. Native engines, specifications,
and other clients were preserved.

## Verification

- TypeScript and production build passed.
- Full web run: 381 passed, 23 existing browser-worker tests skipped. Two further
  navigation/privacy regression tests passed in a targeted run, alongside local
  preferences and compression-hook tests.
- Rust API limiter: four tests passed (per-peer quotas, stricter authentication,
  concurrent admission, window reset, HTTP 429/Retry-After, health availability).
- Browser: actual synthetic file compressed from 10,800 bytes to a 356-byte SPK,
  downloaded, restored, and downloaded again. Original and restored SHA-256:
  `3715ed51ea5daa023d64b8b32e2585c028351f8e4e9e568ed4a9c54c0eaadbf7`.
- Browser screens and navigation inspected at desktop and 375px width. No
  horizontal overflow was observed in the narrow About/settings view.
- Logs: `buildlogs/ui-rebuild-*.log`; fixture:
  `validation/fixtures/ui-rebuild-roundtrip.txt` (ignored generated data).

These checks do not certify all native WASM/worker paths, public deployment,
legacy account security, server storage, billing, or sharing. No unmeasured
compression or throughput guarantee is made.
