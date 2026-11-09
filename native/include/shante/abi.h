#ifndef SHANTE_ABI_H
#define SHANTE_ABI_H

#include <stdint.h>

#if defined(_WIN32)
# if defined(SHANTE_ABI_BUILD)
#  define SHANTE_API __declspec(dllexport)
# else
#  define SHANTE_API __declspec(dllimport)
# endif
#else
# define SHANTE_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

enum shante_v1_operation {
    SHANTE_V1_COMPRESS = 1,
    SHANTE_V1_DECOMPRESS = 2
};

enum shante_v1_status {
    SHANTE_V1_OK = 0,
    SHANTE_V1_INVALID_ARGUMENT = 1,
    SHANTE_V1_LIMIT = 2,
    SHANTE_V1_CANCELLED = 3,
    SHANTE_V1_INVALID_ARCHIVE = 4,
    SHANTE_V1_MEMORY = 5,
    SHANTE_V1_OUTPUT_EXISTS = 6,
    SHANTE_V1_IO = 7
};

typedef struct shante_v1_options {
    uint64_t input_limit;
    uint64_t output_limit;
    uint64_t memory_limit;
    uint32_t workers;
    const char* cancel_file_utf8;
} shante_v1_options;

typedef struct shante_v1_result {
    uint64_t input_bytes;
    uint64_t output_bytes;
    uint64_t allocator_peak;
    uint64_t allocator_outstanding;
} shante_v1_result;

SHANTE_API uint32_t shante_abi_version(void);

/* Paths are null-terminated UTF-8. Null options use kernel defaults.
 * Caller owns all memory. Result is zeroed on failure. The destination
 * directory must be trusted, and an existing file is never replaced. */
SHANTE_API uint32_t shante_v1_process(uint32_t operation, const char* input_utf8,
                                     const char* output_utf8, const shante_v1_options* options,
                                     shante_v1_result* result);

#ifdef __cplusplus
}
#endif

#endif
