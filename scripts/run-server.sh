#!/bin/bash
# SPK Backend Server - Production Starter Script
# Singularity Pack Universal Compression Platform

cd -- "$(dirname -- "$0")/.." || exit 1

echo "================================================================"
echo "   SINGULARITY PACK (SPK) - Universal Compression Server"
echo "================================================================"
echo ""

# Validate Rust installation
if ! command -v cargo &> /dev/null; then
    echo "[ERROR] Rust/Cargo not found"
    echo "Install from: https://rustup.rs/"
    exit 1
fi

echo "[BUILD] Compiling SPK backend (release mode)..."
cargo build --release --bin spk-server

if [ $? -ne 0 ]; then
    echo "[ERROR] Build failed - check output above"
    exit 1
fi

echo "[OK] Build completed successfully"
echo ""

# Configure environment
export RUST_LOG="info,spk_backend=debug"
export PORT="3000"

echo "[START] Launching SPK Backend Server..."
echo ""
echo "Configuration:"
echo "  Port: $PORT"
echo "  Log Level: $RUST_LOG"
echo ""

echo "Enabled Features:"
echo "  [V1-V5]  Core Compression and Encryption"
echo "  [V6]     GPU Acceleration"
echo "  [V7]     Autonomous Optimization"
echo "  [V8]     Edge/Mobile Support"
echo "  [V9]     Health Monitoring"
echo "  [V10]    Universal Interoperability"
echo "  [V12]    Global Mesh Network"
echo "  [V13]    Semantic Compression"
echo "  [V14]    Heterogeneous Hardware"
echo "  [V15]    Self-Transforming Containers"
echo "  [V16]    Long-Term Resilience"
echo "  [V17]    Scientific Data Modes"
echo "  [V18]    Realtime Streaming"
echo "  [V19]    Virtual Data Layer"
echo "  [V20]    Compute Sandbox"
echo "  [V21]    Policy Engine"
echo "  [MEDIA]  Media-Safe Compression"
echo ""

echo "API Endpoints:"
echo "  http://localhost:3000/health"
echo "  http://localhost:3000/version"
echo "  http://localhost:3000/api/*"
echo ""
echo "================================================================"
echo "Server running - Press Ctrl+C to stop"
echo "================================================================"
echo ""

# Launch server
cargo run --release --bin spk-server
