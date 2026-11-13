from http.cookiejar import CookieJar
import hashlib
import json
from urllib.request import build_opener, HTTPCookieProcessor
import time
import unittest
from unittest.mock import patch

from processor.projects import Projects, DEFAULT_SETTINGS
from processor.server import Store
import test_server


class ProjectRecoveryRoutes(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    call = test_server.ServerTests.call
    upload = test_server.ServerTests.upload
    job = test_server.ServerTests.job
    execute = test_server.ServerTests.execute
    assert_status = test_server.ServerTests.assert_status

    def save(self, project='default', **fields):
        return self.call('/projects/' + project, {'settings': DEFAULT_SETTINGS, **fields}, 'PUT')

    def checkpoint(self, upload, project='default', source='a' * 32):
        return self.call(f'/projects/{project}/inputs/{source}', {'upload': upload['id']}, 'PUT')

    def test_settings_are_durable_revision_checked_and_owner_scoped(self):
        first = self.save()
        self.assertEqual(first['revision'], 1)
        self.assert_status(409, lambda: self.save())
        updated = self.save(revision=1, settings={**DEFAULT_SETTINGS, 'conversion': 'mp4-h264', 'groupActions': {
            'png': 'convert:png', 'zip': 'extract:zip', 'mkv': 'convert:mp4-h264'}})
        self.assertEqual(updated['revision'], 2)
        reloaded = Projects(Store(self.temp.name), self.service.limits)
        owner = self.service.store.list(kind='project')[0][0]
        self.assertEqual(reloaded.get(owner, 'default')['settings']['conversion'], 'mp4-h264')
        self.assertEqual(reloaded.get(owner, 'default')['settings']['groupActions']['zip'], 'extract:zip')
        self.assertEqual(reloaded.get(owner, 'default')['settings']['groupActions']['mkv'], 'convert:mp4-h264')
        legacy_update = self.save(revision=2, settings={**DEFAULT_SETTINGS, 'conversion': 'wav'})
        self.assertEqual(legacy_update['settings']['groupActions']['png'], 'convert:png')
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assertEqual(self.call('/projects', client=stranger)['projects'], [])
        self.assert_status(404, lambda: self.call('/projects/default', client=stranger))
        self.assert_status(400, lambda: self.save(settings={'target': 'zip'}))
        self.assert_status(400, lambda: self.save(revision=True))
        for invalid in ([], {'png': 'run:shell'}, {'../../': 'convert:png'}, {str(i): 'skip' for i in range(65)}):
            self.assert_status(400, lambda: self.save(revision=2, settings={**DEFAULT_SETTINGS, 'groupActions': invalid}))
        self.save('inputs')
        self.assertEqual(self.call('/projects/inputs')['id'], 'inputs')

    def test_complete_inputs_restore_with_signatures_and_do_not_copy_bytes(self):
        self.save()
        upload = self.upload(b'\x89PNG\r\n\x1a\n' + b'x' * 30, '世界/misleading.txt')
        self.checkpoint(upload)
        self.checkpoint(upload)  # Retrying a lost acknowledgment is idempotent.
        owner = self.service.store.list(kind='project')[0][0]
        recovered = Projects(Store(self.temp.name), self.service.limits).inputs(owner, 'default')
        self.assertEqual(recovered['total'], 1)
        source = recovered['sources'][0]
        self.assertEqual(source['inspection']['format'], 'png')
        self.assertEqual(source['upload'], upload['id'])
        self.assertEqual(source['id'], 'a' * 32)
        self.assertNotIn('path', source)
        self.assertEqual(self.service.store.count(kind='upload'), 1)
        other = self.upload(b'other', 'other.txt')
        self.assert_status(409, lambda: self.checkpoint(other))
        self.assert_status(409, lambda: self.checkpoint(upload, source='b' * 32))

    def test_saved_selections_share_paging_with_upload_checkpoints(self):
        self.call('/projects/default', {}, 'PUT')
        path = '/projects/default/inputs'
        first = {'id': 'a' * 32, 'name': 'draft.txt', 'size': 3, 'directory': False}
        second = {'id': 'b' * 32, 'name': 'empty/', 'size': 0, 'directory': True}
        self.call(path, {'selections': [first, second]}, 'PUT')
        self.assertEqual(self.service.store.count(kind='upload'), 0)
        self.assertEqual(self.call(path)['sources'], [])
        options = '?includeIncomplete=1&includeSelections=1'
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call(path + options, client=stranger))
        self.assert_status(404, lambda: self.call(path, {'selections': [first]}, 'PUT', client=stranger))
        page = self.call(path + options + '&limit=1')
        self.assertEqual(page['sources'], [{**first, 'pending': True}])
        self.assertEqual(page['total'], 2)
        self.assertEqual(self.call(path + options + '&after=' + page['nextCursor'])['sources'],
                         [{**second, 'pending': True}])

        upload = self.call('/uploads', {'projectId': 'default', 'sourceId': first['id'],
                                        'name': first['name'], 'size': 3}, 'POST')
        self.call(path, {'selections': [first]}, 'PUT')
        sources = self.call(path + options)['sources']
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[0]['upload'], upload['id'])
        self.assertEqual(sources[0]['uploaded'], 0)
        self.assertNotIn('pending', sources[0])
        self.assertEqual(sources[1], {**second, 'pending': True})
        self.call(path + '/' + second['id'], method='DELETE')
        self.assertEqual(self.call(path + options)['total'], 1)

    def test_partial_foreign_and_expired_inputs_are_not_recovered(self):
        self.save()
        partial = self.call('/uploads', {'name': 'partial', 'size': 20}, 'POST')
        self.call('/uploads/' + partial['id'], b'first', 'PUT', {'Upload-Offset': '0'}, raw=True)
        self.assert_status(409, lambda: self.checkpoint(partial))
        complete = self.upload()
        self.checkpoint(complete)
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call('/projects/other', {'settings': DEFAULT_SETTINGS}, 'PUT', client=stranger)
        self.assert_status(410, lambda: self.call('/projects/other/inputs/' + 'b' * 32, {'upload': complete['id']}, 'PUT', client=stranger))
        owner = self.service.store.list(kind='upload')[0][0]
        self.service.store.patch(owner, 'upload', complete['id'], expires=time.time() - 1)
        page = self.call('/projects/default/inputs')
        self.assertEqual((page['total'], page['scanned'], page['unavailable']), (1, 1, 1))
        self.assertEqual(page['sources'], [])
        self.service.projects.cleanup()
        self.assertEqual(self.call('/projects/default/inputs')['total'], 0)

    def test_upload_reservation_recovers_after_final_chunk_without_checkpoint(self):
        self.save()
        source_id = 'c' * 32
        body = {'projectId': 'default', 'sourceId': source_id, 'name': 'restart.txt', 'size': 3}
        upload = self.call('/uploads', body, 'POST')
        self.assertEqual(self.call('/uploads', body, 'POST')['id'], upload['id'])
        self.assertEqual(self.service.store.count(kind='upload'), 1)
        self.assert_status(409, lambda: self.call('/uploads', {**body, 'size': 4}, 'POST'))
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call('/uploads', body, 'POST', client=stranger))
        self.call('/uploads/' + upload['id'], b'a', 'PUT', {'Upload-Offset': '0'}, raw=True)
        page = self.call('/projects/default/inputs')
        self.assertEqual((page['sources'], page['unavailable']), ([], 1))
        self.call('/uploads/' + upload['id'], b'bc', 'PUT', {'Upload-Offset': '1'}, raw=True)
        owner = self.service.store.list(kind='project')[0][0]
        recovered = Projects(Store(self.temp.name), self.service.limits).inputs(owner, 'default')
        self.assertEqual([(s['id'], s['upload'], s['uploaded']) for s in recovered['sources']],
                         [(source_id, upload['id'], 3)])
        job = self.call('/jobs', {'uploads': [upload['id']], 'operation': 'compress',
                                 'target': 'zip', 'recoverable': True}, 'POST')
        self.assertEqual(self.execute(job)['state'], 'completed')
        self.assertEqual(self.call('/projects/default/inputs')['total'], 0)

    def test_resume_checks_prefix_and_fences_stale_writers(self):
        self.save()
        upload = self.call('/uploads', {'projectId': 'default', 'sourceId': 'c' * 32,
                                        'name': 'resume.txt', 'size': 6}, 'POST')
        path = '/uploads/' + upload['id']
        self.call(path, b'abc', 'PUT', {'Upload-Offset': '0'}, raw=True)
        recovered = self.call('/projects/default/inputs?includeIncomplete=1')
        self.assertEqual(recovered['sources'][0]['uploaded'], 3)
        self.assertEqual(recovered['unavailable'], 0)
        prefix = path + '/prefix?start=0&length=3'
        self.assertEqual(self.call(prefix)['sha256'], hashlib.sha256(b'abc').hexdigest())
        self.assertFalse(json.loads(self.call(prefix, b'xyz', 'POST', raw=True))['matches'])
        self.assertTrue(json.loads(self.call(prefix, b'abc', 'POST', raw=True))['matches'])
        self.assert_status(416, lambda: self.call(path + '/prefix?start=1&length=3'))
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call(prefix, client=stranger))
        self.assert_status(409, lambda: self.call(path + '/resume', {'offset': 2, 'writer': 'a' * 32}, 'POST'))
        for writer in ('a' * 32, 'b' * 32):
            self.call(path + '/resume', {'offset': 3, 'writer': writer}, 'POST')
        for headers in ({}, {'Upload-Writer': 'a' * 32}):
            self.assert_status(423, lambda: self.call(path, b'def', 'PUT', {'Upload-Offset': '3', **headers}, raw=True))
        state = self.call(path)
        self.assertTrue(state['claimed'])
        self.assertNotIn('writerHash', state)
        self.call(path, b'def', 'PUT', {'Upload-Offset': '3', 'Upload-Writer': 'b' * 32}, raw=True)
        completed = self.call('/projects/default/inputs')['sources'][0]
        self.assertEqual(completed['uploaded'], 6)
        self.assertEqual(self.call(path + '/prefix?start=0&length=6')['sha256'], hashlib.sha256(b'abcdef').hexdigest())

    def test_lost_submission_response_reconciles_without_duplicate_job(self):
        self.save()
        upload = self.upload()
        self.checkpoint(upload)
        second_upload = self.upload(b'second', 'other.txt')
        self.checkpoint(second_upload, source='b' * 32)
        body = {'uploads': [upload['id'], second_upload['id']], 'operation': 'compress', 'target': 'zip', 'recoverable': True}
        # Simulate the process dying after the durable job commit, before clearing
        # recovery references. The next identical request must find that job.
        with patch.object(self.service.projects, 'forget_uploads', side_effect=RuntimeError('injected checkpoint interruption')):
            self.assert_status(500, lambda: self.call('/jobs', body, 'POST'))
        self.assertEqual(self.call('/projects/default/inputs')['total'], 2)
        first = self.call('/jobs', body, 'POST')
        second = self.call('/jobs', {**body, 'uploads': list(reversed(body['uploads']))}, 'POST')
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(self.service.store.count(kind='job'), 1)
        self.assertEqual(self.call('/projects/default/inputs')['total'], 0)
        completed = self.execute(first)
        self.assertEqual(completed['state'], 'completed')
        other = self.call('/jobs', {**body, 'target': 'tar'}, 'POST')
        self.assertNotEqual(other['id'], first['id'])

    def test_keyset_recovery_does_not_skip_inputs_after_an_earlier_removal(self):
        self.save()
        for index in range(5):
            upload = self.upload(name=f'file-{index}')
            self.checkpoint(upload, source=f'{index:032x}')
        first = self.call('/projects/default/inputs?limit=2')
        self.assertEqual([source['id'] for source in first['sources']], [f'{i:032x}' for i in (0, 1)])
        self.call('/projects/default/inputs/' + '0' * 32, method='DELETE')
        second = self.call('/projects/default/inputs?limit=2&after=' + first['nextCursor'])
        self.assertEqual([source['id'] for source in second['sources']], [f'{i:032x}' for i in (2, 3)])
        self.assert_status(400, lambda: self.call('/projects/default/inputs?after=invalid'))

    def test_recovery_project_and_input_limits_and_forgetting(self):
        self.save()
        upload = self.upload()
        self.checkpoint(upload)
        self.call('/projects/default/inputs/' + 'a' * 32, method='DELETE')
        self.assertEqual(self.call('/projects/default/inputs')['sources'], [])
        self.assertEqual(self.call('/uploads/' + upload['id'])['size'], upload['size'])
        for index in range(1, 20):
            self.save('project-' + str(index))
        self.assert_status(413, lambda: self.save('one-too-many'))
        self.assertEqual(len(self.call('/projects')['projects']), 20)
        self.assert_status(400, lambda: self.call('/jobs', {'uploads': [upload['id']], 'operation': 'compress', 'target': 'zip', 'recoverable': 'yes'}, 'POST'))

    def test_missing_upload_folder_can_be_forgotten_without_a_storage_error(self):
        self.save()
        upload = self.upload()
        self.checkpoint(upload)
        owner = self.service.store.list(kind='upload')[0][0]
        folder = self.service.store.folder(owner, upload['id'])
        (folder / 'input').unlink()
        folder.rmdir()
        self.call('/uploads/' + upload['id'], method='DELETE')
        self.assert_status(404, lambda: self.call('/uploads/' + upload['id']))
        self.service.projects.cleanup()
        self.assertEqual(self.call('/projects/default/inputs')['total'], 0)
