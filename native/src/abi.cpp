#include "shante/abi.h"
#include "shante/kernel.hpp"

#include <new>
#include <string_view>

namespace {
std::filesystem::path utf8_path(std::string_view value) {
    return std::filesystem::path(std::u8string(value.begin(), value.end()));
}
}

uint32_t shante_abi_version(void) {
    return 1;
}

uint32_t shante_v1_process(uint32_t operation, const char* input_utf8,
                          const char* output_utf8, const shante_v1_options* supplied,
                          shante_v1_result* result) {
    if (!result) return SHANTE_V1_INVALID_ARGUMENT;
    *result = {};
    if (!input_utf8 || !*input_utf8 || !output_utf8 || !*output_utf8 ||
        (operation != SHANTE_V1_COMPRESS && operation != SHANTE_V1_DECOMPRESS))
        return SHANTE_V1_INVALID_ARGUMENT;

    try {
        shante::Options options;
        if (supplied) {
            options.input_limit = supplied->input_limit;
            options.output_limit = supplied->output_limit;
            options.memory_limit = supplied->memory_limit;
            options.workers = supplied->workers;
            if (supplied->cancel_file_utf8)
                options.cancel_file = utf8_path(supplied->cancel_file_utf8);
        }
        const auto input = utf8_path(input_utf8);
        const auto output = utf8_path(output_utf8);
        const auto value = operation == SHANTE_V1_COMPRESS ? shante::compress(input, output, options)
                                                           : shante::decompress(input, output, options);
        *result = {value.input_bytes, value.output_bytes, value.allocator_peak, value.allocator_outstanding};
        return SHANTE_V1_OK;
    } catch (const shante::Failure& failure) {
        if (failure.code == "arguments") return SHANTE_V1_INVALID_ARGUMENT;
        if (failure.code == "limit") return SHANTE_V1_LIMIT;
        if (failure.code == "cancelled") return SHANTE_V1_CANCELLED;
        if (failure.code == "integrity" || failure.code == "codec") return SHANTE_V1_INVALID_ARCHIVE;
        if (failure.code == "memory") return SHANTE_V1_MEMORY;
        if (failure.code == "exists") return SHANTE_V1_OUTPUT_EXISTS;
        return SHANTE_V1_IO;
    } catch (const std::bad_alloc&) {
        return SHANTE_V1_MEMORY;
    } catch (...) {
        return SHANTE_V1_IO;
    }
}
