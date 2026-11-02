import hashlib
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import zipfile

from processor.server import LocalHTTPServer, Service, handler, run_job
from test_engine import LIMITS


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name, limits=LIMITS)
        self.server = LocalHTTPServer(("127.0.0.1", 0), handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}/api/process"
        self.client = build_opener(HTTPCookieProcessor(CookieJar()))

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
        self.service.tick()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            current = self.call("/jobs/" + job["id"])
            if current["state"] in ("completed", "failed", "interrupted"):
                break
            time.sleep(.1)
        self.assertEqual(current["state"], "completed", current)
        while self.service.running and time.monotonic() < deadline:
            self.service.tick()
            time.sleep(.1)
        self.assertFalse(self.service.running)

    def test_running_worker_cancellation_stays_final(self):
        job = self.job(self.upload(os.urandom(2 * 1024**2), name="cancel.bin"))
        self.service.tick()
        self.assertTrue(self.service.running)
        cancelled = self.call("/jobs/" + job["id"] + "/cancel", {}, "POST")
        self.assertEqual(cancelled["state"], "cancelled")
        self.service.tick()
        self.assertFalse(self.service.running)
        final = self.call("/jobs/" + job["id"])
        self.assertEqual(final["state"], "cancelled")
        self.assertFalse(final["downloadAvailable"])

    def test_second_server_cannot_share_the_same_listener(self):
        with self.assertRaises(OSError):
            LocalHTTPServer(("127.0.0.1", self.server.server_port), handler(self.service))

    def test_second_scheduler_cannot_share_the_same_data_directory(self):
        with self.assertRaisesRegex(RuntimeError, "Another processor"):
            Service(self.temp.name, limits=LIMITS)


if __name__ == "__main__":
    unittest.main()
