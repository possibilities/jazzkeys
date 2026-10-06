import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from test_release_launch import synthetic_assets, TREE, RUN_ID, ATTEMPT

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-mac-release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
COMMIT = 'a' * 40


class FakeAPI:
    def __init__(self, release=None, tag=None):
        self.release = release
        self.tag = tag
        self.assets = []
        self.mutations = []

    def request(self, method, path, body=None, file=None, allow_not_found=False):
        if method == 'GET' and '/git/ref/tags/' in path:
            return {'object': {'type': 'commit', 'sha': self.tag}} if self.tag else None
        if method == 'GET' and '/releases?' in path:
            return [dict(self.release)] if self.release else []
        if method == 'GET' and '/assets?' in path:
            return list(self.assets)
        self.mutations.append((method, path))
        if method == 'POST' and path.endswith('/releases'):
            self.release = {**body, 'id': 42, 'html_url': 'https://github.com/possibilities/jazzkeys/releases/tag/demo'}
            return dict(self.release)
        if method == 'POST' and '/assets?' in path:
            asset = {'name': file.name, 'size': file.stat().st_size, 'digest': 'sha256:' + m.digest(file), 'state': 'uploaded'}
            self.assets.append(asset)
            return dict(asset)
        if method == 'PATCH':
            self.release.update(body)
            self.tag = COMMIT
            return dict(self.release)
        raise AssertionError((method, path))


def draft():
    return {'id': 42, 'tag_name': 'demo', 'target_commitish': COMMIT, 'name': 'title', 'body': 'body',
            'draft': True, 'prerelease': True, 'html_url': 'https://github.com/possibilities/jazzkeys/releases/tag/demo'}


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'source.tar.gz'
        self.path.write_bytes(b'test-only fixture')

    def publish(self, api):
        return m.publish(api, 'demo', COMMIT, 'title', 'body', [self.path])

    def test_new_release_is_draft_until_all_assets_verified(self):
        api = FakeAPI()
        self.assertIn('/releases/tag/', self.publish(api))
        self.assertEqual([method for method, path in api.mutations], ['POST', 'POST', 'PATCH'])
        self.assertFalse(api.release['draft'])

    def test_matching_draft_resumes_without_creating_duplicate(self):
        api = FakeAPI(draft())
        self.publish(api)
        self.assertFalse(any(path.endswith('/releases') for method, path in api.mutations))

    def test_complete_published_release_is_read_only_retry(self):
        api = FakeAPI()
        self.publish(api)
        api.mutations.clear()
        self.publish(api)
        self.assertEqual(api.mutations, [])

    def test_conflicting_tag_rejected_before_mutation(self):
        api = FakeAPI(tag='b' * 40)
        with self.assertRaisesRegex(ValueError, 'tag'):
            self.publish(api)
        self.assertEqual(api.mutations, [])

    def test_conflicting_release_metadata_rejected(self):
        release = draft()
        release['body'] = 'different'
        api = FakeAPI(release)
        with self.assertRaisesRegex(ValueError, 'metadata'):
            self.publish(api)
        self.assertEqual(api.mutations, [])

    def test_existing_asset_mismatch_is_never_overwritten(self):
        api = FakeAPI(draft())
        api.assets = [{'name': self.path.name, 'size': self.path.stat().st_size, 'digest': 'sha256:' + '0' * 64, 'state': 'uploaded'}]
        with self.assertRaisesRegex(ValueError, 'verification failed'):
            self.publish(api)
        self.assertEqual(api.mutations, [])

    def test_missing_published_asset_does_not_expand_release(self):
        release = draft()
        release['draft'] = False
        api = FakeAPI(release, COMMIT)
        with self.assertRaisesRegex(ValueError, 'missing an asset'):
            self.publish(api)
        self.assertEqual(api.mutations, [])

    def test_asset_names_and_hashes_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            m.check_file(Path(self.temp.name), {'name': '../outside'})
        with self.assertRaisesRegex(ValueError, 'differs'):
            m.check_file(Path(self.temp.name), {'name': self.path.name, 'bytes': 1, 'sha256': '0' * 64})


class PublisherLaunchGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory, self.mac, self.receipt = synthetic_assets(Path(self.temp.name))

    def verify(self):
        return m.verify_assets(self.directory, COMMIT, TREE, RUN_ID, ATTEMPT)

    def test_archive_bound_same_run_receipt_is_a_required_public_asset(self):
        mac, assets = self.verify()
        self.assertEqual(mac, self.mac)
        self.assertEqual(len(assets), 6)
        self.assertIn('macos-launch.json', {path.name for path in assets})

    def test_missing_launch_receipt_rejected(self):
        (self.directory / 'macos-launch.json').unlink()
        with self.assertRaisesRegex(ValueError, 'receipt'):
            self.verify()

    def test_same_commit_different_run_receipt_rejected(self):
        self.receipt['workflow']['runId'] = '999'
        self.receipt['workflow']['url'] = 'https://github.com/possibilities/jazzkeys/actions/runs/999'
        (self.directory / 'macos-launch.json').write_text(json.dumps(self.receipt))
        with self.assertRaisesRegex(ValueError, 'workflow run'):
            self.verify()

    def test_other_archive_receipt_rejected(self):
        self.receipt['archive']['sha256'] = '0' * 64
        (self.directory / 'macos-launch.json').write_text(json.dumps(self.receipt))
        with self.assertRaisesRegex(ValueError, 'source/archive correspondence'):
            self.verify()

    def test_launch_cleanup_failure_blocks_publication(self):
        self.receipt['launch']['forceAttempted'] = True
        (self.directory / 'macos-launch.json').write_text(json.dumps(self.receipt))
        with self.assertRaisesRegex(ValueError, 'gracefully quit'):
            self.verify()

    def test_extra_assets_and_symlink_receipts_rejected(self):
        unexpected = self.directory / 'another-app.zip'
        unexpected.write_bytes(b'unexpected')
        with self.assertRaisesRegex(ValueError, 'staging contents'):
            self.verify()
        unexpected.unlink()
        receipt = self.directory / 'macos-launch.json'
        moved = Path(self.temp.name) / 'elsewhere.json'
        receipt.rename(moved)
        receipt.symlink_to(moved)
        with self.assertRaisesRegex(ValueError, 'unsafe receipt'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
