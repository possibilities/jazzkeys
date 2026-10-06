"""Offline synthetic exact-source release tests; no GUI, downloads or hardware."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('source-release.py')
COLLECTOR = SCRIPT.parents[1] / 'docs/redistribution/collect_sources.py'
SPEC = importlib.util.spec_from_file_location('source_release', SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class SourceReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.base = Path(cls.fixture.name).resolve()
        cls.repo = cls.base / 'repo'
        docs = cls.repo / 'docs/redistribution'
        docs.mkdir(parents=True)
        shutil.copyfile(COLLECTOR, docs / COLLECTOR.name)
        (docs / 'README.md').write_text('Synthetic fixture instructions, not a binary build.\n')
        cache = cls.base / 'cache'
        cache.mkdir()
        cls.payload = b'pinned upstream fixture, never executed\n'
        cls.input_path = 'upstream/fixture.crate'
        (cache / 'fixture.crate').write_bytes(cls.payload)
        (docs / 'source-inputs.json').write_text(json.dumps({'archives': [{
            'bundle_path': cls.input_path,
            'cache_filename': 'fixture.crate',
            'sha256': hashlib.sha256(cls.payload).hexdigest(),
            'size_bytes': len(cls.payload),
        }]}))
        (cls.repo / 'README.md').write_text('Synthetic exact-commit fixture.\n')

        def git(*args):
            return subprocess.check_output([
                'git', '-c', 'user.name=Source release test',
                '-c', 'user.email=source-release-test@localhost',
                '-c', 'commit.gpgsign=false', *args,
            ], cwd=cls.repo, text=True, stderr=subprocess.DEVNULL).strip()

        git('init', '--initial-branch=fixture')
        git('add', '--force', '--all')
        git('commit', '-m', 'Synthetic source release fixture')
        cls.commit = git('rev-parse', 'HEAD')
        cls.tree = git('rev-parse', 'HEAD^{tree}')
        cls.verified_source = cls.base / 'verified-source'
        subprocess.run([
            sys.executable, str(docs / COLLECTOR.name), '--output', str(cls.verified_source),
            '--cache', str(cache), '--project-ref', cls.commit,
        ], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=self.base)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'source'
        shutil.copytree(self.verified_source, self.source)
        self.output = self.directory / 'output'
        self.prefix = f'Jazzkeys-corresponding-source-{self.commit}'
        self.archive = self.output / f'{self.prefix}.tar.gz'
        self.receipt = self.output / f'{self.prefix}.json'
        self.root_patch = patch.object(release, 'ROOT', self.repo)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def package(self, verify_only=False):
        return release.package_source(self.source, self.output, self.commit, verify_only)

    def test_real_collector_and_round_trip(self):
        result = self.package()
        self.assertEqual(result['project_commit'], self.commit)
        self.assertEqual(result['source_tree'], self.tree)
        self.assertEqual(result['archive']['sha256'], hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.assertEqual(result['archive']['bytes'], self.archive.stat().st_size)
        self.assertEqual(result['source_input_count'], 1)
        self.assertEqual(result['instruction_count'], 3)
        self.assertEqual(result['file_count'], 7)
        self.assertEqual(result, self.package(verify_only=True))
        self.assertEqual(set(path.name for path in self.output.iterdir()), {self.archive.name, self.receipt.name})
        with tarfile.open(self.archive, 'r:gz') as archive:
            self.assertEqual(archive.extractfile(f'{self.prefix}/{self.input_path}').read(), self.payload)
            self.assertTrue(all(not member.issym() and not member.islnk() for member in archive))

    def test_reproducible_archive_and_receipt(self):
        first = self.package()
        second_output = self.directory / 'second-output'
        for path in self.source.rglob('*'):
            if path.is_file():
                path.chmod(0o700)
        second = release.package_source(self.source, second_output, self.commit)
        self.assertEqual(first, second)
        self.assertEqual(self.archive.read_bytes(), (second_output / self.archive.name).read_bytes())

    def test_full_commit_required(self):
        for value in ('HEAD', self.commit[:8], 'F' * 40, '../bad'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'full lowercase'):
                release.package_source(self.source, self.output, value)
        self.assertFalse(self.output.exists())

    def test_wrong_commit_rejected_by_collector(self):
        with self.assertRaises(subprocess.CalledProcessError):
            release.package_source(self.source, self.output, 'f' * 40)
        self.assertFalse(self.output.exists())

    def test_source_tampering_rejected_by_collector(self):
        for relative in (self.input_path, 'instructions/README.md', 'SOURCE-RECEIPT.json'):
            with self.subTest(relative=relative):
                target = self.source / relative
                original = target.read_bytes()
                target.write_bytes(b'tampered')
                try:
                    with self.assertRaises(subprocess.CalledProcessError):
                        self.package()
                finally:
                    target.write_bytes(original)
                self.assertFalse(self.output.exists())

    def test_extra_source_file_rejected(self):
        (self.source / 'unreviewed.txt').write_text('extra')
        with self.assertRaises(subprocess.CalledProcessError):
            self.package()

    def test_source_symlink_rejected(self):
        original = self.source / self.input_path
        original.unlink()
        original.symlink_to(self.verified_source / self.input_path)
        with self.assertRaises(subprocess.CalledProcessError):
            self.package()

    def test_source_and_output_must_not_overlap(self):
        for output in (self.source, self.source / 'assets', self.source.parent):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'overlap'):
                release.package_source(self.source, output, self.commit)

    def test_symlink_output_rejected(self):
        real = self.directory / 'real'
        real.mkdir()
        self.output.symlink_to(real, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.package()
        self.assertEqual(list(real.iterdir()), [])

    def test_no_overwrite(self):
        self.package()
        archive, receipt = self.archive.read_bytes(), self.receipt.read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.package()
        self.assertEqual(self.archive.read_bytes(), archive)
        self.assertEqual(self.receipt.read_bytes(), receipt)

    def test_receipt_alone_prevents_overwrite(self):
        self.output.mkdir()
        self.receipt.write_text('existing')
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.package()
        self.assertFalse(self.archive.exists())
        self.assertEqual(self.receipt.read_text(), 'existing')

    def test_exclusive_publication_cleans_archive_if_receipt_races(self):
        original_link = release.os.link

        def racing_link(source, target):
            if target == self.receipt:
                target.write_text('concurrent receipt')
            return original_link(source, target)

        with patch.object(release.os, 'link', side_effect=racing_link):
            with self.assertRaises(FileExistsError):
                self.package()
        self.assertFalse(self.archive.exists())
        self.assertEqual(self.receipt.read_text(), 'concurrent receipt')
        self.assertEqual(list(self.output.iterdir()), [self.receipt])

    def test_missing_verify_creates_nothing(self):
        with self.assertRaisesRegex(ValueError, 'Missing release asset'):
            self.package(verify_only=True)
        self.assertFalse(self.output.exists())

    def test_receipt_digest_and_commit_must_match(self):
        result = self.package()
        for key in ('project_commit', 'source_tree', 'archive'):
            with self.subTest(key=key):
                changed = dict(result)
                changed[key] = 'tampered'
                self.receipt.write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError, 'Release receipt mismatch'):
                    self.package(verify_only=True)

    def test_malicious_and_changed_archive_members_rejected(self):
        _, records = release.verify_source(self.source, self.commit)
        self.output.mkdir()
        member_name = f'{self.prefix}/{self.input_path}'
        cases = ('traversal', 'absolute', 'backslash', 'duplicate', 'symlink',
                 'hardlink', 'fifo', 'extra', 'missing', 'content', 'mode', 'pax')
        for case in cases:
            with self.subTest(case=case):
                with tarfile.open(self.archive, 'w:gz') as archive:
                    if case != 'missing':
                        names = {
                            'traversal': f'{self.prefix}/../outside',
                            'absolute': '/outside', 'backslash': f'{self.prefix}/bad\\path',
                            'extra': f'{self.prefix}/unreviewed.txt',
                        }
                        member = tarfile.TarInfo(names.get(case, member_name))
                        member.mode = 0o644
                        member.size = len(self.payload)
                        if case in ('symlink', 'hardlink', 'fifo'):
                            member.type = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE,
                                           'fifo': tarfile.FIFOTYPE}[case]
                            member.size = 0
                            if case != 'fifo':
                                member.linkname = '/outside'
                        if case == 'mode':
                            member.mode = 0o4777
                        if case == 'pax':
                            member.pax_headers = {'SCHILY.xattr.bad': 'unexpected'}
                        payload = b'x' * len(self.payload) if case == 'content' else self.payload
                        archive.addfile(member, io.BytesIO(payload))
                        if case == 'duplicate':
                            archive.addfile(member, io.BytesIO(payload))
                with self.assertRaises(ValueError):
                    release.verify_archive(self.archive, self.prefix, records)

    def test_archive_failure_publishes_nothing(self):
        with patch.object(release, 'verify_archive', side_effect=ValueError('synthetic failure')):
            with self.assertRaisesRegex(ValueError, 'synthetic failure'):
                self.package()
        self.assertEqual(list(self.output.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
