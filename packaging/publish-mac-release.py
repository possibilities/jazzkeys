#!/usr/bin/env python3
"""Publish only verified same-run Mac demo/source assets using CI's ephemeral token."""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
REPO = 'possibilities/jazzkeys'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_file(directory, record, name_key='name'):
    name = record[name_key]
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
        raise ValueError('Unsafe release asset name')
    path = directory / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size != record['bytes'] or digest(path) != record['sha256']:
        raise ValueError(f'Release asset differs from its receipt: {name}')
    return path


def launch_tools():
    spec = importlib.util.spec_from_file_location('release_launch', ROOT / 'packaging/release-launch.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_assets(directory, commit, tree, run_id=None, run_attempt=None):
    launch_module = launch_tools()
    mac, app, bundle = launch_module.verify_mac_assets(directory, commit, tree)
    source_name = f'JazzKeys-corresponding-source-{commit}.json'
    source = launch_module.read_receipt(directory / source_name)
    if (source['schema_version'] != 1 or source['project_commit'] != commit or source['source_tree'] != tree):
        raise ValueError('Release source/target correspondence mismatch')
    if source['archive']['path'] != f'JazzKeys-corresponding-source-{commit}.tar.gz':
        raise ValueError('Unexpected release artifact filename')
    source_archive = check_file(directory, source['archive'], 'path')
    launch = launch_module.read_receipt(directory / 'macos-launch.json')
    launch_module.verify_launch_receipt(launch, mac, commit, tree, run_id, run_attempt)
    expected = {app.name, bundle.name, source_archive.name, source_name, 'macos-release.json', 'macos-launch.json'}
    if {p.name for p in directory.iterdir()} != expected or any(not p.is_file() or p.is_symlink() for p in directory.iterdir()):
        raise ValueError('Unexpected release staging contents')
    return mac, sorted(directory.iterdir())


class GitHub:
    def __init__(self, token):
        self.token = token

    def request(self, method, path, body=None, file=None, allow_not_found=False):
        host = 'uploads.github.com' if file else 'api.github.com'
        connection = http.client.HTTPSConnection(host, timeout=240)
        headers = {'Authorization': f'Bearer {self.token}', 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JazzKeys-reviewed-release-workflow'}
        data = json.dumps(body).encode() if body is not None else None
        headers['Content-Type'] = 'application/octet-stream' if file else 'application/json'
        if file:
            headers['Content-Length'] = str(file.stat().st_size)
        try:
            if file:
                with file.open('rb') as stream:
                    connection.request(method, path, body=stream, headers=headers)
                    response = connection.getresponse()
                    data = response.read()
            else:
                connection.request(method, path, body=data, headers=headers)
                response = connection.getresponse()
                data = response.read()
            if response.status == 404 and allow_not_found:
                return None
            if not 200 <= response.status < 300:
                # Never print authorization headers or arbitrary upstream payloads.
                raise RuntimeError(f'GitHub {method} failed with HTTP {response.status}; inspect state before retrying')
            return json.loads(data) if data else None
        finally:
            connection.close()


def find_release(api, tag):
    # Draft releases are not reliably returned by the by-tag endpoint. The
    # authenticated listing includes drafts visible to this publishing token.
    found = []
    page = 1
    while True:
        entries = api.request('GET', f'/repos/{REPO}/releases?per_page=100&page={page}')
        found.extend(item for item in entries if item['tag_name'] == tag)
        if len(entries) < 100:
            break
        page += 1
    if len(found) > 1:
        raise ValueError('Duplicate release drafts for this tag; reconcile before retrying')
    return found[0] if found else None


def verify_tag(api, tag, commit, required=False):
    prefix = f'/repos/{REPO}'
    ref = api.request('GET', f'{prefix}/git/ref/tags/{quote(tag)}', allow_not_found=True)
    if ref is None:
        if required:
            raise ValueError('Published release tag is missing')
        return
    obj = ref['object']
    seen = set()
    while obj['type'] == 'tag':
        if obj['sha'] in seen or len(seen) >= 16:
            raise ValueError('Unexpected annotated-tag chain')
        seen.add(obj['sha'])
        obj = api.request('GET', f"{prefix}/git/tags/{obj['sha']}")['object']
    if obj['type'] != 'commit' or obj['sha'] != commit:
        raise ValueError('Release tag does not identify the verified commit')


def publish(api, tag, commit, title, body, assets):
    prefix = f'/repos/{REPO}'
    verify_tag(api, tag, commit)
    release = find_release(api, tag)
    if release is None:
        release = api.request('POST', f'{prefix}/releases', {
            'tag_name': tag, 'target_commitish': commit, 'name': title,
            'body': body, 'draft': True, 'prerelease': True, 'make_latest': 'false'})
    if (release['tag_name'] != tag or release['target_commitish'] != commit
            or release['name'] != title or release['body'] != body or not release['prerelease']):
        raise ValueError('Existing release metadata differs; never overwrite it')
    release_id = release['id']
    remote = api.request('GET', f'{prefix}/releases/{release_id}/assets?per_page=100')
    expected = {p.name: p for p in assets}
    if len({a['name'] for a in remote}) != len(remote) or any(a['name'] not in expected for a in remote):
        raise ValueError('Unexpected or duplicate existing release assets')
    existing = {a['name']: a for a in remote}
    for name, path in expected.items():
        asset = existing.get(name)
        if asset is None:
            if not release['draft']:
                raise ValueError('Published release is missing an asset; publish a new version')
            asset = api.request('POST', f'{prefix}/releases/{release_id}/assets?name={quote(name)}', file=path)
        if asset['name'] != name or asset['size'] != path.stat().st_size or asset.get('digest') != f'sha256:{digest(path)}' or asset.get('state') != 'uploaded':
            raise ValueError(f'Remote release asset verification failed: {name}')
    # Re-read the complete server asset set before making any binary public.
    final_assets = api.request('GET', f'{prefix}/releases/{release_id}/assets?per_page=100')
    if len(final_assets) != len(expected) or {a['name'] for a in final_assets} != set(expected):
        raise ValueError('Incomplete uploaded release')
    for asset in final_assets:
        path = expected[asset['name']]
        if asset.get('digest') != f'sha256:{digest(path)}' or asset['size'] != path.stat().st_size:
            raise ValueError('Remote asset changed before publication')
    verify_tag(api, tag, commit)
    if release['draft']:
        release = api.request('PATCH', f'{prefix}/releases/{release_id}', {'draft': False, 'prerelease': True, 'make_latest': 'false'})
    if release['draft'] or not release['prerelease']:
        raise ValueError('Release publication not confirmed')
    verify_tag(api, tag, commit, required=True)
    return release['html_url']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True, type=Path)
    args = parser.parse_args()
    commit = os.environ.get('GITHUB_SHA', '')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    run_attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '')
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != REPO
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch')
            or not re.fullmatch(r'[a-f0-9]{40}', commit) or not re.fullmatch(r'[1-9][0-9]*', run_id)
            or not re.fullmatch(r'[1-9][0-9]*', run_attempt)):
        raise SystemExit('Publication is restricted to the trusted repository main workflow')
    current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip()
    if current != commit:
        raise SystemExit('Publisher checkout does not match workflow commit')
    directory = args.assets.resolve()
    mac, assets = verify_assets(directory, commit, tree, run_id, run_attempt)
    launch = json.loads((directory / 'macos-launch.json').read_text())
    version = (ROOT / 'packaging/mac-release-version.txt').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+-demo\.\d+', version):
        raise SystemExit('Invalid demo release version')
    if json.loads((ROOT / 'package.json').read_text())['version'] != version:
        raise SystemExit('Package/release version mismatch')
    tag = f'v{version}-{commit[:12]}-{run_id}'
    run_url = f'https://github.com/{REPO}/actions/runs/{run_id}'
    provenance = directory / 'release-provenance.json'
    provenance.write_text(json.dumps({'schemaVersion': 1, 'repository': REPO, 'sourceCommit': commit,
        'sourceTree': tree, 'tag': tag, 'buildRun': run_url, 'launchRunAttempt': launch['workflow']['runAttempt'], 'target': 'macos-arm64',
        'distribution': 'experimental no-hardware demo', 'signing': mac['signing'],
        'launchAcceptance': {'receipt': 'macos-launch.json', 'archiveSha256': mac['archive']['sha256'],
                             'testOS': launch['testOS'], 'trust': launch['trust']},
        'assets': [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in assets]}, indent=2) + '\n')
    assets.append(provenance)
    sums = directory / 'SHA256SUMS'
    sums.write_text(''.join(f'{digest(p)}  {p.name}\n' for p in sorted(assets)))
    assets.append(sums)
    body = f'''Experimental **Mac Apple-silicon demo**. Requires macOS {mac['minimumSystemVersion']} or later.

Download **{mac['archive']['name']}**, unzip, and move JazzKeys.app into Applications or a folder you own. No Rust, Xcode, Bun, or Node is needed. Quit and remove the app to uninstall. [Installation and Apple security guidance](https://github.com/{REPO}/blob/{commit}/docs/INSTALL.md).

**Ad-hoc development-signed, without Developer ID or notarization. macOS may block opening it.** Do not disable system protections globally. This demo cannot read or change your keyboard. No hardware permission grant is part of exploring the demo.

Strict signature verification passes before and after extraction, and a modified-resource negative test is rejected. The exact ZIP above was downloaded from this workflow's build artifact, extracted, recognized by Launch Services, opened with a titled JazzKeys window, and quit gracefully on a GitHub-hosted Mac running macOS {launch['testOS']['version']} ({launch['testOS']['build']}). The same-run archive-bound evidence is in macos-launch.json. No app rebuild, permission acceptance, input injection, or security-settings change was part of this gate.

This does not establish first-run acceptance of a quarantined download on a user's Mac or resolve the reported Raycast -10827 failure on macOS 26.5.2. Network silence, hardware behavior, and VoiceOver acceptance remain unverified. Native offscreen controls and relocated compiled self-tests passed. [Exact scope](https://github.com/{REPO}/blob/{commit}/docs/RELEASE.md).

The complete corresponding-source archive and build/relink instructions are provided alongside the app; GitHub's automatic source ZIP alone is not the full source companion. Notices are also inside the app.

Source: {commit}\nTree: {tree}\nBuild: {run_url}

Verify downloads using SHA256SUMS. This version's assets are never overwritten. Checksums/provenance do not claim notarization, independent publisher authentication, or reproducible builds.
'''
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        raise SystemExit('The publishing job requires its ephemeral GitHub Actions token')
    url = publish(GitHub(token), tag, commit, f'JazzKeys {version} · Mac demo', body, assets)
    print(url)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(f'Published [Mac demo release]({url}) with matching complete source.\n')


if __name__ == '__main__':
    main()
