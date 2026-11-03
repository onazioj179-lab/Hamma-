import tempfile
import unittest
from processor.server import Store
from processor.catalog import FileCatalog


class CatalogTests(unittest.TestCase):
    def test_owner_isolation_pagination_unicode_and_known_duplicates(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            catalog = FileCatalog(store)
            for owner in ('a', 'b'):
                for index in range(130):
                    store.put(owner, 'upload', {'id': str(index), 'name': f'Straße-{index:03}.txt', 'size': 10,
                                               'created': index, 'expires': 9999999999,
                                               **({'sha256': 'same'} if index < 2 else {})})
            page = catalog.page('a', search='STRASSE', offset=100, limit=10000)
            self.assertEqual(page['total'], 130)
            self.assertEqual(len(page['files']), 30)
            self.assertEqual(catalog.page('a', duplicates=True)['total'], 2)
            self.assertEqual(catalog.page('unknown')['total'], 0)
            self.assertNotIn('path', page['files'][0])
            store.delete('a', '0')
            self.assertEqual(catalog.page('a', duplicates=True)['total'], 0)
            self.assertEqual(catalog.page('b', duplicates=True)['total'], 2)

    def test_duplicate_digest_also_requires_matching_size(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            catalog = FileCatalog(store)
            for index, size in enumerate((10, 10, 11)):
                store.put('owner', 'upload', {'id': str(index), 'name': str(index),
                                            'size': size, 'sha256': 'same', 'created': index})
            page = catalog.page('owner', duplicates=True)
            self.assertEqual(page['total'], 2)
            self.assertEqual({item['id'] for item in page['files']}, {'0', '1'})
