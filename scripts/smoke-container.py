"""Check a disposable HAMMA container through its public HTTP endpoints."""

import argparse
import hashlib
from http.cookiejar import LWPCookieJar
from io import BytesIO
import json
from pathlib import Path
import random
import re
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from processor.tests.pdf_fixture import two_page_pdf
from processor.tests.office_fixture import office_fixture


def check(base, state_path=None, after_restart=False):
    cookie_path = state_path.with_suffix(".cookies") if state_path else None
    cookies = LWPCookieJar(cookie_path)
    if after_restart:
        cookies.load(ignore_discard=True)
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(cookies))

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

    def assert_owner_only(job):
        stranger = build_opener(ProxyHandler({}))
        try:
            stranger.open(base + job["download"], timeout=10).close()
        except HTTPError as error:
            assert error.code in (401, 403, 404), error
            error.close()
        else:
            raise AssertionError("A different guest could download the output")

    def check_manifest(job):
        url = "/api/process/jobs/" + job["id"] + "/manifest"
        first = call(url + "?limit=1")
        last = call(url + "?limit=1&after=" + first["nextCursor"])
        assert first["total"] == last["total"] == 2
        assert first["sha256"] == last["sha256"] == job["sha256"]
        assert last["nextCursor"] is None
        return [(entry["name"], entry["sha256"]) for entry in first["files"] + last["files"]]

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
        return job, data

    # Readiness is polled by the container and by operators without a session.
    with build_opener(ProxyHandler({})).open(base + "/api/process/ready", timeout=10) as response:
        assert json.load(response) == {"ready": True}
        assert response.headers.get("Set-Cookie") is None
    if after_restart:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        job = call("/api/process/jobs/" + state["job"])
        data = call(job["download"], raw=True)
        assert job["sha256"] == hashlib.sha256(data).hexdigest() == state["sha256"]
        assert_owner_only(job)
        assert check_manifest(job) == [tuple(entry) for entry in state["manifest"]]
        assert call("/api/process/settings")["fileRetention"] == "7d"
        path = "/api/process/uploads/" + state["upload"]
        checkpoint = call(path)
        assert checkpoint["offset"] == 5, checkpoint
        result = call(path, b" after restart", "PUT", {"Upload-Offset": "5"})
        assert result["offset"] == 19, result
        _, data = download("compress", "zip", [state["upload"]])
        with ZipFile(BytesIO(data)) as archive:
            assert archive.read("resume.txt") == b"start after restart"
        print("Restart preserved retention, the verified download, and the upload checkpoint.")
        return

    page = call("/", raw=True)
    assert b'id="root"' in page
    bundle = re.search(rb'<script[^>]+src="(/assets/[^"]+\.js)"', page)
    assert bundle and call(bundle[1].decode("ascii"), raw=True)
    capabilities = call("/api/process/capabilities")
    assert capabilities["officePdf"], capabilities
    for extension in ("docx", "xlsx", "pptx"):
        office_job, office_pdf = download("convert", "office-pdf",
                                         [upload("office." + extension, office_fixture(extension))])
        assert office_job["outputName"] == "office.pdf", office_job
        assert office_pdf.startswith(b"%PDF-")
        text = subprocess.run(["pdftotext", "-", "-"], input=office_pdf,
                              capture_output=True, check=True, timeout=10).stdout
        assert b"HAMMA verified export" in b" ".join(text.split()), (extension, text)
        assert_owner_only(office_job)
    assert capabilities["pdfPages"], capabilities
    _, rendered = download("convert", "pdf-pages", [upload("fixture.pdf", two_page_pdf())])
    with ZipFile(BytesIO(rendered)) as pages:
        assert pages.namelist() == ["page-001.png", "page-002.png"]
        assert [tuple(int.from_bytes(pages.read(name)[offset:offset + 4], "big") for offset in (16, 20))
                for name in pages.namelist()] == [(1024, 2048), (2048, 1024)]
    assert capabilities["nativeEngine"]["protocol"] == 1, capabilities
    assert "tar.zst" in capabilities["archives"], capabilities
    files = {"nested/one.txt": b"First member", "two.bin": random.Random(42).randbytes(4096)}
    packed_job, packed = download("compress", "tar.zst", [upload(name, data) for name, data in files.items()])
    packed_name = packed_job["outputName"]
    assert packed_name.endswith(".tar.zst"), packed_name
    packed_id = upload(packed_name, packed)
    _, report = download("verify", "json", [packed_id])
    report = json.loads(report)
    assert report["format"] == "tar.zst", report
    assert {entry["name"]: entry["sha256"] for entry in report["entries"]} == {
        name: hashlib.sha256(data).hexdigest() for name, data in files.items()
    }, report
    restored_job, restored = download("extract", "zip", [packed_id])
    with ZipFile(BytesIO(restored)) as archive:
        assert {name: archive.read(name) for name in archive.namelist()} == files
    assert_owner_only(restored_job)
    manifest = check_manifest(restored_job)
    assert manifest == [(name, hashlib.sha256(data).hexdigest()) for name, data in files.items()]
    if state_path:
        settings = {"historyRetention": "30d", "fileRetention": "7d"}
        call("/api/process/settings", json.dumps(settings).encode(), "PUT",
             {"Content-Type": "application/json"})
        source = post("/api/process/uploads", {"name": "resume.txt", "size": 19})
        result = call("/api/process/uploads/" + source["id"], b"start", "PUT",
                      {"Upload-Offset": "0"})
        assert result["offset"] == 5, result
        cookies.save(ignore_discard=True)
        state_path.write_text(json.dumps({"job": restored_job["id"],
                                          "sha256": restored_job["sha256"],
                                          "manifest": manifest,
                                          "upload": source["id"]}), encoding="utf-8")
    print("Container served the web build and verified an exact TAR.ZST round trip.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("--state", type=Path)
    parser.add_argument("--after-restart", action="store_true")
    args = parser.parse_args()
    if args.after_restart and not args.state:
        parser.error("--after-restart requires --state")
    check(args.base.rstrip("/"), args.state, args.after_restart)
