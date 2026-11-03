# Page and processing stress validation — 2026-11-02

Scope: the seven active screens (Workspace, Files & History, Overview, General,
Privacy, Storage, About) and bounded synthetic processing. This is not a claim
that the 100 engineering proposals are implemented or that every platform is
certified.

## Reproduced and repaired

- Denied storage reads crashed App initialization. Storage quota failures could
  also interrupt preference/theme changes. Persistence now fails safely while
  the current session remains usable. Tests cover initial module loading,
  privacy-notice dismissal, theme changes and navigation under denied reads and
  writes.
- Removing a deeply scrolled 5,000-file selection left a replacement selection
  without visible rows because the virtualized start index outlived the old
  list. The render window is now bounded by the current list length. Regression
  coverage removes the scrolled batch, adds a new file and checks its row.

Both initial regressions failed before the implementation fixes and passed
afterward. No test was removed or suppressed.

## Verification

| Check | Result |
| --- | --- |
| Live page navigation | 50 transitions across Workspace, History, Overview, Settings and About; no console errors |
| All seven screens at 320px and 390px | No horizontal document overflow observed |
| Selection stress | 5,000 sources with at most 14 rendered rows; replacement selection visible |
| History stress | 500 retained jobs; 50 rows per page across ten pages; search resets pagination |
| Network failure | Bulk retry followed by disconnect reports the error without an unhandled rejection |
| Concurrent HTTP workload | 8 independent sessions, 24 jobs, 16 verified ZIP/gzip downloads, 8 corrupt-input failures correctly rejected |
| Isolation and retries | Cross-session metadata/download access denied; duplicate submissions retain one job; chunk offsets and suffix ranges verified |
| Live browser file flow | Picker → ZIP compression → download; picker → SPK compression → blob download → restoration → blob download |
| Browser download integrity | ZIP contents and restored SPK contents match original SHA-256 `26f3a30fd60df0eed6d1e486c49b16485023d8f07d3cca15be2d24af8a4e857c` |
| Production build | TypeScript and Vite passed |

Full web run: 417 passed, 23 existing browser-worker cases skipped. After adding
network/storage/history stress cases, the focused suites also passed (15 tests
across three files, then 12 UniversalWorkspace cases including the new history
case). The skipped browser-worker tests and fallback WASM tests do not verify
native WASM execution.

Machine-readable concurrent-run summary: `validation/processor-stress-result.json`.
Screenshot: `validation/screenshots/page-stress-overview.png`. Detailed local logs
are ignored under `validation/page-stress-*.log`.

To repeat the synthetic HTTP workload, start a processor with a disposable data
directory and run:

```powershell
python -m processor.server --port 5026 --data .hamma-data/page-stress --web web/dist
python scripts/stress-processor.py http://127.0.0.1:5026 --sessions 8
```

Remaining verification includes physical iOS/Android saves, native Rust/WASM,
power-loss durability, constrained-disk behavior, public hosting and larger
resource-exhaustion workloads. The existing 100-proposal discovery list retains
its original classifications; a passing page or workload is not evidence that
all proposed capabilities exist.
