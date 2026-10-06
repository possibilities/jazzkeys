import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

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


if __name__ == '__main__':
    unittest.main()
