/**
 * Singularity Pack (SPK) Mobile FFI Header
 * Version 23.0 - Realtime Ultra-Media Pipeline
 * 
 * C-compatible interface for iOS and Android applications.
 * This header defines the FFI boundary for mobile apps.
 */

#ifndef SPK_MOBILE_H
#define SPK_MOBILE_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Version Information
 * ============================================================================ */

#define SPK_VERSION_MAJOR 23
#define SPK_VERSION_MINOR 0
#define SPK_VERSION_PATCH 0
#define SPK_VERSION_STRING "23.0.0"

/* ============================================================================
 * Error Codes
 * ============================================================================ */

#define SPK_SUCCESS              0
#define SPK_ERROR_INVALID_ARG    1
#define SPK_ERROR_IO             2
#define SPK_ERROR_MEMORY         3
#define SPK_ERROR_FORMAT         4
#define SPK_ERROR_CHECKSUM       5
#define SPK_ERROR_NOT_INIT       6
#define SPK_ERROR_CANCELLED      7
#define SPK_ERROR_UNKNOWN        255

/* ============================================================================
 * Configuration Constants
 * ============================================================================ */

/* Compression levels */
#define SPK_LEVEL_FAST           1
#define SPK_LEVEL_DEFAULT        5
#define SPK_LEVEL_MAX            9

/* Chunk sizes for mobile (energy-aware) */
#define SPK_CHUNK_MICRO          (256 * 1024)      /* 256 KB */
#define SPK_CHUNK_SMALL          (512 * 1024)      /* 512 KB */
#define SPK_CHUNK_DEFAULT        (1024 * 1024)     /* 1 MB */
#define SPK_CHUNK_LARGE          (4 * 1024 * 1024) /* 4 MB */

/* ============================================================================
 * Type Definitions
 * ============================================================================ */

/** Opaque handle to SPK context */
typedef void* spk_context_t;

/** Progress callback function type
 * @param progress  Progress value from 0.0 to 1.0
 * @param bytes     Total bytes processed so far
 * @param speed_mbps Current speed in MB/s
 * @param chunks    Number of chunks processed
 * @param user_data User-provided context pointer
 */
typedef void (*spk_progress_callback_t)(
    double progress,
    int64_t bytes,
    double speed_mbps,
    int32_t chunks,
    void* user_data
);

/** Mobile configuration options */
typedef struct {
    int32_t compression_level;      /* 1-9, default 5 */
    int32_t chunk_size;             /* Chunk size in bytes */
    bool energy_aware;              /* Enable battery optimization */
    bool verify_after_write;        /* Verify data after compression */
    int32_t thread_count;           /* 0 = auto-detect */
} spk_config_t;

/** Archive information */
typedef struct {
    uint32_t version_major;
    uint32_t version_minor;
    uint32_t version_patch;
    int64_t original_size;
    int64_t compressed_size;
    int32_t file_count;
    int32_t chunk_count;
    double compression_ratio;
    bool is_encrypted;
    char* created_at;               /* ISO 8601 timestamp */
} spk_archive_info_t;

/** File entry in archive */
typedef struct {
    char* path;
    int64_t size;
    int64_t compressed_size;
    char* checksum;
    bool is_directory;
} spk_file_entry_t;

/* ============================================================================
 * Initialization & Cleanup
 * ============================================================================ */

/**
 * Initialize SPK library.
 * Must be called before any other SPK functions.
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_init(void);

/**
 * Shutdown SPK library and free resources.
 */
void spk_shutdown(void);

/**
 * Get SPK library version string.
 * @return Version string (do not free)
 */
const char* spk_version(void);

/* ============================================================================
 * Configuration
 * ============================================================================ */

/**
 * Create default configuration.
 * @return Default config struct
 */
spk_config_t spk_config_default(void);

/**
 * Create mobile-optimized configuration.
 * Uses smaller chunks and energy-aware settings.
 * @return Mobile config struct
 */
spk_config_t spk_config_mobile(void);

/* ============================================================================
 * Compression Functions
 * ============================================================================ */

/**
 * Compress a file to SPK format.
 * @param input_path   Path to input file
 * @param output_path  Path to output .spk file
 * @param config       Configuration (NULL for defaults)
 * @param callback     Progress callback (can be NULL)
 * @param user_data    User data passed to callback
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_compress_file(
    const char* input_path,
    const char* output_path,
    const spk_config_t* config,
    spk_progress_callback_t callback,
    void* user_data
);

/**
 * Compress multiple files to SPK format.
 * @param input_paths  Array of input file paths
 * @param path_count   Number of paths
 * @param output_path  Path to output .spk file
 * @param config       Configuration (NULL for defaults)
 * @param callback     Progress callback (can be NULL)
 * @param user_data    User data passed to callback
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_compress_files(
    const char** input_paths,
    int32_t path_count,
    const char* output_path,
    const spk_config_t* config,
    spk_progress_callback_t callback,
    void* user_data
);

/**
 * Compress a directory to SPK format.
 * @param input_dir    Path to input directory
 * @param output_path  Path to output .spk file
 * @param config       Configuration (NULL for defaults)
 * @param callback     Progress callback (can be NULL)
 * @param user_data    User data passed to callback
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_compress_directory(
    const char* input_dir,
    const char* output_path,
    const spk_config_t* config,
    spk_progress_callback_t callback,
    void* user_data
);

/* ============================================================================
 * Decompression Functions
 * ============================================================================ */

/**
 * Decompress SPK archive to directory.
 * @param input_path   Path to .spk file
 * @param output_dir   Path to output directory
 * @param callback     Progress callback (can be NULL)
 * @param user_data    User data passed to callback
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_decompress_file(
    const char* input_path,
    const char* output_dir,
    spk_progress_callback_t callback,
    void* user_data
);

/**
 * Extract specific file from archive.
 * @param archive_path Path to .spk file
 * @param file_path    Path of file within archive
 * @param output_path  Path to extract to
 * @param callback     Progress callback (can be NULL)
 * @param user_data    User data passed to callback
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_extract_file(
    const char* archive_path,
    const char* file_path,
    const char* output_path,
    spk_progress_callback_t callback,
    void* user_data
);

/* ============================================================================
 * Archive Information
 * ============================================================================ */

/**
 * Get archive information.
 * @param archive_path Path to .spk file
 * @param info         Pointer to info struct to fill
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_get_archive_info(
    const char* archive_path,
    spk_archive_info_t* info
);

/**
 * List files in archive.
 * @param archive_path Path to .spk file
 * @param entries      Pointer to receive array of entries
 * @param count        Pointer to receive entry count
 * @return SPK_SUCCESS on success, error code otherwise
 */
int32_t spk_list_files(
    const char* archive_path,
    spk_file_entry_t** entries,
    int32_t* count
);

/* ============================================================================
 * Progress & Status
 * ============================================================================ */

/**
 * Get current progress (thread-safe).
 * @param progress Pointer to receive progress (0.0-1.0)
 * @param bytes    Pointer to receive bytes processed
 * @param speed    Pointer to receive speed in MB/s
 * @param chunks   Pointer to receive chunk count
 */
void spk_get_progress(
    double* progress,
    int64_t* bytes,
    double* speed,
    int32_t* chunks
);

/**
 * Cancel ongoing operation.
 * @return SPK_SUCCESS if cancelled, error code otherwise
 */
int32_t spk_cancel(void);

/* ============================================================================
 * Memory Management
 * ============================================================================ */

/**
 * Free archive info struct.
 */
void spk_free_archive_info(spk_archive_info_t* info);

/**
 * Free file entries array.
 */
void spk_free_file_entries(spk_file_entry_t* entries, int32_t count);

/**
 * Free string returned by SPK functions.
 */
void spk_free_string(char* str);

/* ============================================================================
 * Utility Functions
 * ============================================================================ */

/**
 * Verify archive integrity.
 * @param archive_path Path to .spk file
 * @return SPK_SUCCESS if valid, error code otherwise
 */
int32_t spk_verify(const char* archive_path);

/**
 * Get last error message.
 * @return Error message string (do not free)
 */
const char* spk_last_error(void);

#ifdef __cplusplus
}
#endif

#endif /* SPK_MOBILE_H */
