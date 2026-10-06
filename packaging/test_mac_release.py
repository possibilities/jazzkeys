import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('mac_release', Path(__file__).with_name('mac-release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MacArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'bundle'
        self.files = [('Jazzkeys.app/Contents/MacOS/jazzkeys', b'fixture executable', 0o755),
                      ('Jazzkeys.app/Contents/Resources/LICENSE', b'fixture notice', 0o644)]
        self.manifest = {'files': []}
        for name, data, mode in self.files:
            path = self.bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(mode)
            self.manifest['files'].append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        self.archive = self.root / 'app.zip'

    def malicious(self, replacement):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, data, mode in replacement:
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = mode << 16
                archive.writestr(item, data)

    def test_roundtrip_and_no_overwrite(self):
        m.create_archive(self.bundle, self.archive, self.manifest)
        m.validate_archive(self.archive, self.manifest)
        with self.assertRaisesRegex(ValueError, 'replace'):
            m.create_archive(self.bundle, self.archive, self.manifest)

    def test_reject_changed_bundle(self):
        (self.bundle / self.files[0][0]).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            m.create_archive(self.bundle, self.archive, self.manifest)

    def test_reject_symlink(self):
        path = self.bundle / self.files[1][0]
        path.unlink()
        path.symlink_to('/dev/null')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            m.create_archive(self.bundle, self.archive, self.manifest)

    def test_tamper_check_aborts_if_pristine_copy_is_invalid(self):
        with patch.object(m, 'verify_mac_signatures', side_effect=ValueError('copy invalid')) as baseline, patch.object(m.subprocess, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'copy invalid'):
                m.reject_tampered_resources(self.bundle)
            baseline.assert_called_once()
            command.assert_not_called()

    def test_tamper_check_requires_valid_baseline_and_rejected_resource_change(self):
        install = self.bundle / 'Jazzkeys.app/Contents/Resources/INSTALL.txt'
        install.write_bytes(b'pristine instructions')
        def baseline(path):
            self.assertEqual((path / 'Jazzkeys.app/Contents/Resources/INSTALL.txt').read_bytes(), b'pristine instructions')
            return {'verified': True}
        with patch.object(m, 'verify_mac_signatures', side_effect=baseline), patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stderr='a sealed resource is missing or invalid')):
            self.assertTrue(m.reject_tampered_resources(self.bundle))
        self.assertEqual(install.read_bytes(), b'pristine instructions')

    def test_reject_missing_extra_duplicate_traversal_hash_and_modes(self):
        good = [(name, data, stat.S_IFREG | mode) for name, data, mode in self.files]
        bad_cases = [good[:1], good + [('../escape', b'x', stat.S_IFREG | 0o644)], good + [good[0]],
                     [(good[0][0], b'x' * len(good[0][1]), good[0][2]), good[1]],
                     [(good[0][0], good[0][1], stat.S_IFREG | 0o644), good[1]],
                     [good[0], (good[1][0], good[1][1], stat.S_IFLNK | 0o644)],
                     [good[0], (good[1][0], good[1][1], stat.S_IFREG | 0o666)]]
        for files in bad_cases:
            with self.subTest(files=files):
                self.malicious(files)
                with self.assertRaises(ValueError):
                    m.validate_archive(self.archive, self.manifest)


class MacSignatureChecks(unittest.TestCase):
    def display(self, args, **kwargs):
        path = args[-1]
        if path.endswith('/jazzkeys-device'):
            identifier = 'io.jazzkeys.desktop.device'
        elif path.endswith('/jazzkeys-appearance'):
            identifier = 'io.jazzkeys.desktop.appearance'
        else:
            identifier = 'io.jazzkeys.desktop'
        return SimpleNamespace(stderr=f'Identifier={identifier}\nSignature=adhoc\nSealed Resources version=2 rules=13 files=4\n')

    def test_checks_app_and_all_three_executables(self):
        with patch.object(m, 'run', return_value='') as verify, patch.object(m.subprocess, 'run', side_effect=self.display):
            result = m.verify_mac_signatures(Path('/fixture'))
        self.assertTrue(result['verified'])
        self.assertEqual(verify.call_count, 4)
        self.assertIn('--deep', verify.call_args_list[0].args)
        self.assertTrue(all('--strict' in call.args for call in verify.call_args_list))

    def test_invalid_signature_stops_even_if_display_would_succeed(self):
        with patch.object(m, 'run', side_effect=RuntimeError('invalid signature')), patch.object(m.subprocess, 'run') as display:
            with self.assertRaisesRegex(RuntimeError, 'invalid signature'):
                m.verify_mac_signatures(Path('/fixture'))
            display.assert_not_called()

    def test_wrong_identity_unsealed_and_nonadhoc_status_are_rejected(self):
        for text in ['Signature=adhoc\nIdentifier=other\n',
                     'Signature=adhoc\nIdentifier=io.jazzkeys.desktop\n',
                     'Identifier=io.jazzkeys.desktop\nAuthority=Developer ID\n']:
            with self.subTest(text=text), patch.object(m, 'run', return_value=''), patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stderr=text)):
                with self.assertRaises(ValueError):
                    m.verify_mac_signatures(Path('/fixture'))


if __name__ == '__main__':
    unittest.main()
