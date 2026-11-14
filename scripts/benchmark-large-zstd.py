"""Measure verified SHANTE compression against an explicit byte target."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--source", type=Path, help="Use an existing file instead of the sparse zero fixture")
    parser.add_argument("--bytes", type=int, default=100_000_000_000)
    parser.add_argument("--target-bytes", type=int, default=74_000_000)
    args = parser.parse_args()
    if args.source is None and platform.system() != "Windows":
        parser.error("The synthetic fixture uses Windows sparse files. Supply --source on other platforms.")
    if args.bytes <= 0 or args.target_bytes <= 0:
        parser.error("Byte counts must be positive")
    binary = args.binary.resolve(strict=True)
    report_path = args.report.resolve()
    source_path = args.source.resolve(strict=True) if args.source is not None else None
    if source_path is not None and (not source_path.is_file() or source_path.stat().st_size != args.bytes):
        parser.error("--source must be a regular file matching --bytes")
    if report_path in (binary, source_path):
        parser.error("--report must be separate from the source and binary")
    probe = json.loads(subprocess.check_output([binary, "probe"], text=True, timeout=10))
    memory_budget = 128 * 1024**2
    with tempfile.TemporaryDirectory(prefix="hamma-large-zstd-") as directory:
        root = Path(directory)
        source = source_path
        output = root / "output.zst"
        if source is None:
            source = root / "zero.bin"
            source.touch()
            subprocess.run(["fsutil", "sparse", "setflag", source], check=True, timeout=10)
            with source.open("r+b") as stream:
                stream.truncate(args.bytes)
        started = time.perf_counter()
        process = subprocess.run([
            binary, "compress", source, output, str(args.bytes), str(args.target_bytes),
            str(memory_budget), "1", root / "cancel",
        ], capture_output=True, text=True, timeout=3600)
        elapsed = time.perf_counter() - started
        events = [json.loads(line) for line in process.stdout.splitlines()]
        result = events[-1] if events else {}
        if (process.returncode or result.get("event") != "result" or result.get("verified") is not True
                or result.get("inputBytes") != args.bytes or result.get("allocatorOutstanding") != 0):
            raise SystemExit(f"Codec did not finish verified compression: {result}")
        size = output.stat().st_size
        if not 0 < size == result.get("outputBytes") <= args.target_bytes:
            raise SystemExit("Output size did not match the codec result or byte target")
        with output.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {
        "fixture": "supplied file" if source_path else "single sparse file whose logical bytes are all zero",
        "platform": platform.platform(),
        "codec": probe["codec"],
        "codecVersion": probe["codecVersion"],
        "engineVersion": probe["version"],
        "inputBytes": args.bytes,
        "targetBytes": args.target_bytes,
        "outputBytes": size,
        "outputSHA256": digest,
        "secondsIncludingByteForByteVerification": round(elapsed, 3),
        "codecMemoryBudgetBytes": memory_budget,
        "codecAllocatorPeakBytes": result["allocatorPeak"],
        "verified": True,
    }
    with report_path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
