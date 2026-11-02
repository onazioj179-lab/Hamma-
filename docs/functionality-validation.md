# Functionality validation — November 2, 2026

This is a checked scope report, not a certification that every historical feature
in this repository is implemented. All live API and browser checks used synthetic
files and disposable local accounts. Account UI checks used a separate origin to
avoid changing the main app's saved account data.

## Verified workflows

| Area | Evidence |
| --- | --- |
| Rust workspace | 335 core unit tests, 17 integration tests, two backend tests, one host WASM binding test passed |
| Python HAMMA | 66 tests passed in an isolated `hamma/.venv` |
| Web application | 370 tests passed, 23 existing worker tests skipped; no runner errors in `verification-web-threaded.log` |
| Real browser engines | Seven strategy requests restored identical source bytes; worker-WASM fell back to JavaScript |
| Live backend | 21 checks passed: account creation, invalid credentials, login, recovery, multipart compression, manifests, extraction, sessions, pause/resume, missing archives, and unsupported-feature errors |
| Main app UI | Compression, single-file restore, multi-file ZIP restore, settings opening/closing, sign-in, logout, Files view, Dashboard, and disabled unfinished controls verified in the browser |
| Separate mobile web client | Actual backend compression and multi-file extraction to ZIP exercised in the browser |
| Downloaded artifacts | Browser-downloaded SPK restored exact source bytes; browser-downloaded ZIP contained all three expected filenames and exact bytes, including an empty file and binary data |
| Builds | TypeScript application/configuration checks and production web build passed; standalone mobile ZIP asset build passed |

## Defects fixed during validation

- Mobile match lengths could overflow the format's one-byte field. Matches are
  now capped at 255 bytes; invalid back-references fail instead of synthesizing zeros.
- Archive decoders now verify supported versions, declared lengths, checksums,
  restored sizes, and relevant footer data. Damaged archives report errors.
- The active engine now dispatches SPKX archives to the extreme decoder, including
  valid empty archives.
- Selecting a `.spk` file now restores it. Multi-file archives restore to portable
  ZIP files with names, directory paths, empty files, and binary bytes preserved.
- Duplicate/unsafe archive paths and unreadable files fail explicitly. Oversized
  selections no longer silently truncate to 5,000 files.
- Cancellation during file reads cannot publish a later compression result.
- Download controls invoke one handler and preserve restored file extensions.
- Disk-streamed multi-file jobs propagate chunk failures, honor cancellation,
  abort failed output, and do not fall back to a large in-memory job when saving
  is cancelled.
- The mobile web client no longer consumes a response twice or simulates extraction.
  Its Python server now starts on Windows consoles and supports explicit API/port configuration.
- The PWA service worker refreshes its shell rather than indefinitely serving old
  cached application code. Its shell can be cached; backend operations require a live server.
- Backend session finalization now creates a real SPK archive rather than returning
  raw bytes. Paused sessions reject uploaded data.
- Unsupported password-protected archive/session creation returns an explicit
  error instead of silently creating unencrypted output.
- Catalog statistics respect zero-byte compressed sizes. Quotas reject invalid
  sizes, account dates convert Unix seconds correctly, server quotas are honored,
  and switching accounts clears the previous catalog.
- Persisted account metadata no longer provides a credential-free demo login.
- Account API calls use a configurable base and a development proxy rather than
  hard-coded browser `localhost` addresses. HAMMA dashboard calls share this base.
- Unimplemented large-job uploads return HTTP 501. The large-file page and dead
  account-management controls now say they are unavailable.

## Remaining gaps — do not treat these as passing

1. **Native WASM artifact:** host tests are not native browser-WASM execution.
   `wasm-pack` metadata required an uncached dependency (`fiat-crypto`). A direct
   target build then confirmed the `wasm32-unknown-unknown` Rust target was absent.
   The target download stalled and was stopped. Native WASM remains unverified;
   some existing wrapper tests still exercise mocks.
2. **Flutter:** neither Flutter nor Dart was installed. Native mobile builds,
   device behavior, permissions, and FFI were not validated.
3. **Durable accounts/catalog/storage:** backend accounts and file storage are
   in memory. They do not survive server restart. The browser catalog is local
   metadata; `loadFiles` is still a backend-integration placeholder. Upload-to-catalog
   and durable file-library workflows are not established by the metadata tests.
4. **Unfinished account features:** plan upgrades, password-change UI, recovery
   phrase redisplay, account deletion, and preference-to-engine wiring are not
   implemented. Their dashboard controls are disabled/marked unavailable.
5. **Massive jobs and sharing:** the former “100TB” route discarded uploaded
   bytes. It now rejects uploads. Durable streaming output and sharing are still
   unfinished. No 100TB capacity or advertised throughput/latency claim was benchmarked.
6. **Archive interoperability:** JavaScript fallback/SPKX and Rust archive layouts
   differ. Each was tested with its matching decoder/client. Cross-client format
   interoperability and encrypted archive compatibility are not certified.
7. **Browser workers:** 23 existing worker tests require an environment this unit
   runner does not provide and remain skipped. Browser strategy checks verified
   successful fallback, not execution of all native WASM/worker paths.
8. **Deployment/security:** checks used local services and synthetic accounts.
   Production authentication hardening, access control, persistence, real network
   sharing, and deployment have not been certified.

## Reproduce

From `singularity-pack/`:

```sh
npm install
npm run typecheck
npm run test:web
npm run build
npm run build:mobile-web
cargo test --workspace --locked
node scripts/generate-validation-fixtures.mjs
```

Start a disposable backend on port 3011, then run
`python scripts/validate_backend.py`. `SPK_TEST_API` overrides its address.
`scripts/validate_downloads.py` checks the synthetic files downloaded by the browser.

Python service tests, from `hamma/`:

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pytest tests -q
```

For browser engine checks, start `npm run dev` and open `/validation.html`.
For the separate mobile client, first build its ZIP asset, then run
`python mobile-web/serve.py`. Optional variables are `SPK_MOBILE_PORT` and
`SPK_API_BASE`. For the React development proxy use `SPK_API_TARGET`; a deployed
React app can set `VITE_API_BASE_URL` when the API is hosted separately.

Validation artifacts are in `validation/fixtures/` and `validation/screenshots/`.
Root `verification-*.log` files and `hamma/python-validation.log` contain full output.

The fork-based test pool intermittently stalled while starting/recycling child
processes on this machine. Failed test runners and their orphaned workers were
stopped. The complete passing run used one worker thread; the checked-in Vitest
configuration now uses that configuration.
