"""Offline synthetic release-gate tests. No macOS tools or app code execute."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('release_launch', Path(__file__).with_name('release-launch.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
COMMIT, TREE = 'a' * 40, 'b' * 40
RUN_ID, ATTEMPT = '123456', '2'


def write_json(path, value):
    path.write_text(json.dumps(value))


def file_record(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': m.digest(path)}


def synthetic_assets(root):
    """Self-consistent hashes around inert bytes, never a distributable app."""
    directory = root / 'assets'
    directory.mkdir()
    bundle = root / 'bundle'
    executable = bundle / 'JazzKeys.app/Contents/MacOS/jazzkeys'
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b'OFFLINE INERT FIXTURE; not executable app code\n')
    executable.chmod(0o755)
    manifest = {
        'schemaVersion': 1, 'product': 'JazzKeys', 'target': 'macos-arm64',
        'sourceCommit': COMMIT, 'sourceTree': TREE, 'application': 'JazzKeys.app',
        'hardwareStatus': 'no_hardware_demo', 'signing': m.SIGNING, 'version': '0.1.0-demo.3',
        'files': [{**file_record(executable), 'name': 'JazzKeys.app/Contents/MacOS/jazzkeys'}],
    }
    manifest_path = directory / f'JazzKeys-bundle-manifest-{COMMIT}.json'
    write_json(manifest_path, manifest)
    archive = directory / f'JazzKeys-demo-macos-arm64-{COMMIT}.zip'
    m.mac_tools().create_archive(bundle, archive, manifest)
    mac = {
        'schemaVersion': 1, 'product': 'JazzKeys', 'target': 'macos-arm64',
        'sourceCommit': COMMIT, 'sourceTree': TREE, 'hardwareStatus': 'no_hardware_demo',
        'signing': m.SIGNING, 'version': manifest['version'], 'minimumSystemVersion': '14.0',
        'bundleSignatureVerification': {'beforeArchive': {'verified': True},
                                        'afterExtraction': {'verified': True}, 'resourceTamperRejected': True},
        'archive': file_record(archive), 'bundleManifest': file_record(manifest_path),
    }
    write_json(directory / 'macos-release.json', mac)
    receipt = {
        'schemaVersion': 1, 'verified': True, 'product': 'JazzKeys', 'target': 'macos-arm64',
        'sourceCommit': COMMIT, 'sourceTree': TREE, 'archive': mac['archive'], 'bundleManifest': mac['bundleManifest'],
        'application': m.APP_PATH, 'trust': m.TRUST,
        'workflow': {'repository': m.REPO, 'ref': m.WORKFLOW, 'runId': RUN_ID, 'runAttempt': ATTEMPT,
                     'url': f'https://github.com/{m.REPO}/actions/runs/{RUN_ID}'},
        'testOS': {'system': 'Darwin', 'architecture': 'arm64', 'version': '26.6.2', 'build': '25G123',
                   'runner': 'github-hosted', 'runnerLabel': 'macos-26'},
        'bundleVerification': {'verifiedBundle': True, 'target': 'macos-arm64', 'hardwareStatus': 'no_hardware_demo'},
        'bundleSignatureVerification': {'verified': True},
        'metadata': {
            'schemaVersion': 1, 'verified': True, 'bundleCreated': True, 'cfBundleCreated': True,
            'executableResolved': True, 'launchServicesRecognizesApplication': True,
            'urlResourceRecognizesApplication': True, 'launchServicesStatus': 0, 'resourceErrorCode': 0,
            'bundleName': 'JazzKeys', 'displayName': 'JazzKeys', 'identifier': 'io.jazzkeys.desktop',
            'executableName': 'jazzkeys', 'packageType': 'APPL', 'architectures': [16777228],
            'minimumSystemVersion': '14.0', 'systemVersion': 'Version 26.6.2 (Build 25G123)',
        },
        'launch': {
            'schemaVersion': 1, 'verified': True, 'targetKind': 'current-extracted-archive',
            'completionReceived': True, 'identityMatched': True, 'launchedWithOwnedWindow': True,
            'windowServerDataAvailable': True, 'quitRequested': True, 'terminated': True,
            'forceAttempted': False, 'forceAccepted': False, 'launchTimedOut': False,
            'cleanupUncertain': False, 'permissionPromptsAccepted': False, 'pid': 1234, 'errors': [],
            'windows': [{'title': 'JazzKeys', 'width': 1024, 'height': 768}],
        },
    }
    write_json(directory / 'macos-launch.json', receipt)
    source_path = directory / f'JazzKeys-corresponding-source-{COMMIT}.tar.gz'
    source_path.write_bytes(b'OFFLINE source fixture')
    source_record = file_record(source_path)
    source_record['path'] = source_record.pop('name')
    write_json(directory / f'JazzKeys-corresponding-source-{COMMIT}.json', {
        'schema_version': 1, 'project_commit': COMMIT, 'source_tree': TREE, 'archive': source_record,
    })
    return directory, mac, receipt


class LaunchReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory, self.mac, self.receipt = synthetic_assets(Path(self.temp.name))

    def verify(self, receipt=None):
        m.verify_launch_receipt(receipt or self.receipt, self.mac, COMMIT, TREE, RUN_ID, ATTEMPT)

    def test_exact_archive_and_receipt_pass_offline(self):
        mac, archive, manifest = m.verify_mac_assets(self.directory, COMMIT, TREE)
        self.assertEqual(mac, self.mac)
        self.assertEqual(m.digest(archive), self.receipt['archive']['sha256'])
        self.assertEqual(m.digest(manifest), self.receipt['bundleManifest']['sha256'])
        self.verify()

    def test_archive_byte_change_rejected_before_execution(self):
        path = self.directory / self.mac['archive']['name']
        path.write_bytes(path.read_bytes() + b'changed')
        with patch.object(m, 'run') as execute:
            with self.assertRaisesRegex(ValueError, 'differs'):
                m.verify_mac_assets(self.directory, COMMIT, TREE)
            execute.assert_not_called()

    def test_forged_archive_receipt_cannot_hide_member_change(self):
        manifest_path = self.directory / self.mac['bundleManifest']['name']
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['sha256'] = '0' * 64
        write_json(manifest_path, manifest)
        self.mac['bundleManifest'] = file_record(manifest_path)
        write_json(self.directory / 'macos-release.json', self.mac)
        with self.assertRaisesRegex(ValueError, 'ZIP member hash'):
            m.verify_mac_assets(self.directory, COMMIT, TREE)

    def test_each_provenance_binding_is_required(self):
        for field, value in [('sourceCommit', 'c' * 40), ('sourceTree', 'c' * 40),
                             ('archive', {**self.mac['archive'], 'sha256': '0' * 64}),
                             ('bundleManifest', {**self.mac['bundleManifest'], 'sha256': '0' * 64}),
                             ('application', 'dist/install/macos-arm64/JazzKeys.app'), ('verified', False)]:
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.receipt)
                receipt[field] = value
                with self.assertRaises(ValueError):
                    self.verify(receipt)

    def test_other_workflow_run_attempt_or_repository_rejected(self):
        for field, value in [('runId', '123457'), ('runAttempt', '3'), ('repository', 'other/repository'),
                             ('ref', 'other-workflow'), ('runId', None)]:
            with self.subTest(field=field, value=value):
                receipt = copy.deepcopy(self.receipt)
                receipt['workflow'][field] = value
                with self.assertRaisesRegex(ValueError, 'workflow run'):
                    self.verify(receipt)

    def test_publish_retry_can_reuse_exact_archive_evidence_from_earlier_same_run_attempt(self):
        self.receipt['workflow']['runAttempt'] = '1'
        self.verify()

    def test_actual_macos26_host_required(self):
        for field, value in [('version', '14.7.1'), ('version', ''), ('architecture', 'x86_64'),
                             ('runner', 'self-hosted'), ('build', ''), ('runnerLabel', 'macos-14')]:
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.receipt)
                receipt['testOS'][field] = value
                with self.assertRaisesRegex(ValueError, 'host identity'):
                    self.verify(receipt)

    def test_metadata_failures_and_old_brand_rejected(self):
        for field, value in [('verified', False), ('launchServicesStatus', -10827),
                             ('bundleName', 'Jazzkeys'), ('displayName', 'Jazzkeys'),
                             ('architectures', []), ('systemVersion', 'Version 14.7.1'),
                             ('executableResolved', False), ('minimumSystemVersion', '15.0')]:
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.receipt)
                receipt['metadata'][field] = value
                with self.assertRaisesRegex(ValueError, 'metadata recognition'):
                    self.verify(receipt)

    def test_each_success_boolean_is_required_and_typed(self):
        for field in ['verified', 'completionReceived', 'identityMatched', 'launchedWithOwnedWindow',
                      'windowServerDataAvailable', 'quitRequested', 'terminated']:
            for value in [False, 1, None]:
                with self.subTest(field=field, value=value):
                    receipt = copy.deepcopy(self.receipt)
                    receipt['launch'][field] = value
                    with self.assertRaisesRegex(ValueError, 'gracefully quit'):
                        self.verify(receipt)

    def test_force_timeout_uncertain_cleanup_and_prompt_acceptance_rejected(self):
        for field in ['forceAttempted', 'forceAccepted', 'launchTimedOut', 'cleanupUncertain', 'permissionPromptsAccepted']:
            for value in [True, 0, None]:
                with self.subTest(field=field, value=value):
                    receipt = copy.deepcopy(self.receipt)
                    receipt['launch'][field] = value
                    with self.assertRaisesRegex(ValueError, 'gracefully quit'):
                        self.verify(receipt)

    def test_baseline_or_errors_cannot_pass(self):
        for field, value in [('targetKind', 'published-demo.2-baseline'), ('pid', 0), ('pid', True),
                             ('errors', [{'domain': 'NSOSStatusErrorDomain', 'code': -10827}])]:
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.receipt)
                receipt['launch'][field] = value
                with self.assertRaisesRegex(ValueError, 'gracefully quit'):
                    self.verify(receipt)

    def test_owned_window_needs_correct_visible_title_and_size(self):
        for windows in [[], [{'title': '', 'width': 1024, 'height': 768}],
                        [{'title': 'Jazzkeys', 'width': 1024, 'height': 768}],
                        [{'title': 'JazzKeys', 'width': 959, 'height': 768}],
                        [{'title': 'JazzKeys', 'width': 1024, 'height': 679}],
                        [{'title': 'JazzKeys', 'width': float('inf'), 'height': 768}],
                        [{'title': 'JazzKeys', 'width': '1024', 'height': 768}]]:
            with self.subTest(windows=windows):
                receipt = copy.deepcopy(self.receipt)
                receipt['launch']['windows'] = windows
                with self.assertRaisesRegex(ValueError, 'titled, owned'):
                    self.verify(receipt)

    def test_local_or_unapproved_execution_rejected_without_commands(self):
        argv = ['release-launch.py', '--assets', str(self.directory), '--output', 'unused.json',
                '--metadata-helper', 'unused', '--launch-helper', 'unused']
        with patch.dict(m.os.environ, {}, clear=True), patch.object(m, 'run') as execute, patch('sys.argv', argv):
            with self.assertRaisesRegex(SystemExit, 'authorized GitHub-hosted'):
                m.main()
            execute.assert_not_called()

    def run_mocked_gate(self, metadata=None):
        """Exercise ordering and output with every external command mocked."""
        root = Path(self.temp.name) / 'checkout'
        root.mkdir()
        output = Path(self.temp.name) / 'result/macos-launch.json'
        metadata_helper = Path(self.temp.name) / 'metadata-helper'
        launch_helper = Path(self.temp.name) / 'launch-helper'
        calls = []
        environment = {
            'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': m.REPO, 'GITHUB_REF': 'refs/heads/main',
            'GITHUB_WORKFLOW_REF': m.WORKFLOW, 'GITHUB_EVENT_NAME': 'push',
            'GITHUB_SHA': COMMIT, 'GITHUB_RUN_ID': RUN_ID, 'GITHUB_RUN_ATTEMPT': ATTEMPT,
            'GITHUB_WORKSPACE': str(root), 'RUNNER_ENVIRONMENT': 'github-hosted',
            'RUNNER_OS': 'macOS', 'RUNNER_ARCH': 'ARM64',
        }

        def command(*args, **kwargs):
            calls.append(args)
            if args == ('git', 'rev-parse', 'HEAD'):
                return COMMIT
            if args == ('git', 'rev-parse', 'HEAD^{tree}'):
                return TREE
            if args == ('git', 'status', '--porcelain'):
                return ''
            if args == ('/usr/bin/sw_vers', '-productVersion'):
                return '26.6.2'
            if args == ('/usr/bin/sw_vers', '-buildVersion'):
                return '25G123'
            if args[0] == '/usr/bin/ditto':
                self.assertEqual(args[3], str(self.directory / self.mac['archive']['name']))
                with zipfile.ZipFile(args[3]) as archive:
                    archive.extractall(args[4])
                return ''
            if args[:2] == ('bun', 'packaging/verify-bundle.ts'):
                return json.dumps(self.receipt['bundleVerification'])
            if args[0] == str(metadata_helper):
                return json.dumps(metadata if metadata is not None else self.receipt['metadata'])
            if args[0] == str(launch_helper):
                self.assertEqual(args[1], str(root / m.APP_PATH))
                self.assertTrue((root / 'dist/launch-current/bundle-manifest.json').is_file())
                write_json(Path(args[2]), self.receipt['launch'])
                return json.dumps(self.receipt['launch'])
            self.fail(f'Unexpected external command: {args}')

        argv = ['release-launch.py', '--assets', str(self.directory), '--output', str(output),
                '--metadata-helper', str(metadata_helper), '--launch-helper', str(launch_helper)]
        mac_module = m.mac_tools()
        with (patch.dict(m.os.environ, environment, clear=True), patch.object(m, 'ROOT', root),
              patch.object(m, 'run', side_effect=command), patch.object(m, 'mac_tools', return_value=mac_module),
              patch.object(mac_module, 'verify_mac_signatures', return_value={'verified': True}) as signature_check,
              patch.object(m.platform, 'system', return_value='Darwin'),
              patch.object(m.platform, 'machine', return_value='arm64'), patch('sys.argv', argv)):
            if metadata is not None:
                with self.assertRaisesRegex(ValueError, 'metadata recognition'):
                    m.main()
                self.assertFalse(output.exists())
                self.assertFalse(any(args[0] == str(launch_helper) for args in calls))
                return
            m.main()
            self.assertEqual(signature_check.call_count, 2)
        receipt = json.loads(output.read_text())
        self.assertEqual(receipt['archive'], self.mac['archive'])
        self.assertEqual(receipt['launch'], self.receipt['launch'])
        self.assertEqual([path.name for path in output.parent.iterdir()], ['macos-launch.json'])
        self.assertEqual(sum(args[0] == str(launch_helper) for args in calls), 1)
        self.assertEqual(sum(args[:2] == ('bun', 'packaging/verify-bundle.ts') for args in calls), 2)
        self.verify(receipt)

    def test_mocked_gate_extracts_exact_archive_and_emits_one_bound_receipt(self):
        self.run_mocked_gate()

    def test_mocked_gate_never_launches_after_metadata_rejection(self):
        self.run_mocked_gate({**self.receipt['metadata'], 'verified': False})


if __name__ == '__main__':
    unittest.main()
