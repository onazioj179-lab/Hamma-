#include "shante/abi.h"

#include <stdio.h>
#include <string.h>

#define REQUIRE(test) do { if (!(test)) { fprintf(stderr, "%s failed\n", #test); return 1; } } while (0)

int main(void) {
    const char payload[] = "SHANTE C ABI round-trip";
    char restored[sizeof(payload)] = {0};
    shante_v1_result result;
    shante_v1_options options = {1024, 1024, 128ULL << 20, 0, NULL};
    remove("abi-input.bin");
    remove("abi-output.zst");
    remove("abi-restored.bin");
    remove("abi-limited.bin");

    FILE* input = fopen("abi-input.bin", "wb");
    REQUIRE(input != NULL);
    REQUIRE(fwrite(payload, 1, sizeof(payload), input) == sizeof(payload));
    REQUIRE(fclose(input) == 0);
    REQUIRE(shante_abi_version() == 1);
    REQUIRE(shante_v1_process(SHANTE_V1_COMPRESS, "abi-input.bin", "abi-output.zst", &options, &result) == SHANTE_V1_OK);
    REQUIRE(result.input_bytes == sizeof(payload) && result.output_bytes > 0 && result.allocator_outstanding == 0);
    REQUIRE(shante_v1_process(SHANTE_V1_COMPRESS, "abi-input.bin", "abi-output.zst", NULL, &result) == SHANTE_V1_OUTPUT_EXISTS);
    REQUIRE(result.input_bytes == 0 && result.output_bytes == 0);
    REQUIRE(shante_v1_process(SHANTE_V1_DECOMPRESS, "abi-output.zst", "abi-restored.bin", NULL, &result) == SHANTE_V1_OK);
    REQUIRE(result.output_bytes == sizeof(payload));
    FILE* output = fopen("abi-restored.bin", "rb");
    REQUIRE(output != NULL);
    REQUIRE(fread(restored, 1, sizeof(restored), output) == sizeof(restored));
    REQUIRE(fclose(output) == 0);
    REQUIRE(memcmp(payload, restored, sizeof(payload)) == 0);
    options.output_limit = 1;
    REQUIRE(shante_v1_process(SHANTE_V1_DECOMPRESS, "abi-output.zst", "abi-limited.bin", &options, &result) == SHANTE_V1_LIMIT);
    REQUIRE(fopen("abi-limited.bin", "rb") == NULL);
    return 0;
}
