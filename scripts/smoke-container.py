"""Check a disposable HAMMA container through its public HTTP endpoints."""

import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
import random
import re
import sys
import time
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile


def check(base):
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def call(path, payload=None, method="GET", headers=None, raw=False):
        request = Request(base + path, data=payload, method=method,
                          headers={"X-Hamma-Request": "1", **(headers or {})})
        with client.open(request, timeout=10) as response:
            data = response.read()
        return data if raw else json.loads(data)

    def post(path, payload):
        return call(path, json.dumps(payload).encode(), "POST", {"Content-Type": "application/json"})

    def upload(name, payload):
        source = post("/api/process/uploads", {"name": name, "size": len(payload)})
        result = call("/api/process/uploads/" + source["id"], payload, "PUT",
                      {"Upload-Offset": "0"})
        assert result["offset"] == len(payload), result
        return source["id"]

    def download(operation, target, uploads):
        job = post("/api/process/jobs", {"operation": operation, "target": target, "uploads": uploads})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            job = call("/api/process/jobs/" + job["id"])
            if job["state"] in ("completed", "failed", "cancelled", "interrupted"):
                break
            time.sleep(.2)
        assert job["state"] == "completed", job
        data = call(job["download"], raw=True)
        assert hashlib.sha256(data).hexdigest() == job["sha256"]
        return job["outputName"], data

    page = call("/", raw=True)
    assert b'id="root"' in page
    bundle = re.search(rb'<script[^>]+src="(/assets/[^"]+\.js)"', page)
    assert bundle and call(bundle[1].decode("ascii"), raw=True)
    capabilities = call("/api/process/capabilities")
    assert capabilities["nativeEngine"]["protocol"] == 1, capabilities
    assert "tar.zst" in capabilities["archives"], capabilities
    files = {"nested/one.txt": b"First member", "two.bin": random.Random(42).randbytes(4096)}
    packed_name, packed = download("compress", "tar.zst", [upload(name, data) for name, data in files.items()])
    assert packed_name.endswith(".tar.zst"), packed_name
    packed_id = upload(packed_name, packed)
    _, report = download("verify", "json", [packed_id])
    report = json.loads(report)
    assert report["format"] == "tar.zst", report
    assert {entry["name"]: entry["sha256"] for entry in report["entries"]} == {
        name: hashlib.sha256(data).hexdigest() for name, data in files.items()
    }, report
    _, restored = download("extract", "zip", [packed_id])
    with ZipFile(BytesIO(restored)) as archive:
        assert {name: archive.read(name) for name in archive.namelist()} == files
    print("Container served the web build and verified an exact TAR.ZST round trip.")


if __name__ == "__main__":
    check(sys.argv[1].rstrip("/"))
