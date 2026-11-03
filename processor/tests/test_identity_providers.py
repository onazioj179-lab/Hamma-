import unittest
from processor.identity_providers import public_providers


class ProviderAvailabilityTests(unittest.TestCase):
    def test_unimplemented_providers_never_offer_a_redirect(self):
        providers = public_providers()
        self.assertEqual([row['id'] for row in providers], ['google', 'apple'])
        for row in providers:
            self.assertFalse(row['available'])
            self.assertNotIn('url', row)
            self.assertIn('username and password', row['message'])
