import unittest
from unittest.mock import patch
import test_server


class ProjectRoutes(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    call = test_server.ServerTests.call
    upload = test_server.ServerTests.upload
    job = test_server.ServerTests.job
    execute = test_server.ServerTests.execute
    assert_status = test_server.ServerTests.assert_status

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
        self.call('/jobs/' + bad['id'] + '/retry', {}, 'POST')
        self.assertEqual(self.call('/jobs/' + bad['id'])['state'], 'queued')
        retained = self.call('/jobs/' + good['id'])
        self.assertEqual(retained['state'], 'completed')
        self.assertEqual(retained['sha256'], good['sha256'])
        self.assertTrue(retained['downloadAvailable'])
