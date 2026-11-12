"""Disk-backed local discovery for operator-authorized roots.

This is an internal indexing primitive, not an HTTP filesystem access endpoint.
Directories commit in bounded batches. Interrupted directories are rescanned;
unique relative paths make replay idempotent. Links are recorded, never followed.
Use a private database outside the scanned tree and one discoverer per database.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import stat

from .engine import ProcessingError


class IndexQuotaError(ProcessingError):
    pass


class DirectoryIndex:
    def __init__(self, database, root, *, max_entries, batch_size=256, checkpoint=lambda: None):
        self.root = Path(root).resolve(strict=True)
        self.database = Path(database).resolve()
        if not self.root.is_dir():
            raise ValueError('Discovery root must be a directory')
        if self.database == self.root or self.root in self.database.parents:
            raise ValueError('Index database must be outside the discovery root')
        if type(max_entries) is not int or not 1 <= max_entries <= 2**63 - 1:
            raise ValueError('A positive 64-bit entry quota is required')
        if type(batch_size) is not int or not 1 <= batch_size <= 4096:
            raise ValueError('Batch size must be between 1 and 4096')
        self.max_entries, self.batch_size = max_entries, batch_size
        self.checkpoint = checkpoint
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            saved = db.execute("SELECT value FROM metadata WHERE key='root'").fetchone()
            if saved and saved[0] != str(self.root):
                raise ValueError('Index belongs to another root')
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('root',?)", (str(self.root),))
            db.execute('CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY,path TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,size INTEGER NOT NULL,mtime_ns INTEGER NOT NULL,error TEXT)')
            if not db.execute("SELECT 1 FROM metadata WHERE key='entry_count'").fetchone():
                db.execute("INSERT INTO metadata SELECT 'entry_count',cast(count(*) AS TEXT) FROM entries")
            db.execute('CREATE TABLE IF NOT EXISTS frontier(path TEXT PRIMARY KEY,done INTEGER NOT NULL DEFAULT 0)')
            db.execute('CREATE INDEX IF NOT EXISTS frontier_pending ON frontier(done,path)')
            db.execute("INSERT OR IGNORE INTO frontier(path) VALUES ('')")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        try:
            with db:
                yield db
        finally:
            db.close()

    def _commit(self, rows):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            count = int(db.execute("SELECT value FROM metadata WHERE key='entry_count'").fetchone()[0])
            inserted = db.executemany(
                'INSERT INTO entries(path,kind,size,mtime_ns,error) VALUES (?,?,?,?,?) ON CONFLICT(path) DO NOTHING',
                rows,
            ).rowcount
            if inserted and count + inserted > self.max_entries:
                raise IndexQuotaError('Discovery entry quota reached; raise quota to resume')
            count += inserted
            if inserted != len(rows):
                # Replay updates metadata without changing entry IDs.
                db.executemany('UPDATE entries SET kind=?,size=?,mtime_ns=?,error=? WHERE path=?',
                               [(kind, size, mtime, error, path) for path, kind, size, mtime, error in rows])
            db.executemany('INSERT OR IGNORE INTO frontier(path) VALUES (?)',
                           [(path,) for path, kind, *_ in rows if kind == 'directory'])
            db.execute("UPDATE metadata SET value=? WHERE key='entry_count'", (str(count),))
        self.checkpoint()

    def discover(self, *, cancelled=lambda: False):
        """Return False on cooperative interruption, True after all directories.

        The source tree should be stable while indexing. This is not a snapshot
        or a secure file-opening authority: consumers must revalidate paths and
        metadata before processing. A changed/reparse ancestor is rejected here.
        """
        while not cancelled():
            with self.connect() as db:
                pending = db.execute('SELECT path FROM frontier WHERE done=0 ORDER BY path LIMIT 1').fetchone()
            if pending is None:
                return True
            relative = pending[0]
            directory = self.root / relative
            rows = []
            try:
                current = self.root
                for part in ('', *Path(relative).parts):
                    current = current / part
                    info = current.lstat()
                    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                        raise OSError('Directory became a link or reparse point')
                with os.scandir(directory) as children:
                    for child in children:
                        if cancelled():
                            self._commit(rows)
                            return False
                        path = (Path(relative) / child.name).as_posix()
                        try:
                            info = child.stat(follow_symlinks=False)
                            link = stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400
                            kind = 'link' if link else 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'special'
                            rows.append((path, kind, info.st_size, info.st_mtime_ns, None))
                        except OSError as error:
                            rows.append((path, 'error', 0, 0, str(error)))
                        if len(rows) >= self.batch_size:
                            self._commit(rows)
                            rows.clear()
                self._commit(rows)
            except OSError as error:
                self._commit([(relative or '.', 'error', 0, 0, str(error))])
            with self.connect() as db:
                db.execute('UPDATE frontier SET done=1 WHERE path=?', (relative,))
        return False

    def page(self, *, after=0, limit=100):
        if type(after) is not int or not 0 <= after <= 2**63 - 1:
            raise ValueError('Invalid index cursor')
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Page size must be between 1 and 1000')
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM entries WHERE id>? ORDER BY id LIMIT ?', (after, limit))]

    def manifest(self, stream):
        """Write JSON Lines with bounded memory, preserving stable entry IDs."""
        after = 0
        while rows := self.page(after=after, limit=1000):
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=True) + '\n')
            after = rows[-1]['id']

    def summary(self):
        with self.connect() as db:
            return {'entries': int(db.execute("SELECT value FROM metadata WHERE key='entry_count'").fetchone()[0]),
                    'errors': db.execute("SELECT count(*) FROM entries WHERE kind='error'").fetchone()[0],
                    'pendingDirectories': db.execute('SELECT count(*) FROM frontier WHERE done=0').fetchone()[0]}


def main():
    import argparse
    import sys
    parser = argparse.ArgumentParser(description='Index an explicitly authorized local folder without loading its file list into RAM')
    parser.add_argument('root', type=Path)
    parser.add_argument('--database', type=Path, required=True, help='Private index path outside the source tree; reuse to resume')
    parser.add_argument('--max-entries', type=int, required=True, help='Operator resource quota, not a supported-capacity claim')
    parser.add_argument('--batch-size', type=int, default=256)
    args = parser.parse_args()
    try:
        index = DirectoryIndex(args.database, args.root, max_entries=args.max_entries, batch_size=args.batch_size)
        index.discover()
        index.manifest(sys.stdout)
        summary = index.summary()
        print(json.dumps(summary), file=sys.stderr)
        if summary['errors']:
            parser.exit(1, 'Discovery finished with errors; consult manifest diagnostics.\n')
    except (OSError, ValueError, IndexQuotaError) as error:
        parser.exit(1, f'Indexing incomplete: {error}\n')


if __name__ == '__main__':
    main()
