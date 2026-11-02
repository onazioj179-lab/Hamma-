//! Backend routes module

pub mod compress;
pub mod decompress;
pub mod cluster;

// V7 routes
pub mod optimizer;

// V8 routes
pub mod compute; // V20
pub mod device;

// V9 routes
pub mod health;

// V10 routes
pub mod interop;

// V12 routes
pub mod mesh;

// V13 routes
pub mod semantic;

// V14 routes
pub mod hardware;

// V21 routes
pub mod policy;

// Media-Safe Compression routes
pub mod media;

// V22 routes
pub mod ai_media;
pub mod ai_media_routes;

// HAMMA Performance Controller routes
pub mod hamma;

// Account management routes
pub mod account;

// Large-scale compression job management
pub mod compression_job;
