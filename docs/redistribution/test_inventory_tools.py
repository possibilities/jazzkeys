"""Offline tests for source-input collection; no project/runtime code executes."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tarfile
import unittest

SCRIPT = Path(__file__).with_name('collect_sources.py')


class SourceCollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.docs = self.repo / 'docs' / 'redistribution'
        self.docs.mkdir(parents=True)
        self.script = self.docs / SCRIPT.name
        shutil.copyfile(SCRIPT, self.script)
        self.cache = self.base / 'cache'
        self.cache.mkdir()
        self.payload = b'fixture bytes; never extracted or executed'
        (self.cache / 'fixture.crate').write_bytes(self.payload)
        self.output = self.base / 'companion'
        self.entry = {
            'bundle_path': 'native/registry/fixture.crate',
            'cache_filename': 'fixture.crate',
            'sha256': hashlib.sha256(self.payload).hexdigest(),
            'size_bytes': len(self.payload),
        }
        self.write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self):
        (self.docs / 'source-inputs.json').write_text(json.dumps({'archives': [self.entry]}))

    def run_collector(self, *extra):
        return subprocess.run([sys.executable, str(self.script), '--output',
                               str(self.output), *extra], text=True, capture_output=True)

    def commit_fixture(self):
        def git(*args):
            return subprocess.check_output([
                'git', '-c', 'user.name=Source collector test',
                '-c', 'user.email=collector-test@localhost',
                '-c', 'commit.gpgsign=false', *args,
            ], cwd=self.repo, text=True, stderr=subprocess.DEVNULL).strip()
        git('init', '--initial-branch=fixture')
        git('add', '--force', '--all')
        git('commit', '-m', 'Original source fixture')
        return git('rev-parse', 'HEAD')

    def test_collect_and_verify_offline(self):
        run = self.run_collector('--cache', str(self.cache))
        self.assertEqual(run.returncode, 0, run.stderr)
        target = self.output / self.entry['bundle_path']
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertIn('not a complete release source companion', run.stdout)
        self.assertEqual(self.run_collector('--verify-only').returncode, 0)

    def test_corrupt_archive_fails(self):
        self.assertEqual(self.run_collector('--cache', str(self.cache)).returncode, 0)
        (self.output / self.entry['bundle_path']).write_bytes(b'changed')
        run = self.run_collector('--verify-only')
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('mismatched source archive', run.stderr)

    def test_traversal_rejected(self):
        self.entry['bundle_path'] = '../outside.crate'
        self.write_manifest()
        run = self.run_collector('--cache', str(self.cache))
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Unsafe manifest entry', run.stderr)
        self.assertFalse((self.base / 'outside.crate').exists())

    def test_symlink_output_rejected(self):
        real = self.base / 'real'
        real.mkdir()
        self.output.symlink_to(real, target_is_directory=True)
        run = self.run_collector('--cache', str(self.cache))
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('symlink', run.stderr)
        self.assertEqual(list(real.iterdir()), [])

    def test_missing_verify_does_not_create_output(self):
        run = self.run_collector('--verify-only')
        self.assertNotEqual(run.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_archive_reconstructs_clean_git_tree(self):
        def git(cwd, *args):
            return subprocess.check_output([
                'git', '-c', 'user.name=Local source rebuild test',
                '-c', 'user.email=rebuild-test@localhost',
                '-c', 'commit.gpgsign=false', *args,
            ], cwd=cwd, text=True, stderr=subprocess.STDOUT).strip()

        git(self.repo, 'init', '--initial-branch=fixture')
        git(self.repo, 'add', '--force', '--all')
        git(self.repo, 'commit', '-m', 'Original source fixture')
        original = git(self.repo, 'rev-parse', 'HEAD')
        original_tree = git(self.repo, 'rev-parse', 'HEAD^{tree}')
        run = self.run_collector('--cache', str(self.cache), '--project-ref', original)
        self.assertEqual(run.returncode, 0, run.stderr)
        receipt = json.loads((self.output / 'SOURCE-RECEIPT.json').read_text())
        project = receipt['project_source']
        self.assertEqual(project['source_tree'], original_tree)
        self.assertEqual(project['commit'], original)
        self.assertEqual(self.run_collector('--verify-only', '--project-ref', original).returncode, 0)

        unpack = self.base / 'unpack'
        unpack.mkdir()
        with tarfile.open(self.output / project['path']) as archive:
            archive.extractall(unpack, filter='data')
        checkout = unpack / f'jazzkeys-{original}'
        self.assertFalse((checkout / '.git').exists())
        git(checkout, 'init', '--initial-branch=rebuild')
        git(checkout, 'config', 'core.autocrlf', 'false')
        git(checkout, 'add', '--force', '--all')
        self.assertEqual(git(checkout, 'write-tree'), original_tree)
        git(checkout, 'commit', '-m', f'Reconstruct release source {original}')
        self.assertEqual(git(checkout, 'rev-parse', 'HEAD^{tree}'), original_tree)
        self.assertNotEqual(git(checkout, 'rev-parse', 'HEAD'), original)
        self.assertEqual(git(checkout, 'status', '--porcelain'), '')

    def test_missing_source_does_not_download_without_opt_in(self):
        self.entry['url'] = 'https://example.invalid/must-not-request.crate'
        self.write_manifest()
        run = self.run_collector()
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Source bytes required', run.stderr)

    def test_project_ref_selects_its_own_manifest_and_instructions(self):
        original = self.commit_fixture()
        committed_manifest = (self.docs / 'source-inputs.json').read_bytes()
        # A different checkout's dependency and instructions must not leak into
        # an earlier release's source companion, even when the tree is dirty.
        self.entry['sha256'] = hashlib.sha256(b'new dependency').hexdigest()
        self.entry['size_bytes'] = len(b'new dependency')
        self.write_manifest()
        (self.docs / 'uncommitted-instructions.txt').write_text('not release A')
        run = self.run_collector('--cache', str(self.cache), '--project-ref', original)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((self.output / 'source-inputs.json').read_bytes(), committed_manifest)
        self.assertEqual((self.output / self.entry['bundle_path']).read_bytes(), self.payload)
        self.assertFalse((self.output / 'instructions/uncommitted-instructions.txt').exists())
        run = self.run_collector('--verify-only', '--project-ref', original)
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_missing_or_changed_copied_instructions_fail(self):
        for name in ['source-inputs.json', 'instructions/collect_sources.py']:
            with self.subTest(name=name):
                self.assertEqual(self.run_collector('--cache', str(self.cache)).returncode, 0)
                target = self.output / name
                original = target.read_bytes()
                for changed in [None, b'changed instructions']:
                    if changed is None:
                        target.unlink()
                    else:
                        target.write_bytes(changed)
                    run = self.run_collector('--verify-only')
                    self.assertNotEqual(run.returncode, 0)
                    self.assertIn('companion instructions', run.stderr)
                target.write_bytes(original)

    def test_receipt_manifest_instruction_and_project_tree_hashes_fail(self):
        original = self.commit_fixture()
        self.assertEqual(self.run_collector('--cache', str(self.cache), '--project-ref', original).returncode, 0)
        receipt_path = self.output / 'SOURCE-RECEIPT.json'
        original_receipt = receipt_path.read_bytes()
        for field in ['manifest_sha256', 'instructions', 'source_tree', 'source_input_count']:
            with self.subTest(field=field):
                receipt = json.loads(original_receipt)
                if field == 'source_tree':
                    receipt['project_source'][field] = '0' * 40
                elif field == 'instructions':
                    receipt[field][0]['sha256'] = '0' * 64
                elif field == 'source_input_count':
                    receipt[field] = 0
                else:
                    receipt[field] = '0' * 64
                receipt_path.write_text(json.dumps(receipt))
                self.assertNotEqual(self.run_collector('--verify-only', '--project-ref', original).returncode, 0)
        receipt_path.write_bytes(original_receipt)

    def test_rehashed_changed_project_archive_still_fails_tree_check(self):
        original = self.commit_fixture()
        self.assertEqual(self.run_collector('--cache', str(self.cache), '--project-ref', original).returncode, 0)
        receipt_path = self.output / 'SOURCE-RECEIPT.json'
        receipt = json.loads(receipt_path.read_text())
        path = self.output / receipt['project_source']['path']
        rewritten = self.base / 'changed.tar.gz'
        with tarfile.open(path) as source, tarfile.open(rewritten, 'w:gz', format=tarfile.PAX_FORMAT,
                                                      pax_headers=source.pax_headers) as destination:
            for member in source:
                destination.addfile(member, source.extractfile(member) if member.isfile() else None)
            added = tarfile.TarInfo(f'jazzkeys-{original}/not-in-original-source.txt')
            added.size = 7
            destination.addfile(added, io.BytesIO(b'changed'))
        shutil.copyfile(rewritten, path)
        receipt['project_source']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        receipt_path.write_text(json.dumps(receipt))
        run = self.run_collector('--verify-only', '--project-ref', original)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('source tree mismatch', run.stderr)

    def test_extra_companion_files_and_missing_project_ref_fail(self):
        original = self.commit_fixture()
        self.assertEqual(self.run_collector('--cache', str(self.cache), '--project-ref', original).returncode, 0)
        run = self.run_collector('--verify-only')
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Use --project-ref', run.stderr)
        (self.output / 'private-leftover.txt').write_text('must not be accidentally published')
        run = self.run_collector('--verify-only', '--project-ref', original)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Unexpected or missing companion files', run.stderr)

    def test_project_archive_and_receipt_symlinks_fail_before_overwrite(self):
        original = self.commit_fixture()
        self.output.mkdir()
        sentinel = self.base / 'sentinel'
        sentinel.write_bytes(b'untouched')
        for name in ['SOURCE-RECEIPT.json', f'jazzkeys-{original}.tar.gz']:
            with self.subTest(name=name):
                link = self.output / name
                link.symlink_to(sentinel)
                run = self.run_collector('--cache', str(self.cache), '--project-ref', original)
                self.assertNotEqual(run.returncode, 0)
                self.assertIn('Symlink', run.stderr)
                self.assertEqual(sentinel.read_bytes(), b'untouched')
                link.unlink()

    def test_reserved_instruction_archive_path_rejected(self):
        self.entry['bundle_path'] = 'instructions/collect_sources.py'
        self.write_manifest()
        run = self.run_collector('--cache', str(self.cache))
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Unsafe manifest entry', run.stderr)


if __name__ == '__main__':
    unittest.main()
