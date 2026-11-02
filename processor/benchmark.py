"""Small reproducible workload benchmark; results are not large-scale claims."""
import argparse
import json
import os
from pathlib import Path
import tempfile
import time
import tracemalloc

from .engine import BLOCK, Context, compress


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size-mib", type=int, default=16)
    args = parser.parse_args()
    if not 1 <= args.size_mib <= 1024:
        parser.error("Choose between 1 and 1024 MiB")
    results = []
    with tempfile.TemporaryDirectory(prefix="hamma-bench-") as folder:
        root = Path(folder)
        for kind in ("repeated-text", "random-bytes"):
            source = root / "input"
            with source.open("wb") as stream:
                for _ in range(args.size_mib):
                    data = os.urandom(BLOCK) if kind == "random-bytes" else (b"HAMMA streaming benchmark.\n" * (BLOCK // 26 + 1))[:BLOCK]
                    stream.write(data)
            size = source.stat().st_size
            ctx = Context(root, {"expanded": size * 2, "files": 5000, "depth": 8, "ratio": 1000, "seconds": 1800})
            tracemalloc.start()
            started = time.perf_counter()
            manifest = compress([{"name": "input", "path": str(source)}], root / "output.zip", "zip", ctx)
            duration = time.perf_counter() - started
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            results.append({"workload": kind, "inputBytes": size, "outputBytes": (root / "output.zip").stat().st_size,
                            "secondsIncludingVerification": round(duration, 4), "inputMiBPerSecond": round(size / BLOCK / duration, 3),
                            "peakPythonAllocatedBytes": peak, "sha256": manifest[0]["sha256"], "verified": True})
    print(json.dumps({"note": "Local sample only. Memory is traced Python allocations, not full process/native RSS.", "results": results}, indent=2))


if __name__ == "__main__":
    main()
