#pragma once
#include <cstdint>
#include <filesystem>
#include <functional>
#include <stdexcept>
#include <string>

namespace shante {
struct Failure : std::runtime_error {
    std::string code;
    Failure(std::string code_value, const char* message)
        : std::runtime_error(message), code(std::move(code_value)) {}
};
struct Hardware {
    unsigned cores = 1;
    std::uint64_t available_memory = 0;
    bool avx2 = false, avx512 = false, neon = false;
    unsigned workers = 0;
};
Hardware hardware();
const char* codec_version();
struct Options {
    std::uint64_t input_limit = 8ULL << 30;
    std::uint64_t output_limit = 2ULL << 30;
    std::uint64_t memory_limit = 128ULL << 20;
    unsigned workers = 0; // zero is the Zstandard synchronous CPU fallback
    std::filesystem::path cancel_file;
    std::function<void(std::uint64_t, std::uint64_t, bool)> progress;
};
struct Result {
    std::uint64_t input_bytes = 0, output_bytes = 0, allocator_peak = 0;
    std::uint64_t allocator_outstanding = 0;
    bool verified = false;
};
// Produces standard checksummed Zstandard frames. Both operations publish only
// after success, exclusively; existing output paths are never overwritten.
Result compress(const std::filesystem::path&, const std::filesystem::path&, const Options&);
Result decompress(const std::filesystem::path&, const std::filesystem::path&, const Options&);
std::string signature(const std::filesystem::path&);
}
