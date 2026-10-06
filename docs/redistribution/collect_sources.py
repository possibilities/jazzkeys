#!/usr/bin/env python3
"""Assemble checksum-pinned source inputs; never execute fetched upstream code.

Example:
  python docs/redistribution/collect_sources.py --output /tmp/jazzkeys-source \
    --cache /path/to/source-archive-cache --download --project-ref FULL_COMMIT

Downloads are opt-in. This source-input collector is not a binary build, final
compliance certification, or an installer. Review the source/relink recipe too.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
INSTRUCTIONS = 'docs/redistribution/'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_relative(name):
    p = PurePosixPath(name)
    return (bool(name) and not p.is_absolute() and '..' not in p.parts
            and '\\' not in name and name == '/'.join(p.parts))


def safe_target(output, name):
    if not safe_relative(name):
        raise SystemExit(f'Unsafe companion path: {name}')
    target = output / name
    for path in [target, *target.parents]:
        if path.is_symlink():
            raise SystemExit(f'Symlink in output path: {name}')
        if path == output:
            break
    if target.exists() and not target.is_file():
        raise SystemExit(f'Not a regular companion file: {name}')
    return target


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def instruction_inputs(project_ref):
    """Return the selected commit's bytes, never a different checkout's inputs."""
    if project_ref:
        if not re.fullmatch(r'[a-f0-9]{40}', project_ref):
            raise SystemExit('--project-ref must be a full commit SHA')
        if git('rev-parse', f'{project_ref}^{{commit}}').decode().strip() != project_ref:
            raise SystemExit('--project-ref must identify the exact commit')
        files = {}
        for entry in git('ls-tree', '-rz', project_ref, '--', INSTRUCTIONS).split(b'\0'):
            if not entry:
                continue
            meta, name = entry.split(b'\t', 1)
            mode, kind, blob = meta.decode().split()
            path = name.decode('utf-8')
            if mode not in ('100644', '100755') or kind != 'blob':
                raise SystemExit(f'Unsupported instruction source: {path}')
            files[path[len(INSTRUCTIONS):]] = git('cat-file', 'blob', blob)
        source_tree = git('rev-parse', f'{project_ref}^{{tree}}').decode().strip()
    else:
        files = {}
        directory = ROOT / INSTRUCTIONS
        for path in directory.rglob('*'):
            if path.is_symlink():
                raise SystemExit(f'Symlink in instruction source: {path}')
            if path.is_file():
                files[path.relative_to(directory).as_posix()] = path.read_bytes()
        source_tree = None
    if 'source-inputs.json' not in files:
        raise SystemExit('Selected source has no source-inputs.json')
    return files, source_tree


def archive_tree(path, project_ref):
    """Compute the Git tree represented by git archive, without extracting it."""
    entries = {}
    prefix = f'jazzkeys-{project_ref}/'
    with tarfile.open(path, 'r:gz') as archive:
        if archive.pax_headers.get('comment') != project_ref:
            raise SystemExit('Project archive commit metadata mismatch')
        for member in archive:
            if member.name.rstrip('/') == prefix.rstrip('/') and member.isdir():
                continue
            if not member.name.startswith(prefix):
                raise SystemExit('Unexpected project archive prefix')
            name = member.name[len(prefix):].rstrip('/')
            if not safe_relative(name):
                raise SystemExit('Unsafe project archive path')
            if member.isdir():
                continue
            if name in entries:
                raise SystemExit('Duplicate project archive path')
            if member.issym():
                mode, data = '120000', member.linkname.encode('utf-8')
            elif member.isfile():
                mode = '100755' if member.mode & 0o111 else '100644'
                data = archive.extractfile(member).read()
            else:
                raise SystemExit('Unsupported project archive member')
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).digest()
            entries[name] = (mode, blob)
    tree = {}
    for name, value in entries.items():
        node = tree
        parts = name.split('/')
        for part in parts[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                raise SystemExit('Conflicting project archive paths')
        if parts[-1] in node:
            raise SystemExit('Conflicting project archive paths')
        node[parts[-1]] = value

    def tree_hash(node):
        payload = bytearray()
        for name, value in sorted(node.items(), key=lambda pair: (pair[0] + ('/' if isinstance(pair[1], dict) else '')).encode('utf-8')):
            mode, blob = ('40000', tree_hash(value)) if isinstance(value, dict) else value
            payload.extend(mode.encode() + b' ' + name.encode('utf-8') + b'\0' + blob)
        return hashlib.sha1(b'tree ' + str(len(payload)).encode() + b'\0' + payload).digest()
    return tree_hash(tree).hex()


def check_contents(output, expected_paths):
    actual = set()
    for path in output.rglob('*'):
        if path.is_symlink():
            raise SystemExit('Symlink in companion contents')
        if path.is_file():
            actual.add(path.relative_to(output).as_posix())
        elif not path.is_dir():
            raise SystemExit('Unsupported companion file type')
    if actual != expected_paths:
        raise SystemExit(f'Unexpected or missing companion files: {sorted(actual ^ expected_paths)[:5]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--cache', action='append', default=[], type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--project-ref', help='Exact committed Jazzkeys source to include')
    args = parser.parse_args()
    instructions, source_tree = instruction_inputs(args.project_ref)
    manifest_bytes = instructions['source-inputs.json']
    manifest = json.loads(manifest_bytes)
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    instruction_records = [{'path': f'instructions/{name}', 'bytes': len(data),
                            'sha256': hashlib.sha256(data).hexdigest()}
                           for name, data in sorted(instructions.items())]
    if args.output.is_symlink():
        raise SystemExit('Output must not be a symlink')
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise SystemExit('Keep the source companion outside the project checkout')
    if args.verify_only and not output.is_dir():
        raise SystemExit('Source companion does not exist')
    if not args.verify_only:
        output.mkdir(parents=True, exist_ok=True)
    receipt_path = safe_target(output, 'SOURCE-RECEIPT.json')
    receipt = None
    if args.verify_only:
        if not receipt_path.is_file():
            raise SystemExit('Missing source receipt')
        receipt = json.loads(receipt_path.read_text())
        if receipt.get('schema_version') != 2:
            raise SystemExit('Unsupported source receipt; reassemble with this collector before release verification')
        if receipt.get('manifest_sha256') != manifest_sha or receipt.get('instructions') != instruction_records:
            raise SystemExit('Source manifest or instruction receipt mismatch')
        if receipt.get('source_input_count') != len(manifest['archives']):
            raise SystemExit('Source input count mismatch')
    cache = {}
    for directory in args.cache:
        for path in directory.rglob('*'):
            if path.is_file() and not path.is_symlink() and path.name.endswith(('.crate', '.tgz', '.tar.gz', '.tar.xz')):
                cache.setdefault(path.name, []).append(path)
    written = []
    expected_paths = {'source-inputs.json', 'SOURCE-RECEIPT.json'}
    for item in manifest['archives']:
        name, expected = item['bundle_path'], item['sha256']
        if (not safe_relative(name) or not re.fullmatch(r'[a-f0-9]{64}', expected)
                or name in expected_paths or name.startswith('instructions/')
                or name.startswith('jazzkeys-')):
            raise SystemExit(f'Unsafe manifest entry: {name}')
        expected_paths.add(name)
        target = safe_target(output, name)
        if not (target.exists() and digest(target) == expected):
            if args.verify_only:
                raise SystemExit(f'Missing or mismatched source archive: {name}')
            target.parent.mkdir(parents=True, exist_ok=True)
            found = next((p for p in cache.get(item['cache_filename'], []) if digest(p) == expected), None)
            if found:
                shutil.copyfile(found, target)
            elif args.download and item.get('url', '').startswith('https://'):
                with urllib.request.urlopen(item['url'], timeout=180) as response, target.open('wb') as stream:
                    total = 0
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > item['size_bytes']:
                            raise SystemExit(f'Source size exceeds pinned archive: {name}')
                        stream.write(chunk)
            else:
                raise SystemExit(f'Source bytes required: {name}; add a cache or review --download. '
                                 'Locally generated Git-tree source subsets must be supplied from their verified cache.')
            if digest(target) != expected:
                target.unlink(missing_ok=True)
                raise SystemExit(f'Source checksum mismatch: {name}')
        if target.stat().st_size != item['size_bytes']:
            raise SystemExit(f'Source size mismatch: {name}')
        written.append(item)
    project = None
    if args.project_ref:
        name = f'jazzkeys-{args.project_ref}.tar.gz'
        target = safe_target(output, name)
        expected_paths.add(name)
        if args.verify_only:
            project = receipt.get('project_source')
            if (not isinstance(project, dict) or project.get('commit') != args.project_ref
                    or project.get('path') != name or project.get('source_tree') != source_tree
                    or not target.is_file() or digest(target) != project.get('sha256')):
                raise SystemExit('Project source receipt mismatch')
        else:
            subprocess.run(['git', 'archive', '--format=tar.gz',
                            f'--prefix=jazzkeys-{args.project_ref}/',
                            f'--output={target}', args.project_ref], cwd=ROOT, check=True)
            project = {'commit': args.project_ref, 'source_tree': source_tree,
                       'path': target.name, 'sha256': digest(target)}
        if archive_tree(target, args.project_ref) != source_tree:
            raise SystemExit('Project archive source tree mismatch')
    elif receipt and receipt.get('project_source') is not None:
        raise SystemExit('Use --project-ref to verify the included project source')
    for name, data in [('source-inputs.json', manifest_bytes),
                       *((f'instructions/{name}', data) for name, data in instructions.items())]:
        target = safe_target(output, name)
        expected_paths.add(name)
        if args.verify_only:
            if not target.is_file() or target.read_bytes() != data:
                raise SystemExit(f'Missing or mismatched companion instructions: {name}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    if not args.verify_only:
        receipt_path.write_text(json.dumps({
            'schema_version': 2, 'source_input_count': len(written),
            'project_source': project, 'manifest_sha256': manifest_sha,
            'instructions': instruction_records,
            'status': 'source inputs assembled and checked; rebuild/relink verification is separate',
        }, indent=2) + '\n')
    check_contents(output, expected_paths)
    print(f'Verified {len(written)} source archives, {sum((output / x["bundle_path"]).stat().st_size for x in written)} bytes')
    if not project:
        print('No Jazzkeys source commit included; this is not a complete release source companion')


if __name__ == '__main__':
    main()
