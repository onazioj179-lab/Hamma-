//! # SPK V13: Semantic Compression + Data Understanding
//!
//! Content-aware compression through semantic analysis and fingerprinting.
//! Enables intelligent deduplication at the semantic level.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::blake3_hash;

/// V13 version constant
pub const V13_SEMANTIC_VERSION: u8 = 13;

/// Maximum semantic tags per chunk
pub const V13_MAX_TAGS_PER_CHUNK: usize = 16;

/// Semantic fingerprint size in bytes
pub const V13_FINGERPRINT_SIZE: usize = 32;

// =============================================================================
// CONTENT TYPE DETECTION
// =============================================================================

/// Content type categories for semantic analysis
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ContentType {
    Text,
    SourceCode,
    Binary,
    Image,
    Audio,
    Video,
    Document,
    Data,
    Unknown,
}

/// Programming language detection for code
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LanguageType {
    Rust,
    Python,
    JavaScript,
    TypeScript,
    C,
    Cpp,
    Go,
    Java,
    CSharp,
    Assembly,
    Other,
}

// =============================================================================
// SEMANTIC FINGERPRINTING
// =============================================================================

/// Semantic fingerprint for content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticFingerprint {
    /// Fingerprint hash (32 bytes)
    pub hash: [u8; V13_FINGERPRINT_SIZE],
    /// Content type
    pub content_type: ContentType,
    /// Language (if source code)
    pub language: Option<LanguageType>,
    /// Semantic tags (compact binary)
    pub tags: Vec<SemanticTag>,
    /// Similarity score hint
    pub similarity_hint: f32,
    /// Feature vector (simplified for binary representation)
    pub features: Vec<f32>,
}

/// Compact semantic tag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTag {
    /// Tag type ID (compact)
    pub tag_type: u16,
    /// Tag value hash
    pub value: u32,
    /// Confidence score
    pub confidence: f32,
}

impl SemanticFingerprint {
    /// Create fingerprint from data
    pub fn from_data(data: &[u8]) -> Self {
        let hash_vec = blake3_hash(data);
        let mut hash = [0u8; V13_FINGERPRINT_SIZE];
        hash.copy_from_slice(&hash_vec);

        let content_type = detect_content_type(data);
        let language = if content_type == ContentType::SourceCode {
            Some(detect_language(data))
        } else {
            None
        };

        let tags = extract_semantic_tags(data, content_type);
        let features = extract_features(data, content_type);
        
        Self {
            hash,
            content_type,
            language,
            tags,
            similarity_hint: 0.0,
            features,
        }
    }

    /// Calculate similarity with another fingerprint
    pub fn similarity(&self, other: &Self) -> f32 {
        if self.content_type != other.content_type {
            return 0.0;
        }

        // Feature vector cosine similarity
        if self.features.is_empty() || other.features.is_empty() {
            return 0.0;
        }

        let dot: f32 = self.features.iter()
            .zip(other.features.iter())
            .map(|(a, b)| a * b)
            .sum();

        let norm_a: f32 = self.features.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = other.features.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        (dot / (norm_a * norm_b)).clamp(0.0, 1.0)
    }
}

// =============================================================================
// FUNCTION-LEVEL DEDUPLICATION
// =============================================================================

/// Function signature for code deduplication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionSignature {
    /// Function name hash
    pub name_hash: u64,
    /// Parameter types hash
    pub params_hash: u64,
    /// Body hash (normalized)
    pub body_hash: [u8; 32],
    /// Language
    pub language: LanguageType,
}

/// Function-level deduplication index
#[derive(Debug, Clone)]
pub struct FunctionIndex {
    /// Map of function signatures to chunk IDs
    functions: Arc<RwLock<HashMap<u64, Vec<(usize, FunctionSignature)>>>>,
}

impl FunctionIndex {
    /// Create new function index
    pub fn new() -> Self {
        Self {
            functions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Extract and index functions from code
    pub fn index_code(&self, chunk_id: usize, data: &[u8], language: LanguageType) -> SpkResult<Vec<FunctionSignature>> {
        let functions = extract_functions(data, language)?;
        
        let mut index = self.functions.write()
            .map_err(|_| SpkError::LockError("Failed to acquire function index lock".into()))?;

        for func in &functions {
            let key = func.name_hash ^ func.params_hash;
            index.entry(key)
                .or_insert_with(Vec::new)
                .push((chunk_id, func.clone()));
        }

        Ok(functions)
    }

    /// Find similar functions
    pub fn find_similar(&self, signature: &FunctionSignature) -> SpkResult<Vec<usize>> {
        let index = self.functions.read()
            .map_err(|_| SpkError::LockError("Failed to acquire function index lock".into()))?;

        let key = signature.name_hash ^ signature.params_hash;
        
        Ok(index.get(&key)
            .map(|entries| entries.iter().map(|(chunk_id, _)| *chunk_id).collect())
            .unwrap_or_default())
    }

    /// Get statistics
    pub fn stats(&self) -> SpkResult<FunctionIndexStats> {
        let index = self.functions.read()
            .map_err(|_| SpkError::LockError("Failed to acquire function index lock".into()))?;

        let total_functions: usize = index.values().map(|v| v.len()).sum();
        
        Ok(FunctionIndexStats {
            unique_signatures: index.len(),
            total_functions,
            dedup_ratio: if total_functions > 0 {
                index.len() as f64 / total_functions as f64
            } else {
                1.0
            },
        })
    }
}

impl Default for FunctionIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Function index statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionIndexStats {
    pub unique_signatures: usize,
    pub total_functions: usize,
    pub dedup_ratio: f64,
}

// =============================================================================
// SEMANTIC GROUPING
// =============================================================================

/// Semantic group of related chunks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticGroup {
    /// Group ID
    pub id: u64,
    /// Chunk IDs in this group
    pub chunk_ids: Vec<usize>,
    /// Representative fingerprint
    pub fingerprint: SemanticFingerprint,
    /// Average similarity within group
    pub cohesion: f32,
}

/// Cross-file semantic grouping manager
#[derive(Debug, Clone)]
pub struct SemanticGroupManager {
    /// Groups by ID
    groups: Arc<RwLock<HashMap<u64, SemanticGroup>>>,
    /// Chunk to group mapping
    chunk_to_group: Arc<RwLock<HashMap<usize, u64>>>,
    /// Next group ID
    next_id: Arc<RwLock<u64>>,
}

impl SemanticGroupManager {
    /// Create new manager
    pub fn new() -> Self {
        Self {
            groups: Arc::new(RwLock::new(HashMap::new())),
            chunk_to_group: Arc::new(RwLock::new(HashMap::new())),
            next_id: Arc::new(RwLock::new(0)),
        }
    }

    /// Add chunk and find/create group
    pub fn add_chunk(&self, chunk_id: usize, fingerprint: SemanticFingerprint, threshold: f32) -> SpkResult<u64> {
        let groups = self.groups.read()
            .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;

        // Find best matching group
        let mut best_group: Option<(u64, f32)> = None;

        for (group_id, group) in groups.iter() {
            let similarity = fingerprint.similarity(&group.fingerprint);
            if similarity >= threshold {
                if let Some((_, best_sim)) = best_group {
                    if similarity > best_sim {
                        best_group = Some((*group_id, similarity));
                    }
                } else {
                    best_group = Some((*group_id, similarity));
                }
            }
        }

        drop(groups);

        if let Some((group_id, _)) = best_group {
            // Add to existing group
            self.add_to_group(group_id, chunk_id)?;
            Ok(group_id)
        } else {
            // Create new group
            self.create_group(chunk_id, fingerprint)
        }
    }

    /// Create new group
    fn create_group(&self, chunk_id: usize, fingerprint: SemanticFingerprint) -> SpkResult<u64> {
        let mut next_id = self.next_id.write()
            .map_err(|_| SpkError::LockError("Failed to acquire next_id lock".into()))?;
        
        let group_id = *next_id;
        *next_id += 1;
        drop(next_id);

        let group = SemanticGroup {
            id: group_id,
            chunk_ids: vec![chunk_id],
            fingerprint,
            cohesion: 1.0,
        };

        let mut groups = self.groups.write()
            .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;
        groups.insert(group_id, group);
        drop(groups);

        let mut mapping = self.chunk_to_group.write()
            .map_err(|_| SpkError::LockError("Failed to acquire mapping lock".into()))?;
        mapping.insert(chunk_id, group_id);

        Ok(group_id)
    }

    /// Add chunk to existing group
    fn add_to_group(&self, group_id: u64, chunk_id: usize) -> SpkResult<()> {
        let mut groups = self.groups.write()
            .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;

        if let Some(group) = groups.get_mut(&group_id) {
            group.chunk_ids.push(chunk_id);
        }
        drop(groups);

        let mut mapping = self.chunk_to_group.write()
            .map_err(|_| SpkError::LockError("Failed to acquire mapping lock".into()))?;
        mapping.insert(chunk_id, group_id);

        Ok(())
    }

    /// Get group for chunk
    pub fn get_group(&self, chunk_id: usize) -> SpkResult<Option<SemanticGroup>> {
        let mapping = self.chunk_to_group.read()
            .map_err(|_| SpkError::LockError("Failed to acquire mapping lock".into()))?;

        if let Some(group_id) = mapping.get(&chunk_id) {
            let groups = self.groups.read()
                .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;
            Ok(groups.get(group_id).cloned())
        } else {
            Ok(None)
        }
    }

    /// Get all groups
    pub fn get_all_groups(&self) -> SpkResult<Vec<SemanticGroup>> {
        let groups = self.groups.read()
            .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;
        Ok(groups.values().cloned().collect())
    }

    /// Get statistics
    pub fn stats(&self) -> SpkResult<GroupStats> {
        let groups = self.groups.read()
            .map_err(|_| SpkError::LockError("Failed to acquire groups lock".into()))?;

        let total_groups = groups.len();
        let total_chunks: usize = groups.values().map(|g| g.chunk_ids.len()).sum();
        let avg_group_size = if total_groups > 0 {
            total_chunks as f64 / total_groups as f64
        } else {
            0.0
        };

        Ok(GroupStats {
            total_groups,
            total_chunks,
            avg_group_size,
        })
    }
}

impl Default for SemanticGroupManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Group statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupStats {
    pub total_groups: usize,
    pub total_chunks: usize,
    pub avg_group_size: f64,
}

// =============================================================================
// SEMANTIC ANALYZER
// =============================================================================

/// Main semantic analyzer
pub struct SemanticAnalyzer {
    /// Function index
    function_index: FunctionIndex,
    /// Group manager
    group_manager: SemanticGroupManager,
    /// Configuration
    config: SemanticConfig,
}

/// Semantic analysis configuration
#[derive(Debug, Clone)]
pub struct SemanticConfig {
    /// Similarity threshold for grouping
    pub similarity_threshold: f32,
    /// Enable function-level deduplication
    pub function_dedup: bool,
    /// Maximum features per fingerprint
    pub max_features: usize,
}

impl Default for SemanticConfig {
    fn default() -> Self {
        Self {
            similarity_threshold: 0.7,
            function_dedup: true,
            max_features: 128,
        }
    }
}

impl SemanticAnalyzer {
    /// Create new analyzer
    pub fn new(config: SemanticConfig) -> Self {
        Self {
            function_index: FunctionIndex::new(),
            group_manager: SemanticGroupManager::new(),
            config,
        }
    }

    /// Analyze chunk and create fingerprint
    pub fn analyze_chunk(&self, chunk_id: usize, data: &[u8]) -> SpkResult<SemanticFingerprint> {
        let fingerprint = SemanticFingerprint::from_data(data);

        // Add to semantic group
        self.group_manager.add_chunk(chunk_id, fingerprint.clone(), self.config.similarity_threshold)?;

        // Index functions if code
        if fingerprint.content_type == ContentType::SourceCode && self.config.function_dedup {
            if let Some(language) = fingerprint.language {
                let _ = self.function_index.index_code(chunk_id, data, language);
            }
        }

        Ok(fingerprint)
    }

    /// Find similar chunks
    pub fn find_similar_chunks(&self, fingerprint: &SemanticFingerprint) -> SpkResult<Vec<usize>> {
        let groups = self.group_manager.get_all_groups()?;
        let mut similar = Vec::new();

        for group in groups {
            let similarity = fingerprint.similarity(&group.fingerprint);
            if similarity >= self.config.similarity_threshold {
                similar.extend(group.chunk_ids);
            }
        }

        Ok(similar)
    }

    /// Get group manager
    pub fn group_manager(&self) -> &SemanticGroupManager {
        &self.group_manager
    }

    /// Get function index
    pub fn function_index(&self) -> &FunctionIndex {
        &self.function_index
    }

    /// Get overall statistics
    pub fn stats(&self) -> SpkResult<SemanticStats> {
        let group_stats = self.group_manager.stats()?;
        let function_stats = self.function_index.stats()?;

        Ok(SemanticStats {
            group_stats,
            function_stats,
        })
    }
}

impl Default for SemanticAnalyzer {
    fn default() -> Self {
        Self::new(SemanticConfig::default())
    }
}

/// Overall semantic statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticStats {
    pub group_stats: GroupStats,
    pub function_stats: FunctionIndexStats,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Detect content type from data
fn detect_content_type(data: &[u8]) -> ContentType {
    if data.is_empty() {
        return ContentType::Unknown;
    }

    // Check for common file signatures
    if data.len() >= 4 {
        // Image formats
        if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return ContentType::Image; // JPEG
        }
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            return ContentType::Image; // PNG
        }
        // Audio/Video
        if data.starts_with(b"ID3") || data.starts_with(&[0xFF, 0xFB]) {
            return ContentType::Audio; // MP3
        }
        if data[4..8] == *b"ftyp" {
            return ContentType::Video; // MP4
        }
    }

    // Check if text/code
    let text_ratio = data.iter()
        .take(1024)
        .filter(|&&b| (b >= 32 && b <= 126) || b == b'\n' || b == b'\r' || b == b'\t')
        .count() as f32 / data.len().min(1024) as f32;

    if text_ratio > 0.9 {
        // Check for code patterns
        if is_source_code(data) {
            return ContentType::SourceCode;
        }
        return ContentType::Text;
    }

    ContentType::Binary
}

/// Check if data looks like source code
fn is_source_code(data: &[u8]) -> bool {
    let sample = std::str::from_utf8(&data[..data.len().min(512)]).unwrap_or("");
    
    // Look for common code patterns
    let code_indicators = [
        "fn ", "function ", "def ", "class ", "import ", "use ", "#include",
        "pub ", "const ", "let ", "var ", "=>", "->", "::", "//", "/*",
    ];

    code_indicators.iter().any(|indicator| sample.contains(indicator))
}

/// Detect programming language
fn detect_language(data: &[u8]) -> LanguageType {
    let sample = std::str::from_utf8(&data[..data.len().min(512)]).unwrap_or("");

    // Rust: Look for "fn " with other Rust-specific patterns
    if sample.contains("fn ") {
        if sample.contains("pub ") 
            || sample.contains("use crate::") 
            || sample.contains("let ")
            || sample.contains("mut ")
            || sample.contains("impl ")
            || sample.contains("trait ") {
            return LanguageType::Rust;
        }
    }
    
    if sample.contains("def ") && sample.contains("import ") {
        return LanguageType::Python;
    }
    if sample.contains("function ") || sample.contains("const ") || sample.contains("=>") {
        if sample.contains(": ") && sample.contains("interface ") {
            return LanguageType::TypeScript;
        }
        return LanguageType::JavaScript;
    }
    if sample.contains("package ") && sample.contains("class ") {
        return LanguageType::Java;
    }
    if sample.contains("#include") {
        if sample.contains("namespace ") || sample.contains("::") {
            return LanguageType::Cpp;
        }
        return LanguageType::C;
    }

    LanguageType::Other
}

/// Extract semantic tags from data
fn extract_semantic_tags(data: &[u8], content_type: ContentType) -> Vec<SemanticTag> {
    let mut tags = Vec::new();

    match content_type {
        ContentType::Text | ContentType::SourceCode => {
            // Extract language features
            if let Ok(text) = std::str::from_utf8(data) {
                let words: Vec<&str> = text.split_whitespace().take(100).collect();
                for word in words.iter().take(V13_MAX_TAGS_PER_CHUNK) {
                    tags.push(SemanticTag {
                        tag_type: 1, // Word tag
                        value: simple_hash(word.as_bytes()),
                        confidence: 0.8,
                    });
                }
            }
        }
        ContentType::Binary | ContentType::Image | ContentType::Audio | ContentType::Video => {
            // Extract binary patterns
            let pattern = data.chunks(4)
                .take(V13_MAX_TAGS_PER_CHUNK)
                .map(|chunk| {
                    let mut val = 0u32;
                    for (i, &b) in chunk.iter().enumerate() {
                        val |= (b as u32) << (i * 8);
                    }
                    val
                })
                .collect::<Vec<u32>>();

            for (i, &val) in pattern.iter().enumerate() {
                tags.push(SemanticTag {
                    tag_type: 2, // Pattern tag
                    value: val,
                    confidence: 0.5,
                });
                if i >= V13_MAX_TAGS_PER_CHUNK {
                    break;
                }
            }
        }
        _ => {}
    }

    tags
}

/// Extract feature vector from data
fn extract_features(data: &[u8], _content_type: ContentType) -> Vec<f32> {
    let mut features = vec![0.0f32; 32];

    // Byte frequency distribution (simplified)
    for &byte in data.iter().take(1024) {
        let idx = (byte / 8) as usize;
        if idx < 32 {
            features[idx] += 1.0;
        }
    }

    // Normalize
    let sum: f32 = features.iter().sum();
    if sum > 0.0 {
        for f in features.iter_mut() {
            *f /= sum;
        }
    }

    features
}

/// Extract functions from code
fn extract_functions(data: &[u8], language: LanguageType) -> SpkResult<Vec<FunctionSignature>> {
    let text = std::str::from_utf8(data)
        .map_err(|_| SpkError::InvalidData("Invalid UTF-8 in code".into()))?;

    let mut functions = Vec::new();

    match language {
        LanguageType::Rust => {
            // Simple regex-like parsing for Rust functions
            for line in text.lines() {
                if line.trim_start().starts_with("fn ") || line.trim_start().starts_with("pub fn ") {
                    if let Some(func) = parse_rust_function(line) {
                        functions.push(func);
                    }
                }
            }
        }
        LanguageType::Python => {
            for line in text.lines() {
                if line.trim_start().starts_with("def ") {
                    if let Some(func) = parse_python_function(line) {
                        functions.push(func);
                    }
                }
            }
        }
        _ => {
            // Generic function extraction
            for line in text.lines() {
                if line.contains('(') && line.contains(')') {
                    functions.push(FunctionSignature {
                        name_hash: simple_hash(line.as_bytes()) as u64,
                        params_hash: 0,
                        body_hash: [0u8; 32],
                        language,
                    });
                }
            }
        }
    }

    Ok(functions)
}

/// Parse Rust function signature
fn parse_rust_function(line: &str) -> Option<FunctionSignature> {
    let parts: Vec<&str> = line.split('(').collect();
    if parts.len() < 2 {
        return None;
    }

    let name_part = parts[0].split_whitespace().last()?;
    let params_part = parts[1].split(')').next()?;

    Some(FunctionSignature {
        name_hash: simple_hash(name_part.as_bytes()) as u64,
        params_hash: simple_hash(params_part.as_bytes()) as u64,
        body_hash: [0u8; 32],
        language: LanguageType::Rust,
    })
}

/// Parse Python function signature
fn parse_python_function(line: &str) -> Option<FunctionSignature> {
    let parts: Vec<&str> = line.split('(').collect();
    if parts.len() < 2 {
        return None;
    }

    let name_part = parts[0].split_whitespace().last()?;
    let params_part = parts[1].split(')').next()?;

    Some(FunctionSignature {
        name_hash: simple_hash(name_part.as_bytes()) as u64,
        params_hash: simple_hash(params_part.as_bytes()) as u64,
        body_hash: [0u8; 32],
        language: LanguageType::Python,
    })
}

/// Simple hash function for tags
fn simple_hash(data: &[u8]) -> u32 {
    let mut hash = 0u32;
    for &byte in data {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u32);
    }
    hash
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_type_detection() {
        let text_data = b"Hello, world! This is plain text.";
        assert_eq!(detect_content_type(text_data), ContentType::Text);

        let code_data = b"fn main() { println!(\"Hello\"); }";
        assert_eq!(detect_content_type(code_data), ContentType::SourceCode);

        let binary_data = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        assert_eq!(detect_content_type(&binary_data), ContentType::Image);
    }

    #[test]
    fn test_language_detection() {
        let rust_code = b"fn main() { let x = 42; }";
        assert_eq!(detect_language(rust_code), LanguageType::Rust);

        let python_code = b"def main():\n    import sys\n    pass";
        assert_eq!(detect_language(python_code), LanguageType::Python);
    }

    #[test]
    fn test_semantic_fingerprint() {
        let data1 = b"The quick brown fox jumps over the lazy dog";
        let data2 = b"The quick brown fox jumps over the lazy cat";

        let fp1 = SemanticFingerprint::from_data(data1);
        let fp2 = SemanticFingerprint::from_data(data2);

        let similarity = fp1.similarity(&fp2);
        assert!(similarity > 0.5); // Should be somewhat similar
    }

    #[test]
    fn test_function_index() {
        let index = FunctionIndex::new();
        let code = b"fn test() {}\nfn another() {}";

        let functions = index.index_code(0, code, LanguageType::Rust).unwrap();
        assert!(!functions.is_empty());

        let stats = index.stats().unwrap();
        assert!(stats.total_functions > 0);
    }

    #[test]
    fn test_semantic_grouping() {
        let manager = SemanticGroupManager::new();
        
        let data1 = b"Hello world";
        let data2 = b"Hello there";
        
        let fp1 = SemanticFingerprint::from_data(data1);
        let fp2 = SemanticFingerprint::from_data(data2);

        let group1 = manager.add_chunk(0, fp1, 0.7).unwrap();
        let group2 = manager.add_chunk(1, fp2, 0.7).unwrap();

        // Should create groups
        assert!(group1 <= group2);

        let stats = manager.stats().unwrap();
        assert!(stats.total_chunks >= 2);
    }

    #[test]
    fn test_semantic_analyzer() {
        let analyzer = SemanticAnalyzer::default();
        
        let data = b"fn test() { let x = 42; }";
        let fingerprint = analyzer.analyze_chunk(0, data).unwrap();

        assert_eq!(fingerprint.content_type, ContentType::SourceCode);
        assert_eq!(fingerprint.language, Some(LanguageType::Rust));

        let stats = analyzer.stats().unwrap();
        assert!(stats.group_stats.total_chunks > 0);
    }

    #[test]
    fn test_feature_extraction() {
        let data = b"Test data with various bytes";
        let features = extract_features(data, ContentType::Text);

        assert!(!features.is_empty());
        let sum: f32 = features.iter().sum();
        assert!((sum - 1.0).abs() < 0.01); // Should be normalized
    }
}
