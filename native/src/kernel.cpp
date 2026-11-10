#include "shante/kernel.hpp"
#define ZSTD_STATIC_LINKING_ONLY
#include <zstd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <random>
#include <thread>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <sys/stat.h>
#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
#include <intrin.h>
#endif
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__linux__)
#include <sys/sysinfo.h>
#elif defined(__APPLE__)
#include <mach/mach.h>
#endif
#endif

namespace shante {
namespace {
constexpr std::size_t block = 256 * 1024;
void check(const Options& options) {
    if (!options.cancel_file.empty() && std::filesystem::exists(options.cancel_file))
        throw Failure("cancelled", "Cancelled");
}
void codec(std::size_t result) {
    if (ZSTD_isError(result)) {
        std::fprintf(stderr, "Zstandard: %s\n", ZSTD_getErrorName(result));
        throw Failure("codec", "Invalid frame or codec resource limit");
    }
}
class File {
    std::FILE* stream_ = nullptr;
public:
    explicit File(const std::filesystem::path& path, bool create = false) {
#ifdef _WIN32
        auto handle = CreateFileW(path.c_str(), create ? GENERIC_READ | GENERIC_WRITE : GENERIC_READ,
            FILE_SHARE_READ, nullptr, create ? CREATE_NEW : OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
        if (handle == INVALID_HANDLE_VALUE) throw Failure(create ? "exists" : "input", "Cannot open file exclusively");
        BY_HANDLE_FILE_INFORMATION info{};
        if (!GetFileInformationByHandle(handle, &info) || GetFileType(handle) != FILE_TYPE_DISK ||
            (info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
            CloseHandle(handle); throw Failure("input", "A regular file is required");
        }
        const int fd = _open_osfhandle(reinterpret_cast<intptr_t>(handle), _O_BINARY | (create ? _O_RDWR : _O_RDONLY));
        if (fd < 0) { CloseHandle(handle); throw Failure("io", "Cannot open stream"); }
        stream_ = _fdopen(fd, create ? "w+b" : "rb");
        if (!stream_) _close(fd);
#else
        // Open without waiting on a FIFO before fstat can reject it.
        const int fd = ::open(path.c_str(), (create ? O_RDWR | O_CREAT | O_EXCL : O_RDONLY | O_NONBLOCK) | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd < 0) throw Failure(create ? "exists" : "input", "Cannot open file exclusively");
        struct stat info{};
        if (fstat(fd, &info) || !S_ISREG(info.st_mode)) {
            ::close(fd); throw Failure("input", "A regular file is required");
        }
        stream_ = fdopen(fd, create ? "w+b" : "rb");
        if (!stream_) ::close(fd);
#endif
        if (!stream_) throw Failure("io", "Cannot open stream");
    }
    File(const File&) = delete;
    File& operator=(const File&) = delete;
    ~File() { if (stream_) std::fclose(stream_); }
    std::size_t read(void* data, std::size_t size) {
        auto count = std::fread(data, 1, size, stream_);
        if (std::ferror(stream_)) throw Failure("io", "Input read failed");
        return count;
    }
    void write(const void* data, std::size_t size) {
        if (std::fwrite(data, 1, size, stream_) != size) throw Failure("io", "Output write failed");
    }
    void rewind() {
        if (std::fflush(stream_)) throw Failure("io", "Flush failed");
#ifdef _WIN32
        if (_fseeki64(stream_, 0, SEEK_SET)) throw Failure("io", "Seek failed");
#else
        if (fseeko(stream_, 0, SEEK_SET)) throw Failure("io", "Seek failed");
#endif
    }
    void sync_close() {
        if (std::fflush(stream_)) throw Failure("io", "Flush failed");
#ifdef _WIN32
        if (_commit(_fileno(stream_))) throw Failure("io", "Sync failed");
#else
        if (fsync(fileno(stream_))) throw Failure("io", "Sync failed");
#endif
        auto* closing = stream_; stream_ = nullptr;
        if (std::fclose(closing)) throw Failure("io", "Close failed");
    }
};
class Output {
    std::filesystem::path destination_, temporary_;
    bool published_ = false;
public:
    std::unique_ptr<File> file;
    explicit Output(const std::filesystem::path& destination) : destination_(destination) {
        if (std::filesystem::exists(destination) || std::filesystem::is_symlink(destination))
            throw Failure("exists", "Output already exists");
        std::random_device random;
        temporary_ = destination; temporary_ += ".part-" + std::to_string(random()) + "-" + std::to_string(random());
        file = std::make_unique<File>(temporary_, true);
    }
    ~Output() {
        file.reset();
        if (!published_) { std::error_code ignored; std::filesystem::remove(temporary_, ignored); }
    }
    void publish() {
        file->sync_close(); file.reset();
#ifdef _WIN32
        if (!MoveFileExW(temporary_.c_str(), destination_.c_str(), MOVEFILE_WRITE_THROUGH))
            throw Failure("io", "Output publication failed");
#else
        // link is exclusive, unlike rename which can replace an existing file.
        if (::link(temporary_.c_str(), destination_.c_str())) throw Failure("io", "Output publication failed");
        std::filesystem::remove(temporary_);
        const auto parent = destination_.parent_path().empty() ? std::filesystem::path(".") : destination_.parent_path();
        int dir = ::open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (dir >= 0) { ::fsync(dir); ::close(dir); }
#endif
        published_ = true;
    }
};
class Budget {
    struct alignas(std::max_align_t) Header { std::size_t size; };
    const std::uint64_t limit_;
    std::atomic<std::uint64_t> used_{0}, peak_{0};
    static void* allocate(void* opaque, std::size_t size) {
        auto& self = *static_cast<Budget*>(opaque);
        if (size > std::numeric_limits<std::size_t>::max() - sizeof(Header)) return nullptr;
        const auto charge = size + sizeof(Header);
        auto previous = self.used_.load();
        do { if (previous > self.limit_ || charge > self.limit_ - previous) return nullptr; }
        while (!self.used_.compare_exchange_weak(previous, previous + charge));
        auto* header = static_cast<Header*>(std::malloc(charge));
        if (!header) { self.used_.fetch_sub(charge); return nullptr; }
        header->size = charge;
        auto peak = self.peak_.load();
        while (peak < previous + charge && !self.peak_.compare_exchange_weak(peak, previous + charge)) {}
        return header + 1;
    }
    static void release(void* opaque, void* pointer) {
        if (!pointer) return;
        auto* header = static_cast<Header*>(pointer) - 1;
        static_cast<Budget*>(opaque)->used_.fetch_sub(header->size); std::free(header);
    }
public:
    explicit Budget(std::uint64_t limit) : limit_(limit) {}
    ZSTD_customMem memory() { return {allocate, release, this}; }
    std::uint64_t peak() const { return peak_.load(); }
    std::uint64_t used() const { return used_.load(); }
};
void validate(const Options& options) {
    if (options.memory_limit < (1ULL << 20) || options.memory_limit > (512ULL << 20) || options.workers > 2)
        throw Failure("arguments", "Invalid resource budget");
    static_assert(sizeof(std::uint64_t) == 8);
}
struct DecodedBytes {
    std::uint64_t input;
    std::uint64_t output;
};

template<class Sink>
DecodedBytes decode(File& input, const Options& options, Budget& budget, Sink sink) {
    std::unique_ptr<ZSTD_DCtx, decltype(&ZSTD_freeDCtx)> context(ZSTD_createDCtx_advanced(budget.memory()), ZSTD_freeDCtx);
    if (!context) throw Failure("memory", "Codec memory budget exhausted");
    codec(ZSTD_DCtx_setParameter(context.get(), ZSTD_d_windowLogMax, 23));
    std::vector<char> in(block), out(block);
    std::uint64_t read = 0, written = 0;
    std::size_t remaining = 1;
    while (const auto size = input.read(in.data(), in.size())) {
        check(options);
        if (size > options.input_limit - read) throw Failure("limit", "Input limit reached");
        read += size;
        ZSTD_inBuffer source{in.data(), size, 0};
        while (source.pos < source.size) {
            check(options);
            ZSTD_outBuffer target{out.data(), out.size(), 0};
            remaining = ZSTD_decompressStream(context.get(), &target, &source); codec(remaining);
            if (target.pos > options.output_limit - written) throw Failure("limit", "Output limit reached");
            sink(out.data(), target.pos); written += target.pos;
        }
        if (options.progress) options.progress(read, written, false);
    }
    if (!read || remaining != 0) throw Failure("integrity", "Truncated frame");
    return {read, written};
}
}

Hardware hardware() {
    Hardware result;
    result.cores = std::max(1U, std::thread::hardware_concurrency());
#if (defined(__x86_64__) || defined(__i386__)) && defined(__GNUC__)
    __builtin_cpu_init();
    result.avx2 = __builtin_cpu_supports("avx2");
    result.avx512 = __builtin_cpu_supports("avx512f");
#endif
#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
    int features[4]{}; __cpuid(features, 1);
    if ((features[2] & (1 << 27)) && (features[2] & (1 << 28))) {
        const auto mask = _xgetbv(0);
        __cpuidex(features, 7, 0);
        result.avx2 = (mask & 6) == 6 && (features[1] & (1 << 5));
        result.avx512 = (mask & 0xe6) == 0xe6 && (features[1] & (1 << 16));
    }
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
    result.neon = true; // Advanced SIMD is part of the ARM64 baseline.
#endif
#ifdef _WIN32
    MEMORYSTATUSEX memory{}; memory.dwLength = sizeof(memory);
    if (GlobalMemoryStatusEx(&memory)) result.available_memory = memory.ullAvailPhys;
#elif defined(__linux__)
    struct sysinfo memory{};
    if (!sysinfo(&memory)) result.available_memory = static_cast<std::uint64_t>(memory.freeram) * memory.mem_unit;
#elif defined(__APPLE__)
    vm_statistics64_data_t memory{};
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    vm_size_t page_size = 0;
    const auto host = mach_host_self();
    if (host_page_size(host, &page_size) == KERN_SUCCESS &&
        host_statistics64(host, HOST_VM_INFO64, reinterpret_cast<host_info64_t>(&memory), &count) == KERN_SUCCESS)
        result.available_memory = (static_cast<std::uint64_t>(memory.free_count) + memory.inactive_count) * page_size;
    mach_port_deallocate(mach_task_self(), host);
#endif
    // Conservative CPU scheduling. Unknown/low memory uses synchronous Zstd.
    result.workers = result.available_memory >= (512ULL << 20) ? std::min(2U, result.cores / 2) : 0;
    return result;
}

const char* codec_version() { return ZSTD_versionString(); }

std::string signature(const std::filesystem::path& path) {
    File input(path); std::array<unsigned char, 512> head{};
    const auto size = input.read(head.data(), head.size());
    auto starts = [&](const char* bytes, std::size_t length) { return size >= length && !std::memcmp(head.data(), bytes, length); };
    if (starts("\x28\xb5\x2f\xfd", 4)) return "zstd";
    if (starts("PK\x03\x04", 4) || starts("PK\x05\x06", 4)) return "zip";
    if (starts("\x1f\x8b", 2)) return "gzip";
    if (starts("BZh", 3)) return "bzip2";
    if (starts("\xfd" "7zXZ\0", 6)) return "xz";
    if (size >= 262 && !std::memcmp(head.data() + 257, "ustar", 5)) return "tar";
    if (starts("\x89PNG\r\n\x1a\n", 8)) return "png";
    if (starts("%PDF-", 5)) return "pdf";
    return "file";
}

Result compress(const std::filesystem::path& source, const std::filesystem::path& destination, const Options& options) {
    validate(options); check(options);
    File input(source); Output output(destination); Budget budget(options.memory_limit);
    Result result;
    {
        std::unique_ptr<ZSTD_CCtx, decltype(&ZSTD_freeCCtx)> context(ZSTD_createCCtx_advanced(budget.memory()), ZSTD_freeCCtx);
        if (!context) throw Failure("memory", "Codec memory budget exhausted");
        codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_compressionLevel, 3));
        codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_checksumFlag, 1));
        codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_windowLog, 20));
        codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_nbWorkers, static_cast<int>(options.workers)));
        if (options.workers) {
            codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_jobSize, 1 << 20));
            codec(ZSTD_CCtx_setParameter(context.get(), ZSTD_c_overlapLog, 1));
        }
        std::vector<char> in(block), out(block);
        bool finished = false;
        while (!finished) {
            check(options);
            const auto size = input.read(in.data(), in.size());
            if (size > options.input_limit - result.input_bytes) throw Failure("limit", "Input limit reached");
            result.input_bytes += size;
            ZSTD_inBuffer buffer{in.data(), size, 0};
            const auto directive = size ? ZSTD_e_continue : ZSTD_e_end;
            std::size_t remaining;
            do {
                check(options); ZSTD_outBuffer target{out.data(), out.size(), 0};
                remaining = ZSTD_compressStream2(context.get(), &target, &buffer, directive); codec(remaining);
                if (target.pos > options.output_limit - result.output_bytes) throw Failure("limit", "Output limit reached");
                output.file->write(out.data(), target.pos); result.output_bytes += target.pos;
            } while (buffer.pos < buffer.size || (!size && remaining));
            finished = !size;
            if (options.progress) options.progress(result.input_bytes, result.output_bytes, false);
        }
    }
    check(options); input.rewind(); output.file->rewind();
    std::vector<char> expected(block);
    auto verify_options = options;
    verify_options.input_limit = options.output_limit; verify_options.output_limit = options.input_limit;
    verify_options.progress = {};
    if (options.progress) options.progress(result.input_bytes, result.output_bytes, true);
    const auto verified = decode(*output.file, verify_options, budget, [&](const char* data, std::size_t size) {
        if (input.read(expected.data(), size) != size || std::memcmp(data, expected.data(), size))
            throw Failure("integrity", "Round-trip verification failed");
    });
    if (verified.output != result.input_bytes || input.read(expected.data(), 1)) throw Failure("integrity", "Input changed during verification");
    check(options); result.verified = true; result.allocator_peak = budget.peak();
    result.allocator_outstanding = budget.used();
    if (result.allocator_outstanding) throw Failure("memory", "Codec allocations remain after verification");
    output.publish(); return result;
}
Result decompress(const std::filesystem::path& source, const std::filesystem::path& destination, const Options& options) {
    validate(options); check(options);
    File input(source); Output output(destination); Budget budget(options.memory_limit);
    Result result;
    const auto decoded = decode(input, options, budget, [&](const char* data, std::size_t size) { output.file->write(data, size); });
    result.input_bytes = decoded.input;
    result.output_bytes = decoded.output;
    result.verified = true; result.allocator_peak = budget.peak(); result.allocator_outstanding = budget.used();
    if (result.allocator_outstanding) throw Failure("memory", "Codec allocations remain after decompression");
    check(options); output.publish(); return result;
}
}
