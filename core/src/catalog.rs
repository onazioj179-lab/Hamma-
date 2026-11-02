//! # SPK File Catalog - HAMMA-Managed File Registry
//! 
//! Intelligent file catalog with:
//! - Serial number generation (SPK-YYYYMMDD-XXXXXX)
//! - Auto-labeling and tagging
//! - File summoning by serial/name/tag
//! - Cross-device sync support
//! - HAMMA neural network organization

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// File status in catalog
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileStatus {
    /// File is stored and accessible
    Active,
    /// File is being processed
    Processing,
    /// File is archived (compressed, may need extraction)
    Archived,
    /// File is being transferred
    Transferring,
    /// File is deleted (soft delete, can be recovered)
    Deleted,
    /// File has errors
    Error,
}

/// File type classification (HAMMA auto-detection)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileType {
    /// Document (pdf, doc, txt, etc.)
    Document,
    /// Image (jpg, png, gif, etc.)
    Image,
    /// Video (mp4, mkv, avi, etc.)
    Video,
    /// Audio (mp3, wav, flac, etc.)
    Audio,
    /// Archive (zip, tar, rar, etc.)
    Archive,
    /// Code/Source file
    Code,
    /// Data file (csv, json, xml, etc.)
    Data,
    /// Executable/Binary
    Binary,
    /// Unknown type
    Unknown,
}

impl FileType {
    /// Detect file type from extension
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            // Documents
            "pdf" | "doc" | "docx" | "txt" | "rtf" | "odt" | "xls" | "xlsx" | "ppt" | "pptx" => FileType::Document,
            // Images
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "ico" | "tiff" | "raw" => FileType::Image,
            // Videos
            "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpeg" => FileType::Video,
            // Audio
            "mp3" | "wav" | "flac" | "aac" | "ogg" | "wma" | "m4a" | "opus" => FileType::Audio,
            // Archives
            "zip" | "tar" | "gz" | "rar" | "7z" | "bz2" | "xz" | "spk" => FileType::Archive,
            // Code
            "rs" | "py" | "js" | "ts" | "java" | "c" | "cpp" | "h" | "go" | "rb" | "php" | "swift" | "kt" => FileType::Code,
            // Data
            "json" | "xml" | "csv" | "yaml" | "yml" | "toml" | "sql" | "db" => FileType::Data,
            // Binary
            "exe" | "dll" | "so" | "dylib" | "bin" | "dat" => FileType::Binary,
            // Unknown
            _ => FileType::Unknown,
        }
    }
    
    /// Get icon for file type
    pub fn icon(&self) -> &'static str {
        match self {
            FileType::Document => "📄",
            FileType::Image => "🖼️",
            FileType::Video => "🎬",
            FileType::Audio => "🎵",
            FileType::Archive => "📦",
            FileType::Code => "💻",
            FileType::Data => "📊",
            FileType::Binary => "⚙️",
            FileType::Unknown => "📁",
        }
    }
    
    /// Get category name
    pub fn category(&self) -> &'static str {
        match self {
            FileType::Document => "Documents",
            FileType::Image => "Images",
            FileType::Video => "Videos",
            FileType::Audio => "Audio",
            FileType::Archive => "Archives",
            FileType::Code => "Code",
            FileType::Data => "Data",
            FileType::Binary => "Binaries",
            FileType::Unknown => "Other",
        }
    }
}

/// Compression info for a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionInfo {
    /// Original file size
    pub original_size: u64,
    /// Compressed size
    pub compressed_size: u64,
    /// Compression ratio
    pub ratio: f64,
    /// Codec used
    pub codec: String,
    /// Compression level
    pub level: i32,
    /// Time taken to compress (ms)
    pub compression_time_ms: u64,
    /// HAMMA speed mode used
    pub speed_mode: String,
}

impl CompressionInfo {
    /// Calculate savings
    pub fn savings(&self) -> u64 {
        self.original_size.saturating_sub(self.compressed_size)
    }
    
    /// Get savings percentage
    pub fn savings_percent(&self) -> f64 {
        if self.original_size == 0 {
            return 0.0;
        }
        (self.savings() as f64 / self.original_size as f64) * 100.0
    }
}

/// Catalog entry for a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    /// Unique serial number (SPK-YYYYMMDD-XXXXXX)
    pub serial: String,
    /// Owner account ID
    pub account_id: String,
    /// Original filename
    pub filename: String,
    /// File extension
    pub extension: String,
    /// File type (auto-detected)
    pub file_type: FileType,
    /// User-defined label
    pub label: Option<String>,
    /// Tags for organization
    pub tags: Vec<String>,
    /// HAMMA auto-generated description
    pub description: Option<String>,
    /// File status
    pub status: FileStatus,
    /// Original file size (bytes)
    pub size: u64,
    /// Content hash (BLAKE3)
    pub content_hash: String,
    /// Storage location (archive path or chunk references)
    pub storage_path: String,
    /// Compression info (if compressed)
    pub compression: Option<CompressionInfo>,
    /// Creation timestamp
    pub created_at: u64,
    /// Last modified timestamp
    pub modified_at: u64,
    /// Last accessed timestamp
    pub accessed_at: u64,
    /// Device that uploaded the file
    pub source_device: Option<String>,
    /// Custom metadata
    pub metadata: HashMap<String, String>,
}

impl CatalogEntry {
    /// Generate a new serial number
    pub fn generate_serial() -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        
        let secs = now.as_secs();
        let nanos = now.subsec_nanos();
        
        // Format: SPK-YYYYMMDD-XXXXXX
        let datetime = chrono::Utc::now();
        let date_part = datetime.format("%Y%m%d").to_string();
        
        // Generate unique suffix from time + random
        let mut hasher = Sha256::new();
        hasher.update(secs.to_le_bytes());
        hasher.update(nanos.to_le_bytes());
        hasher.update(uuid::Uuid::new_v4().as_bytes());
        let hash = hasher.finalize();
        
        let suffix = &hex::encode(&hash[..3]).to_uppercase();
        
        format!("SPK-{}-{}", date_part, suffix)
    }
    
    /// Create a new catalog entry
    pub fn new(
        account_id: String,
        filename: String,
        size: u64,
        content_hash: String,
        storage_path: String,
    ) -> Self {
        let extension = Path::new(&filename)
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        
        let file_type = FileType::from_extension(&extension);
        
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        Self {
            serial: Self::generate_serial(),
            account_id,
            filename,
            extension,
            file_type,
            label: None,
            tags: Vec::new(),
            description: None,
            status: FileStatus::Active,
            size,
            content_hash,
            storage_path,
            compression: None,
            created_at: now,
            modified_at: now,
            accessed_at: now,
            source_device: None,
            metadata: HashMap::new(),
        }
    }
    
    /// Add a tag
    pub fn add_tag(&mut self, tag: String) {
        let tag = tag.to_lowercase().trim().to_string();
        if !tag.is_empty() && !self.tags.contains(&tag) {
            self.tags.push(tag);
        }
    }
    
    /// Remove a tag
    pub fn remove_tag(&mut self, tag: &str) {
        self.tags.retain(|t| t != tag.to_lowercase().as_str());
    }
    
    /// Set label
    pub fn set_label(&mut self, label: String) {
        self.label = Some(label);
        self.modified_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }
    
    /// Update access time
    pub fn touch(&mut self) {
        self.accessed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }
    
    /// Get formatted size
    pub fn formatted_size(&self) -> String {
        format_bytes(self.size)
    }
    
    /// Get display name (label or filename)
    pub fn display_name(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.filename)
    }
    
    /// Check if matches search query
    pub fn matches(&self, query: &str) -> bool {
        let query = query.to_lowercase();
        
        // Check serial
        if self.serial.to_lowercase().contains(&query) {
            return true;
        }
        
        // Check filename
        if self.filename.to_lowercase().contains(&query) {
            return true;
        }
        
        // Check label
        if let Some(ref label) = self.label {
            if label.to_lowercase().contains(&query) {
                return true;
            }
        }
        
        // Check tags
        for tag in &self.tags {
            if tag.contains(&query) {
                return true;
            }
        }
        
        // Check description
        if let Some(ref desc) = self.description {
            if desc.to_lowercase().contains(&query) {
                return true;
            }
        }
        
        false
    }
}

/// Catalog error types
#[derive(Debug, Clone)]
pub enum CatalogError {
    /// Entry not found
    NotFound(String),
    /// Entry already exists
    AlreadyExists(String),
    /// Permission denied
    PermissionDenied(String),
    /// IO error
    IoError(String),
    /// Serialization error
    SerializationError(String),
}

impl std::fmt::Display for CatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CatalogError::NotFound(id) => write!(f, "Catalog entry not found: {}", id),
            CatalogError::AlreadyExists(id) => write!(f, "Catalog entry already exists: {}", id),
            CatalogError::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
            CatalogError::IoError(msg) => write!(f, "IO error: {}", msg),
            CatalogError::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
        }
    }
}

impl std::error::Error for CatalogError {}

/// Format bytes to human readable
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;
    
    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// File catalog manager
pub struct FileCatalog {
    /// Storage path for catalog data
    storage_path: PathBuf,
    /// In-memory catalog cache (serial -> entry)
    entries: Arc<RwLock<HashMap<String, CatalogEntry>>>,
    /// Hash to serial index (for dedup lookup)
    hash_index: Arc<RwLock<HashMap<String, String>>>,
    /// Account to serials index
    account_index: Arc<RwLock<HashMap<String, Vec<String>>>>,
    /// Tag to serials index
    tag_index: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl FileCatalog {
    /// Create a new file catalog
    pub fn new<P: AsRef<Path>>(storage_path: P) -> Result<Self, CatalogError> {
        let storage_path = storage_path.as_ref().to_path_buf();
        fs::create_dir_all(&storage_path)
            .map_err(|e| CatalogError::IoError(e.to_string()))?;
        
        let catalog = Self {
            storage_path,
            entries: Arc::new(RwLock::new(HashMap::new())),
            hash_index: Arc::new(RwLock::new(HashMap::new())),
            account_index: Arc::new(RwLock::new(HashMap::new())),
            tag_index: Arc::new(RwLock::new(HashMap::new())),
        };
        
        // Load existing entries
        catalog.load_catalog()?;
        
        Ok(catalog)
    }
    
    /// Load catalog from disk
    fn load_catalog(&self) -> Result<(), CatalogError> {
        let catalog_file = self.storage_path.join("catalog.json");
        
        if !catalog_file.exists() {
            return Ok(());
        }
        
        let mut file = File::open(&catalog_file)
            .map_err(|e| CatalogError::IoError(e.to_string()))?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| CatalogError::IoError(e.to_string()))?;
        
        let stored: Vec<CatalogEntry> = serde_json::from_str(&contents)
            .map_err(|e| CatalogError::SerializationError(e.to_string()))?;
        
        let mut entries = self.entries.write().unwrap();
        let mut hash_index = self.hash_index.write().unwrap();
        let mut account_index = self.account_index.write().unwrap();
        let mut tag_index = self.tag_index.write().unwrap();
        
        for entry in stored {
            // Update indices
            hash_index.insert(entry.content_hash.clone(), entry.serial.clone());
            
            account_index
                .entry(entry.account_id.clone())
                .or_default()
                .push(entry.serial.clone());
            
            for tag in &entry.tags {
                tag_index
                    .entry(tag.clone())
                    .or_default()
                    .push(entry.serial.clone());
            }
            
            entries.insert(entry.serial.clone(), entry);
        }
        
        Ok(())
    }
    
    /// Save catalog to disk
    fn save_catalog(&self) -> Result<(), CatalogError> {
        let entries = self.entries.read().unwrap();
        let all_entries: Vec<&CatalogEntry> = entries.values().collect();
        
        let json = serde_json::to_string_pretty(&all_entries)
            .map_err(|e| CatalogError::SerializationError(e.to_string()))?;
        
        let catalog_file = self.storage_path.join("catalog.json");
        let mut file = File::create(&catalog_file)
            .map_err(|e| CatalogError::IoError(e.to_string()))?;
        file.write_all(json.as_bytes())
            .map_err(|e| CatalogError::IoError(e.to_string()))?;
        
        Ok(())
    }
    
    /// Add a new entry to the catalog
    pub fn add_entry(&self, entry: CatalogEntry) -> Result<String, CatalogError> {
        let serial = entry.serial.clone();
        
        {
            let mut entries = self.entries.write().unwrap();
            
            if entries.contains_key(&serial) {
                return Err(CatalogError::AlreadyExists(serial));
            }
            
            // Update indices
            let mut hash_index = self.hash_index.write().unwrap();
            let mut account_index = self.account_index.write().unwrap();
            let mut tag_index = self.tag_index.write().unwrap();
            
            hash_index.insert(entry.content_hash.clone(), serial.clone());
            
            account_index
                .entry(entry.account_id.clone())
                .or_default()
                .push(serial.clone());
            
            for tag in &entry.tags {
                tag_index
                    .entry(tag.clone())
                    .or_default()
                    .push(serial.clone());
            }
            
            entries.insert(serial.clone(), entry);
        }
        
        self.save_catalog()?;
        
        Ok(serial)
    }
    
    /// Get entry by serial (summon file)
    pub fn summon(&self, serial: &str) -> Result<CatalogEntry, CatalogError> {
        let mut entries = self.entries.write().unwrap();
        
        let entry = entries.get_mut(serial)
            .ok_or_else(|| CatalogError::NotFound(serial.to_string()))?;
        
        entry.touch();
        
        Ok(entry.clone())
    }
    
    /// Get entry by content hash
    pub fn find_by_hash(&self, hash: &str) -> Option<CatalogEntry> {
        let hash_index = self.hash_index.read().unwrap();
        let serial = hash_index.get(hash)?;
        
        let entries = self.entries.read().unwrap();
        entries.get(serial).cloned()
    }
    
    /// Get all entries for an account
    pub fn list_account_files(&self, account_id: &str) -> Vec<CatalogEntry> {
        let account_index = self.account_index.read().unwrap();
        let entries = self.entries.read().unwrap();
        
        account_index
            .get(account_id)
            .map(|serials| {
                serials
                    .iter()
                    .filter_map(|s| entries.get(s).cloned())
                    .filter(|e| e.status != FileStatus::Deleted)
                    .collect()
            })
            .unwrap_or_default()
    }
    
    /// Get files by tag
    pub fn list_by_tag(&self, tag: &str) -> Vec<CatalogEntry> {
        let tag_index = self.tag_index.read().unwrap();
        let entries = self.entries.read().unwrap();
        
        let tag = tag.to_lowercase();
        
        tag_index
            .get(&tag)
            .map(|serials| {
                serials
                    .iter()
                    .filter_map(|s| entries.get(s).cloned())
                    .filter(|e| e.status != FileStatus::Deleted)
                    .collect()
            })
            .unwrap_or_default()
    }
    
    /// Get files by type
    pub fn list_by_type(&self, account_id: &str, file_type: FileType) -> Vec<CatalogEntry> {
        self.list_account_files(account_id)
            .into_iter()
            .filter(|e| e.file_type == file_type)
            .collect()
    }
    
    /// Search files
    pub fn search(&self, account_id: &str, query: &str) -> Vec<CatalogEntry> {
        self.list_account_files(account_id)
            .into_iter()
            .filter(|e| e.matches(query))
            .collect()
    }
    
    /// Update entry
    pub fn update_entry(&self, entry: CatalogEntry) -> Result<(), CatalogError> {
        let serial = entry.serial.clone();
        
        {
            let mut entries = self.entries.write().unwrap();
            
            if !entries.contains_key(&serial) {
                return Err(CatalogError::NotFound(serial));
            }
            
            // Update tag index if tags changed
            if let Some(old_entry) = entries.get(&serial) {
                let mut tag_index = self.tag_index.write().unwrap();
                
                // Remove old tags
                for tag in &old_entry.tags {
                    if let Some(serials) = tag_index.get_mut(tag) {
                        serials.retain(|s| s != &serial);
                    }
                }
                
                // Add new tags
                for tag in &entry.tags {
                    tag_index
                        .entry(tag.clone())
                        .or_default()
                        .push(serial.clone());
                }
            }
            
            entries.insert(serial, entry);
        }
        
        self.save_catalog()?;
        
        Ok(())
    }
    
    /// Delete entry (soft delete)
    pub fn delete_entry(&self, serial: &str) -> Result<(), CatalogError> {
        {
            let mut entries = self.entries.write().unwrap();
            
            let entry = entries.get_mut(serial)
                .ok_or_else(|| CatalogError::NotFound(serial.to_string()))?;
            
            entry.status = FileStatus::Deleted;
            entry.modified_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
        }
        
        self.save_catalog()?;
        
        Ok(())
    }
    
    /// Permanently remove entry
    pub fn purge_entry(&self, serial: &str) -> Result<(), CatalogError> {
        {
            let mut entries = self.entries.write().unwrap();
            let mut hash_index = self.hash_index.write().unwrap();
            let mut account_index = self.account_index.write().unwrap();
            let mut tag_index = self.tag_index.write().unwrap();
            
            let entry = entries.remove(serial)
                .ok_or_else(|| CatalogError::NotFound(serial.to_string()))?;
            
            // Remove from indices
            hash_index.remove(&entry.content_hash);
            
            if let Some(serials) = account_index.get_mut(&entry.account_id) {
                serials.retain(|s| s != serial);
            }
            
            for tag in &entry.tags {
                if let Some(serials) = tag_index.get_mut(tag) {
                    serials.retain(|s| s != serial);
                }
            }
        }
        
        self.save_catalog()?;
        
        Ok(())
    }
    
    /// Get catalog statistics for an account
    pub fn get_stats(&self, account_id: &str) -> CatalogStats {
        let files = self.list_account_files(account_id);
        
        let mut stats = CatalogStats::default();
        stats.total_files = files.len() as u64;
        
        for file in &files {
            stats.total_size += file.size;
            
            if let Some(ref comp) = file.compression {
                stats.compressed_size += comp.compressed_size;
                stats.savings += comp.savings();
            }
            
            *stats.by_type.entry(file.file_type.category().to_string()).or_insert(0) += 1;
        }
        
        if stats.total_size > 0 {
            stats.compression_ratio = stats.total_size as f64 / stats.compressed_size.max(1) as f64;
        }
        
        stats
    }
    
    /// Get all tags for an account
    pub fn get_account_tags(&self, account_id: &str) -> Vec<String> {
        let files = self.list_account_files(account_id);
        let mut tags: Vec<String> = files
            .iter()
            .flat_map(|f| f.tags.iter().cloned())
            .collect();
        
        tags.sort();
        tags.dedup();
        tags
    }
    
    /// HAMMA auto-label suggestion
    pub fn suggest_label(&self, entry: &CatalogEntry) -> String {
        // Simple auto-label based on file type and date
        let date = chrono::Utc::now().format("%Y-%m-%d");
        let type_name = entry.file_type.category();
        
        // Remove extension from filename
        let name = Path::new(&entry.filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| entry.filename.clone());
        
        format!("{} - {} ({})", type_name, name, date)
    }
    
    /// HAMMA auto-tag suggestion
    pub fn suggest_tags(&self, entry: &CatalogEntry) -> Vec<String> {
        let mut tags = Vec::new();
        
        // Add file type tag
        tags.push(entry.file_type.category().to_lowercase());
        
        // Add extension tag
        if !entry.extension.is_empty() {
            tags.push(entry.extension.to_lowercase());
        }
        
        // Add size category tag
        if entry.size > 1024 * 1024 * 1024 {
            tags.push("large".to_string());
        } else if entry.size > 100 * 1024 * 1024 {
            tags.push("medium".to_string());
        } else {
            tags.push("small".to_string());
        }
        
        tags
    }
}

/// Catalog statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CatalogStats {
    /// Total number of files
    pub total_files: u64,
    /// Total size of all files
    pub total_size: u64,
    /// Total compressed size
    pub compressed_size: u64,
    /// Total savings from compression
    pub savings: u64,
    /// Overall compression ratio
    pub compression_ratio: f64,
    /// Files by type
    pub by_type: HashMap<String, u64>,
}

impl CatalogStats {
    /// Get formatted total size
    pub fn formatted_total_size(&self) -> String {
        format_bytes(self.total_size)
    }
    
    /// Get formatted compressed size
    pub fn formatted_compressed_size(&self) -> String {
        format_bytes(self.compressed_size)
    }
    
    /// Get formatted savings
    pub fn formatted_savings(&self) -> String {
        format_bytes(self.savings)
    }
    
    /// Get savings percentage
    pub fn savings_percent(&self) -> f64 {
        if self.total_size == 0 {
            return 0.0;
        }
        (self.savings as f64 / self.total_size as f64) * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[test]
    fn test_serial_generation() {
        let serial1 = CatalogEntry::generate_serial();
        let serial2 = CatalogEntry::generate_serial();
        
        assert!(serial1.starts_with("SPK-"));
        assert!(serial2.starts_with("SPK-"));
        assert_ne!(serial1, serial2);
    }
    
    #[test]
    fn test_file_type_detection() {
        assert_eq!(FileType::from_extension("pdf"), FileType::Document);
        assert_eq!(FileType::from_extension("jpg"), FileType::Image);
        assert_eq!(FileType::from_extension("mp4"), FileType::Video);
        assert_eq!(FileType::from_extension("mp3"), FileType::Audio);
        assert_eq!(FileType::from_extension("zip"), FileType::Archive);
        assert_eq!(FileType::from_extension("rs"), FileType::Code);
        assert_eq!(FileType::from_extension("json"), FileType::Data);
        assert_eq!(FileType::from_extension("exe"), FileType::Binary);
        assert_eq!(FileType::from_extension("xyz"), FileType::Unknown);
    }
    
    #[test]
    fn test_catalog_entry() {
        let entry = CatalogEntry::new(
            "account123".to_string(),
            "test.pdf".to_string(),
            1024,
            "hash123".to_string(),
            "/storage/test.spk".to_string(),
        );
        
        assert!(entry.serial.starts_with("SPK-"));
        assert_eq!(entry.filename, "test.pdf");
        assert_eq!(entry.extension, "pdf");
        assert_eq!(entry.file_type, FileType::Document);
        assert_eq!(entry.size, 1024);
    }
    
    #[test]
    fn test_catalog_crud() {
        let dir = tempdir().unwrap();
        let catalog = FileCatalog::new(dir.path()).unwrap();
        
        // Create entry
        let entry = CatalogEntry::new(
            "account123".to_string(),
            "test.pdf".to_string(),
            1024,
            "hash123".to_string(),
            "/storage/test.spk".to_string(),
        );
        
        let serial = catalog.add_entry(entry.clone()).unwrap();
        
        // Read entry
        let retrieved = catalog.summon(&serial).unwrap();
        assert_eq!(retrieved.filename, "test.pdf");
        
        // List by account
        let files = catalog.list_account_files("account123");
        assert_eq!(files.len(), 1);
        
        // Search
        let results = catalog.search("account123", "test");
        assert_eq!(results.len(), 1);
        
        // Delete
        catalog.delete_entry(&serial).unwrap();
        let files = catalog.list_account_files("account123");
        assert_eq!(files.len(), 0);
    }
    
    #[test]
    fn test_tags() {
        let dir = tempdir().unwrap();
        let catalog = FileCatalog::new(dir.path()).unwrap();
        
        let mut entry = CatalogEntry::new(
            "account123".to_string(),
            "test.pdf".to_string(),
            1024,
            "hash123".to_string(),
            "/storage/test.spk".to_string(),
        );
        
        entry.add_tag("work".to_string());
        entry.add_tag("important".to_string());
        
        let serial = catalog.add_entry(entry).unwrap();
        
        // Find by tag
        let files = catalog.list_by_tag("work");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].serial, serial);
    }
}
