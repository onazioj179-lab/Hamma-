# SHANTE / HAMMA technical documentation

The current native implementation is documented in [SHANTE CORE](../native/README.md).
The versioned architecture
notes below describe historical work and prototypes; their throughput, scale,
GPU and completion claims are not current production guarantees. The Flutter
client's simulated operations are not eligible for release.

## Quick Links

- [Main README](../README.md) - Project overview and quick start
- [HAMMA Documentation](../hamma/README.md) - HAMMA EXTREME API and self-learning system
- [SPK Format Specification](SPK_Format_v1.md) - Binary format details
- [Professional workspace UI](ui-workspace.md) - Active controls, layout, and remaining work
- [Maintenance notes](maintenance.md) - Active paths, checks, and legacy limitations
- [Functionality validation](functionality-validation.md) - Verified workflows, fixes, and remaining gaps

---

## Architecture Documentation

### Core Implementation
- [Implementation Blueprint](implementation-blueprint.md) - Overall architecture design
- [API Compatibility](api-compatibility.md) - Cross-platform interoperability
- [Build Status](build-status.md) - Compilation and test status
- [Internal Version 1.0](INTERNAL-VERSION-1.0.md) - Version history

### API Reference
- [V9-V10 API Reference](v9-v10-api-reference.md) - REST API endpoints
- [V9-V10 Implementation](v9-v10-implementation.md) - Feature implementation details

### Specialized Systems
- [WASM Implementation](wasm-implementation-summary.md) - WebAssembly bindings
- [Workers README](workers-README.md) - Web Workers integration
- [Network Access](NETWORK_ACCESS.md) - Network configuration
- [Optimization Guide](optimization-README.md) - Performance tuning

---

## Feature Evolution

### AI & Media Intelligence
- [V22 AI Media Intelligence](v22-ai-media-intelligence.md) - AI-powered media optimization
- [V22 Implementation Status](v22-implementation-status.md) - V22 feature tracking
- [V46 AI Optimization](v46-ai-optimization.md) - Advanced AI features

### Real-Time & Mobile
- [V23 Real-Time Mobile](v23-realtime-mobile.md) - Mobile compression features
- [V23 Implementation Status](v23-implementation-status.md) - V23 feature tracking
- [V24 Mobile Flutter](v24-mobile-flutter.md) - Flutter integration

### Performance & Scalability
- [V50 Massive Implementation](v50-massive-implementation.md) - Large-scale optimizations
- [V51 Low-Memory Implementation](v51-lowmem-implementation.md) - Memory efficiency
- [V52 Integrity & Parallel](v52-integrity-parallel-implementation.md) - Parallel processing
- [V53 Redundancy Refinement](v53-redundancy-refinement-implementation.md) - Deduplication improvements

---

## Project Components

### Backend (Rust)
- **core/**: Compression engine library
- **backend/**: Optional Axum REST API server
- **wasm/**: WebAssembly bindings

### Frontend
- **web/**: React/Vite TypeScript interface
- **mobile/**: Flutter mobile app
- **mobile-web/**: Progressive web app

### AI Optimizer
- **hamma/**: HAMMA EXTREME FastAPI service with self-learning modules

---

## Getting Help

- Issues and feature requests: See main README
- API documentation: Check endpoint-specific docs above
- HAMMA questions: See [hamma/README.md](../hamma/README.md)

---

## License

MIT License - see [LICENSE](../LICENSE).
