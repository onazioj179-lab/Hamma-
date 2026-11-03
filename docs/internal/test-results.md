# Test results

- npm run test:web: 28 files passed, 1 skipped; 411 tests passed, 23 skipped. Log: .hamma-data/final-web-tests.log (local, ignored).
- python -m unittest discover -s processor/tests: 36 tests passed after repairing the restart scheduler gate. Log: .hamma-data/final-processor-tests.log (local, ignored).
- npm run build: TypeScript/Vite production build passed; web/dist/index.html and bundled assets produced.
- scripts/verify-lan.py: four concurrent owner-isolated sessions, four ZIP outputs verified, cross-session access denied.
- UI: two SPK outputs retained distinct links after subsequent jobs; available-download filter excluded metadata-only records.
- Launcher: cold start and concurrent reuse checked. Final scheduler-drain integration requires deployment/restart recheck.

A newly added restart regression initially failed because the drain check landed in cleanup rather than scheduling. The check was moved into tick; all 36 processor tests then passed. No failed test was removed or suppressed. Embedded-browser blob file-save confirmation timed out. Chrome capture could not restore its minimized window. Physical phone and browser save completion remain unverified.
