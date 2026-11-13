"""Short-lived, owner-scoped upload selections for paged job admission."""
from dataclasses import dataclass
import hashlib
import json
import re
import sqlite3
import time
from typing import TYPE_CHECKING

from .projects import ProjectError, Projects

if TYPE_CHECKING:
    from .server import Store

PAGE_SIZE = 100
LEASE_SECONDS = 900
MAX_OWNER_SELECTIONS = 64
MAX_SELECTIONS = 512


def recovery_request_id(project, sorted_ids, *options):
    """Hash the existing v1 JSON identity without building its upload array."""
    prefix = json.dumps(['project-recovery-v1', project], separators=(',', ':'))
    digest = hashlib.sha256((prefix[:-1] + ',[').encode())
    separator = b''
    for upload_id in sorted_ids:
        digest.update(separator + json.dumps(upload_id).encode())
        separator = b','
    suffix = json.dumps(options, separators=(',', ':'))
    digest.update(('],' + suffix[1:]).encode())
    return digest.hexdigest()


@dataclass(frozen=True)
class SealedSelection:
    store: 'Store'
    owner: str
    id: str
    count: int
    lease: float

    def pages(self, *, by_id=False):
        key = 'upload_id' if by_id else 'position'
        after = '' if by_id else -1
        scanned = 0
        while scanned < self.count:
            with self.store.connect() as db:
                rows = db.execute(f"""
                    SELECT item.{key},item.upload_id FROM job_selection_items AS item
                    JOIN job_selections AS selection ON selection.owner=item.owner AND selection.id=item.selection_id
                    WHERE item.owner=? AND item.selection_id=? AND item.{key}>?
                        AND selection.expires=? AND selection.sealed=1
                    ORDER BY item.{key} LIMIT ?
                """, (self.owner, self.id, after, self.lease, min(PAGE_SIZE, self.count - scanned))).fetchall()
            if not rows or not by_id and rows[-1][0] != scanned + len(rows) - 1:
                raise ProjectError(409, 'Job selection is incomplete')
            scanned += len(rows)
            after = rows[-1][0]
            yield [row[1] for row in rows]

    def ids(self, *, by_id=False):
        for page in self.pages(by_id=by_id):
            yield from page


class AdmissionInputs:
    """Private SQLite spool. The scheduler sees the job only after promotion."""

    def __init__(self, db, path):
        self.db = db
        self.path = path
        db.execute("""CREATE TABLE inputs (
            position INTEGER PRIMARY KEY, upload_id TEXT UNIQUE NOT NULL,
            name_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL,
            fingerprint TEXT NOT NULL, needs_digest INTEGER NOT NULL
        )""")
        self.count = 0
        self.size = 0

    @staticmethod
    def fingerprint(info):
        return json.dumps((info.st_dev, info.st_ino, info.st_mode, info.st_size,
                           info.st_mtime_ns, info.st_ctime_ns))

    def append(self, upload, info, needs_digest):
        try:
            self.db.execute('INSERT INTO inputs VALUES (?,?,?,?,?,?)', (
                self.count, upload['id'], upload['name'].casefold(), json.dumps(upload),
                self.fingerprint(info), needs_digest,
            ))
        except sqlite3.IntegrityError as error:
            raise ProjectError(400, 'Duplicate filename') from error
        self.count += 1
        self.size += upload['size']

    def check_files(self, store, owner):
        for upload_id, fingerprint in self.db.execute('SELECT upload_id,fingerprint FROM inputs'):
            source = store.folder(owner, upload_id) / 'input'
            try:
                current = self.fingerprint(source.stat())
            except FileNotFoundError as error:
                raise ProjectError(410, 'Upload expired or unavailable') from error
            if current != fingerprint:
                raise ProjectError(409, 'Upload changed during verification')

    def promote(self, store, owner, record, recoverable):
        self.db.commit()
        with store.connect() as db:
            db.execute('ATTACH DATABASE ? AS admission', (str(self.path),))
            db.execute('BEGIN IMMEDIATE')
            available = db.execute("""
                SELECT count(*) FROM admission.inputs AS item
                JOIN records ON records.owner=? AND records.kind='upload' AND records.id=item.upload_id
                WHERE json_extract(records.data,'$.expires')>?
            """, (owner, record['created'])).fetchone()[0]
            if available != self.count:
                raise ProjectError(410, 'Upload expired or unavailable')
            db.execute("""
                UPDATE records AS upload SET data=json_set(upload.data,
                    '$.sha256', json_extract(item.data,'$.sha256'),
                    '$.format', json_extract(item.data,'$.format'))
                FROM admission.inputs AS item
                WHERE item.needs_digest AND upload.owner=? AND upload.kind='upload'
                    AND upload.id=item.upload_id
            """, (owner,))
            job_id = record['id']
            db.execute('INSERT INTO records VALUES (?,?,?,?,?)',
                       (job_id, owner, 'job', record['created'], json.dumps(record)))
            db.execute('INSERT INTO job_input_pages SELECT ?,?,position,data FROM admission.inputs',
                       (owner, job_id))
            db.execute('INSERT INTO job_inputs SELECT ?,?,upload_id FROM admission.inputs', (owner, job_id))
            if recoverable:
                forget_job_uploads(db, owner, record['projectId'], job_id)


def forget_job_uploads(db, owner, project, job_id):
    db.execute("""DELETE FROM project_inputs WHERE owner=? AND project_id=? AND upload_id IN (
        SELECT upload_id FROM job_inputs WHERE owner=? AND job_id=?
    )""", (owner, project, owner, job_id))


class JobSelections:
    def __init__(self, store, file_limit):
        self.store = store
        self.file_limit = file_limit
        with store.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS job_selections (
                owner TEXT NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL,
                expires REAL NOT NULL, count INTEGER NOT NULL, sealed INTEGER NOT NULL,
                PRIMARY KEY(owner,id)
            )""")
            db.execute('CREATE INDEX IF NOT EXISTS job_selections_expiry ON job_selections(expires)')
            db.execute("""CREATE TABLE IF NOT EXISTS job_selection_items (
                owner TEXT NOT NULL, selection_id TEXT NOT NULL, position INTEGER NOT NULL,
                upload_id TEXT NOT NULL, PRIMARY KEY(owner,selection_id,position),
                UNIQUE(owner,selection_id,upload_id),
                FOREIGN KEY(owner,selection_id) REFERENCES job_selections(owner,id) ON DELETE CASCADE
            )""")

    def append(self, owner, selection_id, project, offset, uploads):
        Projects.identifier(project)
        if (type(offset) is not int or not isinstance(uploads, list) or
                not 1 <= len(uploads) <= PAGE_SIZE or not 0 <= offset <= self.file_limit - len(uploads) or
                not all(isinstance(item, str) and re.fullmatch(r'[a-f0-9]{32}', item) for item in uploads) or
                len(set(uploads)) != len(uploads)):
            raise ProjectError(400, 'Invalid job selection page')
        now = time.time()
        key = (owner, selection_id)
        end = offset + len(uploads)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            selection = db.execute('SELECT * FROM job_selections WHERE owner=? AND id=?', key).fetchone()
            if selection is None:
                if offset:
                    raise ProjectError(409, 'Start the job selection at offset zero')
                owner_count = db.execute('SELECT count(*) FROM job_selections WHERE owner=? AND expires>?', (owner, now)).fetchone()[0]
                total = db.execute('SELECT count(*) FROM job_selections WHERE expires>?', (now,)).fetchone()[0]
                if owner_count >= MAX_OWNER_SELECTIONS or total >= MAX_SELECTIONS:
                    raise ProjectError(429, 'Too many pending job selections')
                db.execute('INSERT INTO job_selections VALUES (?,?,?,?,0,0)', (*key, project, now + LEASE_SECONDS))
                count, sealed = 0, False
            else:
                if selection['expires'] <= now:
                    raise ProjectError(410, 'Job selection expired')
                if selection['project'] != project:
                    raise ProjectError(409, 'Job selection belongs to another project')
                count, sealed = selection['count'], selection['sealed']

            if offset < count:
                previous = db.execute("""SELECT upload_id FROM job_selection_items
                    WHERE owner=? AND selection_id=? AND position>=? AND position<? ORDER BY position""",
                    (*key, offset, end)).fetchall()
                if [row[0] for row in previous] == uploads:
                    return end
                raise ProjectError(409, 'Job selection page changed')
            if sealed or offset != count:
                raise ProjectError(409, 'Job selection cannot accept this page')
            try:
                db.executemany('INSERT INTO job_selection_items VALUES (?,?,?,?)',
                               [(*key, position, upload) for position, upload in enumerate(uploads, offset)])
            except sqlite3.IntegrityError as error:
                raise ProjectError(409, 'Job selection contains a duplicate upload') from error
            db.execute('UPDATE job_selections SET count=? WHERE owner=? AND id=?', (end, *key))
        return end

    def seal(self, owner, selection_id, project, count):
        if (not isinstance(selection_id, str) or not re.fullmatch(r'[a-f0-9]{32}', selection_id) or
                type(count) is not int or not 1 <= count <= self.file_limit):
            raise ProjectError(400, 'Invalid job selection reference')
        key = (owner, selection_id)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            selection = db.execute('SELECT * FROM job_selections WHERE owner=? AND id=? AND project=?',
                                   (*key, project)).fetchone()
            if not selection:
                raise ProjectError(404, 'Job selection unavailable')
            if selection['expires'] <= time.time():
                raise ProjectError(410, 'Job selection expired')
            if selection['count'] != count:
                raise ProjectError(409, 'Job selection is incomplete')
            if not selection['sealed']:
                db.execute('UPDATE job_selections SET sealed=1 WHERE owner=? AND id=?', key)
        return SealedSelection(self.store, owner, selection_id, count, selection['expires'])

    def cleanup(self):
        with self.store.connect() as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute("""DELETE FROM job_selections WHERE (owner,id) IN (
                SELECT owner,id FROM job_selections WHERE expires<=? ORDER BY expires LIMIT 32
            )""", (time.time(),))
