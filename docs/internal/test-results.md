# Test results

## Worker recovery follow-up (2026-11-02)

- Complete processor suite: 47 passed. Log: validation/reliability-processor-tests.log (ignored local artifact).
- Focused worker-start failure regression passed after switching failure injection to Process.start; retry completes successfully.
- Complete web suite: 415 passed, 23 browser-worker cases skipped. Native WASM tests used the existing fallback; native execution is not verified.
- Production TypeScript/Vite build passed. Existing Browserslist data-age notice remains.
- git diff --check passed. Real phone file-save completion and power-loss durability remain unverified.

- npm run test:web: 28 files passed, 1 skipped; 411 tests passed, 23 skipped. Log: .hamma-data/final-web-tests.log (local, ignored).
- python -m unittest discover -s processor/tests: 36 tests passed after repairing the restart scheduler gate. Log: .hamma-data/final-processor-tests.log (local, ignored).
- npm run build: TypeScript/Vite production build passed; web/dist/index.html and bundled assets produced.
- scripts/verify-lan.py: four concurrent owner-isolated sessions, four ZIP outputs verified, cross-session access denied.
- UI: two SPK outputs retained distinct links after subsequent jobs; available-download filter excluded metadata-only records.
- Launcher: cold start and concurrent reuse checked. Final processor deployment and launcher reuse were rechecked.

A newly added restart regression initially failed because the drain check landed in cleanup rather than scheduling. The check was moved into tick; all 36 processor tests then passed. No failed test was removed or suppressed. Embedded-browser blob file-save confirmation timed out. Chrome capture could not restore its minimized window. Physical phone and browser save completion remain unverified.

## API reliability batch

38 processor tests passed, including malformed JSON bodies and throttling headers. All 10 processing-client tests passed, including retry guidance and response-body cancellation. Previous complete web run: 411 passed, 23 skipped; the two new client cases were run in the targeted suite. See performance-baseline.md for actual local benchmark values.

## Recovery follow-up

44 processor tests passed; all 12 processing-client tests passed; production TypeScript/Vite build passed. Coverage includes expired/missing inputs, queue-capacity enforcement on retries, preserving upload IDs on throttling, cancellation during backoff and existing lossless/owner-isolation checks. An initially overbroad source edit disrupted job intake; regression failures exposed it and the corrected route passed the complete suite. No tests were suppressed. No throughput improvement is claimed for retry backoff.

## Defined 100-case page stress run

100/100 browser page cases passed after fixing narrow-page and filter-toolbar overflow. The matrix covers seven page states, seven widths and two themes, plus a 1,000-file virtualized selection and atomic duplicate rejection. Separate generated-job stress: 100/100 ZIP/GZIP/BZIP2/XZ jobs passed with eight concurrent clients, exact-byte reconstruction, SHA-256, ranges, idempotency, resume positions, isolation and test-only cleanup. Raw results are in validation/page-stress-results.json and validation/stress-local-results.json.

Regression evidence: complete web run 417 passed, 23 browser-worker tests skipped; final targeted run of storage/navigation/large-selection suites 16 passed (overlapping the full run, not additive). Final production build passed. No physical-phone or browser download-to-disk certification is implied. See page-stress-results.md for acceptance criteria and limits.
