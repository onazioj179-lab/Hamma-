"""Short-lived, owner-scoped upload selections for paged job admission."""
import re
import sqlite3
import time

from .projects import ProjectError, Projects

PAGE_SIZE = 100
LEASE_SECONDS = 900
MAX_OWNER_SELECTIONS = 64
MAX_SELECTIONS = 512


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
            rows = db.execute('SELECT upload_id FROM job_selection_items WHERE owner=? AND selection_id=? ORDER BY position',
                              key).fetchall()
            if len(rows) != count:
                raise ProjectError(409, 'Job selection is incomplete')
            if not selection['sealed']:
                db.execute('UPDATE job_selections SET sealed=1 WHERE owner=? AND id=?', key)
            return [row[0] for row in rows]

    def cleanup(self):
        with self.store.connect() as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute("""DELETE FROM job_selections WHERE (owner,id) IN (
                SELECT owner,id FROM job_selections WHERE expires<=? ORDER BY expires LIMIT 32
            )""", (time.time(),))
