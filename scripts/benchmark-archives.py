"""Compare verified ZIP creation with identical seeded inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from processor.engine import BLOCK, Context, Sink, compress


def run_tool(tool, command, cwd):
    return subprocess.run([tool, *command], cwd=cwd, capture_output=True,
                          text=True, check=True, timeout=180).stdout.strip()


def verify(path, expected, limits):
    ctx = Context(path.parent, limits)
    with zipfile.ZipFile(path) as archive:
        if sorted(archive.namelist()) != sorted(expected):
            raise ValueError("Unexpected ZIP entries")
        for name, record in expected.items():
            with archive.open(name) as source:
                if ctx.copy(source, Sink(), expected=record["size"], progress=False) != record:
                    raise ValueError(f"ZIP content changed: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bsdtar", type=Path, help="Path to a bsdtar executable")
    parser.add_argument("--seven-zip", type=Path, help="Path to 7z or 7zz")
    parser.add_argument("--mib", type=int, default=32)
    parser.add_argument("--entries", type=int, default=128)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    if not (args.bsdtar or args.seven_zip):
        parser.error("Provide at least one comparison executable")
    if not (2 <= args.mib <= 512 and 2 <= args.entries <= 1000 and 1 <= args.repeats <= 10):
        parser.error("Use 2–512 MiB, 2–1000 entries, and 1–10 repeats")
    limits = {"expanded": (args.mib + 16) * BLOCK, "files": args.entries, "seconds": 180}
    expected = {}
    with tempfile.TemporaryDirectory(prefix="shante-zip-benchmark-") as temp:
        root = Path(temp)
        inputs = root / "inputs"
        inputs.mkdir()
        generator = random.Random(2027)
        size, remainder = divmod(args.mib * BLOCK, args.entries)
        for index in range(args.entries):
            name = f"item-{index:05}.bin"
            length = size + (index < remainder)
            payload = (b"SHANTE archive benchmark\n" * (length // 25 + 1))[:length] if index % 2 else generator.randbytes(length)
            (inputs / name).write_bytes(payload)
            expected[name] = {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        sources = [{"name": name, "path": str(inputs / name)} for name in expected]
        results = {}
        if args.bsdtar:
            tool = str(args.bsdtar.resolve())
            results["bsdtar"] = {"version": run_tool(tool, ["--version"], inputs),
                                 "settings": "ZIP Deflate level 6", "tool": tool}
        if args.seven_zip:
            tool = str(args.seven_zip.resolve())
            version = run_tool(tool, ["i"], inputs).splitlines()[0]
            results["7-Zip"] = {"version": version, "settings": "ZIP Deflate normal, one thread", "tool": tool}
        results["SHANTE"] = {"version": run_tool(shutil.which("git") or "git", ["rev-parse", "HEAD"], Path(__file__).resolve().parents[1]),
                             "settings": "ZIP Deflate level 6"}
        tools = list(results)
        for result in results.values():
            result["runs"] = []
        for trial in range(args.repeats):
            for index in range(len(tools)):
                name = tools[(index + trial) % len(tools)]
                result = results[name]
                output = root / "output.zip"
                start = time.perf_counter()
                if name == "SHANTE":
                    compress(sources, output, "zip", Context(root, limits))
                else:
                    command = (["-cf", str(output), "--format", "zip", "--options", "zip:compression=deflate,zip:compression-level=6"]
                               if name == "bsdtar" else ["a", "-tzip", "-mm=Deflate", "-mx=5", "-mmt=1", str(output)])
                    run_tool(result["tool"], [*command, *expected], inputs)
                    verify(output, expected, limits)
                elapsed = time.perf_counter() - start
                verify(output, expected, limits)
                result["runs"].append({"secondsIncludingVerification": elapsed, "outputBytes": output.stat().st_size})
                output.unlink()
        for result in results.values():
            result["medianSeconds"] = statistics.median(run["secondsIncludingVerification"] for run in result["runs"])
            result["verified"] = True
    report = {"platform": platform.platform(), "processor": platform.processor(),
              "python": platform.python_version(), "inputBytes": args.mib * BLOCK,
              "entries": args.entries, "fixtureSeed": 2027, "results": results}
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
