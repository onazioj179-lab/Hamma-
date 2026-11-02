# Singularity Pack (SPK)

High-performance SPK compression platform with Rust core, WebAssembly bindings, modern React frontend, and HAMMA EXTREME self-learning optimizer.

## Current Status

The table below records historical feature claims, not a current production certification.
See [maintenance notes](docs/maintenance.md) for verified checks, active code paths, and known limitations.

| Area | Status | Notes |
|------|--------|-------|
| Core compression (Rust) | ✅ Stable | Multi-codec, streaming |
| Web frontend (React/Vite) | ✅ Stable | Drag-and-drop, WASM-backed |
| WebAssembly bindings | ✅ Stable | wasm-pack builds |
| HAMMA EXTREME (AI optimizer) | ✅ Stable | 66/66 tests passing |
| Account System | ✅ Stable | Wallet-style auth with recovery phrase |
| File Catalog | ✅ Stable | Serial numbers, tagging, search |

## Project Structure

```
singularity-pack/
├── core/           # Rust compression engine (account.rs, catalog.rs, hamma.rs, etc.)
├── wasm/           # WebAssembly bindings
├── web/            # TypeScript/React frontend
│   └── src/
│       ├── components/
│       │   ├── auth/       # Login, recovery phrase modals
│       │   ├── files/      # File manager with serial numbers
│       │   ├── dashboard/  # Storage dashboard, HAMMA settings
│       │   └── compression/
│       └── store/          # Zustand state (account.ts, app.ts)
├── hamma/          # HAMMA EXTREME FastAPI + self-learning layer
├── backend/        # Optional API server (Rust)
├── mobile/         # Flutter mobile app
├── mobile-web/     # Progressive web app
├── docs/           # All documentation and specs
└── scripts/        # Shell scripts (run-server, etc.)
```

## Quick Start

### Prerequisites
- Rust 1.70+
- Node.js 18+
- wasm-pack (for wasm build)
- Python 3.12+ (for HAMMA)

### Build & Run

Core (Rust):
```bash
cd core
cargo build --release
```

WASM bindings:
```bash
cd wasm
wasm-pack build --target web --out-dir ../web/src/wasm/generated
```

Web frontend (from the repository root):
```bash
npm install
npm run dev
```

Use `npm run test:web` for non-interactive frontend tests, `npm run typecheck`
for TypeScript validation, and `npm run build` for production output in `web/dist`.

HAMMA EXTREME API:
```bash
cd hamma
python -m uvicorn hamma.api.fastapi_app:app --host 0.0.0.0 --port 8777
```

Tests (HAMMA):
```bash
cd hamma
python -m pytest tests/ -v
```

## Key Features

- **Custom SPK Format**: header + manifest + chunk table + data chunks
- **High Performance**: Rust codecs (ZSTD/LZ4/Brotli/None) with streaming
- **Browser Support**: WASM bindings for client-side compression
- **Modern UI**: React/Vite interface with drag-and-drop and progress
- **Integrity**: SHA-256 checksums across chunks
- **HAMMA EXTREME**: Self-learning optimizer that pushes compression toward theoretical limits (metadata-only learning)

## SPK Format (tl;dr)

1) Header (64 bytes) — magic, version, flags, offsets
2) Manifest — JSON metadata and directory layout
3) Chunk Table — offsets/sizes of compressed chunks
4) Data Chunks — compressed payloads with checksums

Full spec: [docs/SPK_Format_v1.md](docs/SPK_Format_v1.md)

All technical documentation is in [docs/](docs/) including implementation notes, API references, and feature evolution (V22-V53).

## HAMMA EXTREME Overview

- FastAPI service on port 8777
- Self-learning modules in hamma/self_learning/:
  - model_state.py — entropy distributions, redundancy fingerprints
  - trainer.py — online training with adaptive gradients
  - persistence.py — state save/load, checkpoints, export/import
  - extreme_ratio.py — extreme compression targeting and recommendations
  - stability_engine.py — smoothing, overfit detection, oscillation damping
- Tests: 66/66 passing (41 EXTREME + 25 core)

## API Usage (Core)

### Rust
```rust
use spk_core::{Compressor, CompressorOptions};

let options = CompressorOptions::default();
let mut compressor = Compressor::new(options);
compressor.add_file("path/to/file.txt")?;
compressor.write_to("output.spk")?;
```

### TypeScript (WASM)
```typescript
import { compress, decompress } from 'spk-wasm';

const compressed = await compress(fileData, { codec: 'zstd' });
const decompressed = await decompress(compressedData);
```

## Contributing

Contributions welcome! Please:
- Open issues with clear descriptions and repro steps
- Include tests for new features
- Follow existing code style and patterns
- Check [docs/](docs/) for implementation guides and API docs

## License

MIT License - see LICENSE.

