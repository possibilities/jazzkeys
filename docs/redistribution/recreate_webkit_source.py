#!/usr/bin/env python3
"""Re-create the existing checksum-pinned JSCOnly archive, without running WebKit.

CI: python docs/redistribution/recreate_webkit_source.py --output CACHE --download
Offline: add --repository /path/to/an/existing/WebKit/Git/repository instead.
The output directory can be passed to collect_sources.py as --cache.

Only the official repository and full pinned commit are fetched. Git trees and
raw blobs are read, never checked out or executed. The retained file map fixes
the subset, order, modes, sizes, and blob identities. The original tar metadata
and gzip header are preserved because changing them changes the pinned digest.
Python's standard library and Git are the only dependencies. An incompatible
compressor fails the final checksum check rather than changing the inventory.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import zlib


HERE = Path(__file__).resolve().parent
REVISION = '4a6a32c32c11ffb9f5a94c310b10f50130bfe6de'
REPOSITORY_URL = 'https://github.com/oven-sh/WebKit.git'
FILENAME = f'WebKit-{REVISION}-jsconly-source.tar.gz'
ARCHIVE_SHA256 = 'd4f43d689ec5549f1be07f30364dcfe47b85afed62fcd66b50750c6354ffc6ca'
ARCHIVE_BYTES = 94620867
FILE_MAP_SHA256 = '618a7d9d93d0b75a4b62cb9694b02b09fa4c9a0b41bc7ec9c4c0551c21f02bce'
COMMIT_MTIME = 1771833738
# Original gzip header, not a fresh wall-clock time or a claim about Git dates.
GZIP_MTIME = 1791254819


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def object_hash(kind, data):
    return hashlib.sha1(kind.encode() + b' ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def git_command(repository, *arguments):
    return ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null',
            '-c', 'protocol.file.allow=never', '-C', str(repository), *arguments]


def git_environment():
    # Do not run configured helpers/filters or silently fetch missing objects
    # when the caller selected an offline repository. Explicit fetches below
    # are the only network operations and have a fixed official destination.
    env = os.environ.copy()
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_TERMINAL_PROMPT='0', GIT_NO_LAZY_FETCH='1', GIT_NO_REPLACE_OBJECTS='1')
    for key in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
                'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT'):
        env.pop(key, None)
    return env


def git(repository, *arguments, input=None):
    return subprocess.check_output(git_command(repository, *arguments),
                                   input=input, env=git_environment())


def load_inputs():
    inventory = json.loads((HERE / 'bun-webkit-source-inventory.json').read_bytes())
    if (inventory['revision'] != REVISION or inventory['sha256'] != ARCHIVE_SHA256
            or inventory['bytes'] != ARCHIVE_BYTES):
        raise ValueError('WebKit inventory does not match the fixed archive recipe')
    raw = (HERE / 'upstream/WebKit-retained-files.json').read_bytes()
    if (hashlib.sha256(raw).hexdigest() != FILE_MAP_SHA256
            or inventory['retained_file_map']['sha256'] != FILE_MAP_SHA256):
        raise ValueError('retained WebKit file map checksum mismatch')
    rows = json.loads(raw)
    seen = set()
    for row in rows:
        path = row['path']
        if (not isinstance(path, str) or PurePosixPath(path).is_absolute()
                or any(part in ('', '.', '..') for part in path.split('/'))
                or '\\' in path or '\0' in path or path in seen):
            raise ValueError(f'unsafe or duplicate retained path: {path!r}')
        if (row['mode'] not in ('100644', '100755', '120000')
                or not re.fullmatch('[0-9a-f]{40}', row['git_blob_sha1'])
                or type(row['bytes']) is not int or row['bytes'] < 0):
            raise ValueError(f'invalid retained entry: {path}')
        seen.add(path)
    if (len(rows) != inventory['retained_blob_count']
            or sum(row['bytes'] for row in rows) != inventory['uncompressed_source_bytes']):
        raise ValueError('retained file count/size mismatch')
    source_inputs = json.loads((HERE / 'source-inputs.json').read_bytes())
    entries = [row for row in source_inputs['archives']
               if row['bundle_path'] == f'bun/sources/{FILENAME}']
    if (len(entries) != 1 or entries[0]['sha256'] != ARCHIVE_SHA256
            or entries[0]['size_bytes'] != ARCHIVE_BYTES):
        raise ValueError('source-inputs.json does not match the fixed archive recipe')
    return inventory, rows


def verify_tree(repository, revision, inventory, rows, expected_mtime):
    commit = git(repository, 'cat-file', 'commit', revision)
    if object_hash('commit', commit) != revision:
        raise ValueError('pinned Git commit object checksum mismatch')
    committer = next(line for line in commit.splitlines() if line.startswith(b'committer '))
    if int(committer.rsplit(b' ', 2)[1]) != expected_mtime:
        raise ValueError('pinned Git commit timestamp mismatch')
    wanted = {row['path']: row for row in rows}
    matched = []
    blob_count = gitlink_count = 0
    for entry in git(repository, 'ls-tree', '-rz', '--full-tree', revision).split(b'\0'):
        if not entry:
            continue
        attributes, path = entry.split(b'\t', 1)
        mode, kind, oid = attributes.decode('ascii').split(' ')
        path = path.decode('utf-8')
        if kind == 'commit':
            gitlink_count += 1
        elif kind == 'blob':
            blob_count += 1
        else:
            raise ValueError(f'unexpected Git tree entry type: {kind}')
        if path in wanted:
            row = wanted[path]
            if kind != 'blob' or mode != row['mode'] or oid != row['git_blob_sha1']:
                raise ValueError(f'retained file does not match pinned Git tree: {path}')
            matched.append(path)
    if (blob_count != inventory['upstream_tree_blob_count']
            or gitlink_count != inventory['gitlink_count'] or gitlink_count != 0
            or blob_count - len(rows) != inventory['omitted_blob_count']):
        raise ValueError('full Git tree counts do not match WebKit inventory')
    if matched != [row['path'] for row in rows]:
        raise ValueError('retained file paths/order do not match pinned Git tree')


def fetch_commit(repository):
    git(repository, 'init', '--bare', '--quiet')
    git(repository, 'config', 'remote.origin.url', REPOSITORY_URL)
    git(repository, 'config', 'remote.origin.promisor', 'true')
    git(repository, 'config', 'remote.origin.partialclonefilter', 'blob:none')
    git(repository, 'fetch', '--depth=1', '--filter=blob:none', '--no-tags',
        '--no-recurse-submodules', 'origin', REVISION)


def fetch_blobs(repository, rows):
    # Fetch all retained objects in one bounded request, rather than one lazy
    # network fetch per cat-file call. Object names come from the verified map.
    oids = sorted({row['git_blob_sha1'] for row in rows})
    git(repository, '-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-tags',
        '--no-write-fetch-head', '--no-recurse-submodules', '--filter=blob:none',
        '--stdin', 'origin', input=('\n'.join(oids) + '\n').encode('ascii'))


def read_blob(stream, row):
    expected = f"{row['git_blob_sha1']} blob {row['bytes']}\n".encode('ascii')
    if stream.readline() != expected:
        raise ValueError(f"missing or unexpected Git blob header: {row['path']}")
    data = stream.read(row['bytes'])
    if (len(data) != row['bytes'] or stream.read(1) != b'\n'
            or object_hash('blob', data) != row['git_blob_sha1']):
        raise ValueError(f"Git blob checksum/size mismatch: {row['path']}")
    return data


def write_tar(destination, rows, blob_stream, revision=REVISION, mtime=COMMIT_MTIME):
    with tarfile.open(fileobj=destination, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for row in rows:
            data = read_blob(blob_stream, row)
            info = tarfile.TarInfo(f"WebKit-{revision}/{row['path']}")
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = mtime
            if row['mode'] == '120000':
                info.mode = 0o777
                info.type = tarfile.SYMTYPE
                info.linkname = data.decode('utf-8')
                archive.addfile(info)
            else:
                info.mode = int(row['mode'], 8) & 0o777
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))


def write_archive(repository, destination, rows):
    # A file-backed stdin avoids pipe deadlock for the 11,261 object requests.
    with tempfile.TemporaryFile() as requests:
        requests.write(b''.join(row['git_blob_sha1'].encode('ascii') + b'\n' for row in rows))
        requests.seek(0)
        process = subprocess.Popen(git_command(repository, 'cat-file', '--batch'),
                                   stdin=requests, stdout=subprocess.PIPE, env=git_environment())
        try:
            with destination.open('wb') as output, gzip.GzipFile(
                    filename=FILENAME, fileobj=output, mode='wb',
                    compresslevel=6, mtime=GZIP_MTIME) as compressed:
                write_tar(compressed, rows, process.stdout)
            if process.stdout.read(1) or process.wait() != 0:
                raise ValueError('Git blob batch did not end cleanly')
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.kill()
            process.wait()


def verify_archive(path):
    if path.stat().st_size != ARCHIVE_BYTES or sha256(path) != ARCHIVE_SHA256:
        raise ValueError('re-created archive differs from pinned checksum/size; '
                         f'Python {sys.version.split()[0]}, zlib {zlib.ZLIB_RUNTIME_VERSION}; '
                         'do not replace the pinned inventory')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True, help='cache directory to receive the archive')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--repository', type=Path, help='existing Git repository containing pinned objects; offline')
    source.add_argument('--download', action='store_true', help='fetch pinned trees/blobs from official WebKit Git')
    args = parser.parse_args(argv)
    inventory, rows = load_inputs()
    output = args.output.absolute()
    if any(path.is_symlink() for path in (output, *output.parents)):
        raise ValueError('output directory must not use symlinks')
    output.mkdir(parents=True, exist_ok=True)
    target = output / FILENAME
    if target.is_symlink():
        raise ValueError('output archive must not be a symlink')
    if target.exists():
        verify_archive(target)
        print(f'Verified cached archive: {target}')
        return
    # Keep downloaded objects and incomplete output on the output filesystem,
    # then publish only checksum-verified bytes with an atomic rename.
    with tempfile.TemporaryDirectory(prefix='.webkit-recreate-', dir=output) as temporary:
        temporary = Path(temporary)
        repository = args.repository
        if args.download:
            repository = temporary / 'git'
            repository.mkdir()
            print(f'Fetching official WebKit commit {REVISION}', flush=True)
            fetch_commit(repository)
        verify_tree(repository, REVISION, inventory, rows, COMMIT_MTIME)
        if args.download:
            print(f'Fetching {len(rows)} retained source blobs', flush=True)
            fetch_blobs(repository, rows)
        staged = temporary / FILENAME
        write_archive(repository, staged, rows)
        verify_archive(staged)
        if target.exists() or target.is_symlink():
            raise ValueError('output archive appeared during reconstruction')
        staged.replace(target)
    print(f'Verified {len(rows)} Git blobs and exact archive: {target}\nSHA-256: {ARCHIVE_SHA256}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'WebKit source reconstruction failed: {error}') from error
