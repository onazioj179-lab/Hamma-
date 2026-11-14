"""Owner-scoped settings and references to project uploads.

Inputs retain their upload expiry. Partial uploads require the original file
before the browser can continue.
"""
import json
import re
import stat
import time

from .capabilities import inspect_formats
from .engine import Context, ZIP_PROFILES, detect, detect_header, file_digest


class ProjectError(Exception):
    retry_after = None

    def __init__(self, status, message):
        self.status, self.message = status, message


DEFAULT_SETTINGS = {'target': 'zip', 'conversion': 'wav', 'qualityMode': 'lossless',
                    'metadataPolicy': 'strip', 'recursive': False}


class Projects:
    def __init__(self, store, limits):
        self.store, self.limits = store, limits
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS project_inputs (owner TEXT NOT NULL, project_id TEXT NOT NULL, source_id TEXT NOT NULL, upload_id TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(owner,project_id,source_id))')
            db.execute('''CREATE TABLE IF NOT EXISTS project_selections (
                owner TEXT NOT NULL, project_id TEXT NOT NULL, source_id TEXT NOT NULL,
                name TEXT NOT NULL, size INTEGER NOT NULL, directory INTEGER NOT NULL,
                PRIMARY KEY(owner, project_id, source_id))''')
            db.execute('CREATE INDEX IF NOT EXISTS project_inputs_upload ON project_inputs(owner,upload_id)')

    @staticmethod
    def identifier(value):
        if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
            raise ProjectError(400, 'Invalid project identifier')
        return value

    def save(self, owner, project_id, body):
        self.identifier(project_id)
        settings = body.get('settings', DEFAULT_SETTINGS)
        if not isinstance(settings, dict) or not set(DEFAULT_SETTINGS).issubset(settings) or set(settings) - set(DEFAULT_SETTINGS) - {'groupActions', 'zipProfile'}:
            raise ProjectError(400, 'Invalid project settings')
        profile = settings.get('zipProfile', 'balanced')
        if not isinstance(profile, str) or profile not in ZIP_PROFILES:
            raise ProjectError(400, 'Invalid ZIP profile')
        group_actions = settings.get('groupActions', {})
        if (not isinstance(group_actions, dict) or len(group_actions) > 64 or
                any(not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', key) or
                    not isinstance(value, str) or not re.fullmatch(r'(?:skip|(?:compress|convert|extract):[a-z0-9.-]{1,16})', value)
                    for key, value in group_actions.items())):
            raise ProjectError(400, 'Invalid grouped workflow settings')
        if (not isinstance(settings['target'], str) or not re.fullmatch(r'[a-z0-9.]{1,16}', settings['target']) or
                not isinstance(settings['conversion'], str) or not re.fullmatch(r'[a-z0-9.-]{1,16}', settings['conversion']) or
                settings['qualityMode'] not in ('lossless', 'lossy') or settings['metadataPolicy'] not in ('strip', 'preserve') or type(settings['recursive']) is not bool):
            raise ProjectError(400, 'Invalid project settings')
        expected = body.get('revision', 0)
        if type(expected) is not int or expected < 0:
            raise ProjectError(400, 'Invalid project revision')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT data FROM records WHERE owner=? AND kind='project' AND id=?", (owner, project_id)).fetchone()
            previous = json.loads(row[0]) if row else None
            if expected != (previous['revision'] if previous else 0):
                raise ProjectError(409, 'Project changed in another tab. Reconnect before saving.')
            # Older clients omit optional settings they cannot edit.
            if previous and 'zipProfile' not in settings and 'zipProfile' in previous['settings']:
                settings = {**settings, 'zipProfile': previous['settings']['zipProfile']}
            if previous and 'groupActions' not in settings and 'groupActions' in previous['settings']:
                settings = {**settings, 'groupActions': previous['settings']['groupActions']}
            if not previous and db.execute("SELECT count(*) FROM records WHERE owner=? AND kind='project'", (owner,)).fetchone()[0] >= 20:
                raise ProjectError(413, 'Project limit reached')
            if not previous and db.execute("SELECT count(*) FROM records WHERE kind='project'").fetchone()[0] >= 10000:
                raise ProjectError(429, 'Processor project capacity reached')
            now = time.time()
            record = {'id': project_id, 'created': previous['created'] if previous else now,
                      'updated': now, 'revision': expected + 1, 'settings': settings}
            db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)', (project_id, owner, 'project', record['created'], json.dumps(record)))
        return record

    def list(self, owner):
        with self.store.connect() as db:
            rows = db.execute("SELECT data FROM records WHERE owner=? AND kind='project' ORDER BY created,id LIMIT 20", (owner,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def get(self, owner, project_id):
        record = self.store.get(owner, 'project', self.identifier(project_id))
        if not record:
            raise ProjectError(404, 'Project unavailable')
        return record

    def remember_selections(self, owner, project_id, sources):
        self.get(owner, project_id)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.executemany("""INSERT OR IGNORE INTO project_selections
                SELECT ?,?,?,?,?,? WHERE NOT EXISTS (
                    SELECT 1 FROM project_inputs WHERE owner=? AND project_id=? AND source_id=?)""",
                [(owner, project_id, source_id, name, size, directory, owner, project_id, source_id)
                 for source_id, name, size, directory in sources])
            count = db.execute("""SELECT
                (SELECT count(*) FROM project_selections WHERE owner=? AND project_id=?) +
                (SELECT count(*) FROM project_inputs WHERE owner=? AND project_id=?)""",
                (owner, project_id, owner, project_id)).fetchone()[0]
            if count > self.limits['files']:
                raise ProjectError(413, 'Project file limit reached')

    def batch_uploads(self, owner, project_id, selections):
        self.get(owner, project_id)
        with self.store.connect() as db:
            existing = dict(db.execute(
                'SELECT source_id, upload_id FROM project_inputs WHERE owner=? AND project_id=?',
                (owner, project_id)))
            drafts = {row[0]: tuple(row[1:]) for row in db.execute(
                'SELECT source_id, name, size, directory FROM project_selections WHERE owner=? AND project_id=?',
                (owner, project_id))}
        project_sources = existing.keys() | drafts.keys() | selections.keys()
        if len(project_sources) > self.limits['files']:
            raise ProjectError(413, 'Project file limit reached')
        upload_ids = {preferred for source_id, (_, _, _, preferred, _) in selections.items() if preferred}
        upload_ids.update(existing[source_id] for source_id in selections if source_id in existing)
        uploads = self.store.get_uploads(owner, list(upload_ids))
        now = time.time()
        result = {}
        for source_id, (name, size, directory, preferred, _) in selections.items():
            upload_id = existing.get(source_id, preferred)
            if upload_id and preferred and upload_id != preferred:
                raise ProjectError(409, 'Recovery input changed. Reopen the project before retrying.')
            if source_id in drafts and drafts[source_id] != (name, size, directory):
                raise ProjectError(409, 'Recovery input identifier already used')
            record = uploads.get(upload_id)
            if record and (record['name'], record['size'], record['directory']) != (name, size, directory):
                raise ProjectError(409, 'Recovery input identifier already used')
            if record and record['expires'] > now and (self.store.folder(owner, upload_id) / 'input').is_file():
                result[source_id] = record
        return result

    def prepare_upload(self, owner, project_id, source_id, name, size, directory):
        """Under the service lock, reconcile a lost reservation response."""
        self.get(owner, project_id)
        if not isinstance(source_id, str) or not re.fullmatch(r'[a-f0-9]{32}', source_id):
            raise ProjectError(400, 'Invalid recovery input')
        with self.store.connect() as db:
            existing = db.execute('SELECT upload_id FROM project_inputs WHERE owner=? AND project_id=? AND source_id=?',
                                  (owner, project_id, source_id)).fetchone()
            if not existing:
                count = db.execute('SELECT count(*) FROM project_inputs WHERE owner=? AND project_id=?',
                                   (owner, project_id)).fetchone()[0]
                pending = db.execute('SELECT name,size,directory FROM project_selections WHERE owner=? AND project_id=? AND source_id=?',
                                     (owner, project_id, source_id)).fetchone()
                if pending:
                    if tuple(pending) != (name, size, directory):
                        raise ProjectError(409, 'Recovery input identifier already used')
                    return None
                count += db.execute('SELECT count(*) FROM project_selections WHERE owner=? AND project_id=?',
                                    (owner, project_id)).fetchone()[0]
                if count >= self.limits['files']:
                    raise ProjectError(413, 'Project file limit reached')
                return None
        upload = self.store.get(owner, 'upload', existing[0])
        if not upload or upload['expires'] <= time.time() or not (self.store.folder(owner, upload['id']) / 'input').is_file():
            return None
        if (upload['name'], upload['size'], upload['directory']) != (name, size, directory):
            raise ProjectError(409, 'Recovery input identifier already used')
        return upload

    def checkpoint(self, owner, project_id, source_id, upload_id):
        self.get(owner, project_id)
        if not isinstance(source_id, str) or not re.fullmatch(r'[a-f0-9]{32}', source_id) or not isinstance(upload_id, str) or not re.fullmatch(r'[a-f0-9]{32}', upload_id):
            raise ProjectError(400, 'Invalid recovery input')
        upload = self.store.get(owner, 'upload', upload_id)
        path = self.store.folder(owner, upload_id) / 'input'
        if not upload or upload['expires'] <= time.time() or not path.is_file():
            raise ProjectError(410, 'Upload expired or unavailable')
        if path.stat().st_size != upload['size']:
            raise ProjectError(409, 'Finish uploading before saving a recovery input')
        if not upload.get('sha256'):
            upload.update(file_digest(path, Context(path.parent, self.limits)), format=detect(path))
            self.store.put(owner, 'upload', upload)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT upload_id FROM project_inputs WHERE owner=? AND project_id=? AND source_id=?', (owner, project_id, source_id)).fetchone()
            count = db.execute('SELECT count(*) FROM project_inputs WHERE owner=? AND project_id=?', (owner, project_id)).fetchone()[0]
            if not existing and count >= self.limits['files']:
                raise ProjectError(413, 'Project file limit reached')
            if existing and existing[0] != upload_id:
                raise ProjectError(409, 'Recovery input identifier already used')
            alias = db.execute('SELECT source_id FROM project_inputs WHERE owner=? AND project_id=? AND upload_id=?', (owner, project_id, upload_id)).fetchone()
            if alias and alias[0] != source_id:
                raise ProjectError(409, 'This upload is already saved in the project')
            db.execute('DELETE FROM project_selections WHERE owner=? AND project_id=? AND source_id=?', (owner, project_id, source_id))
            db.execute('INSERT OR IGNORE INTO project_inputs VALUES (?,?,?,?,?)', (owner, project_id, source_id, upload_id, time.time()))

    def inputs(self, owner, project_id, after='', limit=100, include_incomplete=False, include_selections=False):
        self.get(owner, project_id)
        if not isinstance(after, str) or after and not re.fullmatch(r'[a-f0-9]{32}', after):
            raise ProjectError(400, 'Invalid recovery cursor')
        limit = min(100, max(1, limit))
        with self.store.connect() as db:
            params = (owner, project_id, after)
            total = db.execute('SELECT count(*) FROM project_inputs WHERE owner=? AND project_id=?', params[:2]).fetchone()[0]
            query = """SELECT p.source_id,u.data,NULL AS name,NULL AS size,NULL AS directory
                FROM project_inputs p LEFT JOIN records u ON u.owner=p.owner AND u.kind='upload' AND u.id=p.upload_id
                WHERE p.owner=? AND p.project_id=? AND p.source_id>?"""
            if include_selections:
                total += db.execute('SELECT count(*) FROM project_selections WHERE owner=? AND project_id=?', params[:2]).fetchone()[0]
                query += """ UNION ALL SELECT source_id,NULL,name,size,directory FROM project_selections
                    WHERE owner=? AND project_id=? AND source_id>?"""
                params += params
            rows = db.execute(query + ' ORDER BY source_id LIMIT ?', (*params, limit)).fetchall()
        sources, inspected_sources, formats, unavailable = [], [], [], 0
        for row in rows:
            if row['name'] is not None:
                sources.append({'id': row['source_id'], 'name': row['name'], 'size': row['size'],
                                'directory': bool(row['directory']), 'pending': True})
                continue
            upload = json.loads(row[1]) if row[1] else None
            if not upload or upload['expires'] <= time.time():
                unavailable += 1
                continue
            path = self.store.folder(owner, upload['id']) / 'input'
            try:
                info = path.stat()
                offset = info.st_size
                if (not stat.S_ISREG(info.st_mode) or offset > upload['size'] or
                        (offset < upload['size'] and not include_incomplete)):
                    unavailable += 1
                    continue
                format_hint = upload.get('format')
                if offset != upload['size'] or not upload.get('sha256') or not isinstance(format_hint, str):
                    with path.open('rb') as stream:
                        format_hint = detect_header(stream.read(512))
            except FileNotFoundError:
                # Upload cleanup can race the database snapshot used for this page.
                unavailable += 1
                continue
            formats.append(format_hint)
            sources.append({'id': row[0], 'name': upload['name'], 'size': upload['size'], 'directory': upload['directory'],
                            'upload': upload['id'], 'uploaded': offset, 'expires': upload['expires']})
            inspected_sources.append(sources[-1])
        inspections = inspect_formats(formats) if formats else []
        for source, inspection in zip(inspected_sources, inspections):
            source['inspection'] = inspection
        return {'sources': sources, 'total': total, 'scanned': len(rows), 'unavailable': unavailable,
                'nextCursor': rows[-1][0] if len(rows) == limit else None}

    def forget_uploads(self, owner, project_id, uploads):
        with self.store.connect() as db:
            db.executemany('DELETE FROM project_inputs WHERE owner=? AND project_id=? AND upload_id=?',
                           [(owner, project_id, upload) for upload in uploads])

    def forget_source(self, owner, project_id, source_id):
        self.get(owner, project_id)
        with self.store.connect() as db:
            db.execute('DELETE FROM project_inputs WHERE owner=? AND project_id=? AND source_id=?', (owner, project_id, source_id))
            db.execute('DELETE FROM project_selections WHERE owner=? AND project_id=? AND source_id=?', (owner, project_id, source_id))

    def cleanup(self):
        with self.store.connect() as db:
            db.execute("DELETE FROM project_selections WHERE NOT EXISTS (SELECT 1 FROM records WHERE owner=project_selections.owner AND kind='project' AND id=project_selections.project_id)")
            db.execute("DELETE FROM project_inputs WHERE NOT EXISTS (SELECT 1 FROM records u WHERE u.owner=project_inputs.owner AND u.kind='upload' AND u.id=project_inputs.upload_id AND json_extract(u.data,'$.expires')>?)", (time.time(),))
