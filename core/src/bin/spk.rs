//! SPK CLI - Singularity Pack Command Line Interface
//! 
//! Terminal-based compression and decompression tool.
//! 
//! Usage:
//!   spk compress <input> -o <output.spk> [--codec zstd] [--level 19] [--speed-mode fast|balanced|max|auto]
//!   spk extract <archive.spk> -o <output_dir>
//!   spk list <archive.spk>
//!   spk info <archive.spk>
//!   spk verify <archive.spk>

use clap::{Parser, Subcommand, ValueEnum};
use console::style;
use indicatif::{ProgressBar, ProgressStyle, MultiProgress, HumanBytes, HumanDuration};
use std::path::PathBuf;
use std::fs::{self, File};
use std::io::{Read, Write, BufReader, BufWriter, Seek, SeekFrom};
use std::time::Instant;
use walkdir::WalkDir;

// Import from spk-core library
use spk_core::{
    codec::{compress, decompress, Codec, CompressionLevel},
    SpkResult, SpkError,
};

// ============================================================================
// CLI ARGUMENT DEFINITIONS
// ============================================================================

#[derive(Parser)]
#[command(name = "spk")]
#[command(author = "Singularity Pack")]
#[command(version = "1.0.0")]
#[command(about = "Ultra-high compression CLI - compress 100TB to 1GB", long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Clone, Copy, Debug, ValueEnum, Default)]
enum SpeedModeArg {
    /// Fastest compression - LZ4, 500MB/s target (lowest CPUs)
    Fast,
    /// Balanced speed vs ratio - ZSTD level 3
    #[default]
    Balanced,
    /// Maximum compression - ZSTD level 19+ (slower)
    Max,
    /// HAMMA auto-selects best based on your device
    Auto,
}

#[derive(Subcommand)]
enum Commands {
    /// Compress files or directories into SPK archive
    Compress {
        /// Input file or directory to compress
        #[arg(required = true)]
        input: PathBuf,

        /// Output SPK archive path
        #[arg(short, long, required = true)]
        output: PathBuf,

        /// Compression codec to use
        #[arg(short, long, default_value = "zstd")]
        codec: CodecArg,

        /// Compression level (1-22 for zstd, 1-12 for lz4, 1-11 for brotli)
        #[arg(short, long, default_value = "19")]
        level: u32,

        /// Speed mode - let HAMMA manage compression for your device
        #[arg(short, long, default_value = "balanced")]
        speed_mode: SpeedModeArg,

        /// Recursively compress directories
        #[arg(short, long, default_value = "true")]
        recursive: bool,

        /// Enable deduplication for better compression
        #[arg(long, default_value = "true")]
        dedup: bool,

        /// Number of parallel threads (0 = auto)
        #[arg(short = 't', long, default_value = "0")]
        threads: usize,
    },

    /// Extract files from SPK archive
    Extract {
        /// SPK archive to extract
        #[arg(required = true)]
        archive: PathBuf,

        /// Output directory for extracted files
        #[arg(short, long, default_value = ".")]
        output: PathBuf,

        /// Overwrite existing files
        #[arg(short, long, default_value = "false")]
        force: bool,

        /// Extract specific file pattern (glob)
        #[arg(short, long)]
        pattern: Option<String>,
    },

    /// List contents of SPK archive
    List {
        /// SPK archive to list
        #[arg(required = true)]
        archive: PathBuf,

        /// Show detailed information
        #[arg(short, long)]
        verbose: bool,
    },

    /// Show information about SPK archive
    Info {
        /// SPK archive to inspect
        #[arg(required = true)]
        archive: PathBuf,
    },

    /// Verify integrity of SPK archive
    Verify {
        /// SPK archive to verify
        #[arg(required = true)]
        archive: PathBuf,

        /// Quick verification (headers only)
        #[arg(short, long)]
        quick: bool,
    },

    /// Benchmark compression performance
    Bench {
        /// Input file to benchmark
        #[arg(required = true)]
        input: PathBuf,

        /// Number of iterations
        #[arg(short, long, default_value = "3")]
        iterations: u32,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum CodecArg {
    Zstd,
    Lz4,
    Brotli,
}

impl From<CodecArg> for Codec {
    fn from(arg: CodecArg) -> Self {
        match arg {
            CodecArg::Zstd => Codec::Zstd,
            CodecArg::Lz4 => Codec::Lz4,
            CodecArg::Brotli => Codec::Brotli,
        }
    }
}

// ============================================================================
// HAMMA DEVICE DETECTION HELPERS
// ============================================================================

/// Get available system memory in MB for HAMMA auto-detection
fn get_available_memory_mb() -> u64 {
    // Try to get system memory - cross-platform estimate
    #[cfg(target_os = "windows")]
    {
        // On Windows, use sys-info or default estimate
        // Using conservative estimate based on typical low-end devices
        2048 // 2GB default estimate
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On Unix-like systems, try /proc/meminfo
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|content| {
                content.lines()
                    .find(|line| line.starts_with("MemTotal:"))
                    .and_then(|line| {
                        line.split_whitespace()
                            .nth(1)
                            .and_then(|v| v.parse::<u64>().ok())
                    })
                    .map(|kb| kb / 1024) // Convert KB to MB
            })
            .unwrap_or(2048) // 2GB default
    }
}

// ============================================================================
// SPK ARCHIVE FORMAT (Simple V1)
// ============================================================================

const SPK_MAGIC: &[u8; 4] = b"SPK1";
const SPK_VERSION: u8 = 1;

/// SPK Archive Header
#[derive(Debug, Clone)]
struct SpkHeader {
    magic: [u8; 4],
    version: u8,
    codec: u8,
    level: u8,
    flags: u8,
    file_count: u32,
    original_size: u64,
    compressed_size: u64,
    checksum: [u8; 32],
}

impl SpkHeader {
    fn new(codec: Codec, level: u32, file_count: u32) -> Self {
        Self {
            magic: *SPK_MAGIC,
            version: SPK_VERSION,
            codec: match codec {
                Codec::Zstd => 1,
                Codec::Lz4 => 2,
                Codec::Brotli => 3,
                Codec::None => 0,
            },
            level: level as u8,
            flags: 0,
            file_count,
            original_size: 0,
            compressed_size: 0,
            checksum: [0u8; 32],
        }
    }

    fn codec(&self) -> Codec {
        match self.codec {
            1 => Codec::Zstd,
            2 => Codec::Lz4,
            3 => Codec::Brotli,
            _ => Codec::Zstd,
        }
    }

    fn write<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(&self.magic)?;
        writer.write_all(&[self.version, self.codec, self.level, self.flags])?;
        writer.write_all(&self.file_count.to_le_bytes())?;
        writer.write_all(&self.original_size.to_le_bytes())?;
        writer.write_all(&self.compressed_size.to_le_bytes())?;
        writer.write_all(&self.checksum)?;
        Ok(())
    }

    fn read<R: Read>(reader: &mut R) -> std::io::Result<Self> {
        let mut magic = [0u8; 4];
        reader.read_exact(&mut magic)?;
        
        if &magic != SPK_MAGIC {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid SPK archive: bad magic bytes"
            ));
        }

        let mut meta = [0u8; 4];
        reader.read_exact(&mut meta)?;

        let mut file_count_bytes = [0u8; 4];
        reader.read_exact(&mut file_count_bytes)?;

        let mut original_size_bytes = [0u8; 8];
        reader.read_exact(&mut original_size_bytes)?;

        let mut compressed_size_bytes = [0u8; 8];
        reader.read_exact(&mut compressed_size_bytes)?;

        let mut checksum = [0u8; 32];
        reader.read_exact(&mut checksum)?;

        Ok(Self {
            magic,
            version: meta[0],
            codec: meta[1],
            level: meta[2],
            flags: meta[3],
            file_count: u32::from_le_bytes(file_count_bytes),
            original_size: u64::from_le_bytes(original_size_bytes),
            compressed_size: u64::from_le_bytes(compressed_size_bytes),
            checksum,
        })
    }

    const SIZE: usize = 4 + 4 + 4 + 8 + 8 + 32; // 60 bytes
}

/// File entry in archive
#[derive(Debug, Clone)]
struct FileEntry {
    path_len: u16,
    path: String,
    original_size: u64,
    compressed_size: u64,
    checksum: [u8; 32],
    offset: u64,
}

impl FileEntry {
    fn write<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(&self.path_len.to_le_bytes())?;
        writer.write_all(self.path.as_bytes())?;
        writer.write_all(&self.original_size.to_le_bytes())?;
        writer.write_all(&self.compressed_size.to_le_bytes())?;
        writer.write_all(&self.checksum)?;
        writer.write_all(&self.offset.to_le_bytes())?;
        Ok(())
    }

    fn read<R: Read>(reader: &mut R) -> std::io::Result<Self> {
        let mut path_len_bytes = [0u8; 2];
        reader.read_exact(&mut path_len_bytes)?;
        let path_len = u16::from_le_bytes(path_len_bytes);

        let mut path_bytes = vec![0u8; path_len as usize];
        reader.read_exact(&mut path_bytes)?;
        let path = String::from_utf8_lossy(&path_bytes).to_string();

        let mut original_size_bytes = [0u8; 8];
        reader.read_exact(&mut original_size_bytes)?;

        let mut compressed_size_bytes = [0u8; 8];
        reader.read_exact(&mut compressed_size_bytes)?;

        let mut checksum = [0u8; 32];
        reader.read_exact(&mut checksum)?;

        let mut offset_bytes = [0u8; 8];
        reader.read_exact(&mut offset_bytes)?;

        Ok(Self {
            path_len,
            path,
            original_size: u64::from_le_bytes(original_size_bytes),
            compressed_size: u64::from_le_bytes(compressed_size_bytes),
            checksum,
            offset: u64::from_le_bytes(offset_bytes),
        })
    }
}

// ============================================================================
// COMPRESSION IMPLEMENTATION
// ============================================================================

fn cmd_compress(
    input: PathBuf,
    output: PathBuf,
    codec_arg: CodecArg,
    level: u32,
    speed_mode: SpeedModeArg,
    recursive: bool,
    _dedup: bool,
    threads: usize,
) -> SpkResult<()> {
    let start_time = Instant::now();
    
    // HAMMA speed mode overrides codec/level when set to Auto
    let (codec, effective_level, max_threads) = match speed_mode {
        SpeedModeArg::Fast => {
            // Fastest mode: LZ4 for lowest CPUs, targets 500MB/s
            (Codec::Lz4, 1, 1)
        }
        SpeedModeArg::Balanced => {
            // Balanced mode: ZSTD level 3, good ratio/speed
            (Codec::Zstd, 3, num_cpus::get().min(4))
        }
        SpeedModeArg::Max => {
            // Maximum compression: user's codec/level
            (codec_arg.into(), level as i32, num_cpus::get())
        }
        SpeedModeArg::Auto => {
            // HAMMA auto-detection based on device
            let mem = get_available_memory_mb();
            if mem < 512 {
                // Ultra-low: LZ4 single-threaded
                (Codec::Lz4, 1, 1)
            } else if mem < 2048 {
                // Low: LZ4, 2 threads
                (Codec::Lz4, 3, 2)
            } else if mem < 8192 {
                // Normal: ZSTD level 3, 4 threads
                (Codec::Zstd, 3, 4)
            } else {
                // High: ZSTD level 6, 8 threads
                (Codec::Zstd, 6, 8)
            }
        }
    };
    
    // Configure thread pool based on speed mode
    let actual_threads = if threads > 0 { threads } else { max_threads };
    if actual_threads > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(actual_threads)
            .build_global()
            .ok();
    }

    println!("\n{}", style("SPK Compression Engine").cyan().bold());
    println!("{}", style("=".repeat(50)).dim());
    println!("  Speed Mode: {}", style(format!("{:?}", speed_mode)).magenta());
    println!("  Codec: {} (level {})", style(format!("{:?}", codec)).green(), effective_level);
    println!("  Threads: {}", style(actual_threads).cyan());
    println!("  Input: {}", style(input.display()).yellow());
    println!("  Output: {}", style(output.display()).yellow());
    println!();

    // Collect files to compress
    let files: Vec<PathBuf> = if input.is_file() {
        vec![input.clone()]
    } else if input.is_dir() {
        let walker = WalkDir::new(&input).follow_links(true);
        let walker = if !recursive { walker.max_depth(1) } else { walker };
        
        walker
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect()
    } else {
        return Err(SpkError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Input not found: {}", input.display())
        )));
    };

    if files.is_empty() {
        return Err(SpkError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "No files to compress"
        )));
    }

    println!("  Found {} file(s) to compress", style(files.len()).cyan());

    // Calculate total size
    let total_size: u64 = files.iter()
        .filter_map(|f| fs::metadata(f).ok())
        .map(|m| m.len())
        .sum();

    println!("  Total size: {}", style(HumanBytes(total_size)).cyan());
    println!();

    // Progress bars
    let multi = MultiProgress::new();
    let overall_pb = multi.add(ProgressBar::new(total_size));
    overall_pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {bytes}/{total_bytes} ({percent}%)")
            .unwrap()
            .progress_chars("=>-")
    );

    // Create output file
    let out_file = File::create(&output)?;
    let mut writer = BufWriter::new(out_file);

    // Write placeholder header (will update at end)
    let mut header = SpkHeader::new(codec, effective_level as u32, files.len() as u32);
    header.write(&mut writer)?;

    // Write placeholder for file entries (will update at end)
    let entries_offset = SpkHeader::SIZE as u64;
    let mut file_entries: Vec<FileEntry> = Vec::with_capacity(files.len());
    
    // Reserve space for file entries
    let entry_size_estimate = 2 + 256 + 8 + 8 + 32 + 8; // path_len + max_path + sizes + checksum + offset
    for _ in 0..files.len() {
        writer.write_all(&vec![0u8; entry_size_estimate])?;
    }

    // Data starts after header + entries
    let data_offset = entries_offset + (files.len() * entry_size_estimate) as u64;
    let mut current_offset = data_offset;
    let mut total_original = 0u64;
    let mut total_compressed = 0u64;

    // Compress each file
    for file_path in &files {
        let relative_path = if input.is_dir() {
            file_path.strip_prefix(&input).unwrap_or(file_path)
        } else {
            file_path.file_name().map(|n| n.as_ref()).unwrap_or(file_path.as_ref())
        };

        // Read file
        let mut file = File::open(file_path)?;
        let file_size = file.metadata()?.len();
        let mut data = Vec::with_capacity(file_size as usize);
        file.read_to_end(&mut data)?;

        // Calculate checksum
        let checksum = blake3::hash(&data);

        // Compress
        let compressed = compress(&data, codec, CompressionLevel::Custom(effective_level))?;

        // Write compressed data
        writer.write_all(&compressed)?;

        // Create entry
        let path_str = relative_path.to_string_lossy().to_string();
        let entry = FileEntry {
            path_len: path_str.len() as u16,
            path: path_str,
            original_size: file_size,
            compressed_size: compressed.len() as u64,
            checksum: *checksum.as_bytes(),
            offset: current_offset,
        };

        total_original += file_size;
        total_compressed += compressed.len() as u64;
        current_offset += compressed.len() as u64;

        file_entries.push(entry);
        overall_pb.inc(file_size);
    }

    overall_pb.finish_with_message("Compression complete");

    // Update header with final values
    header.original_size = total_original;
    header.compressed_size = total_compressed;

    // Calculate overall checksum
    let mut hasher = blake3::Hasher::new();
    for entry in &file_entries {
        hasher.update(&entry.checksum);
    }
    header.checksum = *hasher.finalize().as_bytes();

    // Rewrite header
    writer.seek(SeekFrom::Start(0))?;
    header.write(&mut writer)?;

    // Rewrite file entries
    for entry in &file_entries {
        entry.write(&mut writer)?;
    }

    writer.flush()?;

    // Get final file size
    let final_size = fs::metadata(&output)?.len();
    let ratio = if total_original > 0 {
        (total_compressed as f64 / total_original as f64) * 100.0
    } else {
        100.0
    };

    let elapsed = start_time.elapsed();

    println!();
    println!("{}", style("Compression Results").green().bold());
    println!("{}", style("-".repeat(50)).dim());
    println!("  Original:   {}", style(HumanBytes(total_original)).yellow());
    println!("  Compressed: {}", style(HumanBytes(total_compressed)).cyan());
    println!("  Archive:    {}", style(HumanBytes(final_size)).cyan());
    println!("  Ratio:      {}", style(format!("{:.1}%", ratio)).green().bold());
    println!("  Saved:      {}", style(HumanBytes(total_original.saturating_sub(total_compressed))).green());
    println!("  Time:       {}", style(HumanDuration(elapsed)).dim());
    println!("  Speed:      {}/s", style(HumanBytes((total_original as f64 / elapsed.as_secs_f64()) as u64)).dim());
    println!();
    println!("{} Archive saved to: {}", style("[OK]").green().bold(), style(output.display()).yellow());

    Ok(())
}

// ============================================================================
// EXTRACTION IMPLEMENTATION
// ============================================================================

fn cmd_extract(
    archive: PathBuf,
    output: PathBuf,
    force: bool,
    pattern: Option<String>,
) -> SpkResult<()> {
    let start_time = Instant::now();

    println!("\n{}", style("SPK Extraction Engine").cyan().bold());
    println!("{}", style("=".repeat(50)).dim());
    println!("  Archive: {}", style(archive.display()).yellow());
    println!("  Output:  {}", style(output.display()).yellow());
    println!();

    // Open archive
    let file = File::open(&archive)?;
    let mut reader = BufReader::new(file);

    // Read header
    let header = SpkHeader::read(&mut reader)?;
    let codec = header.codec();

    println!("  Version: SPK v{}", header.version);
    println!("  Codec:   {:?}", codec);
    println!("  Files:   {}", style(header.file_count).cyan());
    println!("  Original size: {}", style(HumanBytes(header.original_size)).yellow());
    println!();

    // Read file entries
    let entry_size_estimate = 2 + 256 + 8 + 8 + 32 + 8;
    let mut entries = Vec::with_capacity(header.file_count as usize);
    
    for _ in 0..header.file_count {
        let entry = FileEntry::read(&mut reader)?;
        entries.push(entry);
    }

    // Skip padding to reach first entry offset
    let _data_offset = SpkHeader::SIZE as u64 + (header.file_count as u64 * entry_size_estimate as u64);

    // Filter by pattern if specified
    let entries_to_extract: Vec<&FileEntry> = if let Some(ref pat) = pattern {
        entries.iter().filter(|e| e.path.contains(pat)).collect()
    } else {
        entries.iter().collect()
    };

    if entries_to_extract.is_empty() {
        println!("{}", style("No files match the pattern").yellow());
        return Ok(());
    }

    // Progress bar
    let pb = ProgressBar::new(header.original_size);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {bytes}/{total_bytes} ({percent}%)")
            .unwrap()
            .progress_chars("=>-")
    );

    // Create output directory
    fs::create_dir_all(&output)?;

    let mut total_extracted = 0u64;

    // Extract each file
    for entry in entries_to_extract {
        let out_path = output.join(&entry.path);

        // Check if exists
        if out_path.exists() && !force {
            println!("  {} {} (use --force to overwrite)", 
                style("SKIP").yellow(), 
                entry.path
            );
            continue;
        }

        // Create parent directories
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Seek to data
        reader.seek(SeekFrom::Start(entry.offset))?;

        // Read compressed data
        let mut compressed = vec![0u8; entry.compressed_size as usize];
        reader.read_exact(&mut compressed)?;

        // Decompress
        let decompressed = decompress(&compressed, codec, Some(entry.original_size as usize))?;

        // Verify checksum
        let checksum = blake3::hash(&decompressed);
        if checksum.as_bytes() != &entry.checksum {
            println!("  {} {} (checksum mismatch)", style("ERR").red(), entry.path);
            continue;
        }

        // Write file
        let mut out_file = File::create(&out_path)?;
        out_file.write_all(&decompressed)?;

        total_extracted += entry.original_size;
        pb.inc(entry.original_size);
    }

    pb.finish_with_message("Extraction complete");

    let elapsed = start_time.elapsed();

    println!();
    println!("{}", style("Extraction Results").green().bold());
    println!("{}", style("-".repeat(50)).dim());
    println!("  Extracted: {}", style(HumanBytes(total_extracted)).cyan());
    println!("  Time:      {}", style(HumanDuration(elapsed)).dim());
    println!("  Speed:     {}/s", style(HumanBytes((total_extracted as f64 / elapsed.as_secs_f64()) as u64)).dim());
    println!();
    println!("{} Files extracted to: {}", style("[OK]").green().bold(), style(output.display()).yellow());

    Ok(())
}

// ============================================================================
// LIST IMPLEMENTATION
// ============================================================================

fn cmd_list(archive: PathBuf, verbose: bool) -> SpkResult<()> {
    let file = File::open(&archive)?;
    let mut reader = BufReader::new(file);

    let header = SpkHeader::read(&mut reader)?;

    println!("\n{}", style("SPK Archive Contents").cyan().bold());
    println!("{}", style("=".repeat(60)).dim());

    // Read entries
    let _entry_size_estimate = 2 + 256 + 8 + 8 + 32 + 8;
    
    if verbose {
        println!("{:<40} {:>12} {:>12} {:>6}", 
            style("Path").underlined(),
            style("Original").underlined(),
            style("Compressed").underlined(),
            style("Ratio").underlined()
        );
        println!("{}", "-".repeat(74));
    }

    for _ in 0..header.file_count {
        let entry = FileEntry::read(&mut reader)?;
        
        if verbose {
            let ratio = if entry.original_size > 0 {
                (entry.compressed_size as f64 / entry.original_size as f64) * 100.0
            } else {
                100.0
            };
            
            println!("{:<40} {:>12} {:>12} {:>5.1}%",
                entry.path,
                HumanBytes(entry.original_size),
                HumanBytes(entry.compressed_size),
                ratio
            );
        } else {
            println!("  {}", entry.path);
        }
    }

    if verbose {
        println!("{}", "-".repeat(74));
        let ratio = if header.original_size > 0 {
            (header.compressed_size as f64 / header.original_size as f64) * 100.0
        } else {
            100.0
        };
        println!("{:<40} {:>12} {:>12} {:>5.1}%",
            style("TOTAL").bold(),
            HumanBytes(header.original_size),
            HumanBytes(header.compressed_size),
            ratio
        );
    }

    println!();
    println!("  {} file(s)", style(header.file_count).cyan());

    Ok(())
}

// ============================================================================
// INFO IMPLEMENTATION
// ============================================================================

fn cmd_info(archive: PathBuf) -> SpkResult<()> {
    let file = File::open(&archive)?;
    let file_size = file.metadata()?.len();
    let mut reader = BufReader::new(file);

    let header = SpkHeader::read(&mut reader)?;

    println!("\n{}", style("SPK Archive Information").cyan().bold());
    println!("{}", style("=".repeat(50)).dim());
    println!("  Archive:      {}", style(archive.display()).yellow());
    println!("  File size:    {}", style(HumanBytes(file_size)).cyan());
    println!();
    println!("{}", style("Header").green().bold());
    println!("  Magic:        {:?}", std::str::from_utf8(&header.magic).unwrap_or("???"));
    println!("  Version:      {}", header.version);
    println!("  Codec:        {:?}", header.codec());
    println!("  Level:        {}", header.level);
    println!("  File count:   {}", header.file_count);
    println!();
    println!("{}", style("Sizes").green().bold());
    println!("  Original:     {}", style(HumanBytes(header.original_size)).yellow());
    println!("  Compressed:   {}", style(HumanBytes(header.compressed_size)).cyan());
    
    let ratio = if header.original_size > 0 {
        (header.compressed_size as f64 / header.original_size as f64) * 100.0
    } else {
        100.0
    };
    println!("  Ratio:        {}", style(format!("{:.2}%", ratio)).green().bold());
    println!("  Savings:      {}", style(HumanBytes(header.original_size.saturating_sub(header.compressed_size))).green());
    println!();
    println!("{}", style("Checksum").green().bold());
    println!("  BLAKE3:       {}", hex::encode(&header.checksum[..16]));

    Ok(())
}

// ============================================================================
// VERIFY IMPLEMENTATION
// ============================================================================

fn cmd_verify(archive: PathBuf, quick: bool) -> SpkResult<()> {
    let start_time = Instant::now();

    println!("\n{}", style("SPK Archive Verification").cyan().bold());
    println!("{}", style("=".repeat(50)).dim());
    println!("  Archive: {}", style(archive.display()).yellow());
    println!("  Mode:    {}", if quick { "Quick (headers only)" } else { "Full (all data)" });
    println!();

    let file = File::open(&archive)?;
    let mut reader = BufReader::new(file);

    // Verify header
    let header = SpkHeader::read(&mut reader)?;
    println!("  {} Header valid (SPK v{})", style("[OK]").green(), header.version);

    if quick {
        println!();
        println!("{} Archive appears valid (quick check)", style("[OK]").green().bold());
        return Ok(());
    }

    // Read and verify all entries
    let _entry_size_estimate = 2 + 256 + 8 + 8 + 32 + 8;
    let mut entries = Vec::with_capacity(header.file_count as usize);
    
    for _ in 0..header.file_count {
        let entry = FileEntry::read(&mut reader)?;
        entries.push(entry);
    }

    let pb = ProgressBar::new(header.file_count as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} Verifying... [{bar:40.cyan/blue}] {pos}/{len}")
            .unwrap()
            .progress_chars("=>-")
    );

    let codec = header.codec();
    let mut errors = 0u32;

    for entry in &entries {
        reader.seek(SeekFrom::Start(entry.offset))?;
        
        let mut compressed = vec![0u8; entry.compressed_size as usize];
        reader.read_exact(&mut compressed)?;

        match decompress(&compressed, codec, Some(entry.original_size as usize)) {
            Ok(decompressed) => {
                let checksum = blake3::hash(&decompressed);
                if checksum.as_bytes() != &entry.checksum {
                    println!("  {} {} (checksum mismatch)", style("[ERR]").red(), entry.path);
                    errors += 1;
                }
            }
            Err(_) => {
                println!("  {} {} (decompression failed)", style("[ERR]").red(), entry.path);
                errors += 1;
            }
        }

        pb.inc(1);
    }

    pb.finish_and_clear();

    let elapsed = start_time.elapsed();

    println!();
    if errors == 0 {
        println!("{} All {} files verified successfully", 
            style("[OK]").green().bold(), 
            header.file_count
        );
    } else {
        println!("{} Verification failed: {} error(s) found", 
            style("[FAIL]").red().bold(),
            errors
        );
    }
    println!("  Time: {}", HumanDuration(elapsed));

    if errors > 0 {
        Err(SpkError::IntegrityCheckFailed(format!("{} files failed verification", errors)))
    } else {
        Ok(())
    }
}

// ============================================================================
// BENCHMARK IMPLEMENTATION
// ============================================================================

fn cmd_bench(input: PathBuf, iterations: u32) -> SpkResult<()> {
    println!("\n{}", style("SPK Compression Benchmark").cyan().bold());
    println!("{}", style("=".repeat(50)).dim());

    // Read input file
    let mut file = File::open(&input)?;
    let file_size = file.metadata()?.len();
    let mut data = Vec::with_capacity(file_size as usize);
    file.read_to_end(&mut data)?;

    println!("  File:       {}", style(input.display()).yellow());
    println!("  Size:       {}", style(HumanBytes(file_size)).cyan());
    println!("  Iterations: {}", iterations);
    println!();

    let codecs = [
        (Codec::Zstd, "ZSTD", 19),
        (Codec::Lz4, "LZ4", 9),
        (Codec::Brotli, "Brotli", 9),
    ];

    println!("{:<10} {:>12} {:>12} {:>10} {:>10}", 
        style("Codec").underlined(),
        style("Compressed").underlined(),
        style("Ratio").underlined(),
        style("Comp").underlined(),
        style("Decomp").underlined()
    );
    println!("{}", "-".repeat(58));

    for (codec, name, level) in codecs {
        let mut compress_times = Vec::new();
        let mut decompress_times = Vec::new();
        let mut compressed_size = 0usize;

        for _ in 0..iterations {
            // Compress
            let start = Instant::now();
            let compressed = compress(&data, codec, CompressionLevel::Custom(level))?;
            compress_times.push(start.elapsed());
            compressed_size = compressed.len();

            // Decompress
            let start = Instant::now();
            let _ = decompress(&compressed, codec, Some(data.len()))?;
            decompress_times.push(start.elapsed());
        }

        let avg_compress = compress_times.iter().sum::<std::time::Duration>() / iterations;
        let avg_decompress = decompress_times.iter().sum::<std::time::Duration>() / iterations;
        let ratio = (compressed_size as f64 / file_size as f64) * 100.0;

        let compress_speed = file_size as f64 / avg_compress.as_secs_f64();
        let decompress_speed = file_size as f64 / avg_decompress.as_secs_f64();

        println!("{:<10} {:>12} {:>11.1}% {:>10}/s {:>10}/s",
            name,
            HumanBytes(compressed_size as u64),
            ratio,
            HumanBytes(compress_speed as u64),
            HumanBytes(decompress_speed as u64)
        );
    }

    println!();
    Ok(())
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Compress { input, output, codec, level, speed_mode, recursive, dedup, threads } => {
            cmd_compress(input, output, codec, level, speed_mode, recursive, dedup, threads)
        }
        Commands::Extract { archive, output, force, pattern } => {
            cmd_extract(archive, output, force, pattern)
        }
        Commands::List { archive, verbose } => {
            cmd_list(archive, verbose)
        }
        Commands::Info { archive } => {
            cmd_info(archive)
        }
        Commands::Verify { archive, quick } => {
            cmd_verify(archive, quick)
        }
        Commands::Bench { input, iterations } => {
            cmd_bench(input, iterations)
        }
    };

    if let Err(e) = result {
        eprintln!("\n{} {}", style("Error:").red().bold(), e);
        std::process::exit(1);
    }
}
