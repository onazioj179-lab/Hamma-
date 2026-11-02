# Singularity Pack - Copilot Instructions

## Project Overview
Singularity Pack (SPK) is a high-performance file compression tool featuring:
- **Rust Core**: Compression engine with custom SPK format
- **WebAssembly**: Browser-based compression via wasm-bindgen
- **TypeScript/React Frontend**: Modern UI built with Vite
- **Rust Backend**: Optional API server using Actix-web

## Project Structure
- `core/` - Rust compression engine library
- `wasm/` - WebAssembly bindings for browser use
- `web/` - TypeScript/React frontend with Vite
- `backend/` - Optional Actix-web API server
- `format-spec/` - SPK format documentation

## Development Guidelines
- Use Rust 2021 edition for all Rust code
- Follow React best practices with functional components
- Use TypeScript strict mode
- Ensure WASM builds are optimized for size

## Build Commands
- `cargo build` - Build Rust projects
- `wasm-pack build --target web` - Build WASM package
- `npm run dev` - Start frontend dev server
- `npm run build` - Build frontend for production
- `cargo run -p spk-backend` - Run backend server

## Task Progress
- [x] Create copilot-instructions.md
- [x] Scaffold the Project
- [x] Customize the Project
- [x] Install Required Extensions
- [x] Compile the Project
- [ ] Create and Run Task
- [ ] Launch the Project
- [x] Ensure Documentation is Complete
