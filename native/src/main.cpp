#include "shante/kernel.hpp"
#include <chrono>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {
std::uint64_t number(const std::filesystem::path& value) {
    const auto text = value.string();
    if (text.empty() || text.size() > 20 || text.find_first_not_of("0123456789") != std::string::npos)
        throw shante::Failure("arguments", "Expected an unsigned integer");
    std::size_t used = 0; const auto result = std::stoull(text, &used);
    if (used != text.size()) throw shante::Failure("arguments", "Invalid integer");
    return result;
}
int execute(const std::vector<std::filesystem::path>& args) {
    try {
        if (args.size() == 2 && args[1] == "probe") {
            const auto hw = shante::hardware();
            std::cout << "{\"protocol\":1,\"engine\":\"shante-core\",\"version\":\"0.1.0\",\"codec\":\"zstd\",\"cores\":" << hw.cores
                << ",\"codecVersion\":\"" << shante::codec_version() << "\""
                << ",\"availableMemory\":" << hw.available_memory << ",\"workers\":" << hw.workers
                << ",\"avx2\":" << (hw.avx2 ? "true" : "false") << ",\"avx512\":" << (hw.avx512 ? "true" : "false")
                << ",\"neon\":" << (hw.neon ? "true" : "false") << ",\"gpuAcceleration\":false}\n"; return 0;
        }
        if (args.size() == 3 && args[1] == "inspect") {
            std::cout << "{\"format\":\"" << shante::signature(args[2]) << "\"}\n"; return 0;
        }
        if (args.size() != 9 || (args[1] != "compress" && args[1] != "decompress"))
            throw shante::Failure("arguments", "Use probe, inspect PATH, or compress/decompress INPUT OUTPUT INPUT_LIMIT OUTPUT_LIMIT MEMORY WORKERS CANCEL_FILE");
        shante::Options options;
        options.input_limit = number(args[4]); options.output_limit = number(args[5]); options.memory_limit = number(args[6]);
        const auto workers = number(args[7]);
        if (workers > 2) throw shante::Failure("arguments", "Worker limit is two");
        options.workers = static_cast<unsigned>(workers); options.cancel_file = args[8];
        auto last = std::chrono::steady_clock::time_point{};
        options.progress = [&](std::uint64_t read, std::uint64_t written, bool verifying) {
            const auto now = std::chrono::steady_clock::now();
            if (!verifying && now - last < std::chrono::milliseconds(250)) return;
            std::cout << "{\"event\":\"progress\",\"inputBytes\":" << read << ",\"outputBytes\":" << written
                << ",\"verifying\":" << (verifying ? "true" : "false") << "}\n" << std::flush; last = now;
        };
        const auto result = args[1] == "compress" ? shante::compress(args[2], args[3], options) : shante::decompress(args[2], args[3], options);
        std::cout << "{\"event\":\"result\",\"inputBytes\":" << result.input_bytes << ",\"outputBytes\":" << result.output_bytes
            << ",\"allocatorPeak\":" << result.allocator_peak << ",\"allocatorOutstanding\":" << result.allocator_outstanding
            << ",\"verified\":" << (result.verified ? "true" : "false") << "}\n";
        return 0;
    } catch (const shante::Failure& failure) {
        std::cout << "{\"event\":\"error\",\"code\":\"" << failure.code << "\"}\n"; return 2;
    } catch (const std::bad_alloc&) {
        std::cout << "{\"event\":\"error\",\"code\":\"memory\"}\n"; return 2;
    } catch (const std::exception&) {
        std::cout << "{\"event\":\"error\",\"code\":\"io\"}\n"; return 2;
    }
}
}
#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
#else
int main(int argc, char** argv) {
#endif
    std::vector<std::filesystem::path> args;
    for (int i = 0; i < argc; ++i) args.emplace_back(argv[i]);
    return execute(args);
}
