# Native runtime and desktop delivery

Creator: Onazi Treasure Oj.

The browser app uses TypeScript compression fallbacks. The existing native core,
archive codecs, API server and CLI are Rust. The portable Windows package serves
the built app from the Rust executable and does not launch Python.

Build from the repository root:

```powershell
powershell -File scripts/package-windows.ps1
# Faster developer package:
powershell -File scripts/package-windows.ps1 -DebugBuild
```

This is an executable plus static assets, not a single-file GUI installer. Keep
the `web` folder beside `HAMMA.exe`. The server binds to loopback by default;
explicit network serving requires SPK_BIND_HOST. Runtime storage is still temporary.

The optional Python HAMMA learning service remains intact. Migrating it requires
porting its prediction, feedback, stability and persistence semantics to Rust and
comparing against all 66 existing tests. The Rust core already includes a HAMMA
optimizer, but API/state parity has not been established. Do not delete Python
until that parity is demonstrated.

C++ kernels are a profiling-driven follow-up, not an assumed speed improvement.
Measure codec/IO/worker bottlenecks, implement only the demonstrated hot path with
a narrow C ABI, and verify identical output, memory safety and end-to-end timing.
Native WASM and Flutter limitations remain documented in functionality-validation.md.
