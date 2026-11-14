"""Run a real staged ZIP upload round trip against a disposable local processor."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.cookiejar import CookieJar
import json
from pathlib import Path
import platform
import random
import shutil
import tempfile
import threading
import time
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener
from zipfile import ZipFile

from .resources import configured_limits
from .server import LocalHTTPServer, Service, handler


def exercise(base, root, count, size):
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def request(path, method="GET", body=None, *, timeout=180, **headers):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        return client.open(Request(base + path, body, {"X-Hamma-Request": "1", **headers},
                                   method=method), timeout=timeout)

    def call(path, method="GET", body=None, **headers):
        with request(path, method, body, **headers) as response:
            return json.load(response)

    def upload_file(index):
        name = f"folder-{index // 100:03d}/file-{index:05d}.bin"
        payload = random.Random(index).randbytes(size)
        upload = call("/api/process/uploads", "POST", {"name": name, "size": size})["id"]
        persisted = call(f"/api/process/uploads/{upload}", "PUT", payload, **{"Upload-Offset": "0"})
        assert persisted["offset"] == size
        return upload, (name, hashlib.sha256(payload).hexdigest())

    selection_id = "a" * 32
    # Establish the shared guest cookie before concurrent requests.
    call("/api/process/settings")
    started = time.monotonic()
    uploads, expected = [], []
    with ThreadPoolExecutor(8) as pool:
        for offset in range(0, count, 100):
            for upload, metadata in pool.map(upload_file, range(offset, min(offset + 100, count))):
                uploads.append(upload)
                expected.append(metadata)
            if len(uploads) % 1000 == 0:
                print(f"Uploaded {len(uploads)} files", flush=True)
    for offset in range(0, count, 100):
        ids = uploads[offset:offset+100]
        stage = call(f"/api/process/job-selections/{selection_id}", "PUT", {"offset": offset, "uploads": ids})
        assert stage["offset"] == offset + len(ids)

    assert len({digest for _, digest in expected}) == count
    uploaded = time.monotonic()
    job = call("/api/process/jobs", "POST", {
        "selectionId": selection_id, "selectionCount": count, "operation": "compress",
        "target": "zip", "requestId": "b" * 64,
    }, timeout=900)
    admitted = time.monotonic()
    path = f"/api/process/jobs/{job['id']}"
    deadline = admitted + 480
    while job["state"] in ("queued", "processing", "verifying"):
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Job timed out in {job['state']}")
        time.sleep(1)
        job = call(path)
    if job["state"] != "completed":
        raise RuntimeError(f"ZIP job failed: {job}")
    completed = time.monotonic()

    output = root / "download.zip"
    with request(job["download"]) as response, output.open("wb") as stream:
        shutil.copyfileobj(response, stream, 1024**2)
    with output.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == job["sha256"]
    with ZipFile(output) as archive:
        assert len(archive.infolist()) == count
        for info, (name, digest) in zip(archive.infolist(), expected, strict=True):
            assert info.filename == name and info.file_size == size
            with archive.open(info) as member:
                assert hashlib.file_digest(member, "sha256").hexdigest() == digest
    cursor = "0"
    for offset in range(0, count, 100):
        page = call(f"{path}/manifest?limit=100&after={cursor}")
        assert page["total"] == count and page["sha256"] == job["sha256"]
        assert [(entry["name"], entry["sha256"]) for entry in page["files"]] == expected[offset:offset+100]
        cursor = page["nextCursor"]
        assert cursor == (str(offset + 100) if offset + 100 < count else None)
    return {
        "platform": platform.platform(), "python": platform.python_version(),
        "files": count, "uniqueDigests": count, "inputBytes": count * size,
        "outputBytes": output.stat().st_size, "outputSHA256": job["sha256"],
        "uploadAndStagingSeconds": round(uploaded - started, 3),
        "admissionSeconds": round(admitted - uploaded, 3),
        "queueProcessingAndVerificationSeconds": round(completed - admitted, 3),
        "downloadAndIndependentVerificationSeconds": round(time.monotonic() - completed, 3),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--files", type=int, default=5000)
    parser.add_argument("--bytes-per-file", type=int, default=32768)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not 101 <= args.files <= 5000 or not 32 <= args.bytes_per_file <= 65536:
        parser.error("Use 101–5000 files and 32–65536 bytes per file")
    with tempfile.TemporaryDirectory(prefix="hamma-upload-scale-") as directory:
        root = Path(directory)
        processor = Service(root / "data", limits=configured_limits({}))
        # Isolate payload-scale measurement from the normal per-IP rate limit.
        processor.requests_per_minute = 20000
        with LocalHTTPServer(("127.0.0.1", 0), handler(processor)) as server:
            http = threading.Thread(target=server.serve_forever, daemon=True)
            scheduler = threading.Thread(target=processor.loop, daemon=True)
            http.start()
            scheduler.start()
            try:
                report = exercise(f"http://127.0.0.1:{server.server_port}", root,
                                  args.files, args.bytes_per_file)
                report["requestLimitPerMinute"] = processor.requests_per_minute
            finally:
                server.shutdown()
                processor.stop.set()
                http.join()
                scheduler.join()
                processor.close()
    with args.report.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
