import unittest
from unittest.mock import patch
from types import SimpleNamespace
import test_server


class ProjectRoutes(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    call = test_server.ServerTests.call
    upload = test_server.ServerTests.upload
    job = test_server.ServerTests.job
    execute = test_server.ServerTests.execute
    assert_status = test_server.ServerTests.assert_status

    def test_zip_profile_survives_reopening_and_saves_from_older_clients(self):
        from processor.projects import DEFAULT_SETTINGS

        path = '/projects/archives'
        first = self.call(path, {'settings': {**DEFAULT_SETTINGS, 'zipProfile': 'maximum'}}, 'PUT')
        self.assertEqual(self.call(path)['settings']['zipProfile'], 'maximum')
        older = self.call(path, {'settings': DEFAULT_SETTINGS, 'revision': first['revision']}, 'PUT')
        self.assertEqual(older['settings']['zipProfile'], 'maximum')
        self.assert_status(400, lambda: self.call(
            path, {'settings': {**DEFAULT_SETTINGS, 'zipProfile': 'unknown'}, 'revision': older['revision']}, 'PUT'))

    def test_memory_pressure_defers_admission_and_disk_exhaustion_is_reported(self):
        job = self.job()
        with patch('processor.server.available_memory', return_value=0):
            self.service.tick()
        self.assertEqual(self.call('/jobs/' + job['id'])['state'], 'queued')
        self.assertFalse(self.service.running)
        with patch('processor.server.available_memory', return_value=4 * 1024**3), patch('processor.server.shutil.disk_usage', return_value=SimpleNamespace(free=0)):
            self.service.tick()
        failed = self.call('/jobs/' + job['id'])
        self.assertEqual(failed['state'], 'failed')
        self.assertEqual(failed['errorInfo']['category'], 'insufficient_storage')
        self.assertTrue(failed['errorInfo']['retryEligible'])
        self.assertIsNotNone(failed['finished'])

    def test_projects_have_independent_verified_outputs_and_idempotency(self):
        source = self.upload()
        first = self.job(source, projectId='images', requestId='a' * 64)
        second = self.job(source, projectId='documents', requestId='b' * 64)
        self.assertEqual(first['projectId'], 'images')
        self.assertEqual(second['projectId'], 'documents')
        self.assert_status(409, lambda: self.job(source, projectId='other', requestId='a' * 64))
        self.assert_status(400, lambda: self.job(source, projectId='../invalid'))
        finished = [self.execute(job) for job in [first, second]]
        for job in finished:
            self.assertEqual(job['state'], 'completed')
            self.assertTrue(job['downloadAvailable'])
            self.assertTrue(self.call(job['download'].split('/api/process')[1], raw=True))
        page = self.call('/jobs?summary=1')
        self.assertEqual({job['projectId'] for job in page['jobs']}, {'images', 'documents'})

    def test_fair_dispatch_rotates_projects_without_loading_manifests(self):
        source = self.upload()
        first = self.job(source, projectId='images')
        self.job(source, projectId='images')
        other = self.job(source, projectId='documents')
        owner = self.service.store.list()[0][0]
        self.service.store.patch(owner, 'job', first['id'], scheduled=20, state='completed')
        self.assertEqual(self.service.store.queued(fair=True)[0][1]['id'], other['id'])
        self.service.store.patch(owner, 'job', other['id'], scheduled=30, state='completed')
        self.assertEqual(self.service.store.queued(fair=True)[0][1]['projectId'], 'images')

    def test_header_inspection_does_not_create_uploads_or_jobs(self):
        with patch('processor.capabilities.shutil.which', return_value='engine'):
            result = self.call('/inspect', {'entries': [{'head': b'\x89PNG\r\n\x1a\n'.hex()}]}, 'POST')
        self.assertEqual(result['entries'][0]['format'], 'png')
        self.assertNotIn('wav', result['entries'][0]['conversions'])
        self.assertEqual(self.service.store.count(kind='upload'), 0)
        self.assertEqual(self.service.store.count(kind='job'), 0)
        self.assert_status(400, lambda: self.call('/inspect', {'entries': [{}]}, 'POST'))


    def test_cancel_and_failed_retry_leave_other_project_output_intact(self):
        good = self.execute(self.job(projectId='successful'))
        cancelled = self.job(projectId='cancelled')
        self.call('/jobs/' + cancelled['id'] + '/cancel', {}, 'POST')
        self.assertEqual(self.call('/jobs/' + cancelled['id'])['state'], 'cancelled')
        bad = self.execute(self.job(operation='extract', target='zip', projectId='failed'))
        self.assertEqual(bad['state'], 'failed')
        self.assertEqual(bad['errorInfo']['category'], 'unsupported_format')
        self.assertFalse(bad['errorInfo']['retryEligible'])
        self.assertEqual(bad['errorInfo']['jobId'], bad['id'])
        self.assertEqual(len(bad['errorInfo']['fileIds']), 1)
        summary = self.call('/jobs?summary=1')
        failure_summary = next(row for row in summary['jobs'] if row['id'] == bad['id'])
        self.assertNotIn('fileIds', failure_summary['errorInfo'])
        self.call('/jobs/' + bad['id'] + '/retry', {}, 'POST')
        retried = self.call('/jobs/' + bad['id'])
        self.assertEqual(retried['state'], 'queued')
        self.assertEqual(retried['retryCount'], 1)
        self.assertIsNone(retried['errorInfo'])
        retained = self.call('/jobs/' + good['id'])
        self.assertEqual(retained['state'], 'completed')
        self.assertEqual(retained['sha256'], good['sha256'])
        self.assertTrue(retained['downloadAvailable'])
