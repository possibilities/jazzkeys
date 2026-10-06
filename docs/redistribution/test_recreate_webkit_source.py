#!/usr/bin/env python3
"""Offline, stdlib-only tests for the exact WebKit source reconstruction recipe."""

import gzip
import importlib.util
import io
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('recreate_webkit_source', HERE / 'recreate_webkit_source.py')
recipe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recipe)


def entry(path, data, mode='100644'):
    return dict(path=path, mode=mode, git_blob_sha1=recipe.object_hash('blob', data), bytes=len(data))


def batch(rows, contents):
    return io.BytesIO(b''.join(
        f"{row['git_blob_sha1']} blob {row['bytes']}\n".encode() + data + b'\n'
        for row, data in zip(rows, contents)))


class ArchiveTests(unittest.TestCase):
    def test_pinned_inventories_are_consistent(self):
        inventory, rows = recipe.load_inputs()
        self.assertEqual(len(rows), 11261)
        self.assertEqual(inventory['gitlink_count'], 0)
        self.assertEqual(sum(row['bytes'] for row in rows), 274167626)

    def test_tar_preserves_modes_links_order_and_pax_paths(self):
        long_path = 'Source/' + 'nested/' * 20 + 'fixture.c'
        contents = [b'root file\n', b'#!/bin/sh\n', b'../root.txt', b'long path\n']
        rows = [entry('root.txt', contents[0]), entry('executable', contents[1], '100755'),
                entry('link', contents[2], '120000'), entry(long_path, contents[3])]
        output = io.BytesIO()
        recipe.write_tar(output, rows, batch(rows, contents))
        output.seek(0)
        with tarfile.open(fileobj=output) as archive:
            members = archive.getmembers()
            self.assertEqual([m.name for m in members],
                             [f"WebKit-{recipe.REVISION}/{row['path']}" for row in rows])
            self.assertEqual([m.mode for m in members], [0o644, 0o755, 0o777, 0o644])
            for member in members:
                self.assertEqual((member.uid, member.gid, member.uname, member.gname), (0, 0, '', ''))
                self.assertEqual(member.mtime, recipe.COMMIT_MTIME)
            self.assertTrue(members[2].issym())
            self.assertEqual(members[2].linkname, '../root.txt')
            self.assertEqual(members[2].size, 0)
            self.assertEqual(members[3].pax_headers['path'], members[3].name)
            self.assertEqual(archive.extractfile(members[3]).read(), contents[3])

    def test_blob_corruption_and_missing_blob_are_rejected(self):
        row = entry('fixture', b'good')
        for stream in (batch([row], [b'evil']), batch([row], [b'sh']),
                       io.BytesIO(f"{row['git_blob_sha1']} missing\n".encode())):
            with self.subTest(stream=stream), self.assertRaises(ValueError):
                recipe.read_blob(stream, row)

    def test_bad_archive_checksum_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / recipe.FILENAME
            path.write_bytes(b'not the pinned archive')
            with self.assertRaisesRegex(ValueError, 'do not replace the pinned inventory'):
                recipe.verify_archive(path)

    def test_recipe_uses_recorded_gzip_header(self):
        output = io.BytesIO()
        with gzip.GzipFile(fileobj=output, filename=recipe.FILENAME, mode='wb',
                           compresslevel=6, mtime=recipe.GZIP_MTIME) as compressed:
            compressed.write(b'fixture')
        header = output.getvalue()
        self.assertEqual(header[:4], bytes.fromhex('1f8b0808'))
        self.assertEqual(struct.unpack('<I', header[4:8])[0], 1791254819)
        self.assertEqual(header[8:10], b'\0\xff')
        self.assertEqual(header[10:].split(b'\0')[0], recipe.FILENAME[:-3].encode())

    def test_output_symlink_is_rejected_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / 'real'
            real.mkdir()
            link = root / 'link'
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                recipe.main(['--output', str(link), '--repository', str(root)])
            self.assertEqual(list(real.iterdir()), [])

    def test_corrupt_existing_archive_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / recipe.FILENAME
            target.write_bytes(b'preserve this failed cache for diagnosis')
            with self.assertRaises(ValueError):
                recipe.main(['--output', directory, '--repository', directory])
            self.assertEqual(target.read_bytes(), b'preserve this failed cache for diagnosis')


class GitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repository = Path(self.temporary.name)
        recipe.git(self.repository, 'init', '--quiet')
        self.contents = [b'alpha\n', b'#!/bin/sh\n', b'alpha']
        self.rows = [entry('alpha', self.contents[0]), entry('bin/run', self.contents[1], '100755'),
                     entry('link', self.contents[2], '120000')]
        for row, data in zip(self.rows, self.contents):
            oid = recipe.git(self.repository, 'hash-object', '-w', '--stdin', input=data).decode().strip()
            self.assertEqual(oid, row['git_blob_sha1'])
            recipe.git(self.repository, 'update-index', '--add', '--cacheinfo',
                       f"{row['mode']},{oid},{row['path']}")
        tree = recipe.git(self.repository, 'write-tree').decode().strip()
        env = recipe.git_environment()
        env.update(GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                   GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
                   GIT_AUTHOR_DATE=f'@{recipe.COMMIT_MTIME} +0000',
                   GIT_COMMITTER_DATE=f'@{recipe.COMMIT_MTIME} +0000')
        self.revision = subprocess.check_output(
            recipe.git_command(self.repository, 'commit-tree', tree, '-m', 'fixture'), env=env).decode().strip()
        self.inventory = dict(upstream_tree_blob_count=3, gitlink_count=0, omitted_blob_count=0)

    def test_tree_is_verified_against_real_git_objects(self):
        recipe.verify_tree(self.repository, self.revision, self.inventory, self.rows, recipe.COMMIT_MTIME)
        for field, value in [('mode', '100755'), ('git_blob_sha1', '0' * 40), ('path', 'not-in-tree')]:
            rows = [dict(row) for row in self.rows]
            rows[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                recipe.verify_tree(self.repository, self.revision, self.inventory, rows, recipe.COMMIT_MTIME)

    def test_tree_order_counts_and_commit_time_are_verified(self):
        for inventory, rows, timestamp in (
                (self.inventory, list(reversed(self.rows)), recipe.COMMIT_MTIME),
                ({**self.inventory, 'upstream_tree_blob_count': 4}, self.rows, recipe.COMMIT_MTIME),
                (self.inventory, self.rows, recipe.COMMIT_MTIME + 1)):
            with self.subTest(inventory=inventory, timestamp=timestamp), self.assertRaises(ValueError):
                recipe.verify_tree(self.repository, self.revision, inventory, rows, timestamp)

    def test_raw_git_archive_is_deterministic_without_a_checkout(self):
        first, second = self.repository / 'first.gz', self.repository / 'second.gz'
        recipe.write_archive(self.repository, first, self.rows)
        recipe.write_archive(self.repository, second, self.rows)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertFalse((self.repository / 'alpha').exists())
        with tarfile.open(first) as archive:
            self.assertEqual(archive.extractfile(archive.getmembers()[0]).read(), b'alpha\n')

    def test_download_is_fixed_to_official_commit_and_verified_blob_ids(self):
        with mock.patch.object(recipe, 'git') as git:
            recipe.fetch_commit(self.repository)
            recipe.fetch_blobs(self.repository, self.rows)
        commands = [call.args[1:] for call in git.call_args_list]
        self.assertIn(('config', 'remote.origin.url', recipe.REPOSITORY_URL), commands)
        self.assertIn(('fetch', '--depth=1', '--filter=blob:none', '--no-tags',
                       '--no-recurse-submodules', 'origin', recipe.REVISION), commands)
        blob_request = git.call_args_list[-1].kwargs['input'].decode().splitlines()
        self.assertEqual(blob_request, sorted({row['git_blob_sha1'] for row in self.rows}))


if __name__ == '__main__':
    unittest.main()
