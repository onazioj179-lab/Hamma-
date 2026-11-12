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
from socketserver import TCPServer
import subprocess
import shutil
import sqlite3
import tempfile
import threading
import tarfile
import time
from urllib.parse import parse_qs, urlsplit, quote
import zipfile

from .engine import ARCHIVES, MEDIA, BLOCK, ZIP_PROFILES, Context, ProcessingError, archive_formats, compress, convert, detect, encode_zip_comment, extract, file_digest, safe_path, verify_archive
from .worker_limits import apply_windows_worker_limits, apply_worker_limits
from .resources import available_memory, worker_capacity
from .errors import describe_failure
from .projects import Projects, ProjectError
from .accounts import Accounts, AccountError, plan as account_plan
from .catalog import FileCatalog
from .capabilities import action_registry, inspect_headers, media_targets, single_file_archives
from .media_policy import H264_TARGET
from .oauth import OAuth

LOG = logging.getLogger("hamma.processor")
TERMINAL = ("completed", "failed", "cancelled", "interrupted")

ACTIVE = ("queued", "processing", "verifying")
PROCESSOR_REVISION = ":".join(hashlib.sha256(path.read_bytes()).hexdigest() for path in
                              sorted(Path(__file__).parent.glob("*.py"), key=lambda path: path.name))
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
            db.execute("CREATE INDEX IF NOT EXISTS records_kind_created ON records(kind,created,id,owner)")
            db.execute("CREATE INDEX IF NOT EXISTS records_visible ON records(owner,kind,coalesce(json_extract(data,'$.hidden'),0),created DESC)")
            db.execute("CREATE INDEX IF NOT EXISTS records_state ON records(kind,json_extract(data,'$.state'),created,id,owner)")
            db.execute("CREATE INDEX IF NOT EXISTS records_owner_state ON records(owner,kind,json_extract(data,'$.state'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_upload_bytes ON records(kind,json_extract(data,'$.size'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_output_bytes ON records(kind,json_extract(data,'$.downloadAvailable'),json_extract(data,'$.outputSize'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_index_bytes ON records(kind,json_extract(data,'$.indexBytes'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_expiry ON records(kind,json_extract(data,'$.expires'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_file_expiry ON records(kind,json_extract(data,'$.fileExpires'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_history_expiry ON records(kind,json_extract(data,'$.historyExpires'))")
            db.execute("CREATE INDEX IF NOT EXISTS records_owner_download_expiry ON records(owner,kind,json_extract(data,'$.downloadAvailable'),json_extract(data,'$.fileExpires'),created DESC)")
            db.execute("CREATE TABLE IF NOT EXISTS job_inputs (owner TEXT NOT NULL, job_id TEXT NOT NULL, upload_id TEXT NOT NULL, PRIMARY KEY(owner,job_id,upload_id))")
            db.execute("CREATE TABLE IF NOT EXISTS local_index_sources(owner TEXT NOT NULL,job_id TEXT NOT NULL,root TEXT NOT NULL,PRIMARY KEY(owner,job_id))")
            db.execute("CREATE INDEX IF NOT EXISTS job_inputs_upload ON job_inputs(owner,upload_id,job_id)")
            db.execute("CREATE TABLE IF NOT EXISTS store_migrations (name TEXT PRIMARY KEY)")
            if not db.execute("SELECT 1 FROM store_migrations WHERE name='job-inputs-v1'").fetchone():
                db.execute("INSERT OR IGNORE INTO job_inputs SELECT records.owner,records.id,json_extract(member.value,'$.id') FROM records,json_each(records.data,'$.inputs') AS member WHERE records.kind='job' AND json_type(member.value,'$.id')='text'")
                db.execute("INSERT INTO store_migrations VALUES ('job-inputs-v1')")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        db.create_function("hamma_casefold", 1, lambda value: value.casefold() if isinstance(value, str) else "", deterministic=True)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, owner, kind, record, *, project_input=None):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)", (record["id"], owner, kind, record["created"], json.dumps(record)))
            if kind == "job":
                self._sync_inputs(db, owner, record)
            if project_input is not None:
                project_id, source_id = project_input
                db.execute("INSERT OR REPLACE INTO project_inputs VALUES (?,?,?,?,?)",
                           (owner, project_id, source_id, record["id"], record["created"]))

    @staticmethod
    def _sync_inputs(db, owner, record):
        db.execute("DELETE FROM job_inputs WHERE owner=? AND job_id=?", (owner, record["id"]))
        db.executemany("INSERT OR IGNORE INTO job_inputs VALUES (?,?,?)", [(owner, record["id"], item["id"]) for item in record.get("inputs", []) if isinstance(item, dict) and isinstance(item.get("id"), str)])

    def get(self, owner, kind, record_id):
        with self.connect() as db:
            row = db.execute("SELECT data FROM records WHERE id=? AND owner=? AND kind=?", (record_id, owner, kind)).fetchone()
        return json.loads(row[0]) if row else None

    def patch(self, owner, kind, record_id, *, expected_states=None, **updates):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT data FROM records WHERE id=? AND owner=? AND kind=?", (record_id, owner, kind)).fetchone()
            if not row:
                return None
            previous = json.loads(row[0])
            # Check and update under the same SQLite write transaction: a worker's
            # stale progress/completion must never undo a cancellation or pause.
            if expected_states is not None and previous.get("state") not in expected_states:
                return previous
            if updates.get("state") == "completed" and previous.get("state") == "cancelled":
                return previous
            record = {**previous, **updates}
            db.execute("UPDATE records SET data=? WHERE id=? AND owner=? AND kind=?", (json.dumps(record), record_id, owner, kind))
            if kind == "job" and "inputs" in updates:
                self._sync_inputs(db, owner, record)
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
            db.execute("DELETE FROM job_inputs WHERE owner=? AND job_id=?", (owner, record_id))
            db.execute("DELETE FROM local_index_sources WHERE owner=? AND job_id=?", (owner, record_id))

    def local_source(self, owner, job_id):
        with self.connect() as db:
            row = db.execute('SELECT root FROM local_index_sources WHERE owner=? AND job_id=?', (owner, job_id)).fetchone()
        return Path(row[0]) if row else None

    def forget_local_source(self, owner, job_id):
        with self.connect() as db:
            db.execute('DELETE FROM local_index_sources WHERE owner=? AND job_id=?', (owner, job_id))

    def count(self, owner=None, kind="job", states=None, visible=False):
        where, parameters = ["kind=?"], [kind]
        if owner is not None:
            where.append("owner=?"); parameters.append(owner)
        if states is not None:
            if not states:
                return 0
            where.append("json_extract(data,'$.state') IN (" + ",".join("?" for _ in states) + ")")
            parameters.extend(states)
        if visible:
            where.append("coalesce(json_extract(data,'$.hidden'),0)=0")
        with self.connect() as db:
            return db.execute("SELECT count(*) FROM records WHERE " + " AND ".join(where), parameters).fetchone()[0]

    def history_page(self, owner, *, offset=0, limit=50, search="", state="", sort="newest", summary=False, include_hidden_downloads=False):
        where, parameters = ["owner=?", "kind='job'"], [owner]
        if include_hidden_downloads:
            where.append("(coalesce(json_extract(data,'$.hidden'),0)=0 OR (json_extract(data,'$.downloadAvailable')=1 AND json_extract(data,'$.fileExpires')>?))")
            parameters.append(time.time())
        else:
            where.append("coalesce(json_extract(data,'$.hidden'),0)=0")
        if search:
            where.append("instr(hamma_casefold(json_extract(data,'$.name')),?)>0")
            parameters.append(search.casefold())
        if state:
            where.append("json_extract(data,'$.state')=?"); parameters.append(state)
        ordering = {"oldest": "created ASC,id ASC", "name": "hamma_casefold(json_extract(data,'$.name')) ASC,created ASC,id ASC",
                    "size": "json_extract(data,'$.inputSize') DESC,created DESC,id ASC"}.get(sort, "created DESC,id ASC")
        condition = " AND ".join(where)
        with self.connect() as db:
            db.execute("BEGIN")
            total = db.execute("SELECT count(*) FROM records WHERE " + condition, parameters).fetchone()[0]
            projection = "json_remove(data,'$.inputs','$.manifest','$.outputFile','$.filesCleaned','$.errorInfo.fileIds') AS data,coalesce(json_extract(data,'$.fileCount'),json_array_length(data,'$.inputs')) AS file_count" if summary else "data"
            rows = db.execute("SELECT " + projection + " FROM records WHERE " + condition + " ORDER BY " + ordering + " LIMIT ? OFFSET ?",
                              [*parameters, min(100, max(1, limit)), min(2**63 - 1, max(0, offset))]).fetchall()
        records = [json.loads(row["data"]) for row in rows]
        if summary:
            for record, row in zip(records, rows):
                record["fileCount"] = row["file_count"] or 0
        return total, records

    def history_overview(self, owner):
        condition = "owner=? AND kind='job' AND coalesce(json_extract(data,'$.hidden'),0)=0"
        with self.connect() as db:
            db.execute("BEGIN")
            metrics = db.execute(f"""
                WITH jobs AS (
                    SELECT json_extract(data,'$.state') AS state,
                           json_extract(data,'$.operation') AS operation,
                           json_extract(data,'$.inputSize') AS input_size,
                           json_extract(data,'$.outputSize') AS output_size
                    FROM records WHERE {condition}
                )
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE state='completed') AS completed,
                       count(*) FILTER (WHERE state IN ('queued','processing','verifying','paused')) AS active,
                       count(*) FILTER (WHERE state IN ('failed','interrupted')) AS failed,
                       count(*) FILTER (WHERE state='completed' AND operation='compress') AS compressed,
                       count(*) FILTER (WHERE state='completed' AND operation='extract') AS extracted,
                       count(*) FILTER (WHERE state='completed' AND operation='convert') AS converted,
                       count(output_size) FILTER (WHERE state='completed' AND operation='compress') AS measured,
                       total(input_size) FILTER (WHERE state='completed' AND operation='compress' AND output_size IS NOT NULL) AS input,
                       total(output_size) FILTER (WHERE state='completed' AND operation='compress') AS output
                FROM jobs
            """, (owner,)).fetchone()
            rows = db.execute(f"""
                SELECT json_remove(data,'$.inputs','$.manifest','$.outputFile','$.filesCleaned','$.errorInfo.fileIds') AS data,
                       coalesce(json_extract(data,'$.fileCount'),json_array_length(data,'$.inputs'),0) AS file_count
                FROM records WHERE {condition} ORDER BY created DESC,id ASC LIMIT 5
            """, (owner,)).fetchall()
        return dict(metrics), [{**json.loads(row['data']), 'fileCount': row['file_count']} for row in rows]

    def trim_history(self, owner, limit=500):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            visible = db.execute("SELECT count(*) FROM records WHERE owner=? AND kind='job' AND coalesce(json_extract(data,'$.hidden'),0)=0", (owner,)).fetchone()[0]
            excess = max(0, visible - limit)
            if not excess:
                return 0
            changed = db.execute("UPDATE records SET data=json_set(data,'$.hidden',json('true')) WHERE owner=? AND kind='job' AND id IN (SELECT id FROM records WHERE owner=? AND kind='job' AND coalesce(json_extract(data,'$.hidden'),0)=0 AND json_extract(data,'$.state') IN ('completed','failed','cancelled','interrupted') ORDER BY created,id LIMIT ?)", (owner, owner, excess)).rowcount
        return changed

    def iter_records(self, owner=None, kind="job", batch=25, states=None):
        previous = None
        while True:
            where, parameters = ["kind=?"], [kind]
            if owner is not None:
                where.append("owner=?"); parameters.append(owner)
            if states is not None:
                if not states:
                    return
                where.append("json_extract(data,'$.state') IN (" + ",".join("?" for _ in states) + ")")
                parameters.extend(states)
            if previous is not None:
                where.append("(created,id,owner)>(?,?,?)"); parameters.extend(previous)
            with self.connect() as db:
                rows = db.execute("SELECT owner,id,created,data FROM records WHERE " + " AND ".join(where) + " ORDER BY created,id,owner LIMIT ?", [*parameters, batch]).fetchall()
            if not rows:
                return
            previous = (rows[-1]["created"], rows[-1]["id"], rows[-1]["owner"])
            for row in rows:
                yield row["owner"], json.loads(row["data"])

    def queued(self, limit=1, excluded_owners=(), fair=False):
        where, parameters = ["kind='job'", "json_extract(data,'$.state')='queued'"], []
        if excluded_owners:
            where.append("owner NOT IN (" + ",".join("?" for _ in excluded_owners) + ")")
            parameters.extend(excluded_owners)
        with self.connect() as db:
            ordering = "created,id,owner"
            if fair:
                ordering = "coalesce((SELECT max(json_extract(previous.data,'$.scheduled')) FROM records AS previous WHERE previous.owner=records.owner AND previous.kind='job' AND coalesce(json_extract(previous.data,'$.projectId'),'default')=coalesce(json_extract(records.data,'$.projectId'),'default')),0),created,id,owner"
            rows = db.execute("SELECT owner,data FROM records WHERE " + " AND ".join(where) + " ORDER BY " + ordering + " LIMIT ?", [*parameters, max(1, min(100, limit))]).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def reserved_bytes(self, owner=None):
        with self.connect() as db:
            scope, parameters = (" AND owner=?", (owner,)) if owner is not None else ("", ())
            uploads = db.execute("SELECT coalesce(sum(json_extract(data,'$.size')),0) FROM records WHERE kind='upload'" + scope, parameters).fetchone()[0]
            outputs = db.execute("SELECT coalesce(sum(coalesce(json_extract(data,'$.outputSize'),0)),0) FROM records WHERE kind='job' AND json_extract(data,'$.downloadAvailable')=1" + scope, parameters).fetchone()[0]
            indexes = db.execute("SELECT coalesce(sum(json_extract(data,'$.indexBytes')),0) FROM records WHERE kind='job'" + scope, parameters).fetchone()[0]
        return uploads + outputs + indexes

    def upload_referenced(self, owner, upload_id, *, now=None, exclude_job=None):
        where, parameters = ["i.owner=?", "i.upload_id=?", "j.kind='job'"], [owner, upload_id]
        if now is not None:
            where.append("(json_extract(j.data,'$.state') IN ('queued','processing','verifying','paused') OR json_extract(j.data,'$.fileExpires')>?)")
            parameters.append(now)
        if exclude_job is not None:
            where.append("j.id<>?"); parameters.append(exclude_job)
        with self.connect() as db:
            return db.execute("SELECT 1 FROM job_inputs AS i JOIN records AS j ON j.owner=i.owner AND j.id=i.job_id WHERE " + " AND ".join(where) + " LIMIT 1", parameters).fetchone() is not None

    def deletion_snapshot(self, owner):
        history, files = hashlib.sha256(), hashlib.sha256()
        counts = {"historyRecords": 0, "inputFiles": 0, "outputFiles": 0, "activeJobs": 0}
        with self.connect() as db:
            db.execute("BEGIN")
            for row in db.execute("SELECT id,json_extract(data,'$.state') AS state,coalesce(json_extract(data,'$.hidden'),0) AS hidden,json_extract(data,'$.downloadAvailable') AS available,json_extract(data,'$.outputFile') AS output,json_extract(data,'$.fileExpires') AS expires,coalesce(json_extract(data,'$.filesCleaned'),0) AS cleaned FROM records WHERE owner=? AND kind='job' ORDER BY id", (owner,)):
                active = row["state"] in (*ACTIVE, "paused")
                counts["activeJobs"] += active
                counts["outputFiles"] += bool(row["available"] and row["output"])
                if not row["hidden"] and row["state"] in TERMINAL:
                    counts["historyRecords"] += 1
                    history.update((row["id"] + "\n").encode())
                files.update(json.dumps([row["id"], active, row["available"], row["output"], row["expires"], row["cleaned"]], separators=(",", ":")).encode())
            for row in db.execute("SELECT id,created,json_extract(data,'$.size') AS size FROM records WHERE owner=? AND kind='upload' ORDER BY id", (owner,)):
                counts["inputFiles"] += 1
                files.update(json.dumps([row["id"], row["created"], row["size"]], separators=(",", ":")).encode())
        return counts, history.hexdigest(), files.hexdigest()

    def expired_jobs(self, now, limit=100):
        with self.connect() as db:
            rows = db.execute("SELECT owner,data FROM records WHERE kind='job' AND json_extract(data,'$.state') IN ('completed','failed','cancelled','interrupted') AND ((json_extract(data,'$.fileExpires')<=? AND coalesce(json_extract(data,'$.filesCleaned'),0)=0) OR (json_extract(data,'$.historyExpires')<=? AND coalesce(json_extract(data,'$.hidden'),0)=0) OR (coalesce(json_extract(data,'$.hidden'),0)=1 AND json_extract(data,'$.fileExpires')<=?)) ORDER BY created,id,owner LIMIT ?", (now, now, now, limit)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def expired_uploads(self, now, limit=100):
        with self.connect() as db:
            rows = db.execute("SELECT u.owner,u.data FROM records AS u WHERE u.kind='upload' AND json_extract(u.data,'$.expires')<=? AND NOT EXISTS (SELECT 1 FROM job_inputs AS i JOIN records AS j ON j.owner=i.owner AND j.id=i.job_id AND j.kind='job' WHERE i.owner=u.owner AND i.upload_id=u.id AND (json_extract(j.data,'$.state') IN ('queued','processing','verifying','paused') OR json_extract(j.data,'$.fileExpires')>?)) ORDER BY u.created,u.id,u.owner LIMIT ?", (now, now, limit)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def folder(self, owner, record_id):
        # Both components are generated identifiers, never user-supplied paths.
        if not re.fullmatch(r"[a-f0-9]{64}", owner) or not re.fullmatch(r"[a-f0-9]{32}", record_id):
            raise ProcessingError("Invalid identifier")
        return self.root / owner / record_id


def run_job(root, owner, job_id, limits, isolated=False):
    if isolated and os.name != "nt":
        os.setsid()
        apply_worker_limits(limits)
    store = Store(root)
    job = store.get(owner, "job", job_id)
    directory = store.folder(owner, job_id)
    started = time.time()
    last_report = [0.0]

    def report(**updates):
        now = time.monotonic()
        if "state" in updates or 'phase' in updates or now - last_report[0] >= .2:
            store.patch(owner, "job", job_id, expected_states=ACTIVE, **updates)
            last_report[0] = now

    ctx = Context(directory, limits, report)
    output_extension = "mp4" if job["target"] == H264_TARGET else job["target"]
    output = directory / ("output." + output_extension)
    try:
        current = store.patch(owner, "job", job_id, expected_states=ACTIVE,
                              state="processing", started=started, error=None)
        if not current or current.get("state") not in ACTIVE:
            return
        if isolated and os.name == "nt":
            apply_windows_worker_limits()
        manifest = []
        for upload in job["inputs"]:
            upload["path"] = str(store.folder(owner, upload["id"]) / "input")
            if upload.get("directory"):
                continue
            ctx.check()
            original = file_digest(Path(upload["path"]), ctx)
            if original["size"] != upload["size"] or original["sha256"] != upload["sha256"]:
                raise ProcessingError("Input integrity check failed")
        indexed = None
        if job.get('inputMode') == 'directory-index':
            from .indexing import DirectoryIndex
            from .indexed_archive import compress_index
            source = store.local_source(owner, job_id)
            if source is None:
                raise ProcessingError('Local source authorization expired')
            index = DirectoryIndex(directory / 'discovery.sqlite3', source, max_entries=limits['files'])

            def account_index():
                ctx.check()
                size = sum(path.stat().st_size for path in directory.glob('discovery.sqlite3*') if path.is_file())
                previous = store.get(owner, 'job', job_id) or {}
                reserved = store.reserved_bytes() - previous.get('indexBytes', 0) + size
                store.patch(owner, 'job', job_id, indexBytes=size)
                if reserved + limits['expanded'] > limits['storage'] or shutil.disk_usage(directory).free < 64 * 1024**2:
                    raise ProcessingError('Storage full')

            index.checkpoint = account_index
            account_index()
            report(phase='indexing')
            index.discover(cancelled=lambda: (directory / 'cancel').exists())
            ctx.check()
            with index.connect() as db:
                input_size = db.execute("SELECT coalesce(sum(size),0) FROM entries WHERE kind='file'").fetchone()[0]
            report(inputSize=input_size, fileCount=index.summary()['entries'], phase='processing')
            if input_size > limits['input']:
                raise ProcessingError('Input size limit reached')
            indexed = compress_index(index, output, job['target'], ctx)
            account_index()  # settle WAL accounting after the manifest writer closes
            job['inputSize'] = indexed['inputBytes']
        elif job["operation"] == "compress":
            manifest = compress(job["inputs"], output, job["target"], ctx,
                                zip_profile=job.get("zipProfile", "balanced"), zip_comment=job.get("zipComment", ""))
        elif job["operation"] == "extract":
            item = job["inputs"][0]
            manifest = extract(Path(item["path"]), item["name"], output, ctx, job["recursive"],
                               job.get("zipIndexes"), repack=job["target"] == "zip-deflate")
        elif job["operation"] == "verify":
            item = job["inputs"][0]
            manifest = verify_archive(Path(item["path"]), item["name"], output, ctx)
        elif job["operation"] == "inspect":
            from .documents import inspect_office
            manifest = inspect_office(Path(job["inputs"][0]["path"]), output, ctx)
        else:
            manifest = convert(Path(job["inputs"][0]["path"]), output, job["target"], ctx,
                               job.get('qualityMode', 'lossless'), job.get('metadataPolicy', 'strip'))
        ctx.check()
        store.patch(owner, "job", job_id, expected_states=ACTIVE, state="verifying")
        digest = file_digest(output, ctx)
        if digest["size"] > limits["expanded"]:
            raise ProcessingError("Output size limit reached")
        # The API exposes only names and opaque identifiers, never storage paths.
        extension = "zip" if detect(output) == "zip" else output_extension
        leaf = Path(job["name"]).name
        # A raw Zstandard frame has no filename field. Preserve the complete
        # source basename in its download name so restoration retains its type.
        stem = leaf if job["operation"] == "compress" and job["target"] == "zstd" else leaf.rsplit(".", 1)[0] or "files"
        if job["operation"] == "verify":
            stem += ".verification"
        elif job["operation"] == "inspect":
            stem += ".inspection"
        if job["operation"] == "extract":
            stem = stem + ".repacked" if job["target"] == "zip-deflate" else "extracted"
        output_name = stem + "." + extension
        ctx.check()
        store.patch(owner, "job", job_id, expected_states=ACTIVE, state="completed", processed=job["inputSize"],
                    error=None,
                    outputSize=digest["size"], sha256=digest["sha256"], manifest=manifest,
                    outputFile=output.name, outputName=output_name, finished=time.time(),
                    duration=time.time() - started, downloadAvailable=True,
                    **({'manifestStorage': 'index', 'fileCount': indexed['entries'], 'entries': indexed['entries'], 'inputSize': indexed['inputBytes'], 'phase': 'completed'} if indexed else {}))
    except Exception as error:
        message, category, retry = describe_failure(error)
        LOG.warning("Job failed: %s (%s)", job_id, category)
        state = "cancelled" if (directory / "cancel").exists() else "failed"
        latest = store.get(owner, 'job', job_id) or job
        failure = {'category': category, 'retryEligible': retry, 'stage': latest['state'],
                   'jobId': job_id, 'fileIds': [item['id'] for item in job['inputs']]}
        store.patch(owner, "job", job_id, expected_states=ACTIVE, state=state, error=message, errorInfo=failure, finished=time.time(), duration=time.time() - started, downloadAvailable=False)
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
        from .resources import configured_limits
        self.limits = limits or configured_limits()
        self.lock = threading.RLock()
        self.projects = Projects(self.store, self.limits)
        self.running = {}
        self.restart_until = 0
        self.stop = threading.Event()
        self.accounts = Accounts(self.store)
        self.oauth = OAuth(self.store)
        self.catalog = FileCatalog(self.store)
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
        self.max_uploads = int(os.environ.get("HAMMA_MAX_UPLOADS", "10000"))
        self.max_queued_jobs = int(os.environ.get("HAMMA_MAX_QUEUED_JOBS", "1000"))
        if not 1 <= self.max_uploads <= 1000000 or not 1 <= self.max_queued_jobs <= 100000:
            raise ValueError("Invalid global upload or queue object limit")
        # A crash must never leave an old success or a fictitious running job.
        for owner, record in self.store.iter_records(states=("processing", "verifying", "failed", "cancelled", "interrupted")):
            if record["state"] in ("processing", "verifying"):
                self.store.patch(owner, "job", record["id"], state="interrupted", error="Processing interrupted", finished=time.time(), downloadAvailable=False)
                self.clean_work(owner, record["id"])
            elif record["state"] in ("failed", "cancelled", "interrupted"):
                # A crash can occur after the terminal state was saved but before cleanup.
                self.clean_work(owner, record["id"])

    def sign(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()

    def defaults(self, owner):
        pref = self.store.get(owner, "settings", "settings")
        return pref or {"id": "settings", "created": time.time(), "historyRetention": "30d", "fileRetention": "24h"}

    def owner_plan(self, owner):
        account = self.accounts.by_owner(owner)
        return account_plan(account['tier'] if account else 'guest', self.limits)

    def reserved(self):
        return self.store.reserved_bytes() + len(self.running) * self.limits["expanded"]

    def deletion_preview(self, owner):
        counts, history, files = self.store.deletion_snapshot(owner)
        return {**counts, "historyToken": self.sign(f"delete:{owner}:history:{history}"),
                "filesToken": self.sign(f"delete:{owner}:files:{files}")}

    def public(self, owner, record):
        result = {k: v for k, v in record.items() if k not in ("inputs", "outputFile", "manifest", "filesCleaned")}
        result["downloadAvailable"] = bool(record.get("downloadAvailable") and record["fileExpires"] > time.time())
        if result["downloadAvailable"]:
            expiry = min(int(time.time()) + 3600, int(record["fileExpires"]))
            token = self.sign(f"{owner}:{record['id']}:{expiry}")
            result["download"] = f"/api/process/jobs/{record['id']}/download?expires={expiry}&token={token}"
        result["fileCount"] = record.get('fileCount', 0) if record.get('inputMode') == 'directory-index' else len(record["inputs"]) if "inputs" in record else record.get("fileCount", 0)
        return result

    def enqueue_directory(self, owner, root, target='tar.gz', project_id='default'):
        """Trusted operator entry point only. Never call with an HTTP path field."""
        from .indexed_archive import TARGETS
        if target not in TARGETS or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', project_id):
            raise ValueError('Invalid indexed archive settings')
        source = Path(root).resolve(strict=True)
        if not source.is_dir() or source == self.store.root or source in self.store.root.parents or self.store.root in source.parents:
            raise ValueError('Choose a source directory outside processor storage')
        job_id = secrets.token_hex(16)
        folder = self.store.folder(owner, job_id)  # validate owner before storing any source
        with self.lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if self.store.count(owner, states=(*ACTIVE, 'paused')) >= self.owner_plan(owner)['maxQueuedJobs'] or self.store.count(states=(*ACTIVE, 'paused')) >= self.max_queued_jobs:
                raise ValueError('Processor queue full')
            now = time.time()
            settings = self.defaults(owner)
            retention = RETENTION[settings['historyRetention']]
            record = {'id': job_id, 'projectId': project_id, 'created': now, 'name': source.name or 'files',
                      'operation': 'compress', 'target': target, 'inputMode': 'directory-index', 'inputs': [],
                      'recursive': False, 'state': 'queued', 'phase': 'queued', 'inputSize': 0, 'outputSize': None,
                      'format': 'directory', 'fileCount': 0, 'processed': 0, 'entries': 0,
                      'fileExpires': now + RETENTION[settings['fileRetention']],
                      'historyExpires': now + retention if retention else None, 'downloadAvailable': False, 'error': None}
            folder.mkdir(mode=0o700, parents=True)
            db.execute('INSERT INTO local_index_sources VALUES (?,?,?)', (owner, job_id, str(source)))
            db.execute('INSERT INTO records VALUES (?,?,?,?,?)', (job_id, owner, 'job', now, json.dumps(record)))
        self.store.trim_history(owner, self.owner_plan(owner)['historyRecords'])
        return self.public(owner, record)

    def cleanup(self):
        self.oauth.cleanup()
        self.projects.cleanup()
        now = time.time()
        jobs = self.store.expired_jobs(now)
        for owner, candidate in jobs:
            with self.lock:
                job = self.store.get(owner, "job", candidate["id"])
                if not job:
                    continue
                if job["state"] in ACTIVE or job["state"] == "paused":
                    continue
                if job["id"] in self.running:
                    continue
                if job["fileExpires"] <= now:
                    directory = self.store.folder(owner, job["id"])
                    if directory.exists():
                        shutil.rmtree(directory)
                    self.store.patch(owner, "job", job["id"], downloadAvailable=False, outputFile=None, filesCleaned=True, indexBytes=0)
                    self.store.forget_local_source(owner, job['id'])
                if job.get("historyExpires") is not None and job["historyExpires"] <= now:
                    # History expires independently; file cleanup remains tracked by a tombstone.
                    self.store.patch(owner, "job", job["id"], hidden=True)
                    if job["fileExpires"] <= now:
                        directory = self.store.folder(owner, job["id"])
                        if directory.exists():
                            shutil.rmtree(directory)
                        self.store.delete(owner, job["id"])
                elif job.get("hidden") and job["fileExpires"] <= now:
                    self.store.delete(owner, job["id"])
        uploads = self.store.expired_uploads(now)
        for owner, upload in uploads:
            with self.lock:
                if not self.store.upload_referenced(owner, upload["id"], now=now):
                    directory = self.store.folder(owner, upload["id"])
                    if directory.exists():
                        shutil.rmtree(directory)
                    self.store.delete(owner, upload["id"])
        return len(jobs) >= 100 or len(uploads) >= 100

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
            if path.name in ("cancel", "media.log", "discovery.sqlite3", "discovery.sqlite3-wal", "discovery.sqlite3-shm"):
                continue
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)

    def delete_files(self, owner, record):
        self.terminate(record["id"])
        self.running.pop(record["id"], None)
        directory = self.store.folder(owner, record["id"])
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=False)
        self.store.patch(owner, "job", record["id"], downloadAvailable=False, outputFile=None, filesCleaned=True, fileExpires=time.time(), indexBytes=0)
        self.store.forget_local_source(owner, record['id'])
        for upload in record["inputs"]:
            if not self.store.upload_referenced(owner, upload["id"], now=time.time(), exclude_job=record["id"]):
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
                        self.store.patch(owner, "job", job_id, state="interrupted", error="Worker interrupted", finished=time.time(), downloadAvailable=False)
                    if record and record["state"] != "completed":
                        self.clean_work(owner, job_id)
                    del self.running[job_id]
            if time.monotonic() < self.restart_until:
                return
            attempts = 0
            capacity = worker_capacity(available_memory())
            while len(self.running) < capacity and attempts < 16:
                attempts += 1
                owners = {entry[1] for entry in self.running.values()}
                blocked = {owner for owner in owners if sum(entry[1] == owner for entry in self.running.values()) >= self.owner_plan(owner)['maxConcurrentJobs']}
                candidates = self.store.queued(excluded_owners=owners, fair=True)
                if not candidates and owners:
                    candidates = self.store.queued(excluded_owners=blocked, fair=True)
                if not candidates:
                    break
                owner, job = candidates[0]
                disk_required = self.limits['expanded'] * (len(self.running) + 1) + 64 * 1024**2
                if self.reserved() + self.limits["expanded"] > self.limits["storage"] or shutil.disk_usage(self.store.root).free < disk_required:
                    self.store.patch(owner, "job", job["id"], state="failed", error="Storage full", finished=time.time(),
                                     errorInfo={'category': 'insufficient_storage', 'retryEligible': True, 'stage': 'queued',
                                                'jobId': job['id'], 'fileIds': [item['id'] for item in job['inputs']]}, downloadAvailable=False)
                    continue
                self.store.patch(owner, "job", job["id"], state="processing", scheduled=time.time())
                try:
                    process = multiprocessing.get_context("spawn").Process(target=run_job, args=(str(self.store.root), owner, job["id"], self.limits, True))
                    process.start()
                except Exception:
                    LOG.exception("Worker could not start: %s", job["id"])
                    self.store.patch(owner, "job", job["id"], state="interrupted", error="Worker could not start; retry the job", finished=time.time(), downloadAvailable=False)
                    self.clean_work(owner, job["id"])
                    continue
                self.running[job["id"]] = (process, owner, time.monotonic())

    def loop(self):
        last_cleanup = 0
        while not self.stop.wait(.25):
            try:
                self.tick()
                if time.monotonic() - last_cleanup > 30:
                    last_cleanup = 0 if self.cleanup() else time.monotonic()
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
    tls_context = None
    transport_secure = False

    def __init__(self, *args, **kwargs):
        self.request_slots = threading.BoundedSemaphore(64)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        # Bound slow uploads and stalled TLS handshakes before creating threads.
        # A TLS overload cannot safely receive a plaintext HTTP error response.
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        if self.tls_context is not None:
            try:
                connection = self.tls_context.wrap_socket(connection, server_side=True, do_handshake_on_connect=False)
            except Exception:
                connection.close()
                raise
        return connection, address

    def server_bind(self):
        # Windows SO_REUSEADDR otherwise permits two listeners on one port.
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        # The listener already has a numeric bind address. HTTPServer's
        # reverse DNS lookup can block startup even for loopback.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


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
            self.send_header('Content-Security-Policy', service.oauth.content_security_policy(self.headers.get('Host', ''), getattr(self.server, 'transport_secure', False)))
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
            if getattr(self, "new_cookie", None):
                self.send_header("Set-Cookie", self.new_cookie)
            if getattr(self, "account_cookie", None):
                self.send_header("Set-Cookie", self.account_cookie)
            if getattr(self, 'oauth_cookie', None):
                self.send_header('Set-Cookie', self.oauth_cookie)

        def identity(self):
            self.new_cookie = None
            self.account_cookie = None
            self.oauth_cookie = None
            self.account = None
            self.account_token = None
            peer = ipaddress.ip_address(self.client_address[0])
            self.credentials_allowed = peer.is_loopback or getattr(self.server, 'transport_secure', False)
            if service.lan_hosts and not (peer.is_private or peer.is_loopback):
                raise HTTPError(403, "Private network only")
            host = self.headers.get("Host", "")
            parsed = urlsplit("http://" + host)
            if parsed.hostname not in ("localhost", "127.0.0.1", "::1", *service.lan_hosts, *(tuple([service.oauth.hostname]) if getattr(self.server, "transport_secure", False) and service.oauth.hostname else ())):
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
            if len(parts) != 2 or not re.fullmatch(r"[a-f0-9]{64}", parts[0]) or not re.fullmatch(r"[a-f0-9]{64}", parts[1]) or not hmac.compare_digest(service.sign(parts[0]), parts[1]):
                session = secrets.token_hex(32)
                secure = '; Secure' if getattr(self.server, 'transport_secure', False) else ''
                self.new_cookie = f"{cookie_name}={session}.{service.sign(session)}; HttpOnly; SameSite=Strict; Path=/{secure}"
            else:
                session = parts[0]
            self.owner = hashlib.sha256(session.encode()).hexdigest()
            self.guest_owner = self.owner
            account_cookie = jar.get(f'shante_account_{self.server.server_port}')
            parts = account_cookie.value.split('.') if account_cookie else []
            if account_cookie and not self.credentials_allowed:
                raise HTTPError(403, 'Use HTTPS for account access on a network connection.')
            if len(parts) == 2 and re.fullmatch(r'[a-f0-9]{64}', parts[0]) and re.fullmatch(r'[a-f0-9]{64}', parts[1]) and hmac.compare_digest(service.sign('account:' + parts[0]), parts[1]):
                self.account = service.accounts.resolve(parts[0])
                if self.account:
                    self.account_token = parts[0]
                    self.owner = self.account['owner']
            if account_cookie and not self.account:
                self.set_account_cookie(None)
            self.plan = account_plan(self.account['tier'] if self.account else 'guest', service.limits)

        def set_account_cookie(self, token):
            secure = '; Secure' if getattr(self.server, 'transport_secure', False) else ''
            value = token + '.' + service.sign('account:' + token) if token else ''
            self.account_cookie = f'shante_account_{self.server.server_port}={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={86400 if token else 0}{secure}'

        def account_view(self):
            return {'authenticated': self.account is not None,
                    'account': service.accounts.public(self.account) if self.account else None,
                    'plan': self.plan, 'billingEnabled': False, 'credentialsAllowed': self.credentials_allowed,
                    'providers': service.oauth.public(self.headers.get('Host', ''), getattr(self.server, 'transport_secure', False))}

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

        def create_upload(self, name, size, directory, project_input):
            if service.store.count(self.owner, "upload") >= self.plan['maxUploadFiles']:
                raise HTTPError(413, "Retained file limit reached. Delete unused files before adding more.")
            if service.store.count(kind="upload") >= service.max_uploads:
                raise HTTPError(429, "Upload capacity reached. Delete unused uploads or wait for expiry.")
            if service.reserved() + size > service.limits["storage"]:
                raise HTTPError(507, "Storage full")
            if service.store.reserved_bytes(self.owner) + size > self.plan['maxStorageBytes']:
                raise HTTPError(413, 'Storage limit reached. Delete unused files or wait for their expiry.')
            now = time.time()
            record = {"id": secrets.token_hex(16), "created": now, "name": name, "size": size,
                      "directory": directory, "expires": now + 86400, "offset": 0}
            folder = service.store.folder(self.owner, record["id"])
            folder.mkdir(mode=0o700, parents=True)
            try:
                (folder / "input").touch(mode=0o600)
                service.store.put(self.owner, "upload", record, project_input=project_input)
            except Exception:
                shutil.rmtree(folder, ignore_errors=True)
                raise
            return record

        def upload_source(self, upload_id):
            record = service.store.get(self.owner, "upload", upload_id)
            if not record:
                raise HTTPError(404, "File unavailable")
            return record, service.store.folder(self.owner, upload_id) / "input"

        def available_upload(self, upload_id):
            record, source = self.upload_source(upload_id)
            if record["expires"] <= time.time() or not source.is_file():
                raise HTTPError(410, "Upload expired or unavailable")
            return record, source

        def check_upload_writer(self, record):
            expected = record.get("writerHash")
            if expected and not secrets.compare_digest(expected, hashlib.sha256(self.headers.get("Upload-Writer", "").encode()).hexdigest()):
                raise HTTPError(423, "This upload was resumed in another tab. Reopen the project to continue.")

        def check_upload_chunk(self, upload_id, offset, length):
            record, source = self.available_upload(upload_id)
            self.check_upload_writer(record)
            if record.get("sha256"):
                raise HTTPError(409, "Upload already finalized")
            if offset != source.stat().st_size:
                raise HTTPError(409, "Upload offset changed")
            if not 0 <= length <= 8 * BLOCK or offset + length > record["size"]:
                raise HTTPError(413, "Invalid upload chunk")
            return source

        def upload_chunk(self, upload_id):
            offset = int(self.headers.get("Upload-Offset", "-1"))
            length = int(self.headers.get("Content-Length", "-1"))
            with service.lock:
                self.check_upload_chunk(upload_id, offset, length)

            # Network reads can stall. Stage at most one bounded chunk per
            # request, then recheck state before committing any bytes.
            with tempfile.TemporaryFile(dir=service.store.root) as pending:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(BLOCK, remaining))
                    if not chunk:
                        raise HTTPError(400, "Upload interrupted")
                    pending.write(chunk)
                    remaining -= len(chunk)
                pending.seek(0)
                with service.lock:
                    source = self.check_upload_chunk(upload_id, offset, length)
                    with source.open("ab") as stream:
                        shutil.copyfileobj(pending, stream, BLOCK)
                        stream.flush()
                        os.fsync(stream.fileno())
                    committed = source.stat().st_size
            return self.send(200, {"offset": committed})

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
            if path == '/api/process/account/me' and method == 'GET':
                return self.send(200, self.account_view())
            provider_route = re.fullmatch(r'/api/process/account/oauth/(google|apple)/(start|complete)', path)
            if provider_route and method == 'POST':
                provider, action = provider_route.groups()
                if self.headers.get('Origin') not in (None, service.oauth.base):
                    raise HTTPError(403, 'Invalid sign-in origin')
                if not service.oauth.same_host(self.headers.get('Host', ''), getattr(self.server, 'transport_secure', False)):
                    raise HTTPError(403, 'Provider sign-in requires its configured HTTPS address.')
                if self.account:
                    raise HTTPError(409, 'Sign out before choosing another sign-in method.')
                service.accounts.admit(self.client_address[0])
                if int(self.headers.get('Content-Length', '0')) > 32768:
                    raise HTTPError(413, 'Account request is too large')
                body = self.json_body()
                cookie_name = f'__Host-shante_oauth_{self.server.server_port}_{provider}'
                if action == 'start':
                    if body != {}:
                        raise HTTPError(400, 'Invalid sign-in request')
                    settings, browser = service.oauth.start(provider)
                    self.oauth_cookie = f'{cookie_name}={browser}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600'
                    return self.send(200, settings)
                if set(body) - {'state', 'credential', 'code', 'error'}:
                    raise HTTPError(400, 'Invalid sign-in response')
                jar = cookies.SimpleCookie()
                try:
                    jar.load(self.headers.get('Cookie', ''))
                except cookies.CookieError:
                    pass
                browser = jar.get(cookie_name)
                issuer, subject, name = service.oauth.complete(provider, body, browser.value if browser else '')
                self.oauth_cookie = f'{cookie_name}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
                account, token = service.accounts.login_provider(issuer, subject, name)
                self.account = account; self.owner = account['owner']
                self.plan = account_plan('free', service.limits)
                self.set_account_cookie(token)
                return self.send(200, self.account_view())
            if path in ('/api/process/account/register', '/api/process/account/login', '/api/process/account/logout', '/api/process/account/password-change') and method == 'POST':
                if path.endswith('/logout'):
                    if self.account_token:
                        service.accounts.logout(self.account_token)
                    self.set_account_cookie(None)
                    self.account = None; self.owner = self.guest_owner
                    self.plan = account_plan('guest', service.limits)
                    return self.send(200, self.account_view())
                if not self.credentials_allowed:
                    raise HTTPError(403, 'Use HTTPS before entering account credentials on a network connection.')
                service.accounts.admit(self.client_address[0])
                if int(self.headers.get('Content-Length', '0')) > 16384:
                    raise HTTPError(413, 'Account request is too large')
                body = self.json_body()
                if path.endswith('/register'):
                    if set(body) - {'username', 'password', 'displayName'}:
                        raise HTTPError(400, 'Unsupported account options')
                    account, token = service.accounts.register(body.get('username'), body.get('password'), body.get('displayName'))
                elif path.endswith('/login'):
                    account, token = service.accounts.login(body.get('username'), body.get('password'))
                else:
                    if not self.account:
                        raise HTTPError(401, 'Sign in before changing your password.')
                    account, token = service.accounts.change_password(self.account, body.get('currentPassword'), body.get('newPassword'))
                self.account = account; self.owner = account['owner']
                self.plan = account_plan('free', service.limits)
                self.set_account_cookie(token)
                return self.send(201 if path.endswith('/register') else 200, self.account_view())
            if path == "/api/process/health" and method == "GET":
                with service.lock:
                    running = len(service.running)
                return self.send(200, {"version": 1, "processing": "local", "instance": service.instance_id,
                                       "pid": os.getpid(), "revision": PROCESSOR_REVISION, "activeJobs": running})
            if path == "/api/process/inspect" and method == "POST":
                try:
                    return self.send(200, {"entries": inspect_headers(self.json_body().get('entries'))})
                except ValueError as error:
                    raise HTTPError(400, str(error)) from error
            if path == "/api/process/capabilities" and method == "GET":
                from .native import capability
                return self.send(200, {"groupedWorkflows": True, "projectRecovery": True, "projectZipProfiles": True, "recoverableUploads": True, "draftScope": hashlib.sha256(("hamma-draft:" + self.owner).encode()).hexdigest(), "archives": archive_formats(), "nativeEngine": capability(), "singleFileArchives": single_file_archives(), "inspection": True, "zipVerification": True, "tarVerification": True, "zipSelection": True, "archiveRepack": True, "officeInspection": True, "zipComments": True, "zipProfiles": list(ZIP_PROFILES), "actionRegistry": action_registry(), "conversions": media_targets(),
                                       "limits": service.limits, 'plan': self.plan, 'billingEnabled': False, "processing": "local", "version": 1})
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
            if path == "/api/process/deletion-preview" and method == "GET":
                with service.lock:
                    return self.send(200, service.deletion_preview(self.owner))
            if path == '/api/process/files' and method == 'GET':
                query = parse_qs(url.query)
                return self.send(200, service.catalog.page(self.owner, search=query.get('q', [''])[0],
                    offset=max(0, int(query.get('offset', ['0'])[0])), limit=min(100, max(1, int(query.get('limit', ['50'])[0]))),
                    duplicates=query.get('duplicates', ['0'])[0] == '1'))
            if path in ("/api/process/history", "/api/process/files") and method == "DELETE":
                with service.lock:
                    token = self.headers.get("X-Hamma-Deletion-Token")
                    if token is not None:
                        preview = service.deletion_preview(self.owner)
                        expected = preview["historyToken" if path.endswith("history") else "filesToken"]
                        if not re.fullmatch(r"[a-f0-9]{64}", token) or not hmac.compare_digest(token, expected):
                            raise HTTPError(409, "The selection changed. Review the deletion count again.")
                    records = service.store.iter_records(self.owner)
                    for _, record in records:
                        if path.endswith("history"):
                            if record["state"] in TERMINAL:
                                service.store.patch(self.owner, "job", record["id"], hidden=True)
                        else:
                            if record["state"] in (*ACTIVE, "paused"):
                                (service.store.folder(self.owner, record["id"]) / "cancel").touch()
                                service.store.patch(self.owner, "job", record["id"], state="cancelled", error="Cancelled")
                            service.delete_files(self.owner, record)
                    if path.endswith("files"):
                        for _, upload in service.store.iter_records(self.owner, "upload"):
                            folder = service.store.folder(self.owner, upload["id"])
                            if folder.exists():
                                shutil.rmtree(folder)
                            service.store.delete(self.owner, upload["id"])
                return self.send(200, {"deleted": True})
            if path == '/api/process/projects' and method == 'GET':
                return self.send(200, {'projects': service.projects.list(self.owner)})
            project_route = re.fullmatch(r'/api/process/projects/([a-zA-Z0-9_-]{1,64})(?:/(inputs)(?:/([a-f0-9]{32}))?)?', path)
            if project_route:
                project_id, input_route, source_id = project_route.groups()
                is_inputs = input_route is not None
                body = self.json_body() if method == 'PUT' else None
                with service.lock:
                    if not is_inputs and method == 'GET':
                        result = service.projects.get(self.owner, project_id)
                    elif not is_inputs and method == 'PUT':
                        result = service.projects.save(self.owner, project_id, body)
                    elif is_inputs and not source_id and method == 'GET':
                        query = parse_qs(url.query)
                        result = service.projects.inputs(self.owner, project_id, query.get('after', [''])[0],
                                                        int(query.get('limit', [100])[0]), query.get('includeIncomplete') == ['1'])
                    elif is_inputs and source_id and method == 'PUT':
                        service.projects.checkpoint(self.owner, project_id, source_id, body.get('upload'))
                        result = {'saved': True}
                    elif is_inputs and source_id and method == 'DELETE':
                        service.projects.forget_source(self.owner, project_id, source_id)
                        result = {'removed': True}
                    else:
                        raise HTTPError(404, 'Not found')
                return self.send(200, result)
            if path == "/api/process/uploads" and method == "POST":
                body = self.json_body()
                name = safe_path(body.get("name"), bool(body.get("directory")))
                size = body.get("size")
                if type(size) is not int or not 0 <= size <= self.plan['maxInputBytes'] or (body.get("directory") and size != 0):
                    raise HTTPError(413, "Upload size limit reached. Choose a smaller file.")
                directory = bool(body.get("directory"))
                project_input = (body.get('projectId'), body.get('sourceId')) if 'projectId' in body or 'sourceId' in body else None
                with service.lock:
                    record = service.projects.prepare_upload(self.owner, *project_input, name, size, directory) if project_input is not None else None
                    if record is None:
                        record = self.create_upload(name, size, directory, project_input)
                return self.send(201, {key: value for key, value in record.items() if key != "writerHash"})
            prefix_route = re.fullmatch(r"/api/process/uploads/([a-f0-9]{32})/prefix", path)
            if prefix_route and method in ("GET", "POST"):
                query = parse_qs(url.query)
                start = int(query.get("start", [-1])[0])
                length = int(query.get("length", [-1])[0])
                if start < 0 or not 1 <= length <= 4 * BLOCK:
                    raise HTTPError(416, "Requested bytes are outside the saved upload")
                candidate = None
                if method == "POST":
                    if int(self.headers.get("Content-Length", "-1")) != length:
                        raise HTTPError(400, "Invalid upload verification length")
                    data = self.rfile.read(length)
                    if len(data) != length:
                        raise HTTPError(400, "Upload verification interrupted")
                    candidate = hashlib.sha256(data).hexdigest()
                with service.lock:
                    _, source = self.available_upload(prefix_route[1])
                    if start + length > source.stat().st_size:
                        raise HTTPError(416, "Requested bytes are outside the saved upload")
                    with source.open("rb") as stream:
                        stream.seek(start)
                        digest = hashlib.sha256(stream.read(length)).hexdigest()
                return self.send(200, {"sha256": digest} if candidate is None else {"matches": secrets.compare_digest(digest, candidate)})
            resume_route = re.fullmatch(r"/api/process/uploads/([a-f0-9]{32})/resume", path)
            if resume_route and method == "POST":
                body = self.json_body()
                offset, writer = body.get("offset"), body.get("writer")
                if type(offset) is not int or not isinstance(writer, str) or not re.fullmatch(r"[a-f0-9]{32}", writer):
                    raise HTTPError(400, "Invalid upload resume request")
                with service.lock:
                    record, source = self.available_upload(resume_route[1])
                    if not 0 <= offset < record["size"] or source.stat().st_size != offset:
                        raise HTTPError(409, "Saved upload changed. Retry with the original file.")
                    service.store.patch(self.owner, "upload", record["id"], writerHash=hashlib.sha256(writer.encode()).hexdigest())
                return self.send(200, {"offset": offset})
            match = re.fullmatch(r"/api/process/uploads/([a-f0-9]{32})", path)
            if match:
                upload_id = match[1]
                if method == "PUT":
                    return self.upload_chunk(upload_id)
                with service.lock:
                    record, source = self.upload_source(upload_id)
                    if method == "GET":
                        if record["expires"] <= time.time() or not source.is_file():
                            raise HTTPError(410, "Upload expired or unavailable")
                        if self.headers.get("Upload-Writer"):
                            self.check_upload_writer(record)
                        result = {key: value for key, value in record.items() if key != "writerHash"}
                        result.update(offset=source.stat().st_size, claimed="writerHash" in record)
                    if method == "DELETE":
                        if service.store.upload_referenced(self.owner, upload_id):
                            raise HTTPError(409, "File in use")
                        if source.parent.exists():
                            shutil.rmtree(source.parent)
                        service.store.delete(self.owner, upload_id)
                        result = {"deleted": True}
                if method in ("GET", "DELETE"):
                    return self.send(200, result)
            if path == "/api/process/jobs" and method == "POST":
                body = self.json_body()
                ids = body.get("uploads")
                operation, target = body.get("operation"), body.get("target")
                if not isinstance(ids, list) or not ids or len(ids) > service.limits["files"] or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
                    raise HTTPError(400, "Invalid file selection")
                if (operation == "compress" and target not in archive_formats() or operation == "extract" and target not in ("zip", "zip-deflate") or
                    operation == "convert" and target not in MEDIA or operation in ("verify", "inspect") and target != "json" or
                    operation not in ("compress", "extract", "convert", "verify", "inspect")):
                    raise HTTPError(400, "Unsupported operation")
                if operation != "compress" and len(ids) != 1:
                    raise HTTPError(400, "One input per extraction or conversion job")
                zip_profile = body.get("zipProfile", "balanced")
                if "zipProfile" in body and (operation != "compress" or target != "zip" or
                                              not isinstance(zip_profile, str) or zip_profile not in ZIP_PROFILES):
                    raise HTTPError(400, "Invalid ZIP compression profile")
                zip_comment = body.get("zipComment", "")
                if "zipComment" in body and (operation != "compress" or target != "zip"):
                    raise HTTPError(400, "Archive comments require ZIP compression")
                try:
                    encode_zip_comment(zip_comment)
                except ProcessingError as error:
                    raise HTTPError(400, str(error)) from error
                zip_indexes = body.get("zipIndexes")
                if "zipIndexes" in body:
                    if (operation != "extract" or body.get("recursive") or not isinstance(zip_indexes, list)
                            or not 0 < len(zip_indexes) <= service.limits["files"]
                            or not all(type(index) is int and 0 <= index < service.limits["files"] for index in zip_indexes)
                            or len(set(zip_indexes)) != len(zip_indexes)):
                        raise HTTPError(400, "Invalid ZIP member selection")
                    zip_indexes = sorted(zip_indexes)
                project_id = body.get('projectId', 'default')
                if not isinstance(project_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', project_id):
                    raise HTTPError(400, 'Invalid project identifier')
                quality_mode = body.get('qualityMode', 'lossless')
                metadata_policy = body.get('metadataPolicy', 'strip')
                from .media_policy import validate_conversion_options
                try:
                    validate_conversion_options(target if operation == 'convert' else None, quality_mode, metadata_policy)
                except ValueError as error:
                    raise HTTPError(400, str(error)) from error
                with service.lock:
                    request_id = body.get("requestId")
                    recoverable = body.get('recoverable', False)
                    if type(recoverable) is not bool:
                        raise HTTPError(400, 'Invalid recovery mode')
                    if recoverable:
                        service.projects.get(self.owner, project_id)
                        identity = ['project-recovery-v1', project_id, sorted(ids), operation, target, bool(body.get('recursive')), quality_mode, metadata_policy]
                        if zip_indexes is not None:
                            identity.append(zip_indexes)
                        if zip_profile != "balanced":
                            identity.append(zip_profile)
                        if zip_comment:
                            identity.append(["zipComment", zip_comment])
                        request_id = hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()
                    if request_id is not None and (not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{64}", request_id)):
                        raise HTTPError(400, "Invalid request identifier")
                    job_id = hashlib.sha256((self.owner + request_id).encode()).hexdigest()[:32] if request_id else secrets.token_hex(16)
                    existing = service.store.get(self.owner, "job", job_id)
                    if existing:
                        existing_ids = [i['id'] for i in existing['inputs']]
                        if ((sorted(existing_ids) != sorted(ids) if recoverable else existing_ids != ids) or existing["operation"] != operation or existing["target"] != target or existing["recursive"] != bool(body.get("recursive")) or
                            existing.get('projectId', 'default') != project_id or existing.get('qualityMode', 'lossless') != quality_mode or existing.get('metadataPolicy', 'strip') != metadata_policy or existing.get('zipIndexes') != zip_indexes or existing.get('zipProfile', 'balanced') != zip_profile or existing.get('zipComment', '') != zip_comment):
                            raise HTTPError(409, "Request identifier already used")
                        if recoverable:
                            service.projects.forget_uploads(self.owner, project_id, ids)
                        return self.send(200, service.public(self.owner, existing))
                    if service.store.count(self.owner, states=(*ACTIVE, "paused")) >= self.plan['maxQueuedJobs']:
                        raise HTTPError(429, "Queue limit reached. Wait for jobs to finish or cancel queued jobs." + (" Sign in for a larger queue." if not self.account else ""))
                    if service.store.count(kind='job', states=(*ACTIVE, 'paused')) >= service.max_queued_jobs:
                        raise HTTPError(429, 'Processor queue full')
                    inputs, seen = [], set()
                    for upload_id in ids:
                        record = service.store.get(self.owner, "upload", upload_id)
                        if not record or record["expires"] <= time.time():
                            raise HTTPError(404, "File unavailable")
                        source = service.store.folder(self.owner, upload_id) / "input"
                        if not source.is_file():
                            raise HTTPError(410, "Upload expired or unavailable")
                        if source.stat().st_size != record["size"]:
                            raise HTTPError(409, "Upload incomplete")
                        if record["name"].casefold() in seen:
                            raise HTTPError(400, "Duplicate filename")
                        seen.add(record["name"].casefold())
                        if not record.get("sha256"):
                            ctx = Context(source.parent, service.limits)
                            record.update(file_digest(source, ctx), format=detect(source))
                            service.store.put(self.owner, "upload", record)
                        inputs.append({key: value for key, value in record.items() if key != "writerHash"})
                    if operation != "compress" and inputs[0].get("directory"):
                        raise HTTPError(400, "Choose a file")
                    now = time.time()
                    settings = service.defaults(self.owner)
                    retention = RETENTION[settings["historyRetention"]]
                    record = {"id": job_id, "projectId": project_id, "created": now, "name": inputs[0]["name"] if len(inputs) == 1 else f"{len(inputs)} files",
                              "operation": operation, "target": target, "inputs": inputs, "recursive": bool(body.get("recursive")),
                              'qualityMode': quality_mode, 'metadataPolicy': metadata_policy,
                              "state": "queued", "inputSize": sum(i["size"] for i in inputs), "outputSize": None,
                              "format": inputs[0]["format"] if len(inputs) == 1 else "batch", "processed": 0, "entries": 0,
                              "fileExpires": now + RETENTION[settings["fileRetention"]], "historyExpires": now + retention if retention else None,
                              "downloadAvailable": False, "error": None}
                    if zip_indexes is not None:
                        record["zipIndexes"] = zip_indexes
                    if zip_profile != "balanced":
                        record["zipProfile"] = zip_profile
                    if zip_comment:
                        record["zipComment"] = zip_comment
                    service.store.folder(self.owner, record["id"]).mkdir(mode=0o700, parents=True)
                    service.store.put(self.owner, "job", record)
                    if recoverable:
                        service.projects.forget_uploads(self.owner, project_id, ids)
                    # Bound guest history independently of file retention.
                    service.store.trim_history(self.owner, limit=self.plan['historyRecords'])
                LOG.info("Job queued: %s %s", record["id"], operation)
                return self.send(202, service.public(self.owner, record))
            if path == "/api/process/jobs/overview" and method == "GET":
                metrics, jobs = service.store.history_overview(self.owner)
                return self.send(200, {"metrics": metrics, "jobs": [service.public(self.owner, job) for job in jobs]})
            if path == "/api/process/jobs" and method == "GET":
                query = parse_qs(url.query)
                offset = max(0, int(query.get("offset", [0])[0]))
                limit = min(100, max(1, int(query.get("limit", [50])[0])))
                search = query.get("q", [""])[0].casefold()
                state = query.get("state", [""])[0]
                sort = query.get("sort", ["newest"])[0]
                total, jobs = service.store.history_page(self.owner, offset=offset, limit=limit, search=search, state=state, sort=sort, summary=True,
                                                        include_hidden_downloads=query.get("includeHiddenDownloads", ["0"])[0] == "1")
                return self.send(200, {"total": total, "jobs": [service.public(self.owner, j) for j in jobs]})
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
                    if record.get('inputMode') == 'directory-index':
                        if not record.get('downloadAvailable') or record['fileExpires'] <= time.time():
                            raise HTTPError(410, 'Verified manifest unavailable')
                        from .indexed_archive import manifest_page
                        query = parse_qs(url.query)
                        limit = min(1000, max(1, int(query.get('limit', [100])[0])))
                        rows = manifest_page(directory / 'discovery.sqlite3', int(query.get('after', [0])[0]), limit)
                        return self.send(200, {'id': job_id, 'sha256': record.get('sha256'), 'files': rows,
                                               'total': record['fileCount'], 'nextCursor': str(rows[-1]['id']) if len(rows) == limit else None})
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
                            if service.store.count(self.owner, states=(*ACTIVE, "paused")) >= self.plan['maxQueuedJobs']:
                                raise HTTPError(429, "Queue limit reached. Wait for jobs to finish or cancel queued jobs." + (" Sign in for a larger queue." if not self.account else ""))
                            if service.store.count(kind='job', states=(*ACTIVE, 'paused')) >= service.max_queued_jobs:
                                raise HTTPError(429, 'Processor queue full')
                            if record["fileExpires"] <= time.time() or any(not (service.store.folder(self.owner, i["id"]) / "input").exists() for i in record["inputs"]):
                                raise HTTPError(410, "Input files expired")
                            (directory / "cancel").unlink(missing_ok=True)
                            service.store.patch(self.owner, "job", job_id, state="queued", error=None, errorInfo=None, retryCount=record.get('retryCount', 0) + 1, processed=0, entries=0, expanded=0, mediaSeconds=0, duration=None, started=None, finished=None, hidden=False)
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
            except (HTTPError, AccountError, ProjectError) as error:
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
    parser.add_argument('--tls-cert', default=None, help='Operator-supplied TLS certificate chain')
    parser.add_argument('--tls-key', default=None, help='Operator-supplied TLS private key')
    parser.add_argument("--lan", action="store_true", help="Allow explicitly named private-network addresses")
    parser.add_argument("--allow-host", action="append", default=[], help="Private IPv4 address used by phones")
    args = parser.parse_args()
    from .transport import configure_tls, TLSConfigurationError
    try:
        transport = configure_tls(args.tls_cert, args.tls_key)
    except TLSConfigurationError as error:
        parser.error(str(error))
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
    try:
        server = LocalHTTPServer((args.host, args.port), handler(service))
    except BaseException:
        service.close()
        raise
    server.tls_context = transport.context
    server.transport_secure = transport.secure_cookies
    thread = threading.Thread(target=service.loop, daemon=True)
    thread.start()
    LOG.info("HAMMA available at %s://%s:%s", 'https' if transport.secure_cookies else 'http', args.host, server.server_port)
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
