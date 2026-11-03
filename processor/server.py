"""Local-only HTTP service. Start with python -m processor.server.

The service requires explicit private hosts for non-loopback binds. Public, multi-tenant hosting
requires an authenticated gateway and stronger per-worker OS sandboxing.
"""
from __future__ import annotations

import argparse
import errno
from contextlib import contextmanager
import hashlib
import gzip
import hmac
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import logging
import lzma
import multiprocessing
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import shutil
import sqlite3
import threading
import tarfile
import time
from urllib.parse import parse_qs, urlsplit, quote
import zipfile

from .engine import ARCHIVES, MEDIA, BLOCK, Context, ProcessingError, compress, convert, detect, extract, file_digest, safe_path

LOG = logging.getLogger("hamma.processor")
TERMINAL = ("completed", "failed", "cancelled", "interrupted")
ACTIVE = ("queued", "processing", "verifying")
PROCESSOR_REVISION = ":".join(hashlib.sha256(path.read_bytes()).hexdigest() for path in
                              (Path(__file__), Path(__file__).with_name("engine.py")))
RETENTION = {"24h": 86400, "7d": 604800, "30d": 2592000, "never": None}


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.database = self.root / "metadata.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("BEGIN IMMEDIATE")
            schema = "CREATE TABLE IF NOT EXISTS records (id TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, created REAL NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,kind,id))"
            db.execute(schema)
            columns = {row["name"]: row["pk"] for row in db.execute("PRAGMA table_info(records)")}
            if not columns.get("owner"):
                # Migrate the first local-service schema without losing guest data.
                db.execute("ALTER TABLE records RENAME TO legacy_records")
                db.execute("DROP INDEX IF EXISTS records_owner")
                db.execute(schema)
                db.execute("INSERT INTO records SELECT * FROM legacy_records")
                db.execute("DROP TABLE legacy_records")
            db.execute("CREATE INDEX IF NOT EXISTS records_owner ON records(owner,kind,created DESC)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, owner, kind, record):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)", (record["id"], owner, kind, record["created"], json.dumps(record)))

    def get(self, owner, kind, record_id):
        with self.connect() as db:
            row = db.execute("SELECT data FROM records WHERE id=? AND owner=? AND kind=?", (record_id, owner, kind)).fetchone()
        return json.loads(row[0]) if row else None

    def patch(self, owner, kind, record_id, **updates):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT data FROM records WHERE id=? AND owner=? AND kind=?", (record_id, owner, kind)).fetchone()
            if not row:
                return None
            previous = json.loads(row[0])
            if updates.get("state") == "completed" and previous.get("state") == "cancelled":
                return previous
            record = {**previous, **updates}
            db.execute("UPDATE records SET data=? WHERE id=? AND owner=? AND kind=?", (json.dumps(record), record_id, owner, kind))
            return record

    def list(self, owner=None, kind="job"):
        with self.connect() as db:
            if owner:
                rows = db.execute("SELECT owner,data FROM records WHERE kind=? AND owner=? ORDER BY created DESC", (kind, owner)).fetchall()
            else:
                rows = db.execute("SELECT owner,data FROM records WHERE kind=? ORDER BY created", (kind,)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def delete(self, owner, record_id):
        with self.connect() as db:
            db.execute("DELETE FROM records WHERE owner=? AND id=?", (owner, record_id))

    def folder(self, owner, record_id):
        # Both components are generated identifiers, never user-supplied paths.
        if not re.fullmatch(r"[a-f0-9]{64}", owner) or not re.fullmatch(r"[a-f0-9]{32}", record_id):
            raise ProcessingError("Invalid identifier")
        return self.root / owner / record_id


def run_job(root, owner, job_id, limits, isolated=False):
    if isolated and os.name != "nt":
        os.setsid()
        import resource
        resource.setrlimit(resource.RLIMIT_FSIZE, (limits["expanded"] + 64 * BLOCK,) * 2)
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (limits["seconds"],) * 2)
    store = Store(root)
    job = store.get(owner, "job", job_id)
    directory = store.folder(owner, job_id)
    started = time.time()
    last_report = [0.0]

    def report(**updates):
        now = time.monotonic()
        if "state" in updates or now - last_report[0] >= .2:
            store.patch(owner, "job", job_id, **updates)
            last_report[0] = now

    ctx = Context(directory, limits, report)
    output = directory / ("output." + job["target"])
    try:
        store.patch(owner, "job", job_id, state="processing", started=started, error=None)
        manifest = []
        for upload in job["inputs"]:
            upload["path"] = str(store.folder(owner, upload["id"]) / "input")
            if upload.get("directory"):
                continue
            ctx.check()
            original = file_digest(Path(upload["path"]), ctx)
            if original["size"] != upload["size"] or original["sha256"] != upload["sha256"]:
                raise ProcessingError("Input integrity check failed")
        if job["operation"] == "compress":
            manifest = compress(job["inputs"], output, job["target"], ctx)
        elif job["operation"] == "extract":
            item = job["inputs"][0]
            manifest = extract(Path(item["path"]), item["name"], output, ctx, job["recursive"])
        else:
            manifest = convert(Path(job["inputs"][0]["path"]), output, job["target"], ctx)
        ctx.check()
        store.patch(owner, "job", job_id, state="verifying")
        digest = file_digest(output, ctx)
        if digest["size"] > limits["expanded"]:
            raise ProcessingError("Output size limit reached")
        # The API exposes only names and opaque identifiers, never storage paths.
        extension = "zip" if detect(output) == "zip" else job["target"]
        stem = Path(job["name"]).name.rsplit(".", 1)[0] or "files"
        output_name = ("extracted" if job["operation"] == "extract" else stem) + "." + extension
        ctx.check()
        store.patch(owner, "job", job_id, state="completed", processed=job["inputSize"],
                    error=None,
                    outputSize=digest["size"], sha256=digest["sha256"], manifest=manifest,
                    outputFile=output.name, outputName=output_name, finished=time.time(),
                    duration=time.time() - started, downloadAvailable=True)
    except Exception as error:
        LOG.exception("Job failed: %s", job_id)
        message = str(error) if isinstance(error, ProcessingError) else "Processing failed"
        if isinstance(error, (zipfile.BadZipFile, tarfile.TarError, gzip.BadGzipFile, lzma.LZMAError, EOFError)):
            message = "Corrupted archive"
        elif isinstance(error, OSError) and error.errno == errno.ENOSPC:
            message = "Storage full"
        elif isinstance(error, PermissionError):
            message = "Missing permissions"
        state = "cancelled" if (directory / "cancel").exists() else "failed"
        store.patch(owner, "job", job_id, state=state, error=message, finished=time.time(), duration=time.time() - started, downloadAvailable=False)
        output.unlink(missing_ok=True)
    finally:
        shutil.rmtree(directory / "expanded", ignore_errors=True)
        for part in directory.glob("audio-*.*"):
            part.unlink(missing_ok=True)
        log = directory / "media.log"
        if log.exists() and log.stat().st_size > BLOCK:
            with log.open("r+b") as stream:
                stream.truncate(BLOCK)


class Service:
    def __init__(self, root, web=None, limits=None, lan_hosts=()):
        self.store = Store(root)
        self.lan_hosts = frozenset(lan_hosts)
        self.instance_id = secrets.token_hex(16)
        self.instance_lock = (self.store.root / ".server.lock").open("a+b")
        self.instance_lock.write(b"\0")
        self.instance_lock.flush()
        self.instance_lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.instance_lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.instance_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.instance_lock.close()
            raise RuntimeError("Another processor is using this data directory") from None
        self.web = Path(web).resolve() if web else None
        self.limits = limits or {"input": 8 * 1024**3, "expanded": 2 * 1024**3, "files": 5000,
                                 "ratio": 1000, "depth": 8, "seconds": 1800, "storage": 20 * 1024**3}
        self.lock = threading.RLock()
        self.running = {}
        self.restart_until = 0
        self.stop = threading.Event()
        self.secret = self.store.root / ".key"
        if not self.secret.exists():
            fd = os.open(self.secret, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(secrets.token_bytes(32))
        self.key = self.secret.read_bytes()
        self.rates = {}
        self.requests_per_minute = int(os.environ.get("HAMMA_REQUESTS_PER_MINUTE", "2000"))
        if not 1 <= self.requests_per_minute <= 1000000:
            raise ValueError("HAMMA_REQUESTS_PER_MINUTE must be between 1 and 1000000")
        # A crash must never leave an old success or a fictitious running job.
        for owner, record in self.store.list():
            if record["state"] in ("processing", "verifying"):
                self.store.patch(owner, "job", record["id"], state="interrupted", error="Processing interrupted", downloadAvailable=False)
                self.clean_work(owner, record["id"])

    def sign(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()

    def defaults(self, owner):
        pref = self.store.get(owner, "settings", "settings")
        return pref or {"id": "settings", "created": time.time(), "historyRetention": "30d", "fileRetention": "24h"}

    def reserved(self):
        uploads = sum(u["size"] for _, u in self.store.list(kind="upload"))
        outputs = sum(j.get("outputSize") or 0 for _, j in self.store.list() if j.get("downloadAvailable"))
        return uploads + outputs + len(self.running) * self.limits["expanded"]

    def public(self, owner, record):
        result = {k: v for k, v in record.items() if k not in ("inputs", "outputFile", "manifest")}
        result["downloadAvailable"] = bool(record.get("downloadAvailable") and record["fileExpires"] > time.time())
        if result["downloadAvailable"]:
            expiry = min(int(time.time()) + 3600, int(record["fileExpires"]))
            token = self.sign(f"{owner}:{record['id']}:{expiry}")
            result["download"] = f"/api/process/jobs/{record['id']}/download?expires={expiry}&token={token}"
        result["fileCount"] = len(record["inputs"])
        return result

    def cleanup(self):
        now = time.time()
        with self.lock:
            for owner, job in self.store.list():
                if job["state"] in ACTIVE or job["state"] == "paused":
                    continue
                if job["id"] in self.running:
                    continue
                if job["fileExpires"] <= now:
                    directory = self.store.folder(owner, job["id"])
                    if directory.exists():
                        shutil.rmtree(directory)
                    self.store.patch(owner, "job", job["id"], downloadAvailable=False, outputFile=None)
                if job.get("historyExpires") and job["historyExpires"] <= now:
                    # History expires independently; file cleanup remains tracked by a tombstone.
                    self.store.patch(owner, "job", job["id"], hidden=True)
                    if job["fileExpires"] <= now:
                        directory = self.store.folder(owner, job["id"])
                        if directory.exists():
                            shutil.rmtree(directory)
                        self.store.delete(owner, job["id"])
                elif job.get("hidden") and job["fileExpires"] <= now:
                    self.store.delete(owner, job["id"])
            for owner, upload in self.store.list(kind="upload"):
                referenced = any(upload["id"] in [i["id"] for i in j["inputs"]] and (j["state"] in ACTIVE or j["state"] == "paused" or j["fileExpires"] > now)
                                 for _, j in self.store.list(owner))
                if upload["expires"] <= now and not referenced:
                    directory = self.store.folder(owner, upload["id"])
                    if directory.exists():
                        shutil.rmtree(directory)
                    self.store.delete(owner, upload["id"])

    def terminate(self, job_id):
        entry = self.running.get(job_id)
        if not entry:
            return
        process = entry[0]
        if process.is_alive():
            if os.name == "nt":
                # Terminate the generated worker's process tree, including FFmpeg.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    process.terminate()
            process.join(3)
            if process.is_alive():
                process.kill()
                process.join(3)
        record = self.store.get(entry[1], "job", job_id)
        if not process.is_alive() and record and record["state"] != "completed":
            self.clean_work(entry[1], job_id)

    def clean_work(self, owner, job_id):
        directory = self.store.folder(owner, job_id)
        if not directory.exists():
            return
        for path in directory.iterdir():
            if path.name in ("cancel", "media.log"):
                continue
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)

    def delete_files(self, owner, record):
        self.terminate(record["id"])
        self.running.pop(record["id"], None)
        shutil.rmtree(self.store.folder(owner, record["id"]), ignore_errors=False)
        self.store.patch(owner, "job", record["id"], downloadAvailable=False, fileExpires=time.time())
        for upload in record["inputs"]:
            others = [j for _, j in self.store.list(owner) if j["id"] != record["id"] and upload["id"] in [i["id"] for i in j["inputs"]] and (j["fileExpires"] > time.time() or j["state"] in (*ACTIVE, "paused"))]
            if not others:
                folder = self.store.folder(owner, upload["id"])
                if folder.exists():
                    shutil.rmtree(folder)
                self.store.delete(owner, upload["id"])

    def tick(self):
        with self.lock:
            for job_id, (process, owner, started) in list(self.running.items()):
                if process.is_alive() and time.monotonic() - started > self.limits["seconds"] + 10:
                    self.terminate(job_id)
                if not process.is_alive():
                    process.join()
                    record = self.store.get(owner, "job", job_id)
                    if record and record["state"] in ACTIVE:
                        self.store.patch(owner, "job", job_id, state="interrupted", error="Worker interrupted", downloadAvailable=False)
                    if record and record["state"] != "completed":
                        self.clean_work(owner, job_id)
                    del self.running[job_id]
            if time.monotonic() < self.restart_until:
                return
            for owner, job in self.store.list():
                if len(self.running) >= 2:
                    break
                if job["state"] != "queued":
                    continue
                if self.reserved() + self.limits["expanded"] > self.limits["storage"]:
                    self.store.patch(owner, "job", job["id"], state="failed", error="Storage full", downloadAvailable=False)
                    continue
                self.store.patch(owner, "job", job["id"], state="processing")
                process = multiprocessing.get_context("spawn").Process(target=run_job, args=(str(self.store.root), owner, job["id"], self.limits, True))
                process.start()
                self.running[job["id"]] = (process, owner, time.monotonic())

    def loop(self):
        last_cleanup = 0
        while not self.stop.wait(.25):
            try:
                self.tick()
                if time.monotonic() - last_cleanup > 30:
                    self.cleanup()
                    last_cleanup = time.monotonic()
            except Exception:
                LOG.exception("Scheduler error")

    def close(self):
        self.stop.set()
        with self.lock:
            for job_id in list(self.running):
                self.terminate(job_id)
            if not self.instance_lock.closed:
                self.instance_lock.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.instance_lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.instance_lock.fileno(), fcntl.LOCK_UN)
                self.instance_lock.close()


class HTTPError(Exception):
    def __init__(self, status, message, retry_after=None):
        self.status, self.message, self.retry_after = status, message, retry_after


class LocalHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        # Windows SO_REUSEADDR otherwise permits two listeners on one port.
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def handler(service):
    class Handler(BaseHTTPRequestHandler):
        # HTTP/1.0 closes each connection, including rejected request bodies.
        server_version = "HAMMA"

        def log_message(self, fmt, *args):
            # No filenames, signed URLs, cookies, or query strings in access logs.
            LOG.debug("HTTP %s", self.command)

        def send(self, status, value, retry_after=None):
            data = json.dumps(value, ensure_ascii=True).encode()
            self.send_response(status)
            self.headers_common()
            if retry_after is not None:
                self.send_header("Retry-After", str(retry_after))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def headers_common(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
            if getattr(self, "new_cookie", None):
                self.send_header("Set-Cookie", self.new_cookie)

        def identity(self):
            self.new_cookie = None
            peer = ipaddress.ip_address(self.client_address[0])
            if service.lan_hosts and not (peer.is_private or peer.is_loopback):
                raise HTTPError(403, "Private network only")
            host = self.headers.get("Host", "")
            parsed = urlsplit("http://" + host)
            if parsed.hostname not in ("localhost", "127.0.0.1", "::1", *service.lan_hosts):
                raise HTTPError(403, "Invalid host")
            origin = self.headers.get("Origin")
            if origin and origin not in ("http://" + host, "https://" + host):
                raise HTTPError(403, "Invalid origin")
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise HTTPError(403, "Invalid origin")
            jar = cookies.SimpleCookie()
            try:
                jar.load(self.headers.get("Cookie", ""))
            except cookies.CookieError:
                pass
            cookie_name = f"hamma_session_{self.server.server_port}"
            cookie = jar.get(cookie_name)
            parts = cookie.value.split(".") if cookie else []
            if len(parts) != 2 or not re.fullmatch(r"[a-f0-9]{64}", parts[0]) or not hmac.compare_digest(service.sign(parts[0]), parts[1]):
                session = secrets.token_hex(32)
                self.new_cookie = f"{cookie_name}={session}.{service.sign(session)}; HttpOnly; SameSite=Strict; Path=/"
            else:
                session = parts[0]
            self.owner = hashlib.sha256(session.encode()).hexdigest()

        def json_body(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise HTTPError(415, "Expected JSON")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 2 * BLOCK:
                raise HTTPError(413, "Request too large")
            def reject_constant(value):
                raise ValueError("Non-finite JSON number")
            value = json.loads(self.rfile.read(length), parse_constant=reject_constant)
            if not isinstance(value, dict):
                raise HTTPError(400, "Expected a JSON object")
            return value

        def route(self):
            self.connection.settimeout(30)
            self.identity()
            url = urlsplit(self.path)
            path, method = url.path, self.command
            if path.startswith("/api/process"):
                with service.lock:
                    now = time.time()
                    minute = int(now // 60)
                    service.rates = {address: entry for address, entry in service.rates.items() if entry[1] == minute}
                    key = self.client_address[0]
                    used, window = service.rates.get(key, (0, minute))
                    service.rates[key] = ((used if minute == window else 0) + 1, minute)
                    if service.rates[key][0] > service.requests_per_minute:
                        raise HTTPError(429, "Too many requests", max(1, 60 - int(now % 60)))
                if method in ("POST", "PUT", "DELETE") and self.headers.get("X-Hamma-Request") != "1":
                    raise HTTPError(403, "Request authorization required")
            if path == "/api/process/prepare-restart" and method == "POST":
                if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    raise HTTPError(403, "Restart preparation is local only")
                if self.headers.get("X-Hamma-Instance") != service.instance_id:
                    raise HTTPError(409, "Processor instance changed")
                with service.lock:
                    if service.running:
                        raise HTTPError(409, "Finish or cancel active jobs before restarting")
                    # Prevent a queued worker from starting between the health check and exit.
                    # If a launcher fails to stop us, scheduling resumes automatically.
                    service.restart_until = time.monotonic() + 30
                return self.send(200, {"ready": True, "instance": service.instance_id})
            if path == "/api/process/health" and method == "GET":
                with service.lock:
                    running = len(service.running)
                return self.send(200, {"version": 1, "processing": "local", "instance": service.instance_id,
                                       "pid": os.getpid(), "revision": PROCESSOR_REVISION, "activeJobs": running})
            if path == "/api/process/capabilities" and method == "GET":
                return self.send(200, {"archives": ARCHIVES, "conversions": MEDIA if shutil.which("ffmpeg") and shutil.which("ffprobe") else [],
                                       "limits": service.limits, "processing": "local", "version": 1})
            if path == "/api/process/settings":
                if method == "GET":
                    return self.send(200, service.defaults(self.owner))
                if method == "PUT":
                    body = self.json_body()
                    if body.get("historyRetention") not in RETENTION or body.get("fileRetention") not in RETENTION or body["fileRetention"] == "never":
                        raise HTTPError(400, "Invalid retention")
                    record = {**service.defaults(self.owner), "historyRetention": body["historyRetention"], "fileRetention": body["fileRetention"]}
                    service.store.put(self.owner, "settings", record)
                    return self.send(200, record)
            if path in ("/api/process/history", "/api/process/files") and method == "DELETE":
                with service.lock:
                    records = service.store.list(self.owner)
                    for _, record in records:
                        if path.endswith("history"):
                            if record["state"] in TERMINAL:
                                service.store.patch(self.owner, "job", record["id"], hidden=True)
                        else:
                            if record["state"] in (*ACTIVE, "paused"):
                                (service.store.folder(self.owner, record["id"]) / "cancel").touch()
                                service.store.patch(self.owner, "job", record["id"], state="cancelled", error="Cancelled")
                            folder = service.store.folder(self.owner, record["id"])
                            if folder.exists():
                                service.delete_files(self.owner, record)
                    if path.endswith("files"):
                        for _, upload in service.store.list(self.owner, "upload"):
                            folder = service.store.folder(self.owner, upload["id"])
                            if folder.exists():
                                shutil.rmtree(folder)
                            service.store.delete(self.owner, upload["id"])
                return self.send(200, {"deleted": True})
            if path == "/api/process/uploads" and method == "POST":
                body = self.json_body()
                name = safe_path(body.get("name"), bool(body.get("directory")))
                size = body.get("size")
                if type(size) is not int or not 0 <= size <= service.limits["input"] or (body.get("directory") and size != 0):
                    raise HTTPError(413, "File size limit reached")
                with service.lock:
                    uploads = service.store.list(kind="upload")
                    if len([u for owner, u in uploads if owner == self.owner]) >= service.limits["files"]:
                        raise HTTPError(413, "Too many files")
                    if service.reserved() + size > service.limits["storage"]:
                        raise HTTPError(507, "Storage full")
                    record = {"id": secrets.token_hex(16), "created": time.time(), "name": name, "size": size, "directory": bool(body.get("directory")), "expires": time.time() + 86400, "offset": 0}
                    folder = service.store.folder(self.owner, record["id"])
                    folder.mkdir(mode=0o700, parents=True)
                    (folder / "input").touch(mode=0o600)
                    service.store.put(self.owner, "upload", record)
                return self.send(201, record)
            match = re.fullmatch(r"/api/process/uploads/([a-f0-9]{32})", path)
            if match:
                upload_id = match[1]
                with service.lock:
                    record = service.store.get(self.owner, "upload", upload_id)
                    if not record:
                        raise HTTPError(404, "File unavailable")
                    source = service.store.folder(self.owner, upload_id) / "input"
                    if method == "GET":
                        return self.send(200, {**record, "offset": source.stat().st_size})
                    if method == "DELETE":
                        if any(upload_id in [i["id"] for i in j["inputs"]] for _, j in service.store.list(self.owner)):
                            raise HTTPError(409, "File in use")
                        shutil.rmtree(source.parent)
                        service.store.delete(self.owner, upload_id)
                        return self.send(200, {"deleted": True})
                    if method == "PUT":
                        if record.get("sha256"):
                            raise HTTPError(409, "Upload already finalized")
                        offset = int(self.headers.get("Upload-Offset", "-1"))
                        length = int(self.headers.get("Content-Length", "-1"))
                        if offset != source.stat().st_size:
                            raise HTTPError(409, "Upload offset changed")
                        if not 0 <= length <= 8 * BLOCK or offset + length > record["size"]:
                            raise HTTPError(413, "Invalid upload chunk")
                        remaining = length
                        with source.open("ab") as stream:
                            while remaining:
                                chunk = self.rfile.read(min(BLOCK, remaining))
                                if not chunk:
                                    raise HTTPError(400, "Upload interrupted")
                                stream.write(chunk)
                                remaining -= len(chunk)
                            stream.flush()
                            os.fsync(stream.fileno())
                        return self.send(200, {"offset": source.stat().st_size})
            if path == "/api/process/jobs" and method == "POST":
                body = self.json_body()
                ids = body.get("uploads")
                operation, target = body.get("operation"), body.get("target")
                if not isinstance(ids, list) or not ids or len(ids) > service.limits["files"] or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
                    raise HTTPError(400, "Invalid file selection")
                if (operation == "compress" and target not in ARCHIVES or operation == "extract" and target != "zip" or
                    operation == "convert" and target not in MEDIA or operation not in ("compress", "extract", "convert")):
                    raise HTTPError(400, "Unsupported operation")
                if operation != "compress" and len(ids) != 1:
                    raise HTTPError(400, "One input per extraction or conversion job")
                with service.lock:
                    request_id = body.get("requestId")
                    if request_id is not None and (not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{64}", request_id)):
                        raise HTTPError(400, "Invalid request identifier")
                    job_id = hashlib.sha256((self.owner + request_id).encode()).hexdigest()[:32] if request_id else secrets.token_hex(16)
                    existing = service.store.get(self.owner, "job", job_id)
                    if existing:
                        if ([i["id"] for i in existing["inputs"]] != ids or existing["operation"] != operation or existing["target"] != target or existing["recursive"] != bool(body.get("recursive"))):
                            raise HTTPError(409, "Request identifier already used")
                        return self.send(200, service.public(self.owner, existing))
                    jobs = service.store.list(self.owner)
                    if len([j for _, j in jobs if j["state"] in (*ACTIVE, "paused")]) >= 100:
                        raise HTTPError(429, "Queue full")
                    inputs, seen = [], set()
                    for upload_id in ids:
                        record = service.store.get(self.owner, "upload", upload_id)
                        if not record or record["expires"] <= time.time():
                            raise HTTPError(404, "File unavailable")
                        source = service.store.folder(self.owner, upload_id) / "input"
                        if source.stat().st_size != record["size"]:
                            raise HTTPError(409, "Upload incomplete")
                        if record["name"].casefold() in seen:
                            raise HTTPError(400, "Duplicate filename")
                        seen.add(record["name"].casefold())
                        if not record.get("sha256"):
                            ctx = Context(source.parent, service.limits)
                            record.update(file_digest(source, ctx), format=detect(source))
                            service.store.put(self.owner, "upload", record)
                        inputs.append(record)
                    if operation != "compress" and inputs[0].get("directory"):
                        raise HTTPError(400, "Choose a file")
                    now = time.time()
                    settings = service.defaults(self.owner)
                    retention = RETENTION[settings["historyRetention"]]
                    record = {"id": job_id, "created": now, "name": inputs[0]["name"] if len(inputs) == 1 else f"{len(inputs)} files",
                              "operation": operation, "target": target, "inputs": inputs, "recursive": bool(body.get("recursive")),
                              "state": "queued", "inputSize": sum(i["size"] for i in inputs), "outputSize": None,
                              "format": inputs[0]["format"] if len(inputs) == 1 else "batch", "processed": 0, "entries": 0,
                              "fileExpires": now + RETENTION[settings["fileRetention"]], "historyExpires": now + retention if retention else None,
                              "downloadAvailable": False, "error": None}
                    service.store.folder(self.owner, record["id"]).mkdir(mode=0o700, parents=True)
                    service.store.put(self.owner, "job", record)
                    visible = [j for _, j in jobs if not j.get("hidden")]
                    # Bound guest history independently of file retention.
                    excess = max(0, len(visible) + 1 - 500)
                    for old in reversed(visible):
                        if not excess:
                            break
                        if old["state"] in TERMINAL:
                            service.store.patch(self.owner, "job", old["id"], hidden=True)
                            excess -= 1
                LOG.info("Job queued: %s %s", record["id"], operation)
                return self.send(202, service.public(self.owner, record))
            if path == "/api/process/jobs" and method == "GET":
                query = parse_qs(url.query)
                offset = max(0, int(query.get("offset", [0])[0]))
                limit = min(100, max(1, int(query.get("limit", [50])[0])))
                search = query.get("q", [""])[0].casefold()
                state = query.get("state", [""])[0]
                jobs = [j for _, j in service.store.list(self.owner) if not j.get("hidden") and search in j["name"].casefold() and (not state or j["state"] == state)]
                sort = query.get("sort", ["newest"])[0]
                if sort == "oldest":
                    jobs.sort(key=lambda j: j["created"])
                elif sort == "name":
                    jobs.sort(key=lambda j: (j["name"].casefold(), j["created"]))
                elif sort == "size":
                    jobs.sort(key=lambda j: j["inputSize"], reverse=True)
                return self.send(200, {"total": len(jobs), "jobs": [service.public(self.owner, j) for j in jobs[offset:offset + limit]]})
            match = re.fullmatch(r"/api/process/jobs/([a-f0-9]{32})(?:/(cancel|pause|resume|retry|files|download|manifest))?", path)
            if match:
                job_id, action = match.groups()
                record = service.store.get(self.owner, "job", job_id)
                if not record:
                    raise HTTPError(404, "Job unavailable")
                directory = service.store.folder(self.owner, job_id)
                if action == "download" and method in ("GET", "HEAD"):
                    query = parse_qs(url.query)
                    expiry = query.get("expires", [""])[0]
                    token = query.get("token", [""])[0]
                    if not expiry.isdigit() or int(expiry) < time.time() or not hmac.compare_digest(service.sign(f"{self.owner}:{job_id}:{expiry}"), token):
                        raise HTTPError(403, "Download link expired")
                    if not record.get("downloadAvailable") or record["fileExpires"] <= time.time():
                        raise HTTPError(410, "File expired")
                    return self.download(directory / record["outputFile"], record["outputName"], record["sha256"])
                if action == "manifest" and method == "GET":
                    return self.send(200, {"id": job_id, "sha256": record.get("sha256"), "files": record.get("manifest", [])})
                if action is None and method == "GET":
                    return self.send(200, service.public(self.owner, record))
                if method == "DELETE" and action in (None, "files"):
                    if record["state"] not in TERMINAL:
                        raise HTTPError(409, "Cancel the job first")
                    if job_id in service.running:
                        raise HTTPError(409, "Worker stopping")
                    if action == "files":
                        with service.lock:
                            if directory.exists():
                                service.delete_files(self.owner, record)
                    else:
                        service.store.patch(self.owner, "job", job_id, hidden=True)
                    LOG.info("Deleted %s for job %s", action or "history", job_id)
                    return self.send(200, {"deleted": True})
                if method == "POST":
                    with service.lock:
                        record = service.store.get(self.owner, "job", job_id)
                        if action == "cancel" and record["state"] in (*ACTIVE, "paused"):
                            (directory / "cancel").touch()
                            service.store.patch(self.owner, "job", job_id, state="cancelled", error="Cancelled", finished=time.time())
                            service.terminate(job_id)
                            service.running.pop(job_id, None)
                        elif action == "pause" and record["state"] == "queued":
                            service.store.patch(self.owner, "job", job_id, state="paused")
                        elif action == "resume" and record["state"] == "paused":
                            service.store.patch(self.owner, "job", job_id, state="queued")
                        elif action == "retry" and record["state"] in ("failed", "cancelled", "interrupted"):
                            if job_id in service.running:
                                raise HTTPError(409, "Worker stopping")
                            if record["fileExpires"] <= time.time() or any(not (service.store.folder(self.owner, i["id"]) / "input").exists() for i in record["inputs"]):
                                raise HTTPError(410, "Input files expired")
                            (directory / "cancel").unlink(missing_ok=True)
                            service.store.patch(self.owner, "job", job_id, state="queued", error=None, processed=0, entries=0, expanded=0, mediaSeconds=0, duration=None, hidden=False)
                        else:
                            raise HTTPError(409, "Action unavailable for this job")
                    return self.send(200, service.public(self.owner, service.store.get(self.owner, "job", job_id)))
            if method in ("GET", "HEAD") and not path.startswith("/api/") and service.web:
                relative = path.lstrip("/") or "index.html"
                static = (service.web / relative).resolve()
                if not static.is_relative_to(service.web) or not static.is_file():
                    raise HTTPError(404, "Not found")
                import mimetypes
                self.send_response(200)
                self.headers_common()
                self.send_header("Content-Type", mimetypes.guess_type(static.name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(static.stat().st_size))
                self.end_headers()
                if method != "HEAD":
                    with static.open("rb") as stream:
                        shutil.copyfileobj(stream, self.wfile, BLOCK)
                return
            raise HTTPError(404, "Not found")

        def download(self, path, name, checksum):
            if not path.is_file():
                raise HTTPError(410, "File unavailable")
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            range_header = self.headers.get("Range")
            if range_header and self.headers.get("If-Range", f'"{checksum}"') == f'"{checksum}"':
                from processor.ranges import download_range
                try:
                    start, end = download_range(range_header, size)
                except ValueError:
                    raise HTTPError(416, "Invalid download range") from None
                status = 206
            self.send_response(status)
            self.headers_common()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name, safe=""))
            self.send_header("Content-Length", str(max(0, end - start + 1)))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", f'"{checksum}"')
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command == "HEAD":
                return
            with path.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = stream.read(min(BLOCK, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        def handle_request(self):
            try:
                self.route()
            except HTTPError as error:
                self.send(error.status, {"error": error.message}, error.retry_after)
            except (ValueError, TypeError, KeyError, ProcessingError):
                self.send(400, {"error": "Invalid request"})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except OSError:
                LOG.exception("Storage operation failed")
                self.send(507, {"error": "Storage unavailable"})
            except Exception:
                LOG.exception("Request failed")
                self.send(500, {"error": "Request failed"})

        do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = handle_request

    return Handler


def main():
    parser = argparse.ArgumentParser(description="HAMMA local processor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5010)
    parser.add_argument("--data", default=os.environ.get("HAMMA_DATA", ".hamma-data"))
    parser.add_argument("--web", default="web/dist")
    parser.add_argument("--lan", action="store_true", help="Allow explicitly named private-network addresses")
    parser.add_argument("--allow-host", action="append", default=[], help="Private IPv4 address used by phones")
    args = parser.parse_args()
    if not ipaddress.ip_address(args.host).is_loopback and not args.lan:
        parser.error("Use --lan with explicit --allow-host addresses for private-network testing")
    if args.lan and not args.allow_host:
        parser.error("LAN mode requires at least one --allow-host private address")
    for hostname in args.allow_host:
        address = ipaddress.ip_address(hostname)
        if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified or address.is_link_local:
            parser.error("LAN hosts must be private IPv4 addresses")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    service = Service(args.data, args.web, lan_hosts=args.allow_host if args.lan else ())
    server = LocalHTTPServer((args.host, args.port), handler(service))
    thread = threading.Thread(target=service.loop, daemon=True)
    thread.start()
    LOG.info("HAMMA available at http://%s:%s", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        service.close()
        server.server_close()
        thread.join(3)


if __name__ == "__main__":
    main()
