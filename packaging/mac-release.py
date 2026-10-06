#!/usr/bin/env python3
"""Archive and round-trip-check the existing Mac demo bundle; never open a GUI."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import shutil
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_archive(path, manifest):
    expected = {x['name']: x for x in manifest['files']}
    if len(expected) != len(manifest['files']):
        raise ValueError('Duplicate bundle file record')
    seen = set()
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            name = item.filename
            p = PurePosixPath(name)
            mode = item.external_attr >> 16
            if (name in seen or name not in expected or p.is_absolute() or '..' in p.parts
                    or '\\' in name or str(p) != name or not name.startswith('Jazzkeys.app/')
                    or item.is_dir() or not stat.S_ISREG(mode) or mode & 0o6022
                    or item.flag_bits & 1):
                raise ValueError('Unsafe or unexpected ZIP member')
            seen.add(name)
            record = expected[name]
            if item.file_size != record['bytes']:
                raise ValueError('ZIP member size mismatch')
            if name.startswith('Jazzkeys.app/Contents/MacOS/') and mode & 0o111 != 0o111:
                raise ValueError('ZIP executable mode missing')
            with archive.open(item) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != record['sha256']:
                    raise ValueError('ZIP member hash mismatch')
    if seen != set(expected):
        raise ValueError('Missing ZIP members')


def create_archive(bundle, output, manifest):
    if output.exists():
        raise ValueError('Refusing to replace an existing app archive')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for record in sorted(manifest['files'], key=lambda x: x['name']):
            source = bundle / record['name']
            info = source.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o6022:
                raise ValueError('Unsafe bundle member')
            if digest(source) != record['sha256'] or info.st_size != record['bytes']:
                raise ValueError('Bundle changed before archiving')
            archive.write(source, record['name'])
    validate_archive(output, manifest)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('The release ZIP must be built and round-trip-tested on macOS ARM64')
    bundle, output = args.bundle.resolve(), args.output.resolve()
    run('bun', 'packaging/verify-bundle.ts', str(bundle), cwd=ROOT)
    manifest = json.loads((bundle / 'bundle-manifest.json').read_text())
    commit = run('git', 'rev-parse', 'HEAD', cwd=ROOT)
    tree = run('git', 'rev-parse', 'HEAD^{tree}', cwd=ROOT)
    if (manifest['sourceCommit'] != commit or manifest['sourceTree'] != tree
            or manifest['target'] != 'macos-arm64' or manifest['hardwareStatus'] != 'no_hardware_demo'
            or run('git', 'status', '--porcelain', cwd=ROOT)):
        raise SystemExit('Release bundle must match the clean current commit and Mac demo target')
    with (bundle / 'Jazzkeys.app/Contents/Info.plist').open('rb') as stream:
        plist = plistlib.load(stream)
    if plist.get('CFBundleExecutable') != 'jazzkeys' or plist.get('CFBundleIdentifier') != 'io.jazzkeys.desktop':
        raise SystemExit('Unexpected app identity')
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'Jazzkeys-demo-macos-arm64-{commit}.zip'
    create_archive(bundle, archive, manifest)
    # Archive Utility-compatible extraction and existing integrity checks. These
    # self-test flags never create a window or enter the ordinary GUI startup.
    with tempfile.TemporaryDirectory(prefix='Jazzkeys install with spaces ') as temp:
        extracted = Path(temp)
        run('/usr/bin/ditto', '-x', '-k', str(archive), temp)
        shutil.copyfile(bundle / 'bundle-manifest.json', extracted / 'bundle-manifest.json')
        run('bun', 'packaging/verify-bundle.ts', temp, cwd=ROOT)
        executable = extracted / 'Jazzkeys.app/Contents/MacOS/jazzkeys'
        tests = {}
        for flag in ['--package-self-test', '--native-self-test']:
            tests[flag] = json.loads(run(str(executable), flag, cwd=temp, env={'PATH': ''}))
        if tests['--package-self-test'].get('hardwareAccess') is not False or tests['--native-self-test'].get('rendererBinding') != 'native':
            raise SystemExit('Unexpected compiled-package test result')
    signatures = {}
    for name in ['jazzkeys', 'jazzkeys-device', 'jazzkeys-appearance']:
        result = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=2', str(bundle / 'Jazzkeys.app/Contents/MacOS' / name)], capture_output=True, text=True)
        # Retain public status only, not runner paths. No signing key is accessed.
        lines = [line for line in result.stderr.splitlines() if line.startswith(('Signature=', 'TeamIdentifier=', 'Authority=', 'CodeDirectory '))]
        if any(line.startswith('Authority=Developer ID') for line in lines):
            raise SystemExit('Unexpected signing identity; review distribution labels')
        signatures[name] = {'inspectionExitCode': result.returncode, 'status': lines or ['not signed or signature inspection unavailable']}
    manifest_name = f'Jazzkeys-bundle-manifest-{commit}.json'
    with (output / manifest_name).open('xb') as stream:
        stream.write((bundle / 'bundle-manifest.json').read_bytes())
    receipt = {
        'schemaVersion': 1, 'product': 'Jazzkeys', 'target': 'macos-arm64',
        'sourceCommit': commit, 'sourceTree': tree, 'version': manifest['version'], 'hardwareStatus': 'no_hardware_demo',
        'distribution': 'experimental demo', 'signing': 'no Developer ID or notarization',
        'minimumSystemVersion': plist['LSMinimumSystemVersion'], 'buildOS': run('/usr/bin/sw_vers', '-productVersion'),
        'buildPython': platform.python_version(),
        'archive': {'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest(archive)},
        'bundleManifest': {'name': manifest_name, 'bytes': (output / manifest_name).stat().st_size, 'sha256': digest(output / manifest_name)},
        'roundTrip': {'extractor': 'macOS ditto', 'pathWithSpaces': True, 'externalRuntimePath': '', 'tests': tests},
        'signatureInspection': signatures,
        'limitations': ['ordinary packaged GUI startup, network behavior, and OS permission prompts not observed',
                        'no hardware support or screen-reader acceptance claim', 'no Developer ID signing or notarization'],
    }
    with (output / 'macos-release.json').open('x') as stream:
        json.dump(receipt, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'archive': archive.name, 'sha256': digest(archive), 'target': 'macos-arm64', 'roundTripVerified': True}))


if __name__ == '__main__':
    main()
