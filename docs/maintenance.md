# Maintenance — November 2, 2026

## Active application

The main React application is `web/src/App.tsx`. Its compression hook uses
`web/src/engine/adaptive-engine.ts`. Files, Dashboard, and large-file views now
load on demand. Versioned architecture documents are historical design notes;
their scale targets and completion claims are not current guarantees.

The old `web/src/wasm/loader.ts` mock discarded input bytes. It has been removed
and its compatibility entry points now reject requests with a migration message.
The excluded V24 worker still references those entry points; use AdaptiveEngine
for current integrations. Other mock/fallback systems remain and need individual
review before calling the entire platform production ready.

## Organization and commands

- `web/`: active browser application and its authoritative Vite/TypeScript config.
  Root configs delegate to these configs.
- `core/`, `backend/`, `wasm/`: Rust workspace members.
- `hamma/`: separate Python service; `mobile/` and `mobile-web/`: separate clients.
- `docs/`: specifications and historical implementation notes.
- `scripts/`: launcher scripts. The PowerShell backend launcher now resolves the
  repository root from its own location and creates its log directory.
- `web/src/wasm/generated/`: isolated wasm-pack output; building no longer writes
  generated bindings over hand-maintained integration files.

Run commands from `singularity-pack/`:

```sh
npm run dev
npm run typecheck
npm run test:web
npm run build
cargo test --workspace --locked
```

`npm test` now includes web tests before the existing Rust core/WASM tests.
`npm run clean` deletes only explicitly named generated output folders, without
walking into dependency distributions. Cargo.lock is no longer ignored, allowing
repeatable application builds. Local logs, Python caches, and TypeScript build
metadata are ignored.

## Fixes and verification

- Invalid array chunk sizes now throw instead of hanging or silently losing data.
- Global keyboard shortcuts ignore editable fields.
- Compression initialization ignores results after unmount and aborts active work
  during cleanup.
- Unsafe legacy compression produces a clear error instead of corrupt archives.
- Documentation links point to existing specifications.
- Regression coverage includes invalid chunk sizes and legacy-engine rejection.
- Vitest uses one worker thread to limit concurrent WASM/stress-test allocation
  and avoid stalled fork processes observed during follow-up validation.

The initial frontend baseline passed 324 tests, with 23 existing worker tests
skipped. Skipped browser-worker tests and mock-backed WASM tests do not establish
native WASM or end-to-end browser correctness. Consult local `*-results.log`
files for the most recent build/test output. Python and Flutter validation are
outside the checks performed in this maintenance pass.

Initial maintenance validation: 332 tests passed, 23 skipped; production build passed.
The main application chunk shrank from 143.87 kB to 116.73 kB before gzip.
An unrestricted-worker rerun timed out during worker startup; the final run with
two workers passed. Rust validation was stopped during dependency downloads,
before compilation; no Rust test pass is claimed.

## Follow-up functionality validation

The follow-up run passed 370 web tests (23 worker tests skipped), 355 Rust tests,
and 66 Python tests. Real browser checks also verified compression, restoration,
sign-in, dashboard/file-manager loading, and byte-exact downloaded artifacts.
See [the full functionality report](functionality-validation.md) for fixes,
reproduction commands, live API checks, and explicit remaining feature gaps.
