#!/usr/bin/env python3
"""Gate the exact release ZIP with bounded, explicitly authorized CI GUI acceptance.

This records same-workflow traceability, not independent attestation, Developer ID
authentication, notarization, or acceptance on a user's Mac.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = 'possibilities/jazzkeys'
WORKFLOW = f'{REPO}/.github/workflows/mac-release.yml@refs/heads/main'
APP_PATH = 'dist/launch-current/JazzKeys.app'
SIGNING = 'ad-hoc sealed bundle; no Developer ID or notarization'
TRUST = 'Same-run CI traceability; not independent attestation, Developer ID authentication, or notarization'


def mac_tools():
    spec = importlib.util.spec_from_file_location('mac_release', ROOT / 'packaging/mac-release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_file(directory, record):
    name = record.get('name', '')
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
        raise ValueError('Unsafe release asset name')
    path = directory / name
    if (path.is_symlink() or not path.is_file() or type(record.get('bytes')) is not int
            or path.stat().st_size != record['bytes'] or digest(path) != record.get('sha256')):
        raise ValueError(f'Release asset differs from its receipt: {name}')
    return path


def read_receipt(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'Missing or unsafe receipt: {path.name}')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f'Invalid receipt: {path.name}')
    return value


def verify_mac_assets(directory, commit, tree):
    """Validate provenance and bytes before extracting or executing anything."""
    mac = read_receipt(directory / 'macos-release.json')
    if (mac.get('schemaVersion') != 1 or mac.get('product') != 'JazzKeys'
            or mac.get('sourceCommit') != commit or mac.get('sourceTree') != tree
            or mac.get('target') != 'macos-arm64' or mac.get('hardwareStatus') != 'no_hardware_demo'
            or mac.get('signing') != SIGNING):
        raise ValueError('Release source/target correspondence mismatch')
    signatures = mac.get('bundleSignatureVerification', {})
    if (signatures.get('beforeArchive', {}).get('verified') is not True
            or signatures.get('afterExtraction', {}).get('verified') is not True
            or signatures.get('resourceTamperRejected') is not True):
        raise ValueError('Mac signature verification evidence is incomplete')
    if (mac.get('archive', {}).get('name') != f'JazzKeys-demo-macos-arm64-{commit}.zip'
            or mac.get('bundleManifest', {}).get('name') != f'JazzKeys-bundle-manifest-{commit}.json'):
        raise ValueError('Unexpected release artifact filename')
    archive = check_file(directory, mac['archive'])
    bundle = check_file(directory, mac['bundleManifest'])
    manifest = read_receipt(bundle)
    if (manifest.get('schemaVersion') != 1 or manifest.get('product') != 'JazzKeys'
            or manifest.get('sourceCommit') != commit or manifest.get('sourceTree') != tree
            or manifest.get('target') != 'macos-arm64' or manifest.get('application') != 'JazzKeys.app'
            or manifest.get('hardwareStatus') != 'no_hardware_demo' or manifest.get('signing') != SIGNING
            or manifest.get('version') != mac.get('version')):
        raise ValueError('Bundle provenance mismatch')
    mac_tools().validate_archive(archive, manifest)
    return mac, archive, bundle


def verify_metadata(metadata, mac, version):
    if (metadata.get('schemaVersion') != 1
            or any(metadata.get(field) is not True for field in (
                'verified', 'bundleCreated', 'cfBundleCreated', 'executableResolved',
                'launchServicesRecognizesApplication', 'urlResourceRecognizesApplication'))
            or type(metadata.get('launchServicesStatus')) is not int or metadata['launchServicesStatus'] != 0
            or metadata.get('resourceErrorCode') != 0
            or metadata.get('bundleName') != 'JazzKeys' or metadata.get('displayName') != 'JazzKeys'
            or metadata.get('identifier') != 'io.jazzkeys.desktop' or metadata.get('executableName') != 'jazzkeys'
            or metadata.get('packageType') != 'APPL' or 16777228 not in metadata.get('architectures', [])
            or metadata.get('minimumSystemVersion') != mac.get('minimumSystemVersion')
            or version not in metadata.get('systemVersion', '')):
        raise ValueError('Launch Services metadata recognition failed')


def verify_launch_receipt(receipt, mac, commit, tree, run_id=None, run_attempt=None):
    """Fail closed on missing, stale, mismatched, or partial acceptance evidence."""
    if (receipt.get('schemaVersion') != 1 or receipt.get('verified') is not True
            or receipt.get('product') != 'JazzKeys' or receipt.get('target') != 'macos-arm64'
            or receipt.get('sourceCommit') != commit or receipt.get('sourceTree') != tree
            or receipt.get('archive') != mac['archive'] or receipt.get('bundleManifest') != mac['bundleManifest']
            or receipt.get('application') != APP_PATH or receipt.get('trust') != TRUST):
        raise ValueError('Launch receipt source/archive correspondence mismatch')
    workflow = receipt.get('workflow', {})
    recorded_id, recorded_attempt = workflow.get('runId'), workflow.get('runAttempt')
    if (workflow.get('repository') != REPO or workflow.get('ref') != WORKFLOW
            or not isinstance(recorded_id, str) or not re.fullmatch(r'[1-9][0-9]*', recorded_id)
            or not isinstance(recorded_attempt, str) or not re.fullmatch(r'[1-9][0-9]*', recorded_attempt)
            or workflow.get('url') != f'https://github.com/{REPO}/actions/runs/{recorded_id}'
            or (run_id is not None and recorded_id != run_id)
            # A failed publish-only retry may reuse valid evidence from an
            # earlier attempt of this exact run and archive, never a future one.
            or (run_attempt is not None and int(recorded_attempt) > int(run_attempt))):
        raise ValueError('Launch receipt is not from the expected workflow run')
    system = receipt.get('testOS', {})
    version = system.get('version', '')
    if (system.get('system') != 'Darwin' or system.get('architecture') != 'arm64'
            or system.get('runner') != 'github-hosted' or system.get('runnerLabel') != 'macos-26'
            or not isinstance(version, str) or not re.fullmatch(r'26(?:\.[0-9]+){1,2}', version)
            or not isinstance(system.get('build'), str) or not re.fullmatch(r'[0-9]+[A-Z][0-9]+[a-z]?', system['build'])):
        raise ValueError('Launch receipt lacks the actual macOS 26 host identity')
    bundle = receipt.get('bundleVerification', {})
    if (bundle.get('verifiedBundle') is not True or bundle.get('target') != 'macos-arm64'
            or bundle.get('hardwareStatus') != 'no_hardware_demo'
            or receipt.get('bundleSignatureVerification', {}).get('verified') is not True):
        raise ValueError('Extracted bundle verification evidence is incomplete')
    verify_metadata(receipt.get('metadata', {}), mac, version)
    launch = receipt.get('launch', {})
    if (launch.get('schemaVersion') != 1 or launch.get('targetKind') != 'current-extracted-archive'
            or any(launch.get(field) is not True for field in (
                'verified', 'completionReceived', 'identityMatched', 'launchedWithOwnedWindow',
                'windowServerDataAvailable', 'quitRequested', 'terminated'))
            or any(launch.get(field) is not False for field in (
                'forceAttempted', 'forceAccepted', 'launchTimedOut', 'cleanupUncertain', 'permissionPromptsAccepted'))
            or type(launch.get('pid')) is not int or launch['pid'] <= 0 or launch.get('errors') != []):
        raise ValueError('Bounded launch did not open and gracefully quit the exact app')
    windows = launch.get('windows', [])
    if not isinstance(windows, list) or not any(
            isinstance(window, dict) and window.get('title') == 'JazzKeys'
            and all(type(window.get(key)) in (int, float) and math.isfinite(window[key])
                    and window[key] >= minimum for key, minimum in (('width', 960), ('height', 680)))
            for window in windows):
        raise ValueError('A titled, owned JazzKeys window was not observed')


def run(*args, **kwargs):
    kwargs.setdefault('timeout', 120)
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        # Probe output is bounded metadata; never capture the user's desktop.
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}')
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--metadata-helper', required=True, type=Path)
    parser.add_argument('--launch-helper', required=True, type=Path)
    args = parser.parse_args()
    commit, run_id, attempt = (os.environ.get(key, '') for key in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != REPO
            or os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_WORKFLOW_REF') != WORKFLOW
            or os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch')
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or os.environ.get('RUNNER_OS') != 'macOS' or os.environ.get('RUNNER_ARCH') != 'ARM64'
            or not re.fullmatch(r'[a-f0-9]{40}', commit) or not re.fullmatch(r'[1-9][0-9]*', run_id)
            or not re.fullmatch(r'[1-9][0-9]*', attempt)
            or Path(os.environ.get('GITHUB_WORKSPACE', '')).resolve() != ROOT
            or platform.system() != 'Darwin' or platform.machine() != 'arm64'):
        raise SystemExit('Launch acceptance is restricted to the authorized GitHub-hosted Mac release workflow')
    if run('git', 'rev-parse', 'HEAD', cwd=ROOT) != commit or run('git', 'status', '--porcelain', cwd=ROOT):
        raise SystemExit('Launch acceptance requires the clean workflow checkout')
    tree = run('git', 'rev-parse', 'HEAD^{tree}', cwd=ROOT)
    version = run('/usr/bin/sw_vers', '-productVersion')
    if not re.fullmatch(r'26(?:\.[0-9]+){1,2}', version):
        raise SystemExit('Launch acceptance requires macOS 26')
    mac, archive, manifest = verify_mac_assets(args.assets.resolve(), commit, tree)
    output = args.output.resolve()
    if output.exists() or args.output.is_symlink():
        raise ValueError('Refusing to replace an existing launch receipt')
    extracted = ROOT / 'dist/launch-current'
    if extracted.exists() or extracted.is_symlink() or extracted.parent.is_symlink():
        raise ValueError('Refusing to replace or follow an existing launch destination')
    extracted.mkdir(parents=True)
    run('/usr/bin/ditto', '-x', '-k', str(archive), str(extracted))
    shutil.copyfile(manifest, extracted / 'bundle-manifest.json')
    bundle = json.loads(run('bun', 'packaging/verify-bundle.ts', str(extracted), cwd=ROOT))
    signatures = mac_tools().verify_mac_signatures(extracted)
    metadata = json.loads(run(str(args.metadata_helper.resolve()), str(extracted / 'JazzKeys.app')))
    verify_metadata(metadata, mac, version)
    # No rebuild and no alternate executable: the native helper permits only this
    # exact extracted path, identifies its PID/window, and bounds open and quit.
    output.parent.mkdir(parents=True, exist_ok=True)
    diagnostic = output.parent / 'launch-probe.json'
    if diagnostic.exists() or diagnostic.is_symlink():
        raise ValueError('Refusing to replace existing launch diagnostics')
    run(str(args.launch_helper.resolve()), str(extracted / 'JazzKeys.app'), str(diagnostic))
    launch = read_receipt(diagnostic)
    receipt = {
        'schemaVersion': 1, 'verified': True, 'product': 'JazzKeys', 'target': 'macos-arm64',
        'sourceCommit': commit, 'sourceTree': tree, 'archive': mac['archive'], 'bundleManifest': mac['bundleManifest'],
        'application': APP_PATH, 'trust': TRUST,
        'workflow': {'repository': REPO, 'ref': WORKFLOW, 'runId': run_id, 'runAttempt': attempt,
                     'url': f'https://github.com/{REPO}/actions/runs/{run_id}'},
        'testOS': {'system': platform.system(), 'version': version, 'build': run('/usr/bin/sw_vers', '-buildVersion'),
                   'architecture': platform.machine(), 'runner': 'github-hosted', 'runnerLabel': 'macos-26'},
        'bundleVerification': bundle, 'bundleSignatureVerification': signatures, 'metadata': metadata, 'launch': launch,
        'limitations': ['No user Mac, Raycast, quarantined-download, or first-run security acceptance claim',
                        'No permission prompts accepted or security settings changed',
                        'No hardware, network-silence, input interaction, or screen-reader acceptance claim'],
    }
    # Recheck the archive and full extracted bundle after quitting as well.
    verify_mac_assets(args.assets.resolve(), commit, tree)
    run('bun', 'packaging/verify-bundle.ts', str(extracted), cwd=ROOT)
    mac_tools().verify_mac_signatures(extracted)
    verify_launch_receipt(receipt, mac, commit, tree, run_id, attempt)
    with output.open('x') as stream:
        json.dump(receipt, stream, indent=2, allow_nan=False)
        stream.write('\n')
    diagnostic.unlink()
    print(json.dumps({'verified': True, 'archive': mac['archive'], 'testOS': receipt['testOS']}))


if __name__ == '__main__':
    main()
