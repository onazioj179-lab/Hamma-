"""Owner-scoped, paginated index of explicitly uploaded files; no drive access."""


class FileCatalog:
    def __init__(self, store):
        self.store = store
        with store.connect() as db:
            db.execute("CREATE INDEX IF NOT EXISTS catalog_digest ON records(owner,kind,json_extract(data,'$.sha256'))")
            db.execute("CREATE INDEX IF NOT EXISTS catalog_name ON records(owner,kind,hamma_casefold(json_extract(data,'$.name')),id)")

    def page(self, owner, *, search='', offset=0, limit=50, duplicates=False):
        conditions = ["r.owner=?", "r.kind='upload'"]
        parameters = [owner]
        if search:
            conditions.append("instr(hamma_casefold(json_extract(r.data,'$.name')),?)>0")
            parameters.append(search.casefold())
        if duplicates:
            conditions.append("(json_extract(r.data,'$.sha256'),json_extract(r.data,'$.size')) IN (SELECT json_extract(data,'$.sha256'),json_extract(data,'$.size') FROM records WHERE owner=? AND kind='upload' AND json_type(data,'$.sha256')='text' GROUP BY json_extract(data,'$.sha256'),json_extract(data,'$.size') HAVING count(*)>1)")
            parameters.append(owner)
        where = ' AND '.join(conditions)
        with self.store.connect() as db:
            db.execute('BEGIN')
            total = db.execute('SELECT count(*) FROM records r WHERE ' + where, parameters).fetchone()[0]
            rows = db.execute("SELECT json_object('id',r.id,'name',json_extract(r.data,'$.name'),'size',json_extract(r.data,'$.size'),'format',json_extract(r.data,'$.format'),'sha256',json_extract(r.data,'$.sha256'),'created',r.created,'expires',json_extract(r.data,'$.expires'),'directory',coalesce(json_extract(r.data,'$.directory'),0)) FROM records r WHERE " + where + ' ORDER BY hamma_casefold(json_extract(r.data,\'$.name\')),r.id LIMIT ? OFFSET ?', [*parameters, min(100, max(1, limit)), min(2**63-1, max(0, offset))]).fetchall()
        import json
        return {'total': total, 'files': [json.loads(row[0]) for row in rows],
                'scope': 'retained-uploads', 'duplicateScope': 'verified-checksums-only'}
