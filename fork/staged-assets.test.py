import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('staged_assets', Path(__file__).with_name('staged-assets.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagedAssetsTests(unittest.TestCase):
    def test_promotion_requires_both_smokes_same_candidate_and_intact_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'orca-linux.AppImage').write_bytes(b'appimage')
            (root / 'orca-macos-arm64.dmg').write_bytes(b'dmg')
            sha = base64.b64encode(module.digest(root / 'orca-linux.AppImage', 'sha512')).decode()
            (root / 'latest-linux.yml').write_text('version: 1.4.281-hub.1\npath: orca-linux.AppImage\nfiles:\n  - url: orca-linux.AppImage\n    sha512: ' + sha + '\n')
            import json
            linux = module.receipt(root, 'linux', 'a' * 40, 'v1.4.281-hub.1', '99', 1)
            (root / 'linux.json').write_text(json.dumps(linux))
            with self.assertRaises(FileNotFoundError):
                module.verify(root, 'a' * 40, 'v1.4.281-hub.1', '99')
            macos = module.receipt(root, 'macos', 'a' * 40, 'v1.4.281-hub.1', '99', 2)
            (root / 'macos.json').write_text(json.dumps(macos))
            self.assertEqual(set(module.verify(root, 'a' * 40, 'v1.4.281-hub.1', '99')),
                             {'orca-linux.AppImage', 'latest-linux.yml', 'orca-macos-arm64.dmg'})
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                module.verify(root, 'b' * 40, 'v1.4.281-hub.1', '99')
            (root / 'orca-macos-arm64.dmg').write_bytes(b'')
            with self.assertRaisesRegex(ValueError, 'empty'):
                module.verify(root, 'a' * 40, 'v1.4.281-hub.1', '99')


if __name__ == '__main__':
    unittest.main()
