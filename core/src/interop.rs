//! V10 Universal Interoperability and Extensible Format Layer
//!
//! Provides plugin system for custom codecs, metadata extensions,
//! and cross-format integration with other archival standards.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use crate::utils::error::{SpkError, SpkResult};

/// Plugin registry for codecs and format handlers
pub struct PluginRegistry {
    /// Registered codecs
    codecs: Arc<RwLock<HashMap<String, Box<dyn CodecPlugin>>>>,
    /// Registered format handlers
    format_handlers: Arc<RwLock<HashMap<String, Box<dyn FormatHandler>>>>,
    /// Metadata extractors
    metadata_extractors: Arc<RwLock<HashMap<String, Box<dyn MetadataExtractor>>>>,
}

impl PluginRegistry {
    /// Create new plugin registry
    pub fn new() -> Self {
        Self {
            codecs: Arc::new(RwLock::new(HashMap::new())),
            format_handlers: Arc::new(RwLock::new(HashMap::new())),
            metadata_extractors: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a codec plugin
    pub fn register_codec(&self, plugin: Box<dyn CodecPlugin>) -> SpkResult<()> {
        let mut codecs = self.codecs.write()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        codecs.insert(plugin.id().to_string(), plugin);
        Ok(())
    }

    /// Register a format handler
    pub fn register_format_handler(&self, handler: Box<dyn FormatHandler>) -> SpkResult<()> {
        let mut handlers = self.format_handlers.write()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        handlers.insert(handler.format_name().to_string(), handler);
        Ok(())
    }

    /// Register metadata extractor
    pub fn register_metadata_extractor(&self, extractor: Box<dyn MetadataExtractor>) -> SpkResult<()> {
        let mut extractors = self.metadata_extractors.write()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        extractors.insert(extractor.name().to_string(), extractor);
        Ok(())
    }

    /// List all registered codecs
    pub fn list_codecs(&self) -> SpkResult<Vec<CodecInfo>> {
        let codecs = self.codecs.read()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        Ok(codecs.values().map(|c| c.info()).collect())
    }

    /// List all format handlers
    pub fn list_format_handlers(&self) -> SpkResult<Vec<String>> {
        let handlers = self.format_handlers.read()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        Ok(handlers.keys().cloned().collect())
    }

    /// Get codec by ID
    pub fn get_codec(&self, id: &str) -> SpkResult<CodecInfo> {
        let codecs = self.codecs.read()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;
        codecs.get(id)
            .map(|c| c.info())
            .ok_or_else(|| SpkError::InvalidFormat(format!("Codec not found: {}", id)))
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Codec plugin trait
pub trait CodecPlugin: Send + Sync {
    /// Plugin identifier
    fn id(&self) -> &str;
    
    /// Human-readable name
    fn name(&self) -> &str;
    
    /// Version
    fn version(&self) -> &str;
    
    /// Compress data
    fn compress(&self, data: &[u8], level: u32) -> SpkResult<Vec<u8>>;
    
    /// Decompress data
    fn decompress(&self, data: &[u8]) -> SpkResult<Vec<u8>>;
    
    /// Get codec info
    fn info(&self) -> CodecInfo;
    
    /// Capability flags
    fn capabilities(&self) -> CodecCapabilities;
}

/// Codec information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodecInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub capabilities: CodecCapabilities,
    pub description: String,
}

/// Codec capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodecCapabilities {
    /// Supports GPU acceleration
    pub gpu_accelerated: bool,
    /// Supports streaming
    pub streaming: bool,
    /// Supports multi-threading
    pub multithreaded: bool,
    /// Minimum compression level
    pub min_level: u32,
    /// Maximum compression level
    pub max_level: u32,
}

/// Format handler trait for cross-format support
pub trait FormatHandler: Send + Sync {
    /// Format name (e.g., "tar", "zip", "7z")
    fn format_name(&self) -> &str;
    
    /// Detect if data is this format
    fn detect(&self, data: &[u8]) -> bool;
    
    /// Extract file list from format
    fn list_files(&self, data: &[u8]) -> SpkResult<Vec<FileEntry>>;
    
    /// Extract specific file
    fn extract_file(&self, data: &[u8], path: &str) -> SpkResult<Vec<u8>>;
    
    /// Extract all files
    fn extract_all(&self, data: &[u8]) -> SpkResult<Vec<(String, Vec<u8>)>>;
    
    /// Convert to SPK format
    fn convert_to_spk(&self, data: &[u8]) -> SpkResult<Vec<u8>>;
}

/// File entry in external format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_directory: bool,
    pub modified: u64,
}

/// Metadata extractor trait
pub trait MetadataExtractor: Send + Sync {
    /// Extractor name
    fn name(&self) -> &str;
    
    /// Extract metadata from file
    fn extract(&self, data: &[u8], mime_type: &str) -> SpkResult<ExtendedMetadata>;
}

/// Extended metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendedMetadata {
    /// MIME type
    pub mime_type: String,
    /// Custom fields
    pub fields: HashMap<String, MetadataValue>,
    /// Binary blobs
    pub binary_data: HashMap<String, Vec<u8>>,
}

/// Metadata value types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MetadataValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<MetadataValue>),
    Object(HashMap<String, MetadataValue>),
}

/// Extension block for V10 features
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionBlock {
    /// Version of extension format
    pub version: u32,
    /// Feature flags
    pub features: FeatureFlags,
    /// Registered plugins
    pub plugins: Vec<String>,
    /// Schema indices
    pub schemas: HashMap<String, SchemaDefinition>,
    /// Custom metadata
    pub custom_data: HashMap<String, Vec<u8>>,
}

/// Feature flags for V10
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeatureFlags {
    /// Has custom codecs
    pub has_custom_codecs: bool,
    /// Has nested containers
    pub has_nested_containers: bool,
    /// Has external format mappings
    pub has_format_mappings: bool,
    /// Has extended metadata
    pub has_extended_metadata: bool,
    /// Has plugin hooks
    pub has_plugin_hooks: bool,
}

/// Schema definition for typed metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDefinition {
    pub name: String,
    pub version: String,
    pub fields: Vec<SchemaField>,
}

/// Schema field definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaField {
    pub name: String,
    pub field_type: FieldType,
    pub required: bool,
    pub description: String,
}

/// Field types for schemas
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FieldType {
    String,
    Integer,
    Float,
    Boolean,
    Binary,
    Timestamp,
    Array,
    Object,
}

/// Container mount manager for hybrid SPK files
pub struct ContainerManager {
    /// Mounted containers
    mounted: HashMap<String, MountedContainer>,
    /// Cross-references between containers
    cross_refs: HashMap<String, Vec<ChunkReference>>,
}

/// Mounted container
#[derive(Debug, Clone)]
pub struct MountedContainer {
    /// Container ID
    pub id: String,
    /// Parent container (if nested)
    pub parent: Option<String>,
    /// Mount path
    pub mount_path: String,
    /// Format type
    pub format: String,
    /// Is writable
    pub writable: bool,
}

/// Cross-container chunk reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkReference {
    /// Source container
    pub source_container: String,
    /// Source chunk index
    pub source_chunk: u64,
    /// Target container
    pub target_container: String,
    /// Target chunk index
    pub target_chunk: u64,
}

impl ContainerManager {
    /// Create new container manager
    pub fn new() -> Self {
        Self {
            mounted: HashMap::new(),
            cross_refs: HashMap::new(),
        }
    }

    /// Mount a container
    pub fn mount(&mut self, container: MountedContainer) -> SpkResult<()> {
        let id = container.id.clone();
        self.mounted.insert(id, container);
        Ok(())
    }

    /// Unmount a container
    pub fn unmount(&mut self, id: &str) -> SpkResult<()> {
        self.mounted.remove(id)
            .ok_or_else(|| SpkError::InvalidFormat("Container not mounted".into()))?;
        Ok(())
    }

    /// Add cross-reference
    pub fn add_cross_reference(&mut self, reference: ChunkReference) -> SpkResult<()> {
        let container = reference.source_container.clone();
        self.cross_refs.entry(container)
            .or_insert_with(Vec::new)
            .push(reference);
        Ok(())
    }

    /// Get cross-references for container
    pub fn get_cross_references(&self, container_id: &str) -> Vec<&ChunkReference> {
        self.cross_refs.get(container_id)
            .map(|refs| refs.iter().collect())
            .unwrap_or_default()
    }

    /// List mounted containers
    pub fn list_mounted(&self) -> Vec<&MountedContainer> {
        self.mounted.values().collect()
    }
}

impl Default for ContainerManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Format detection utilities
pub struct FormatDetector;

impl FormatDetector {
    /// Detect format from magic bytes
    pub fn detect_format(data: &[u8]) -> Option<String> {
        if data.len() < 2 {
            return None;
        }

        // TAR
        if data.len() >= 262 && &data[257..262] == b"ustar" {
            return Some("tar".to_string());
        }

        // ZIP
        if data.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
            return Some("zip".to_string());
        }

        // 7z
        if data.starts_with(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
            return Some("7z".to_string());
        }

        // ISO 9660
        if data.len() >= 32769 && &data[32769..32774] == b"CD001" {
            return Some("iso".to_string());
        }

        // GZIP
        if data.starts_with(&[0x1F, 0x8B]) {
            return Some("gzip".to_string());
        }

        // BZIP2
        if data.starts_with(&[0x42, 0x5A, 0x68]) {
            return Some("bzip2".to_string());
        }

        // XZ
        if data.starts_with(&[0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) {
            return Some("xz".to_string());
        }

        None
    }

    /// Check if data is SPK format
    pub fn is_spk(data: &[u8]) -> bool {
        data.len() >= 8 && &data[0..4] == b"SPK\x01"
    }
}

/// Interop converter for external formats
pub struct InteropConverter {
    registry: Arc<PluginRegistry>,
}

impl InteropConverter {
    /// Create new converter
    pub fn new(registry: Arc<PluginRegistry>) -> Self {
        Self { registry }
    }

    /// Import external format to SPK
    pub fn import(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        let format = FormatDetector::detect_format(data)
            .ok_or_else(|| SpkError::InvalidFormat("Unknown format".into()))?;

        let handlers = self.registry.format_handlers.read()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;

        let handler = handlers.get(&format)
            .ok_or_else(|| SpkError::InvalidFormat(format!("No handler for {}", format)))?;

        handler.convert_to_spk(data)
    }

    /// Export SPK to external format
    pub fn export(&self, _spk_data: &[u8], target_format: &str) -> SpkResult<Vec<u8>> {
        // Would convert SPK data to target format
        // For now, return error
        Err(SpkError::InvalidFormat(format!("Export to {} not implemented", target_format)))
    }

    /// Detect and list files in any format
    pub fn list_files_universal(&self, data: &[u8]) -> SpkResult<Vec<FileEntry>> {
        if FormatDetector::is_spk(data) {
            // Handle SPK format
            return Ok(Vec::new());
        }

        let format = FormatDetector::detect_format(data)
            .ok_or_else(|| SpkError::InvalidFormat("Unknown format".into()))?;

        let handlers = self.registry.format_handlers.read()
            .map_err(|_| SpkError::InvalidFormat("Lock poisoned".into()))?;

        let handler = handlers.get(&format)
            .ok_or_else(|| SpkError::InvalidFormat(format!("No handler for {}", format)))?;

        handler.list_files(data)
    }
}

/// Extension block manager
pub struct ExtensionManager {
    /// Current extension block
    block: ExtensionBlock,
}

impl ExtensionManager {
    /// Create new extension manager
    pub fn new() -> Self {
        Self {
            block: ExtensionBlock {
                version: 1,
                features: FeatureFlags::default(),
                plugins: Vec::new(),
                schemas: HashMap::new(),
                custom_data: HashMap::new(),
            },
        }
    }

    /// Add plugin to extension block
    pub fn add_plugin(&mut self, plugin_id: String) {
        self.block.plugins.push(plugin_id);
        self.block.features.has_plugin_hooks = true;
    }

    /// Register schema
    pub fn register_schema(&mut self, schema: SchemaDefinition) {
        let name = schema.name.clone();
        self.block.schemas.insert(name, schema);
        self.block.features.has_extended_metadata = true;
    }

    /// Add custom metadata
    pub fn add_custom_data(&mut self, key: String, data: Vec<u8>) {
        self.block.custom_data.insert(key, data);
    }

    /// Serialize extension block
    pub fn serialize(&self) -> SpkResult<Vec<u8>> {
        serde_json::to_vec(&self.block)
            .map_err(|e| SpkError::SerializationError(e.to_string()))
    }

    /// Deserialize extension block
    pub fn deserialize(data: &[u8]) -> SpkResult<Self> {
        let block: ExtensionBlock = serde_json::from_slice(data)
            .map_err(|e| SpkError::SerializationError(e.to_string()))?;
        Ok(Self { block })
    }

    /// Get extension block
    pub fn block(&self) -> &ExtensionBlock {
        &self.block
    }
}

impl Default for ExtensionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_registry() {
        let registry = PluginRegistry::new();
        assert!(registry.list_codecs().unwrap().is_empty());
    }

    #[test]
    fn test_format_detection() {
        let zip_data = vec![0x50, 0x4B, 0x03, 0x04];
        assert_eq!(FormatDetector::detect_format(&zip_data), Some("zip".to_string()));

        let gzip_data = vec![0x1F, 0x8B];
        assert_eq!(FormatDetector::detect_format(&gzip_data), Some("gzip".to_string()));
    }

    #[test]
    fn test_spk_detection() {
        let spk_data = b"SPK\x01test data";
        assert!(FormatDetector::is_spk(spk_data));

        let not_spk = b"notspk";
        assert!(!FormatDetector::is_spk(not_spk));
    }

    #[test]
    fn test_container_manager() {
        let mut manager = ContainerManager::new();
        let container = MountedContainer {
            id: "test".to_string(),
            parent: None,
            mount_path: "/mnt/test".to_string(),
            format: "spk".to_string(),
            writable: true,
        };
        manager.mount(container).unwrap();
        assert_eq!(manager.list_mounted().len(), 1);
    }

    #[test]
    fn test_extension_manager() {
        let mut manager = ExtensionManager::new();
        manager.add_plugin("custom-codec".to_string());
        assert_eq!(manager.block.plugins.len(), 1);
        assert!(manager.block.features.has_plugin_hooks);
    }

    #[test]
    fn test_cross_references() {
        let mut manager = ContainerManager::new();
        let reference = ChunkReference {
            source_container: "container1".to_string(),
            source_chunk: 0,
            target_container: "container2".to_string(),
            target_chunk: 5,
        };
        manager.add_cross_reference(reference).unwrap();
        assert_eq!(manager.get_cross_references("container1").len(), 1);
    }
}
