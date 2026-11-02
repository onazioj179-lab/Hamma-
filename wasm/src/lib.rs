//! SPK WASM Library
//!
//! WebAssembly bindings for browser-based compression/decompression.

use wasm_bindgen::prelude::*;

pub mod bindings;

/// Initialize WASM module
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Get library version
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get supported features
#[wasm_bindgen]
pub fn supported_features() -> JsValue {
    let features = vec![
        "streaming",
        "zstd",
        "lz4",
        "brotli",
        "deduplication",
        "partial_extraction",
        "preview",
    ];
    serde_wasm_bindgen::to_value(&features).unwrap_or(JsValue::NULL)
}
