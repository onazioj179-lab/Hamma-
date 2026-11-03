import hashlib
from concurrent.futures import ThreadPoolExecutor
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
from unittest.mock import patch
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

    def test_json_endpoints_reject_non_object_payloads(self):
        for path, method in [("/uploads", "POST"), ("/jobs", "POST"), ("/settings", "PUT")]:
            for payload in [b"null", b"[]", b"1", b'"text"', b'{"size": NaN}', b'{"size": Infinity}']:
                with self.subTest(path=path, payload=payload):
                    with self.assertRaises(HTTPError) as caught:
                        self.call(path, payload, method, {"Content-Type": "application/json"}, raw=True)
                    self.assertEqual(caught.exception.code, 400)
                    self.assertIn("error", json.loads(caught.exception.read()))
        self.assertIn("id", self.upload())

    def test_conversion_quality_is_enforced_before_queueing_and_bound_to_request_identity(self):
        source = self.upload()
        self.assert_status(400, lambda: self.job(source, operation='convert', target='mp3'))
        self.assertEqual(self.call('/jobs')['total'], 0)
        accepted = self.job(source, operation='convert', target='mp3', qualityMode='lossy', metadataPolicy='strip', requestId='d' * 64)
        self.assertEqual(accepted['qualityMode'], 'lossy')
        self.assertEqual(accepted['metadataPolicy'], 'strip')
        self.assert_status(409, lambda: self.job(source, operation='convert', target='mp3', qualityMode='lossy', metadataPolicy='preserve', requestId='d' * 64))
        self.assert_status(400, lambda: self.job(source, operation='convert', target='wav', metadataPolicy='invalid'))

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
        self.service.rates["expired-client"] = (2000, int(time.time() // 60) - 1)
        self.call("/health")
        with self.assertRaises(HTTPError) as raised:
            self.call("/health")
        self.assertEqual(raised.exception.code, 429)
        self.assertTrue(1 <= int(raised.exception.headers["Retry-After"]) <= 60)
        self.assertNotIn("expired-client", self.service.rates)

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
        self.assertRegex(first["revision"], r"^[0-9a-f]{64}:[0-9a-f]{64}$")
        self.assertNotIn(str(self.service.store.root), json.dumps(first))
        self.assertNotIn("files", first)

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

    def test_worker_start_failure_does_not_strand_jobs_or_stop_queue(self):
        jobs = [self.job(), self.job()]
        with self.assertLogs("hamma.processor", level="ERROR"), patch("processor.server.multiprocessing.get_context") as spawn:
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
        restored = self.execute(self.job(source, operation='extract', target='zip'))
        output = self.call(restored['download'].removeprefix('/api/process'), raw=True)
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            self.assertEqual(archive.read('original.txt'), data)

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
