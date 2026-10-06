#!/usr/bin/env python3
"""Package and verify an exact-commit corresponding-source release asset.

First assemble the source directory with docs/redistribution/collect_sources.py.
This helper independently runs that collector's --verify-only checks, makes a
deterministic archive, and checks every archived byte without extracting it.
The separate JSON receipt hashes the archive, never itself. No downloads,
upstream code execution, native runtime, or publication happen here.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(chunk)
    return result.hexdigest()


def file_record(path):
    with path.open('rb') as stream:
        return {'bytes': path.stat().st_size, 'sha256': digest(stream)}


def safe_relative(name):
    path = PurePosixPath(name)
    return (bool(name) and not path.is_absolute() and '..' not in path.parts
            and '\\' not in name and name == '/'.join(path.parts))


def checked_path(path):
    if path.is_symlink():
        raise ValueError(f'Symlink in source or output path: {path}')
    # Resolve ordinary platform aliases such as macOS /tmp -> /private/tmp.
    # Member paths within the source are separately checked by the collector.
    return path.resolve()


def verify_source(source, project_ref):
    """Use the existing exact Git tree, manifest, and instruction verifier."""
    subprocess.run([
        sys.executable, str(ROOT / 'docs/redistribution/collect_sources.py'),
        '--output', str(source), '--project-ref', project_ref, '--verify-only',
    ], check=True)
    receipt_path = source / 'SOURCE-RECEIPT.json'
    manifest_path = source / 'source-inputs.json'
    receipt = json.loads(receipt_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    project = receipt['project_source']
    records = {
        'SOURCE-RECEIPT.json': file_record(receipt_path),
        'source-inputs.json': file_record(manifest_path),
        project['path']: {'bytes': (source / project['path']).stat().st_size,
                          'sha256': project['sha256']},
    }
    for item in manifest['archives']:
        records[item['bundle_path']] = {'bytes': item['size_bytes'], 'sha256': item['sha256']}
    for item in receipt['instructions']:
        records[item['path']] = {'bytes': item['bytes'], 'sha256': item['sha256']}
    return receipt, records


def archive_members(prefix, records):
    """Only regular files and their necessary parent directories are allowed."""
    files = {}
    directories = {prefix}
    for name, record in records.items():
        if not safe_relative(name):
            raise ValueError(f'Unsafe source path: {name}')
        member = f'{prefix}/{name}'
        files[member] = record
        directories.update(str(parent) for parent in PurePosixPath(member).parents
                           if str(parent) != '.')
    if directories & files.keys():
        raise ValueError('Conflicting source file and directory paths')
    return files, directories


def write_archive(path, source, prefix, records):
    files, directories = archive_members(prefix, records)
    with path.open('xb') as raw:
        # No original filename, wall-clock time, owner, or local permissions.
        with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
                for name in sorted(files.keys() | directories):
                    member = tarfile.TarInfo(name)
                    member.mode = 0o755 if name in directories else 0o644
                    if name in directories:
                        member.type = tarfile.DIRTYPE
                        archive.addfile(member)
                    else:
                        relative = name[len(prefix) + 1:]
                        target = source / relative
                        if target.is_symlink() or not target.is_file():
                            raise ValueError(f'Not a regular source file: {relative}')
                        member.size = files[name]['bytes']
                        with target.open('rb') as stream:
                            archive.addfile(member, stream)


def verify_archive(path, prefix, records):
    """Verify strict paths, types, membership, sizes and SHA-256; never extract."""
    files, directories = archive_members(prefix, records)
    seen = set()
    with tarfile.open(path, mode='r:gz') as archive:
        if archive.pax_headers:
            raise ValueError('Unexpected global archive metadata')
        for member in archive:
            name = member.name
            if not safe_relative(name) or name in seen:
                raise ValueError(f'Unsafe or duplicate archive path: {name}')
            seen.add(name)
            if (member.uid != 0 or member.gid != 0 or member.uname or member.gname
                    or member.mtime != 0 or member.linkname or member.sparse is not None
                    or set(member.pax_headers) - {'path'}):
                raise ValueError(f'Unexpected archive metadata: {name}')
            if name in directories:
                if not member.isdir() or member.mode != 0o755 or member.size != 0:
                    raise ValueError(f'Invalid archive directory: {name}')
            elif name in files:
                record = files[name]
                if not member.isfile() or member.mode != 0o644 or member.size != record['bytes']:
                    raise ValueError(f'Invalid archive file: {name}')
                with archive.extractfile(member) as stream:
                    if digest(stream) != record['sha256']:
                        raise ValueError(f'Archive content mismatch: {name}')
            else:
                raise ValueError(f'Unexpected archive member: {name}')
    if seen != files.keys() | directories:
        raise ValueError('Missing archive members')


def release_receipt(archive, filename, source_receipt, records):
    return {
        'schema_version': 1,
        'artifact_type': 'JazzKeys corresponding source',
        'project_commit': source_receipt['project_source']['commit'],
        'source_tree': source_receipt['project_source']['source_tree'],
        'archive': {'path': filename, **file_record(archive)},
        'source_receipt': {'path': 'SOURCE-RECEIPT.json', **records['SOURCE-RECEIPT.json']},
        'source_input_count': source_receipt['source_input_count'],
        'instruction_count': len(source_receipt['instructions']),
        'file_count': len(records),
        'status': 'source archive verified; rebuild/relink verification is separate',
    }


def package_source(source, output, project_ref, verify_only=False):
    if not re.fullmatch(r'[a-f0-9]{40}', project_ref):
        raise ValueError('--project-ref must be a full lowercase 40-character commit SHA')
    source, output = checked_path(source), checked_path(output)
    if not source.is_dir():
        raise ValueError('Source companion does not exist')
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('Source and output directories must not overlap')
    prefix = f'JazzKeys-corresponding-source-{project_ref}'
    archive = output / f'{prefix}.tar.gz'
    receipt_path = output / f'{prefix}.json'
    for path in (archive, receipt_path):
        if path.is_symlink():
            raise ValueError(f'Symlink release asset: {path.name}')
        if verify_only:
            if not path.is_file():
                raise ValueError(f'Missing release asset: {path.name}')
        elif path.exists():
            raise ValueError(f'Refusing to overwrite release asset: {path.name}')
    source_receipt, records = verify_source(source, project_ref)
    if verify_only:
        verify_archive(archive, prefix, records)
        expected = release_receipt(archive, archive.name, source_receipt, records)
        if json.loads(receipt_path.read_text()) != expected:
            raise ValueError('Release receipt mismatch')
        return expected
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.source-release-', dir=output) as temporary:
        staged_archive = Path(temporary) / archive.name
        staged_receipt = Path(temporary) / receipt_path.name
        write_archive(staged_archive, source, prefix, records)
        verify_archive(staged_archive, prefix, records)
        expected = release_receipt(staged_archive, archive.name, source_receipt, records)
        staged_receipt.write_text(json.dumps(expected, indent=2) + '\n')
        # Exclusive same-filesystem links prevent overwrites, including a race
        # after the initial existence check. Only publish fully verified bytes.
        os.link(staged_archive, archive)
        try:
            os.link(staged_receipt, receipt_path)
        except BaseException:
            archive.unlink()
            raise
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        receipt = package_source(args.source, args.output, args.project_ref, args.verify_only)
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError, EOFError) as error:
        parser.exit(1, f'Source release failed: {error}\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
