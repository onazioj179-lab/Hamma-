import errno
import hashlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from http.client import HTTPConnection, IncompleteRead
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from socketserver import ThreadingMixIn
import io
import json
import os
import random
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import tarfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import wave
import zipfile

from processor.server import ACTIVE, LocalHTTPServer, Service, Store, handler, run_job
from processor.engine import probe
from processor.capabilities import media_targets
from test_engine import LIMITS


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name, limits=LIMITS)
        self.server = LocalHTTPServer(("127.0.0.1", 0), handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}/api/process"
        self.cookies = CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.cookies))

    def tearDown(self):
        self.service.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        self.temp.cleanup()

    def call(self, path, data=None, method="GET", headers=None, client=None, raw=False):
        body = json.dumps(data).encode() if data is not None and not raw else data
        request = Request(self.base + path, data=body, method=method, headers={"X-Hamma-Request": "1", **({"Content-Type": "application/json"} if data is not None and not raw else {}), **(headers or {})})
        with (client or self.client).open(request, timeout=15) as response:
            result = response.read()
            return result if raw else json.loads(result)

    def test_json_endpoints_reject_non_object_payloads(self):
        for path, method in [("/uploads", "POST"), ("/jobs", "POST"), ("/settings", "PUT")]:
            for payload in [b"null", b"[]", b"1", b'"text"', b'{"size": NaN}', b'{"size": Infinity}']:
                with self.subTest(path=path, payload=payload):
                    with self.assertRaises(HTTPError) as caught:
                        self.call(path, payload, method, {"Content-Type": "application/json"}, raw=True)
                    self.assertEqual(caught.exception.code, 400)
                    self.assertIn("error", json.loads(caught.exception.read()))
        self.assertIn("id", self.upload())

    def test_disconnected_clients_close_without_a_false_storage_error(self):
        request = object.__new__(self.server.RequestHandlerClass)
        for failure in (ConnectionAbortedError(), BrokenPipeError(), ConnectionResetError()):
            with self.subTest(failure=type(failure).__name__):
                request.close_connection = False
                with patch.object(request, 'route', side_effect=failure), patch.object(request, 'send') as send, \
                        patch('processor.server.LOG.exception') as log:
                    request.handle_request()
                self.assertTrue(request.close_connection)
                send.assert_not_called()
                log.assert_not_called()

        request.close_connection = False
        with patch.object(request, 'route', side_effect=ValueError), \
                patch.object(request, 'send', side_effect=ConnectionAbortedError) as send:
            request.handle_request()
        self.assertTrue(request.close_connection)
        send.assert_called_once_with(400, {"error": "Invalid request"}, None)

    def test_failure_after_response_headers_does_not_send_another_response(self):
        request = object.__new__(self.server.RequestHandlerClass)
        request.close_connection = False
        request.response_started = True
        with patch.object(request, 'route', side_effect=OSError(errno.EIO, 'injected read failure')), \
                patch.object(request, 'send') as send, patch('processor.server.LOG.exception') as log:
            request.handle_request()
        self.assertTrue(request.close_connection)
        send.assert_not_called()
        log.assert_called_once_with('Storage operation failed')

    def test_upload_retries_at_last_acknowledged_offset_after_disk_fills(self):
        source = self.call("/uploads", {"name": "resume.txt", "size": 6}, "POST")
        path = "/uploads/" + source["id"]
        self.call(path, b"abc", "PUT", {"Upload-Offset": "0"}, raw=True)

        def partial_write(pending, stream, _length):
            stream.write(pending.read(1))
            raise OSError(errno.ENOSPC, "injected disk exhaustion")

        with patch("processor.server.shutil.copyfileobj", side_effect=partial_write):
            self.assert_status(507, lambda: self.call(path, b"def", "PUT", {"Upload-Offset": "3"}, raw=True))
        self.assertEqual(self.call(path)["offset"], 3)
        self.call(path, b"def", "PUT", {"Upload-Offset": "3"}, raw=True)

        completed = self.execute(self.job(source))
        self.assertEqual(completed["state"], "completed", completed)
        downloaded = self.call(completed["download"].removeprefix("/api/process"), raw=True)
        with zipfile.ZipFile(io.BytesIO(downloaded)) as archive:
            self.assertEqual(archive.read("resume.txt"), b"abcdef")

    def test_conversion_quality_is_enforced_before_queueing_and_bound_to_request_identity(self):
        source = self.upload()
        self.assert_status(400, lambda: self.job(source, operation='convert', target='mp3'))
        self.assertEqual(self.call('/jobs')['total'], 0)
        accepted = self.job(source, operation='convert', target='mp3', qualityMode='lossy', metadataPolicy='strip', requestId='d' * 64)
        self.assertEqual(accepted['qualityMode'], 'lossy')
        self.assertEqual(accepted['metadataPolicy'], 'strip')
        self.assert_status(409, lambda: self.job(source, operation='convert', target='mp3', qualityMode='lossy', metadataPolicy='preserve', requestId='d' * 64))
        self.assert_status(400, lambda: self.job(source, operation='convert', target='wav', metadataPolicy='invalid'))

    def test_h264_video_job_requires_consent_and_downloads_verified_mp4(self):
        if "mp4-h264" not in media_targets():
            self.skipTest("FFmpeg H.264 MP4 preset unavailable")
        fixture = Path(self.temp.name) / "source.mkv"
        subtitles = fixture.with_suffix(".srt")
        subtitles.write_text("1\n00:00:00,100 --> 00:00:00,400\nSHANTE\n", encoding="ascii")
        subprocess.run([
            shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:duration=0.6",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=0.6", "-i", str(subtitles),
            "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-c:s", "srt", str(fixture),
        ], check=True, capture_output=True, timeout=30)
        payload = fixture.read_bytes()
        inspection = self.call("/inspect", {"entries": [{"head": payload[:512].hex()}]}, "POST")
        self.assertIn("mp4-h264", inspection["entries"][0]["conversions"])
        upload = self.upload(payload, fixture.name)
        self.assert_status(400, lambda: self.job(upload, operation="convert", target="mp4-h264"))
        job = self.job(upload, operation="convert", target="mp4-h264", qualityMode="lossy")
        completed = self.execute(job)
        self.assertEqual(completed["state"], "completed", completed)
        self.assertEqual(completed["outputName"], "source.mp4")
        downloaded = self.call(completed["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(downloaded).hexdigest(), completed["sha256"])
        output = fixture.with_suffix(".mp4")
        output.write_bytes(downloaded)
        streams = probe(output)["streams"]
        self.assertEqual([s["codec_name"] for s in streams], ["h264", "aac", "mov_text"])
        self.assertEqual((streams[0]["width"], streams[0]["height"]), (64, 48))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg not installed")
    def test_video_audio_targets_extract_short_tracks_to_a_verified_zip(self):
        source = Path(self.temp.name) / "short-tracks.mkv"
        subprocess.run([
            shutil.which("ffmpeg"), "-v", "error",
            "-f", "lavfi", "-i", "color=s=32x32:d=2",
            "-f", "lavfi", "-i", "sine=frequency=400:duration=0.2",
            "-f", "lavfi", "-i", "sine=frequency=800:duration=0.4",
            "-map", "0:v", "-map", "1:a", "-map", "2:a",
            "-c:v", "mpeg4", "-c:a", "pcm_s16le", str(source),
        ], check=True, capture_output=True, timeout=30)
        inspection = self.call("/inspect", {"entries": [{"head": source.read_bytes()[:512].hex()}]}, "POST")
        self.assertIn("wav", inspection["entries"][0]["conversions"])
        upload = self.upload(source.read_bytes(), source.name)
        completed = self.execute(self.job(upload, operation="convert", target="wav"))
        self.assertEqual(completed["state"], "completed", completed)
        self.assertEqual(completed["outputName"], "short-tracks.zip")
        path = "/jobs/" + completed["id"]
        report = self.call(path + "/manifest")
        data = self.call(completed["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(data).hexdigest(), report["sha256"])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.namelist(), ["audio-1.wav", "audio-2.wav"])
            for member, frames in zip(report["files"], (8820, 17640)):
                payload = archive.read(member["name"])
                self.assertEqual(hashlib.sha256(payload).hexdigest(), member["sha256"])
                with wave.open(io.BytesIO(payload)) as audio:
                    self.assertEqual(audio.getframerate(), 44100)
                    self.assertEqual(audio.getnframes(), frames)

    def upload(self, data=b"test data", name="nested/世界.txt", split=False):
        record = self.call("/uploads", {"name": name, "size": len(data)}, "POST")
        if split:
            self.call("/uploads/" + record["id"], data[:3], "PUT", {"Upload-Offset": "0"}, raw=True)
            self.assertEqual(self.call("/uploads/" + record["id"])["offset"], 3)
            self.call("/uploads/" + record["id"], data[3:], "PUT", {"Upload-Offset": "3"}, raw=True)
        else:
            self.call("/uploads/" + record["id"], data, "PUT", {"Upload-Offset": "0"}, raw=True)
        return record

    def job(self, upload=None, **options):
        upload = upload or self.upload()
        return self.call("/jobs", {"uploads": [upload["id"]], "operation": "compress", "target": "zip", **options}, "POST")

    def execute(self, job):
        owner = self.service.store.list()[0][0]
        run_job(self.temp.name, owner, job["id"], LIMITS)
        return self.call("/jobs/" + job["id"])

    def assert_status(self, status, function):
        with self.assertRaises(HTTPError) as raised:
            function()
        self.assertEqual(raised.exception.code, status, raised.exception.read().decode())

    def test_completed_output_can_be_reused_after_original_is_deleted(self):
        original = self.job(self.upload(b"retained bytes", "original.txt"))
        path = "/jobs/" + original["id"] + "/reuse"
        self.call("/projects/default", {}, "PUT")
        self.assert_status(410, lambda: self.call(path, {"name": "original.zip"}, "POST"))
        original = self.execute(original)
        body = {"name": original["outputName"]}
        source = self.call(path, {}, "POST")
        self.assertEqual(source["name"], original["outputName"])
        self.assertEqual(self.call(path, body, "POST"), source)
        upload_path = "/uploads/" + source["upload"]
        self.assert_status(409, lambda: self.call(upload_path, b"x", "PUT",
                                                   {"Upload-Offset": str(source["size"])}, raw=True))
        retained = self.call(original["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(retained).hexdigest(), original["sha256"])
        self.assertEqual(self.call("/projects/default/inputs")["sources"][0]["id"], source["id"])
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call("/projects/default", {}, "PUT", client=other)
        self.assert_status(404, lambda: self.call(path, body, "POST", client=other))
        self.call("/jobs/" + original["id"] + "/files", method="DELETE")
        self.assert_status(410, lambda: self.call(path, body, "POST"))
        extracted = self.job({"id": source["upload"]}, operation="extract", recoverable=True)
        extracted = self.execute(extracted)
        self.assertEqual(extracted["state"], "completed")
        with zipfile.ZipFile(io.BytesIO(self.call(extracted["download"].removeprefix("/api/process"), raw=True))) as archive:
            self.assertEqual(archive.read("original.txt"), b"retained bytes")
        self.assertEqual(self.call("/projects/default/inputs")["sources"], [])

    def test_output_reuse_can_retry_after_link_failure_without_leaking_upload(self):
        original = self.execute(self.job(self.upload(b"retained bytes", "original.txt")))
        path = "/jobs/" + original["id"] + "/reuse"
        self.call("/projects/default", {}, "PUT")
        body = {"name": original["outputName"]}
        before = self.service.store.count(kind="upload")
        with patch("processor.server.os.link", side_effect=OSError("link unavailable")):
            self.assert_status(507, lambda: self.call(path, body, "POST"))
        self.assertEqual(self.service.store.count(kind="upload"), before)
        self.assertEqual(self.call("/projects/default/inputs")["sources"], [])
        source = self.call(path, body, "POST")
        self.assertEqual(source, self.call(path, body, "POST"))
        self.assertEqual(self.service.store.count(kind="upload"), before + 1)

    def test_reuse_respects_project_limit_when_pending_selections_fill_it(self):
        original = self.execute(self.job(self.upload(b"retained bytes", "original.txt")))
        self.call("/projects/default", {}, "PUT")
        selection = {"id": "1" * 32, "name": "pending.txt", "size": 1, "directory": False}
        path = "/projects/default/inputs"
        self.call(path, {"selections": [selection]}, "PUT")
        before = self.service.store.count(kind="upload")
        with patch.dict(self.service.projects.limits, {"files": 1}):
            self.assert_status(413, lambda: self.call("/jobs/" + original["id"] + "/reuse",
                                                       {"name": original["outputName"]}, "POST"))
        self.assertEqual(self.service.store.count(kind="upload"), before)
        self.assertEqual(self.call(path + "?includeSelections=1")["sources"][0]["id"], selection["id"])

    def test_output_reuse_verifies_copy_when_links_are_unsupported(self):
        original = self.execute(self.job(self.upload(b"copy fixture", "original.txt")))
        path = "/jobs/" + original["id"] + "/reuse"
        self.call("/projects/default", {}, "PUT")
        owner, job = self.service.store.list()[0]
        output = self.service.store.folder(owner, job["id"]) / job["outputFile"]
        original_bytes = output.read_bytes()
        output.write_bytes(b"x" * len(original_bytes))
        with patch("processor.server.os.link", side_effect=OSError(errno.ENOTSUP, "link unavailable")):
            before = self.service.store.count(kind="upload")
            self.assert_status(409, lambda: self.call(path, {}, "POST"))
            self.assertEqual(self.service.store.count(kind="upload"), before)
            output.write_bytes(original_bytes)
            source = self.call(path, {}, "POST")
        self.call("/jobs/" + original["id"] + "/files", method="DELETE")
        extracted = self.execute(self.job({"id": source["upload"]}, operation="extract", recoverable=True))
        with zipfile.ZipFile(io.BytesIO(self.call(extracted["download"].removeprefix("/api/process"), raw=True))) as archive:
            self.assertEqual(archive.read("original.txt"), b"copy fixture")

    def test_restart_preparation_is_instance_bound_and_keeps_queued_jobs_intact(self):
        queued = self.job()
        self.assert_status(409, lambda: self.call("/prepare-restart", method="POST", headers={"X-Hamma-Instance": "wrong"}))
        self.assertEqual(self.service.restart_until, 0)
        self.service.running["busy"] = ()
        try:
            self.assert_status(409, lambda: self.call("/prepare-restart", method="POST", headers={"X-Hamma-Instance": self.service.instance_id}))
        finally:
            self.service.running.pop("busy")
        prepared = self.call("/prepare-restart", method="POST", headers={"X-Hamma-Instance": self.service.instance_id})
        self.assertTrue(prepared["ready"])
        self.service.tick()
        self.assertEqual(self.call("/jobs/" + queued["id"])["state"], "queued")
        self.assertEqual(len(self.service.running), 0)

    def test_json_routes_reject_non_object_bodies(self):
        for value in ([], None, 12, "string"):
            payload = json.dumps(value).encode()
            self.assert_status(400, lambda: self.call("/uploads", payload, "POST", {"Content-Type": "application/json"}, raw=True))

    def test_rate_limit_returns_retry_after_and_discards_expired_windows(self):
        self.service.requests_per_minute = 1
        self.service.rate_window = int(time.monotonic() // 60) - 1
        self.service.rates["expired-client"] = 2000
        self.call("/health")
        with self.assertRaises(HTTPError) as raised:
            self.call("/health")
        self.assertEqual(raised.exception.code, 429)
        self.assertTrue(1 <= int(raised.exception.headers["Retry-After"]) <= 60)
        self.assertNotIn("expired-client", self.service.rates)

    def test_sqlite_busy_returns_retryable_error(self):
        import sqlite3
        error = sqlite3.OperationalError("private database detail")
        error.sqlite_errorcode = sqlite3.SQLITE_BUSY
        with patch.object(self.service.store, "history_page", side_effect=error):
            with self.assertRaises(HTTPError) as caught:
                self.call("/jobs")
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(caught.exception.headers["Retry-After"], "1")
        self.assertEqual(json.loads(caught.exception.read()), {"error": "Processor is busy"})

    def test_live_history_refresh_is_owner_scoped_and_invalidates_on_completion_and_hiding(self):
        queued = self.job()
        owner = self.service.store.list()[0][0]
        status = self.call("/jobs/live")
        self.assertIsNone(status["jobs"])
        poll = "/jobs/live?revision=" + status["revision"]
        self.service.store.patch(owner, "job", queued["id"], state="processing", processed=3)
        live = self.call(poll)
        self.assertEqual(live["revision"], status["revision"])
        self.assertEqual([(job["id"], job["processed"]) for job in live["jobs"]], [(queued["id"], 3)])
        self.assertNotIn("inputs", live["jobs"][0])
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assertIsNone(self.call(poll, client=other)["jobs"])
        self.execute(queued)
        completed = self.call(poll)
        self.assertNotEqual(completed["revision"], status["revision"])
        self.assertIsNone(completed["jobs"])
        poll = "/jobs/live?revision=" + completed["revision"]
        self.assertEqual(self.call(poll)["jobs"], [])
        self.service.store.trim_history(owner, 0)
        self.assertIsNone(self.call(poll)["jobs"])
        self.assertTrue(self.call("/jobs?includeHiddenDownloads=1")["jobs"][0]["downloadAvailable"])

    def test_connection_slots_leave_capacity_for_another_peer(self):
        primary, other = ("127.0.0.1", 1234), ("127.0.0.2", 1234)
        with patch.object(ThreadingMixIn, "process_request") as start, patch.object(self.server, "shutdown_request") as reject:
            for _ in range(16):
                self.server.process_request(Mock(), primary)
            overflow = Mock()
            self.server.process_request(overflow, primary)
            self.server.process_request(Mock(), other)
            self.assertEqual(start.call_count, 17)
            reject.assert_called_once_with(overflow)
            self.server.release_slot(primary[0])
            self.server.process_request(Mock(), primary)
            self.assertEqual(start.call_count, 18)
            for peer, count in self.server.peer_slots.copy().items():
                for _ in range(count):
                    self.server.release_slot(peer)
            self.assertFalse(self.server.peer_slots)

    def test_stream_failure_closes_response_without_appending_json(self):
        def broken_stream(request):
            request.send_response(200)
            request.send_header("Content-Length", "100")
            request.end_headers()
            request.wfile.write(b"partial")
            raise OSError("Disk read failed")

        with (patch.object(self.server.RequestHandlerClass, "route", autospec=True, side_effect=broken_stream),
              self.assertLogs("hamma.processor", level="ERROR"),
              closing(HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)) as client):
            client.request("GET", "/")
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            with self.assertRaises(IncompleteRead) as caught:
                response.read()
            self.assertEqual(caught.exception.partial, b"partial")

    def test_expired_or_missing_uploads_report_gone_before_cleanup(self):
        source = self.upload(b"original")
        owner = self.service.store.list(kind="upload")[0][0]
        self.service.store.patch(owner, "upload", source["id"], expires=time.time() - 1)
        self.assert_status(410, lambda: self.call("/uploads/" + source["id"]))
        self.assert_status(410, lambda: self.call("/uploads/" + source["id"], b"", "PUT", {"Upload-Offset": "8"}, raw=True))
        self.assertEqual((self.service.store.folder(owner, source["id"]) / "input").read_bytes(), b"original")
        missing = self.upload(b"missing", "missing.txt")
        (self.service.store.folder(owner, missing["id"]) / "input").unlink()
        self.assert_status(410, lambda: self.call("/uploads/" + missing["id"]))

    def start_partial_upload(self, path):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(connection.close)
        entered = threading.Event()
        get_record = self.service.store.get

        def observe_lookup(*args, **kwargs):
            record = get_record(*args, **kwargs)
            entered.set()
            return record

        with patch.object(self.service.store, "get", side_effect=observe_lookup):
            connection.putrequest("PUT", "/api/process" + path)
            connection.putheader("Cookie", "; ".join(f"{c.name}={c.value}" for c in self.cookies))
            connection.putheader("X-Hamma-Request", "1")
            connection.putheader("Upload-Offset", "0")
            connection.putheader("Content-Length", "8")
            connection.endheaders(b"old")
            self.assertTrue(entered.wait(5), "The PUT request did not reach the upload route")
        return connection

    def test_stalled_upload_allows_health_checks_and_rechecks_competing_writes(self):
        record = self.call("/uploads", {"name": "race.txt", "size": 8}, "POST")
        path = "/uploads/" + record["id"]
        pending = self.start_partial_upload(path)
        with closing(HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)) as health:
            health.request("GET", "/api/process/health")
            with health.getresponse() as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.load(response)["activeJobs"], 0)
        self.assertEqual(self.call(path)["offset"], 0)
        self.assertEqual(json.loads(self.call(path, b"new data", "PUT", {"Upload-Offset": "0"}, raw=True)), {"offset": 8})
        pending.send(b" data")
        with pending.getresponse() as response:
            self.assertEqual(response.status, 409)
        owner = self.service.store.list(kind="upload")[0][0]
        self.assertEqual((self.service.store.folder(owner, record["id"]) / "input").read_bytes(), b"new data")

    def test_interrupted_chunk_leaves_committed_offset_unchanged(self):
        record = self.call("/uploads", {"name": "resume.txt", "size": 8}, "POST")
        path = "/uploads/" + record["id"]
        pending = self.start_partial_upload(path)
        pending.sock.shutdown(socket.SHUT_WR)
        with pending.getresponse() as response:
            self.assertEqual(response.status, 400)
        self.assertEqual(self.call(path)["offset"], 0)
        self.assertEqual(json.loads(self.call(path, b"new data", "PUT", {"Upload-Offset": "0"}, raw=True)), {"offset": 8})

    def test_pending_chunk_cannot_recreate_deleted_upload(self):
        record = self.call("/uploads", {"name": "deleted.txt", "size": 8}, "POST")
        path = "/uploads/" + record["id"]
        pending = self.start_partial_upload(path)
        owner = self.service.store.list(kind="upload")[0][0]
        self.assertEqual(self.call(path, method="DELETE"), {"deleted": True})
        pending.send(b" data")
        with pending.getresponse() as response:
            self.assertEqual(response.status, 404)
        self.assertFalse(self.service.store.folder(owner, record["id"]).exists())

    def test_job_verification_allows_health_and_rechecks_deleted_input(self):
        from processor.engine import detect

        upload = self.upload()
        path = "/uploads/" + upload["id"]
        verified = threading.Event()
        release = threading.Event()

        def pause_verification(source):
            format_name = detect(source)
            verified.set()
            if not release.wait(10):
                raise TimeoutError("Test did not release verification")
            return format_name

        with (patch("processor.server.detect", side_effect=pause_verification),
              ThreadPoolExecutor(max_workers=1) as executor):
            pending = executor.submit(self.job, upload)
            try:
                self.assertTrue(verified.wait(5))
                with closing(HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)) as client:
                    client.request("GET", "/api/process/health")
                    with client.getresponse() as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(json.load(response)["activeJobs"], 0)
                self.assertEqual(self.call(path, method="DELETE"), {"deleted": True})
            finally:
                release.set()
            self.assert_status(410, lambda: pending.result(timeout=5))
        self.assertEqual(self.call("/jobs")["total"], 0)

    def test_retry_cannot_bypass_queue_capacity(self):
        job = self.job()
        owner = self.service.store.list()[0][0]
        self.service.store.patch(owner, "job", job["id"], state="failed", error="Original failure")
        for index in range(100):
            self.service.store.put(owner, "job", {"id": f"{index:032x}", "created": time.time(), "state": "paused"})
        self.assert_status(429, lambda: self.call("/jobs/" + job["id"] + "/retry", method="POST"))
        record = self.service.store.get(owner, "job", job["id"])
        self.assertEqual(record["state"], "failed")
        self.assertEqual(record["error"], "Original failure")

    def test_health_identifies_live_instance_without_file_metadata(self):
        first = self.call("/health")
        second = self.call("/health")
        self.assertEqual(first["instance"], second["instance"])
        self.assertEqual(first["pid"], os.getpid())
        self.assertEqual(first["activeJobs"], 0)
        self.assertEqual(first["processing"], "local")
        self.assertRegex(first["revision"], r"^[0-9a-f]{64}(:[0-9a-f]{64})+$")
        self.assertNotIn(str(self.service.store.root), json.dumps(first))
        self.assertNotIn("files", first)

    def test_readiness_reports_scheduler_and_configured_web_build_without_session(self):
        ready = self.base + '/ready'
        with self.assertRaises(HTTPError) as waiting:
            self.client.open(ready)
        with waiting.exception as response:
            self.assertEqual(response.code, 503)
            self.assertEqual(json.load(response), {'ready': False, 'reason': 'scheduler'})
            self.assertIsNone(response.headers.get('Set-Cookie'))

        worker = threading.Thread(target=self.service.loop)
        worker.start()
        try:
            deadline = time.monotonic() + 10
            while self.service.last_scheduler_tick is None and time.monotonic() < deadline:
                time.sleep(.02)
            with self.client.open(ready) as response:
                self.assertEqual(json.load(response), {'ready': True})
                self.assertIsNone(response.headers.get('Set-Cookie'))
            self.service.web = Path(self.temp.name) / 'dist'
            self.service.web.mkdir()
            with self.assertRaises(HTTPError) as missing:
                self.client.open(ready)
            with missing.exception as response:
                self.assertEqual(response.code, 503)
                self.assertEqual(json.load(response), {'ready': False, 'reason': 'web-build'})
            (self.service.web / 'index.html').write_text('<main>Fixture</main>', encoding='utf-8')
            self.assertEqual(self.call('/ready'), {'ready': True})
            self.assert_status(403, lambda: self.call('/ready', headers={'Origin': 'https://example.invalid'}))
        finally:
            self.service.stop.set()
            worker.join(timeout=10)
        self.assertFalse(worker.is_alive())
        self.service.stop.clear()
        self.service.last_scheduler_tick = time.monotonic() - 31
        self.assert_status(503, lambda: self.call('/ready'))
        self.assertEqual(self.call('/health')['processing'], 'local')

    def test_resumable_chunks_real_job_hash_download_and_ranges(self):
        source = self.upload(b"Real content" * 100, split=True)
        job = self.execute(self.job(source))
        self.assertEqual(job["state"], "completed", job)
        self.assertTrue(job["downloadAvailable"])
        url = job["download"].removeprefix("/api/process")
        output = self.call(url, raw=True)
        self.assertEqual(hashlib.sha256(output).hexdigest(), job["sha256"])
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            self.assertEqual(archive.read(source["name"]), b"Real content" * 100)
        part = self.call(url, headers={"Range": "bytes=2-20"}, raw=True)
        self.assertEqual(part, output[2:21])
        manifest = self.call("/jobs/" + job["id"] + "/manifest")
        self.assertEqual(manifest["files"][0]["sha256"], hashlib.sha256(b"Real content" * 100).hexdigest())
        self.assertNotIn("inputs", job)
        self.assertNotIn("outputFile", job)
        self.assertNotIn(str(self.service.store.root), json.dumps(job))

    def test_standard_manifest_pages_match_verified_archive_and_respect_expiry(self):
        first = self.upload(b'first payload', 'first.txt')
        second = self.upload(b'second payload', 'second.txt')
        job = self.execute(self.call('/jobs', {'uploads': [first['id'], second['id']],
                                              'operation': 'compress', 'target': 'zip'}, 'POST'))
        self.assertEqual(job['state'], 'completed')
        self.assertEqual(job['manifestStorage'], 'paged')
        self.assertEqual(self.call('/jobs')['jobs'][0]['manifestStorage'], 'paged')
        path = '/jobs/' + job['id'] + '/manifest'
        full = self.call(path)
        page = self.call(path + '?limit=1')
        self.assertEqual(page['total'], 2)
        self.assertEqual(page['sha256'], full['sha256'])
        self.assertEqual(page['files'], [{**full['files'][0], 'id': 1}])
        last = self.call(path + '?limit=1&after=' + page['nextCursor'])
        self.assertEqual(last['files'], [{**full['files'][1], 'id': 2}])
        self.assertIsNone(last['nextCursor'])
        self.assert_status(400, lambda: self.call(path + '?after=-1'))
        self.assert_status(400, lambda: self.call(path + '?after=9223372036854775807'))
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call(path + '?limit=1', client=stranger))
        owner = self.service.store.list(kind='job')[0][0]
        stored = self.service.store.get(owner, 'job', job['id'])
        self.assertNotIn('manifest', stored)
        self.assertEqual(stored['manifestCount'], 2)
        self.service.store.patch(owner, 'job', job['id'], fileExpires=0)
        self.assert_status(410, lambda: self.call(path + '?limit=1'))
        self.service.cleanup()
        self.assertEqual(self.service.store.full_paged_manifest(owner, job['id']), [])

    def test_existing_inline_manifest_keeps_its_full_and_paged_responses(self):
        job = self.job()
        owner = self.service.store.list(kind='job')[0][0]
        manifest = [{'name': 'older.txt', 'size': 3, 'sha256': hashlib.sha256(b'old').hexdigest()}]
        self.service.store.patch(owner, 'job', job['id'], state='completed',
                                 downloadAvailable=True, manifest=manifest)
        path = '/jobs/' + job['id'] + '/manifest'
        self.assertEqual(self.call('/jobs')['jobs'][0]['manifestStorage'], 'inline')
        self.assertEqual(self.call(path)['files'], manifest)
        self.assertEqual(self.call(path + '?limit=1')['files'], [{**manifest[0], 'id': 1}])

    def test_cancelled_job_cannot_publish_manifest_rows(self):
        job = self.job()
        owner = self.service.store.list(kind='job')[0][0]
        self.call('/jobs/' + job['id'] + '/cancel', {}, 'POST')
        record = self.service.store.patch(owner, 'job', job['id'], expected_states=('verifying',),
                                          state='completed', manifest_entries=[{'name': 'late.txt'}])
        self.assertEqual(record['state'], 'cancelled')
        self.assertEqual(self.service.store.full_paged_manifest(owner, job['id']), [])

    def test_paged_job_selection_submits_a_verified_archive_and_fences_replays(self):
        first = self.upload(b'first', 'first.txt')
        owner = self.service.store.list(kind='upload')[0][0]
        uploads = [first['id']]
        names = ['first.txt']
        for number in range(1, 201):
            upload = f'{number:032x}'
            name = f'input-{number}.txt'
            folder = self.service.store.folder(owner, upload)
            folder.mkdir(parents=True)
            (folder / 'input').write_bytes(name.encode())
            self.service.store.put(owner, 'upload', {'id': upload, 'created': time.time(),
                'name': name, 'size': len(name), 'directory': False, 'expires': time.time() + 300})
            uploads.append(upload)
            names.append(name)

        selection = 'd' * 32
        path = '/job-selections/' + selection
        request = {'selectionId': selection, 'selectionCount': len(uploads),
                   'operation': 'compress', 'target': 'zip', 'requestId': 'e' * 64}
        first_page = {'offset': 0, 'uploads': uploads[:100]}
        self.assertEqual(self.call(path, first_page, 'PUT')['offset'], 100)
        self.assertEqual(self.call(path, first_page, 'PUT')['offset'], 100)
        self.assert_status(409, lambda: self.call('/jobs', request, 'POST'))
        self.assert_status(409, lambda: self.call(path, {'offset': 100, 'uploads': [uploads[0]]}, 'PUT'))
        self.assertEqual(self.call(path, {'offset': 100, 'uploads': uploads[100:200]}, 'PUT')['offset'], 200)
        self.assertEqual(self.call(path, {'offset': 200, 'uploads': uploads[200:]}, 'PUT')['offset'], 201)
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call('/jobs', request, 'POST', client=stranger))

        with patch.object(self.service.store, 'get_uploads', wraps=self.service.store.get_uploads) as reads:
            job = self.call('/jobs', request, 'POST')
        self.assertEqual([len(call.args[1]) for call in reads.call_args_list], [100, 100, 1])
        self.assertEqual(job['inputMode'], 'upload-pages')
        self.assertEqual(self.call('/jobs', request, 'POST')['id'], job['id'])
        self.assert_status(409, lambda: self.call(path, {'offset': 201, 'uploads': ['f' * 32]}, 'PUT'))
        self.assertEqual(self.call('/jobs')['total'], 1)
        completed = self.execute(job)
        self.assertEqual(completed['state'], 'completed')
        output = self.call(completed['download'].removeprefix('/api/process'), raw=True)
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            self.assertEqual(archive.namelist(), names)
            self.assertEqual(archive.read('first.txt'), b'first')
            self.assertTrue(all(archive.read(name) == name.encode() for name in names[1:]))
            manifest_path = '/jobs/' + job['id'] + '/manifest'
            for after in (0, 100, 200):
                page = self.call(f'{manifest_path}?limit=100&after={after}')
                expected = names[after:after + 100]
                self.assertEqual(page['total'], len(names))
                self.assertEqual([row['id'] for row in page['files']],
                                 list(range(after + 1, after + 1 + len(expected))))
                self.assertEqual([(row['name'], row['sha256']) for row in page['files']],
                                 [(name, hashlib.sha256(archive.read(name)).hexdigest()) for name in expected])
                self.assertEqual(page['nextCursor'], str(after + 100) if after < 200 else None)

        with self.service.store.connect() as db:
            db.execute('UPDATE job_selections SET expires=0 WHERE owner=? AND id=?', (owner, selection))
        self.assert_status(410, lambda: self.call('/jobs', request, 'POST'))
        self.service.job_selections.cleanup()
        with self.service.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM job_selection_items').fetchone()[0], 0)

    def test_staged_recovery_matches_existing_request_identity_and_rechecks_file_changes(self):
        first = self.upload(b'abc', 'first.txt')
        owner = self.service.store.list(kind='upload')[0][0]
        uploads = [first['id']]
        for number in range(1, 101):
            upload = f'{number:032x}'
            folder = self.service.store.folder(owner, upload)
            folder.mkdir(parents=True)
            (folder / 'input').write_bytes(b'abc')
            self.service.store.put(owner, 'upload', {'id': upload, 'created': time.time(),
                'name': f'input-{number}.txt', 'size': 3, 'directory': False, 'expires': time.time() + 300})
            uploads.append(upload)
        project = 'default'
        self.call('/projects/' + project, {'revision': 0}, 'PUT')
        selection = 'b' * 32
        path = '/job-selections/' + selection
        ordered = list(reversed(uploads))
        for offset in (0, 100):
            self.call(path, {'offset': offset, 'uploads': ordered[offset:offset + 100]}, 'PUT')
        request = {'selectionId': selection, 'selectionCount': len(uploads), 'operation': 'compress',
                   'target': 'zip', 'zipProfile': 'maximum', 'zipComment': 'test', 'recoverable': True}
        source = self.service.store.folder(owner, first['id']) / 'input'
        from processor.job_selections import AdmissionInputs
        check = AdmissionInputs.check_files

        def changed_file(admission, store, upload_owner):
            source.write_bytes(b'xyz')
            changed = source.stat()
            os.utime(source, ns=(changed.st_atime_ns, changed.st_mtime_ns + 2_000_000_000))
            return check(admission, store, upload_owner)

        with patch.object(AdmissionInputs, 'check_files', changed_file):
            self.assert_status(409, lambda: self.call('/jobs', request, 'POST'))
        self.assertEqual(self.call('/jobs')['total'], 0)
        self.assertNotIn('sha256', self.service.store.get(owner, 'upload', first['id']))
        with self.service.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM job_input_pages').fetchone()[0], 0)
            db.execute("INSERT INTO project_inputs VALUES (?,?,?,?,?)",
                       (owner, project, 'a' * 32, first['id'], time.time()))
            db.execute("""CREATE TRIGGER reject_last_input BEFORE INSERT ON job_input_pages
                          WHEN NEW.position=100 BEGIN SELECT RAISE(ABORT, 'injected failure'); END""")

        self.assert_status(500, lambda: self.call('/jobs', request, 'POST'))
        self.assertEqual(self.call('/jobs')['total'], 0)
        self.assertNotIn('sha256', self.service.store.get(owner, 'upload', first['id']))
        with self.service.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM job_input_pages').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM job_inputs').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM project_inputs WHERE owner=?', (owner,)).fetchone()[0], 1)
            db.execute('DROP TRIGGER reject_last_input')

        job = self.call('/jobs', request, 'POST')
        identity = ['project-recovery-v1', project, sorted(uploads), 'compress', 'zip', False,
                    'lossless', 'strip', 'maximum', ['zipComment', 'test']]
        request_id = hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()
        expected_job = hashlib.sha256((owner + request_id).encode()).hexdigest()[:32]
        self.assertEqual(job['id'], expected_job)
        inline = {key: value for key, value in request.items() if key not in ('selectionId', 'selectionCount')}
        self.assertEqual(self.call('/jobs', {**inline, 'uploads': uploads}, 'POST')['id'], expected_job)
        self.assertEqual(self.call('/jobs', request, 'POST')['id'], expected_job)
        with self.service.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM project_inputs WHERE owner=?', (owner,)).fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM job_input_pages').fetchone()[0], 101)

    def test_batch_admission_keeps_other_requests_responsive_during_hashing(self):
        from processor.server import file_digest

        files = {'first.txt': b'first payload'}
        first = self.upload(files['first.txt'], 'first.txt')
        owner = self.service.store.list(kind='upload')[0][0]
        uploads = [first['id']]
        for index in range(1, 256):
            upload_id = f'{index:032x}'
            name = f'file-{index}.txt'
            payload = files[name] = f'payload {index}'.encode()
            folder = self.service.store.folder(owner, upload_id)
            folder.mkdir(parents=True)
            (folder / 'input').write_bytes(payload)
            self.service.store.put(owner, 'upload', {
                'id': upload_id, 'name': name, 'size': len(payload), 'created': time.time(),
                'expires': time.time() + 60, 'directory': False,
            })
            uploads.append(upload_id)

        hashing, release = threading.Event(), threading.Event()

        def gated_digest(path, context):
            if path.parent.name == first['id']:
                hashing.set()
                if not release.wait(15):
                    raise AssertionError('Admission did not release its shared lock')
            return file_digest(path, context)

        with patch('processor.server.file_digest', side_effect=gated_digest), ThreadPoolExecutor(2) as pool:
            admission = pool.submit(self.call, '/jobs',
                                    {'uploads': uploads, 'operation': 'compress', 'target': 'zip'}, 'POST')
            try:
                self.assertTrue(hashing.wait(10))
                history = pool.submit(self.call, '/jobs')
                self.assertEqual(history.result(timeout=5)['total'], 0)
            finally:
                release.set()
            job = admission.result(timeout=20)

        self.assertEqual(job['fileCount'], len(files))
        record = self.service.store.get(owner, 'job', job['id'])
        self.assertEqual(record['inputMode'], 'upload-pages')
        self.assertNotIn('inputs', record)
        self.assertEqual([item['id'] for item in self.service.store.iter_job_inputs(owner, record)], uploads)
        completed = self.execute(job)
        self.assertEqual(completed['state'], 'completed')
        output = self.call(completed['download'].removeprefix('/api/process'), raw=True)
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            self.assertEqual(archive.namelist(), list(files))
            for name, payload in files.items():
                self.assertEqual(archive.read(name), payload)

        tar_job = self.call('/jobs', {'uploads': uploads, 'operation': 'compress', 'target': 'tar.gz'}, 'POST')
        self.assertEqual(tar_job['inputMode'], 'upload-pages')
        completed_tar = self.execute(tar_job)
        self.assertEqual(completed_tar['state'], 'completed')
        output = self.call(completed_tar['download'].removeprefix('/api/process'), raw=True)
        with tarfile.open(fileobj=io.BytesIO(output), mode='r:gz') as archive:
            self.assertEqual(archive.getnames(), list(files))
            for name, payload in files.items():
                with archive.extractfile(name) as member:
                    self.assertEqual(member.read(), payload)

    def test_batch_admission_rechecks_an_upload_deleted_after_hashing(self):
        from processor.server import detect

        upload = self.upload()
        hashing, release = threading.Event(), threading.Event()

        # Pause after both hash and format reads so the commit must recheck storage.
        def gated_detect(path):
            format_hint = detect(path)
            hashing.set()
            if not release.wait(15):
                raise AssertionError('Upload could not be deleted during admission')
            return format_hint

        with patch('processor.server.detect', side_effect=gated_detect), ThreadPoolExecutor(2) as pool:
            admission = pool.submit(self.job, upload)
            try:
                self.assertTrue(hashing.wait(10))
                delete = pool.submit(self.call, '/uploads/' + upload['id'], method='DELETE')
                self.assertTrue(delete.result(timeout=5)['deleted'])
            finally:
                release.set()
            self.assert_status(410, lambda: admission.result(timeout=15))
        self.assertEqual(self.call('/jobs')['total'], 0)

    def test_batch_admission_rejects_same_size_changes_after_hashing(self):
        from processor.server import detect

        upload = self.upload(b"old bytes", "example.txt")
        owner = self.service.store.list(kind="upload")[0][0]

        def replace_after_detection(path):
            format_hint = detect(path)
            original = path.stat()
            path.write_bytes(b"new bytes")
            os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns + 2_000_000_000))
            return format_hint

        with patch("processor.server.detect", side_effect=replace_after_detection):
            self.assert_status(409, lambda: self.job(upload))
        self.assertEqual(self.call("/jobs")["total"], 0)
        self.assertNotIn("sha256", self.service.store.get(owner, "upload", upload["id"]))

        retried = self.job(upload)
        saved = self.service.store.get(owner, "upload", upload["id"])
        self.assertEqual(saved["sha256"], hashlib.sha256(b"new bytes").hexdigest())
        self.assertEqual(self.execute(retried)["state"], "completed")

    def test_listener_starts_without_reverse_dns(self):
        with patch("socket.getfqdn", side_effect=AssertionError("unexpected reverse DNS")):
            with LocalHTTPServer(("127.0.0.1", 0), handler(self.service)) as listener:
                self.assertEqual(listener.server_name, "127.0.0.1")
                self.assertGreater(listener.server_port, 0)

    def test_office_report_detects_package_type_and_rejects_active_xml(self):
        from processor.documents import CONTENT_TYPES, RELATIONSHIPS

        def document(main, content, declaration=''):
            package = io.BytesIO()
            with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('_rels/.rels',
                                 f'{declaration}<Relationships xmlns="{RELATIONSHIPS}">'
                                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                                 f'Target="{main}"/></Relationships>')
                archive.writestr('[Content_Types].xml',
                                 f'<Types xmlns="{CONTENT_TYPES}"><Override PartName="/{main}" '
                                 f'ContentType="application/vnd.openxmlformats-officedocument.{content}.main+xml"/></Types>')
                archive.writestr(main, '<document/>')
                if main == 'xl/workbook.xml':
                    archive.writestr('xl/worksheets/sheet1.xml', '<worksheet/>')
                if main == 'ppt/presentation.xml':
                    archive.writestr('ppt/slides/slide1.xml', '<slide/>')
            return package.getvalue()

        source = self.upload(document('xl/workbook.xml', 'spreadsheetml.sheet'), 'misnamed.docx')
        result = self.execute(self.job(source, operation='inspect', target='json'))
        self.assertEqual(result['state'], 'completed', result)
        report = json.loads(self.call(result['download'].removeprefix('/api/process'), raw=True))
        self.assertEqual(report, {'format': 'xlsx', 'scope': 'package-metadata', 'packageEntries': 4,
                                  'mainPart': 'xl/workbook.xml', 'hasVbaProjectPart': False, 'worksheetParts': 1})
        for kind, main, content in (
            ('docx', 'word/document.xml', 'wordprocessingml.document'),
            ('pptx', 'ppt/presentation.xml', 'presentationml.presentation'),
        ):
            with self.subTest(kind=kind):
                source = self.upload(document(main, content), 'sample.' + kind)
                result = self.execute(self.job(source, operation='inspect', target='json'))
                self.assertEqual(result['state'], 'completed', result)
                report = json.loads(self.call(result['download'].removeprefix('/api/process'), raw=True))
                self.assertEqual((report['format'], report['mainPart']), (kind, main))
                if kind == 'pptx':
                    self.assertEqual(report['slideParts'], 1)

        hostile = '<!DOCTYPE Relationships [<!ENTITY local SYSTEM "file:///private">]>'
        source = self.upload(document('word/document.xml', 'wordprocessingml.document', hostile), 'hostile.docx')
        rejected = self.execute(self.job(source, operation='inspect', target='json'))
        self.assertEqual(rejected['state'], 'failed', rejected)
        self.assertFalse(rejected['downloadAvailable'])

    def test_zip_comment_is_validated_bound_to_the_job_and_downloaded(self):
        upload = self.upload(b"example", "entry.txt")
        for comment in (None, "x" * 1025, "newline\n", "世界"):
            self.assert_status(400, lambda: self.job(upload, zipComment=comment))
        self.assert_status(400, lambda: self.job(upload, target="tar", zipComment="label"))
        request_id = "c" * 64
        job = self.job(upload, zipComment="Release notes", requestId=request_id)
        self.assertEqual(self.job(upload, zipComment="Release notes", requestId=request_id)["id"], job["id"])
        self.assert_status(409, lambda: self.job(upload, zipComment="Different label", requestId=request_id))
        completed = self.execute(job)
        self.assertEqual(completed["state"], "completed", completed)
        data = self.call(completed["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(data).hexdigest(), completed["sha256"])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.comment, b"Release notes")
            self.assertEqual(archive.read("entry.txt"), b"example")

    def test_auto_zip_profile_stores_incompressible_sample_and_deflates_repeated_data(self):
        noise = random.Random(2027).randbytes(8192)
        repeated = b"sample" * 2000
        first = self.upload(noise, "noise.bin")
        second = self.upload(repeated, "repeated.txt")
        body = {"uploads": [first["id"], second["id"]], "operation": "compress", "target": "zip",
                "zipProfile": "auto", "requestId": "f" * 64}
        queued = self.call("/jobs", body, "POST")
        self.assert_status(409, lambda: self.call("/jobs", {**body, "zipProfile": "maximum"}, "POST"))
        self.assert_status(400, lambda: self.call("/jobs", {**body, "zipProfile": "unknown"}, "POST"))
        result = self.execute(queued)
        self.assertEqual(result["state"], "completed", result)
        data = self.call(result["download"].removeprefix("/api/process"), raw=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.getinfo("noise.bin").compress_type, zipfile.ZIP_STORED)
            self.assertEqual(archive.getinfo("repeated.txt").compress_type, zipfile.ZIP_DEFLATED)
            self.assertEqual(archive.read("noise.bin"), noise)
            self.assertEqual(archive.read("repeated.txt"), repeated)

    def test_tar_repack_produces_verified_deflate_zip(self):
        payload = b"compressible fixture\n" * 100
        source = io.BytesIO()
        with tarfile.open(fileobj=source, mode="w:gz") as archive:
            item = tarfile.TarInfo("folder/file.txt")
            item.size = len(payload)
            archive.addfile(item, io.BytesIO(payload))
        job = self.job(self.upload(source.getvalue(), "sample.tar.gz"), operation="extract", target="zip-deflate")
        result = self.execute(job)
        self.assertEqual(result["state"], "completed", result)
        self.assertEqual(result["outputName"], "sample.tar.repacked.zip")
        data = self.call(result["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(data).hexdigest(), result["sha256"])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.getinfo("folder/file.txt").compress_type, zipfile.ZIP_DEFLATED)
            self.assertEqual(archive.read("folder/file.txt"), payload)

    def test_selective_zip_extract_binds_selection_to_job_and_verifies_output(self):
        from processor.projects import DEFAULT_SETTINGS

        self.call("/projects/default", {"settings": DEFAULT_SETTINGS}, "PUT")
        source = io.BytesIO()
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("first.txt", b"ignore")
            archive.writestr("folder/second.txt", b"keep")
        upload = self.upload(source.getvalue(), "sample.zip")
        options = {"operation": "extract", "target": "zip", "recoverable": True}
        queued = self.job(upload, zipIndexes=[1], **options)
        self.assertEqual(self.job(upload, zipIndexes=[1], **options)["id"], queued["id"])
        other = self.job(upload, zipIndexes=[0], **options)
        self.assertNotEqual(other["id"], queued["id"])
        self.assert_status(400, lambda: self.job(upload, zipIndexes=[True], **options))
        self.assert_status(400, lambda: self.job(upload, zipIndexes=[1, 1], **options))
        self.assert_status(400, lambda: self.job(upload, zipIndexes=[1], recursive=True, **options))
        result = self.execute(queued)
        self.assertEqual(result["state"], "completed", result)
        data = self.call(result["download"].removeprefix("/api/process"), raw=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.namelist(), ["folder/second.txt"])
            self.assertEqual(archive.read("folder/second.txt"), b"keep")
        missing = self.execute(self.job(upload, zipIndexes=[2], **options))
        self.assertEqual(missing["state"], "failed", missing)
        self.assertFalse(missing["downloadAvailable"])

    def test_zip_integrity_job_reports_hashes_and_withholds_failed_reports(self):
        payload = b"integrity fixture"
        source = io.BytesIO()
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("file.txt", payload)
            archive.writestr("deflated.txt", payload, compress_type=zipfile.ZIP_DEFLATED)
        valid = source.getvalue()
        job = self.execute(self.job(self.upload(valid, "sample.zip"), operation="verify", target="json"))
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(job["outputName"], "sample.verification.json")
        report_bytes = self.call(job["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(report_bytes).hexdigest(), job["sha256"])
        report = json.loads(report_bytes)
        self.assertTrue(report["verified"])
        self.assertEqual(report["entries"], [
            {"name": name, "directory": False, "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
            for name in ("file.txt", "deflated.txt")
        ])

        damaged = valid.replace(payload, b"!" * len(payload), 1)
        failed = self.execute(self.job(self.upload(damaged, "damaged.zip"), operation="verify", target="json"))
        self.assertEqual(failed["state"], "failed", failed)
        self.assertEqual(failed["errorInfo"]["category"], "corrupt_file")
        self.assertFalse(failed["downloadAvailable"])
        self.assertFalse(failed.get("download"))

    def test_stream_integrity_reports_decoded_hashes_and_checks_trailers(self):
        import bz2
        import gzip
        import lzma

        payload = bytes(range(256)) * 4
        self.assertTrue(self.call('/capabilities')['streamVerification'])
        for kind, extension, encode in (('gzip', 'gz', gzip.compress),
                                         ('bzip2', 'bz2', bz2.compress),
                                         ('xz', 'xz', lzma.compress)):
            with self.subTest(kind=kind):
                encoded = encode(payload)
                upload = self.upload(encoded, f'payload.bin.{extension}')
                job = self.execute(self.job(upload, operation='verify', target='json'))
                self.assertEqual(job['state'], 'completed', job)
                report = self.call(job['download'].removeprefix('/api/process'))
                self.assertEqual(report, {'format': kind, 'verified': True,
                    'scope': 'decoded-stream-and-observed-digest',
                    'entries': [{'name': 'payload.bin', 'directory': False, 'size': len(payload),
                                 'sha256': hashlib.sha256(payload).hexdigest()}]})
                upload = self.upload(encoded[:-6], f'truncated.bin.{extension}')
                job = self.execute(self.job(upload, operation='verify', target='json'))
                self.assertEqual(job['state'], 'failed', job)
                self.assertFalse(job['downloadAvailable'])

        upload = self.upload(gzip.compress(payload), 'not-a-tar.tar.gz')
        job = self.execute(self.job(upload, operation='verify', target='json'))
        self.assertEqual(job['state'], 'failed', job)
        self.assertFalse(job['downloadAvailable'])

        expanded = 4 * 1024 * 1024
        encoded = gzip.compress(b'0' * expanded)
        self.assertGreater(expanded, len(encoded) * LIMITS['ratio'])
        compressed = self.upload(encoded, 'expansion.gz')
        rejected = self.execute(self.job(compressed, operation='verify', target='json'))
        self.assertEqual(rejected['state'], 'failed', rejected)
        self.assertEqual(rejected['errorInfo']['category'], 'resource_limit')
        self.assertFalse(rejected['downloadAvailable'])

    def test_split_and_join_restore_exact_file_and_reject_damaged_parts(self):
        source_bytes = random.Random(123).randbytes(2 * 1024**2 + 7)
        source = self.upload(source_bytes, 'nested/data.bin')
        request = {'uploads': [source['id']], 'operation': 'split', 'target': 'zip',
                   'partMiB': 1, 'requestId': 'a' * 64}
        self.assertIn(1, self.call('/capabilities')['filePartSizesMiB'])
        self.assert_status(400, lambda: self.call('/jobs', {**request, 'partMiB': True}, 'POST'))
        queued = self.call('/jobs', request, 'POST')
        self.assertEqual(self.call('/jobs', request, 'POST')['id'], queued['id'])
        self.assert_status(409, lambda: self.call('/jobs', {**request, 'partMiB': 8}, 'POST'))
        split = self.execute(queued)
        self.assertEqual(split['state'], 'completed', split)
        self.assertEqual(split['outputName'], 'data.bin.parts.zip')
        package = self.call(split['download'].removeprefix('/api/process'), raw=True)
        damaged = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(package)) as parts, zipfile.ZipFile(damaged, 'w') as broken:
            names = ['parts/000001.part', 'parts/000002.part', 'parts/000003.part']
            self.assertEqual(parts.namelist(), [*names, 'hamma-parts.json'])
            self.assertEqual(b''.join(parts.read(name) for name in names), source_bytes)
            for name in parts.namelist():
                content = parts.read(name)
                if name == names[-1]:
                    content = bytes([content[0] ^ 1]) + content[1:]
                broken.writestr(name, content)

        for data, state in ((package, 'completed'), (damaged.getvalue(), 'failed')):
            with self.subTest(state=state):
                upload = self.upload(data, split['outputName'])
                job = self.execute(self.job(upload, operation='join', target='file'))
                self.assertEqual(job['state'], state, job)
                if state == 'completed':
                    self.assertEqual(job['outputName'], 'data.bin')
                    restored = self.call(job['download'].removeprefix('/api/process'), raw=True)
                    self.assertEqual(restored, source_bytes)
                else:
                    self.assertFalse(job['downloadAvailable'])

    def test_pdf_pages_render_in_order_and_reject_invalid_input(self):
        from processor.pdf_pages import pdf_tools
        from processor.tests.pdf_fixture import two_page_pdf
        import zlib

        if not all(pdf_tools()):
            self.skipTest("Poppler is unavailable")
        self.assertTrue(self.call('/capabilities')['pdfPages'])
        queued = self.job(self.upload(two_page_pdf(), 'example.pdf'), operation='convert', target='pdf-pages')
        job = self.execute(queued)
        self.assertEqual(job['state'], 'completed', job)
        self.assertEqual(job['outputName'], 'example.pages.zip')
        data = self.call(job['download'].removeprefix('/api/process'), raw=True)
        manifest = self.call('/jobs/' + job['id'] + '/manifest?limit=2')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(archive.namelist(), ['page-001.png', 'page-002.png'])
            expected_pages = [((1024, 2048), b'\xff\x00\x00'), ((2048, 1024), b'\x00\x00\xff')]
            for entry, (expected, pixel) in zip(manifest['files'], expected_pages, strict=True):
                page = archive.read(entry['name'])
                self.assertEqual(tuple(int.from_bytes(page[offset:offset + 4], 'big') for offset in (16, 20)), expected)
                self.assertEqual(entry['sha256'], hashlib.sha256(page).hexdigest())
                self.assertEqual(page[24:26], b'\x08\x02')  # Eight-bit RGB.
                position = 8
                compressed = bytearray()
                while position < len(page):
                    length = int.from_bytes(page[position:position + 4], 'big')
                    if page[position + 4:position + 8] == b'IDAT':
                        compressed.extend(page[position + 8:position + 8 + length])
                    position += length + 12
                # The first pixel has no neighboring bytes for PNG filters.
                self.assertEqual(zlib.decompress(compressed)[1:4], pixel)
        for source in (b'%PDF-1.4\n', b'plain text'):
            bad = self.execute(self.job(self.upload(source, 'invalid.pdf'), operation='convert', target='pdf-pages'))
            self.assertEqual(bad['state'], 'failed', bad)
            self.assertFalse(bad['downloadAvailable'])

    def test_tar_integrity_job_supports_compressed_tar_and_withholds_invalid_reports(self):
        payload = b"member contents"

        def fixture(mode, name="folder/entry.txt"):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode=mode) as archive:
                info = tarfile.TarInfo(name)
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            return data.getvalue()

        for extension, mode in (("tar", "w"), ("tar.gz", "w:gz"), ("tar.bz2", "w:bz2"), ("tar.xz", "w:xz")):
            with self.subTest(format=extension):
                source = self.upload(fixture(mode), f"example.{extension}")
                job = self.execute(self.job(source, operation="verify", target="json"))
                self.assertEqual(job["state"], "completed", job)
                data = self.call(job["download"].removeprefix("/api/process"), raw=True)
                self.assertEqual(hashlib.sha256(data).hexdigest(), job["sha256"])
                report = json.loads(data)
                self.assertEqual(report, {
                    "format": extension, "verified": True, "scope": "structure-and-observed-member-digests",
                    "entries": [{"name": "folder/entry.txt", "directory": False, "size": len(payload),
                                 "sha256": hashlib.sha256(payload).hexdigest()}],
                })
        damaged = bytearray(fixture("w:gz"))
        damaged[-8] ^= 1
        for data, name in ((bytes(damaged), "damaged.tar.gz"), (fixture("w", "../escape"), "unsafe.tar")):
            with self.subTest(name=name):
                job = self.execute(self.job(self.upload(data, name), operation="verify", target="json"))
                self.assertEqual(job["state"], "failed", job)
                self.assertFalse(job["downloadAvailable"])
                self.assertNotIn("download", job)

    def test_user_isolation_for_jobs_uploads_and_signed_downloads(self):
        source = self.upload()
        job = self.execute(self.job(source))
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assertEqual(self.call("/jobs", client=other)["total"], 0)
        self.assert_status(404, lambda: self.call("/jobs/" + job["id"], client=other))
        self.assert_status(404, lambda: self.call("/uploads/" + source["id"], client=other))
        self.assert_status(404, lambda: self.call(job["download"].removeprefix("/api/process"), client=other, raw=True))
        self.assert_status(403, lambda: self.call(job["download"].removeprefix("/api/process") + "tampered", raw=True))

    def test_retention_settings_are_independent_between_sessions(self):
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call("/settings", {"historyRetention": "never", "fileRetention": "7d"}, "PUT")
        self.call("/settings", {"historyRetention": "24h", "fileRetention": "30d"}, "PUT", client=other)
        self.assertEqual(self.call("/settings")["historyRetention"], "never")
        self.assertEqual(self.call("/settings", client=other)["historyRetention"], "24h")

    def test_automatic_history_expiry_keeps_unexpired_files_accessible(self):
        job = self.execute(self.job())
        owner = self.service.store.list()[0][0]
        self.service.store.patch(owner, "job", job["id"], historyExpires=time.time() - 1)
        self.service.cleanup()
        self.assertEqual(self.call("/jobs")["total"], 0)
        self.assertTrue(self.call("/jobs/" + job["id"])["downloadAvailable"])

    def test_csrf_dns_rebinding_and_upload_size_guards(self):
        self.assert_status(403, lambda: self.call("/settings", {"fileRetention": "24h", "historyRetention": "7d"}, "PUT", {"Origin": "https://untrusted.example"}))
        self.assert_status(403, lambda: self.call("/capabilities", headers={"Host": "untrusted.example"}))
        self.assert_status(403, lambda: self.call("/uploads", {}, "POST", {"X-Hamma-Request": ""}))
        self.assert_status(413, lambda: self.call("/uploads", {"name": "large", "size": LIMITS["input"] + 1}, "POST"))
        self.assert_status(400, lambda: self.call("/uploads", {"name": "../escape", "size": 0}, "POST"))

    def test_offset_conflict_and_finalized_inputs_are_immutable(self):
        source = self.upload()
        self.assert_status(409, lambda: self.call("/uploads/" + source["id"], b"x", "PUT", {"Upload-Offset": "0"}, raw=True))
        self.job(source)
        self.assert_status(409, lambda: self.call("/uploads/" + source["id"], b"", "PUT", {"Upload-Offset": str(source["size"])}, raw=True))

    def test_cancel_pause_resume_retry_states_and_failed_outputs(self):
        job = self.job()
        prefix = "/jobs/" + job["id"]
        self.assertEqual(self.call(prefix + "/pause", {}, "POST")["state"], "paused")
        self.assertEqual(self.call(prefix + "/resume", {}, "POST")["state"], "queued")
        self.assertEqual(self.call(prefix + "/cancel", {}, "POST")["state"], "cancelled")
        self.assertEqual(self.call(prefix + "/retry", {}, "POST")["state"], "queued")
        completed = self.execute(job)
        self.assertEqual(completed["state"], "completed")
        self.assert_status(409, lambda: self.call(prefix + "/cancel", {}, "POST"))
        invalid = self.job(self.upload(b"not a real archive", "bad.zip"), operation="extract")
        failed = self.execute(invalid)
        self.assertEqual(failed["state"], "failed")
        self.assertFalse(failed["downloadAvailable"])
        self.assertNotIn("download", failed)

    def test_history_and_files_have_separate_deletion_and_expiration(self):
        source = self.upload()
        job = self.execute(self.job(source))
        prefix = "/jobs/" + job["id"]
        self.call(prefix, method="DELETE")
        self.assertEqual(self.call("/jobs")["total"], 0)
        self.assertTrue(self.call(prefix)["downloadAvailable"])
        self.call(prefix + "/files", method="DELETE")
        self.assertFalse(self.call(prefix)["downloadAvailable"])
        self.assert_status(404, lambda: self.call("/uploads/" + source["id"]))
        self.assert_status(410, lambda: self.call(job["download"].removeprefix("/api/process"), raw=True))
        second = self.execute(self.job(self.upload(name="other.txt")))
        owner = self.service.store.list()[0][0]
        self.service.store.patch(owner, "job", second["id"], fileExpires=time.time() - 1)
        self.service.cleanup()
        self.assertFalse(self.call("/jobs/" + second["id"])["downloadAvailable"])
        self.assertEqual(self.call("/jobs")["total"], 1)

    def test_search_pagination_retention_and_restart_recovery(self):
        self.call("/settings", {"historyRetention": "never", "fileRetention": "7d"}, "PUT")
        job = self.job(self.upload(name="searchable.txt"))
        self.assertIsNone(job["historyExpires"])
        self.assertGreater(job["fileExpires"], time.time() + 6 * 86400)
        self.assertEqual(self.call("/jobs?q=searchable&limit=1")["total"], 1)
        self.assertEqual(self.call("/jobs?offset=1")["jobs"], [])
        owner = self.service.store.list()[0][0]
        self.service.store.patch(owner, "job", job["id"], state="processing")
        self.service.close()
        restarted = Service(self.temp.name, limits=LIMITS)
        try:
            self.assertEqual(restarted.store.get(owner, "job", job["id"])["state"], "interrupted")
        finally:
            restarted.close()

    def test_idempotent_queue_requests_do_not_duplicate_work(self):
        upload = self.upload()
        first = self.job(upload, requestId="a" * 64)
        second = self.job(upload, requestId="a" * 64)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(self.call("/jobs")["total"], 1)
        self.assert_status(409, lambda: self.job(upload, requestId="a" * 64, target="tar"))

    def test_worker_start_failure_does_not_strand_jobs_or_stop_queue(self):
        jobs = [self.job(), self.job()]
        with (self.assertLogs("hamma.processor", level="ERROR"),
              patch("processor.server.available_memory", return_value=None),
              patch("processor.server.multiprocessing.get_context") as spawn):
            spawn.return_value.Process.return_value.start.side_effect = OSError("private host detail")
            self.service.tick()
        self.assertEqual(spawn.call_count, 2)
        self.assertFalse(self.service.running)
        for job in jobs:
            current = self.call("/jobs/" + job["id"])
            self.assertEqual(current["state"], "interrupted")
            self.assertIn("retry", current["error"])
            self.assertNotIn("private host detail", current["error"])
            self.assertIsNotNone(current["finished"])
            self.assertFalse(current["downloadAvailable"])
        retried = self.call("/jobs/" + jobs[0]["id"] + "/retry", method="POST")
        self.assertEqual(retried["state"], "queued")
        self.assertIsNone(retried["finished"])
        self.assertIsNone(retried["started"])
        self.assertEqual(self.execute(retried)["state"], "completed")

    def test_archive_worker_crash_requeues_once_and_removes_partial_output(self):
        job = self.job()
        owner = self.service.store.list()[0][0]
        output = self.service.store.folder(owner, job["id"]) / "output.zip"
        for attempt, expected in enumerate(("queued", "interrupted")):
            with self.subTest(attempt=attempt):
                self.service.store.patch(owner, "job", job["id"], state="verifying", processed=5)
                output.write_bytes(b"partial")
                process = Mock(exitcode=1)
                process.is_alive.return_value = False
                self.service.running[job["id"]] = (process, owner, time.monotonic())
                with patch("processor.server.worker_capacity", return_value=0):
                    self.service.tick()
                current = self.call("/jobs/" + job["id"])
                self.assertEqual(current["state"], expected)
                self.assertEqual(current["crashRetries"], 1)
                self.assertFalse(current["downloadAvailable"])
                self.assertFalse(output.exists())
                process.close.assert_called_once()
                if attempt == 0:
                    self.assertEqual(current["processed"], 0)
                    self.assertIsNone(current["error"])
                else:
                    self.assertEqual(current["errorInfo"]["category"], "worker_interrupted")
        retried = self.call("/jobs/" + job["id"] + "/retry", method="POST")
        self.assertEqual(self.execute(retried)["state"], "completed")

    def test_late_cancellation_preserves_completed_output(self):
        job = self.job()
        owner = self.service.store.list()[0][0]
        marker = self.service.store.folder(owner, job["id"]) / "cancel"
        original = Path.touch

        def complete_before_cancel(path, *args, **kwargs):
            if path == marker:
                run_job(self.temp.name, owner, job["id"], LIMITS)
            return original(path, *args, **kwargs)

        with patch.object(Path, "touch", autospec=True, side_effect=complete_before_cancel):
            self.assert_status(409, lambda: self.call("/jobs/" + job["id"] + "/cancel", method="POST"))
        current = self.call("/jobs/" + job["id"])
        self.assertEqual(current["state"], "completed")
        data = self.call(current["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(data).hexdigest(), current["sha256"])

    def test_restart_cleans_incomplete_outputs_and_preserves_completed_and_queued_jobs(self):
        completed = self.execute(self.job())
        queued = self.job()
        owner = self.service.store.list()[0][0]
        incomplete = []
        for state in ("processing", "verifying", "failed", "cancelled", "interrupted"):
            job = self.job()
            self.service.store.patch(owner, "job", job["id"], state=state)
            directory = self.service.store.folder(owner, job["id"])
            (directory / "output.zip").write_bytes(b"partial")
            (directory / "expanded").mkdir()
            (directory / "expanded" / "private.txt").write_bytes(b"temporary")
            incomplete.append((job, state))
        self.service.close()
        self.service = Service(self.temp.name, limits=LIMITS)
        for job, state in incomplete:
            current = self.call("/jobs/" + job["id"])
            self.assertEqual(current["state"], "interrupted" if state in ("processing", "verifying") else state)
            self.assertFalse(current["downloadAvailable"])
            self.assertEqual(list(self.service.store.folder(owner, job["id"]).iterdir()), [])
        self.assertEqual(self.call("/jobs/" + queued["id"])["state"], "queued")
        current = self.call("/jobs/" + completed["id"])
        output = self.call(current["download"].removeprefix("/api/process"), raw=True)
        self.assertEqual(hashlib.sha256(output).hexdigest(), current["sha256"])

    def test_job_creation_rejects_missing_and_incomplete_uploads(self):
        missing = self.upload()
        owner = self.service.store.list(kind="upload")[0][0]
        (self.service.store.folder(owner, missing["id"]) / "input").unlink()
        self.assert_status(410, lambda: self.job(missing))
        incomplete = self.call("/uploads", {"name": "partial.txt", "size": 100}, "POST")
        self.assert_status(409, lambda: self.job(incomplete))
        self.assertEqual(self.call("/jobs")["total"], 0)

    def test_bulk_deletion_includes_hidden_records_and_orphan_uploads(self):
        job = self.execute(self.job())
        orphan = self.upload(name="orphan.txt")
        self.call("/history", method="DELETE")
        self.assertEqual(self.call("/jobs")["total"], 0)
        self.assertTrue(self.call("/jobs/" + job["id"])["downloadAvailable"])
        self.call("/files", method="DELETE")
        self.assertFalse(self.call("/jobs/" + job["id"])["downloadAvailable"])
        self.assert_status(404, lambda: self.call("/uploads/" + orphan["id"]))

    def test_actual_background_worker_process_completes_and_releases_slot(self):
        job = self.job()
        # Exercise both admission outcomes independently of host memory pressure.
        with patch('processor.server.available_memory', return_value=0):
            self.service.tick()
        self.assertEqual(self.call('/jobs/' + job['id'])['state'], 'queued')
        stalled = self.call('/jobs/live')
        self.assertTrue(stalled['waitingForMemory'])
        with patch('processor.server.available_memory', return_value=2 * 1024**3):
            self.service.tick()
        self.assertFalse(self.call('/jobs/live?revision=' + stalled['revision'])['waitingForMemory'])
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.service.tick()
            current = self.call("/jobs/" + job["id"])
            if current["state"] in ("completed", "failed", "interrupted"):
                break
            time.sleep(.1)
        self.assertEqual(current["state"], "completed", current)
        while self.service.running and time.monotonic() < deadline:
            self.service.tick()
            time.sleep(.1)
        self.assertFalse(self.service.running)

    def test_native_zstandard_jobs_use_existing_queue_downloads_and_extraction(self):
        from processor.native import capability
        if not capability():
            self.skipTest('SHANTE C++ engine has not been built')
        capabilities = self.call('/capabilities')
        self.assertIn('zstd', capabilities['archives'])
        self.assertEqual(capabilities['nativeEngine']['engine'], 'shante-core')
        self.assertFalse(capabilities['nativeEngine']['gpuAcceleration'])
        data = b'Native persistent queue fixture\n' * 500
        job = self.job(self.upload(data, 'original.txt'), target='zstd')
        # The admission test covers memory pressure separately.
        with patch('processor.server.available_memory', return_value=2 * 1024**3):
            self.service.tick()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            current = self.call('/jobs/' + job['id'])
            if current['state'] in ('completed', 'failed', 'interrupted'):
                break
            time.sleep(.1)
        self.assertEqual(current['state'], 'completed', current)
        self.assertEqual(current['outputName'], 'original.txt.zstd')
        packed = self.call(current['download'].removeprefix('/api/process'), raw=True)
        self.assertEqual(hashlib.sha256(packed).hexdigest(), current['sha256'])
        self.assertEqual(packed[:4], b'\x28\xb5\x2f\xfd')
        source = self.upload(packed, current['outputName'])
        verified = self.execute(self.job(source, operation='verify', target='json'))
        self.assertEqual(verified['state'], 'completed', verified)
        report = self.call(verified['download'].removeprefix('/api/process'))
        self.assertEqual(report['format'], 'zstd')
        self.assertEqual(report['entries'][0]['sha256'], hashlib.sha256(data).hexdigest())
        damaged = self.upload(packed[:-1], current['outputName'])
        rejected = self.execute(self.job(damaged, operation='verify', target='json'))
        self.assertEqual(rejected['state'], 'failed', rejected)
        self.assertFalse(rejected['downloadAvailable'])
        restored = self.execute(self.job(source, operation='extract', target='zip'))
        output = self.call(restored['download'].removeprefix('/api/process'), raw=True)
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            self.assertEqual(archive.read('original.txt'), data)

    def test_zstandard_tar_jobs_create_extract_repack_and_verify_through_http(self):
        from processor.native import capability
        if not capability():
            self.skipTest('SHANTE C++ engine has not been built')
        capabilities = self.call('/capabilities')
        self.assertIn('tar.zst', capabilities['archives'])
        self.assertNotIn('tar.zst', capabilities['singleFileArchives'])
        files = {'nested/one.txt': b'First file', 'second.bin': random.Random(5).randbytes(2048)}
        uploads = [self.upload(data, name)['id'] for name, data in files.items()]
        job = self.call('/jobs', {'uploads': uploads, 'operation': 'compress', 'target': 'tar.zst'}, 'POST')
        completed = self.execute(job)
        self.assertEqual(completed['state'], 'completed', completed)
        self.assertEqual(completed['outputName'], '2 files.tar.zst')
        packed = self.call(completed['download'].removeprefix('/api/process'), raw=True)
        self.assertEqual(hashlib.sha256(packed).hexdigest(), completed['sha256'])
        source = self.upload(packed, completed['outputName'])
        for target in ('zip', 'zip-deflate'):
            restored = self.execute(self.job(source, operation='extract', target=target))
            self.assertEqual(restored['state'], 'completed', restored)
            result = self.call(restored['download'].removeprefix('/api/process'), raw=True)
            with zipfile.ZipFile(io.BytesIO(result)) as archive:
                self.assertEqual({name: archive.read(name) for name in archive.namelist()}, files)
        verified = self.execute(self.job(source, operation='verify', target='json'))
        self.assertEqual(verified['state'], 'completed', verified)
        report = self.call(verified['download'].removeprefix('/api/process'))
        self.assertEqual(report['format'], 'tar.zst')
        self.assertEqual({item['name']: item['sha256'] for item in report['entries']},
                         {name: hashlib.sha256(data).hexdigest() for name, data in files.items()})

    def test_running_worker_cancellation_stays_final(self):
        job = self.job(self.upload(os.urandom(2 * 1024**2), name="cancel.bin"))
        with patch("processor.server.available_memory", return_value=2 * 1024**3):
            self.service.tick()
        self.assertTrue(self.service.running)
        cancelled = self.call("/jobs/" + job["id"] + "/cancel", {}, "POST")
        self.assertEqual(cancelled["state"], "cancelled")
        self.service.tick()
        self.assertFalse(self.service.running)
        final = self.call("/jobs/" + job["id"])
        self.assertEqual(final["state"], "cancelled")
        self.assertFalse(final["downloadAvailable"])

    def test_cancel_commits_before_delayed_worker_initial_progress(self):
        job = self.job()
        owner = self.service.store.list()[0][0]
        worker_waiting, release_worker = threading.Event(), threading.Event()
        original_patch = Store.patch

        def delayed_patch(store, record_owner, kind, record_id, **updates):
            if threading.current_thread() is worker and updates.get('state') == 'processing':
                worker_waiting.set()
                if not release_worker.wait(10):
                    raise RuntimeError('Test did not release worker')
            return original_patch(store, record_owner, kind, record_id, **updates)

        worker = threading.Thread(target=run_job, args=(self.temp.name, owner, job['id'], LIMITS))
        with patch.object(Store, 'patch', delayed_patch):
            worker.start()
            try:
                self.assertTrue(worker_waiting.wait(10))
                cancelled = self.call('/jobs/' + job['id'] + '/cancel', {}, 'POST')
                self.assertEqual(cancelled['state'], 'cancelled')
            finally:
                release_worker.set()
                worker.join(10)
        self.assertFalse(worker.is_alive())
        final = self.call('/jobs/' + job['id'])
        self.assertEqual(final['state'], 'cancelled')
        self.assertEqual(final['error'], 'Cancelled')
        self.assertFalse(final['downloadAvailable'])

    def test_late_worker_updates_preserve_terminal_state_and_explicit_retry_works(self):
        job = self.job()
        owner = self.service.store.list()[0][0]
        for state in ('cancelled', 'completed', 'failed', 'interrupted', 'paused'):
            with self.subTest(state=state):
                self.service.store.patch(owner, 'job', job['id'], state='queued')
                original = self.service.store.patch(owner, 'job', job['id'], state=state, processed=7)
                self.assertEqual(original['state'], state)
                for updates in ({'state': 'processing'}, {'state': 'verifying'},
                                {'state': 'completed', 'downloadAvailable': True},
                                {'state': 'failed', 'error': 'late error'}, {'processed': 100}):
                    self.assertEqual(self.service.store.patch(owner, 'job', job['id'],
                        expected_states=ACTIVE, **updates), original)
        self.service.store.patch(owner, 'job', job['id'], state='cancelled')
        retried = self.call('/jobs/' + job['id'] + '/retry', {}, 'POST')
        self.assertEqual(retried['state'], 'queued')

    def test_second_server_cannot_share_the_same_listener(self):
        with self.assertRaises(OSError):
            LocalHTTPServer(("127.0.0.1", self.server.server_port), handler(self.service))

    def test_second_scheduler_cannot_share_the_same_data_directory(self):
        with self.assertRaisesRegex(RuntimeError, "Another processor"):
            Service(self.temp.name, limits=LIMITS)

    def test_explicit_lan_host_keeps_origin_and_host_protection(self):
        self.service.lan_hosts = frozenset({"192.168.0.103"})
        host = f"192.168.0.103:{self.server.server_port}"
        self.assertEqual(self.call("/capabilities", headers={"Host": host})["processing"], "local")
        self.assert_status(403, lambda: self.call("/capabilities", headers={"Host": "192.168.0.104"}))
        self.assert_status(403, lambda: self.call("/settings", {"historyRetention": "7d", "fileRetention": "24h"}, "PUT", {"Host": host, "Origin": "http://untrusted.example"}))

    def test_four_simultaneous_sessions_complete_with_isolated_verified_downloads(self):
        clients = [build_opener(HTTPCookieProcessor(CookieJar())) for _ in range(4)]
        payloads = [(f"session-{i}\n" * 4096).encode() for i in range(4)]

        def enqueue(index):
            client = clients[index]
            source = self.call("/uploads", {"name": "shared.txt", "size": len(payloads[index])}, "POST", client=client)
            self.call("/uploads/" + source["id"], payloads[index], "PUT", {"Upload-Offset": "0"}, client=client, raw=True)
            return self.call("/jobs", {"uploads": [source["id"]], "operation": "compress", "target": "zip"}, "POST", client=client)

        with ThreadPoolExecutor(max_workers=4) as executor:
            jobs = list(executor.map(enqueue, range(4)))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.service.tick()
            self.assertLessEqual(len(self.service.running), 2)
            current = [self.call("/jobs/" + job["id"], client=client) for job, client in zip(jobs, clients)]
            if all(job["state"] == "completed" for job in current):
                break
            time.sleep(.1)
        for index, (job, client) in enumerate(zip(current, clients)):
            self.assertEqual(job["state"], "completed", job)
            self.assertEqual(self.call("/jobs", client=client)["total"], 1)
            output = self.call(job["download"].removeprefix("/api/process"), raw=True, client=client)
            with zipfile.ZipFile(io.BytesIO(output)) as archive:
                self.assertEqual(archive.read("shared.txt"), payloads[index])
            self.assert_status(404, lambda: self.call("/jobs/" + current[(index + 1) % 4]["id"], client=client))


if __name__ == "__main__":
    unittest.main()
