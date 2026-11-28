import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('promote_release', Path(__file__).with_name('promote-release.py'))
promoter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promoter)
COMMIT = 'a' * 40
TAG = 'v1.4.281-hub.1'


class GitHubWorld:
    def __init__(self):
        self.run = dict(head_sha=COMMIT, status='completed', conclusion='success', event='push',
                        workflow_id=409894392, head_repository={'id': 1432470272}, run_attempt=2)
        self.row = dict(state='building', integration_commit=COMMIT, fork_tag=TAG, run_id='99',
                        intent_kind='release-promote', intent_id='promote-99', attempt=2)
        self.files = {'orca-linux.AppImage': b'appimage', 'orca-macos-arm64.dmg': b'dmg'}
        sha = base64.b64encode(hashlib.sha512(b'appimage').digest()).decode()
        self.files['latest-linux.yml'] = ('version: 1.4.281-hub.1\npath: orca-linux.AppImage\nfiles:\n'
                                         '  - url: orca-linux.AppImage\n    sha512: ' + sha + '\n').encode()
        self.jobs = {}
        self.artifacts = []
        self.archives = {}
        for platform, attempt, artifact_id, job_id in [('linux', 1, 101, 201), ('macos', 2, 102, 202)]:
            names = promoter.assets.ASSETS[platform]
            receipt = dict(platform=platform, commit=COMMIT, tag=TAG, run='99', attempt=attempt,
                           repoId=1432470272, smoke=True,
                           files={name: dict(size=len(self.files[name]),
                                            sha256=hashlib.sha256(self.files[name]).hexdigest()) for name in names})
            contents = {name: self.files[name] for name in names}
            contents[platform + '.json'] = json.dumps(receipt).encode()
            self.archive(artifact_id, contents)
            self.artifacts.append(dict(id=artifact_id, name='staged-' + platform, expired=False,
                                       digest='sha256:' + hashlib.sha256(self.archives[artifact_id]).hexdigest(),
                                       workflow_run=dict(id=99, head_sha=COMMIT, repository_id=1432470272)))
            self.jobs[attempt] = [dict(id=job_id, name='appimage' if platform == 'linux' else 'macos',
                                       status='completed', conclusion='success', run_id=99,
                                       run_attempt=attempt, head_sha=COMMIT,
                                       steps=[dict(name='Smoke check', status='completed', conclusion='success')])]
        self.release = None
        self.remote = {}
        self.mutations = []
        self.lost = None
        self.renews = 0
        self.expire_at = None

    def archive(self, identity, contents):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as zipped:
            for name, content in contents.items():
                zipped.writestr(name, content)
        self.archives[identity] = buffer.getvalue()

    def seed_draft(self, files):
        self.release = dict(id=301, tag_name=TAG, draft=True, published_at=None, html_url='https://example.test/301')
        self.remote = dict(files)

    def release_data(self):
        return {**self.release, 'assets': [dict(name=name) for name in self.remote]}

    def lose_response(self, action):
        if self.lost == action:
            self.lost = None
            raise subprocess.CalledProcessError(1, ['gh', action], 'response lost after effect')

    def execute(self, argv, text=False):
        args = list(argv)
        result = {}
        if args[0] == 'python3':
            action = args[4]
            if action == 'get':
                result = {'result': {'release': self.row}}
            elif action == 'renew':
                self.renews += 1
                if self.renews == self.expire_at:
                    raise subprocess.CalledProcessError(1, args, 'lease expired or stale fence')
            else:
                raise AssertionError('promoter must not resolve the ledger intent')
        elif args[:2] == ['gh', 'api']:
            path = args[-1]
            if path.endswith('/zip'):
                return self.archives[int(path.split('/')[-2])]
            if path == 'repos/Fede654/orca':
                result = {'id': 1432470272}
            elif path.endswith('/actions/runs/99'):
                result = self.run
            elif '/git/ref/tags/' in path:
                result = {'object': {'type': 'commit', 'sha': COMMIT}}
            elif '/artifacts?' in path:
                result = [{'artifacts': self.artifacts}]
            elif '/jobs?' in path:
                result = [{'jobs': self.jobs[int(path.split('/attempts/')[1].split('/')[0])]}]
            elif '/releases?' in path:
                result = [[self.release_data()] if self.release else []]
            elif '/releases/' in path:
                result = self.release_data()
            else:
                raise AssertionError(path)
        elif args[:2] == ['gh', 'release']:
            action = args[2]
            if action == 'create':
                if self.release:
                    raise AssertionError('duplicate release creation')
                self.seed_draft({})
                self.mutations.append(('create', 301))
                self.lose_response('create')
            elif action == 'upload':
                for value in args[6:]:
                    path = Path(value)
                    if path.name in self.remote:
                        raise AssertionError('duplicate upload or clobber')
                    self.remote[path.name] = path.read_bytes()
                    self.mutations.append(('upload', path.name))
                    self.lose_response('upload')
            elif action == 'download':
                root = Path(args[args.index('--dir') + 1])
                root.mkdir()
                for name, content in self.remote.items():
                    (root / name).write_bytes(content)
            elif action == 'edit':
                self.release.update(draft=False, published_at='2026-11-28T00:00:00Z')
                self.mutations.append(('edit', 301))
                self.lose_response('edit')
            else:
                raise AssertionError(args)
        else:
            raise AssertionError(args)
        return json.dumps(result) if text else json.dumps(result).encode()


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.evidence = Path(self.temp.name) / 'promotion.json'
        self.world = GitHubWorld()

    def tearDown(self):
        self.temp.cleanup()

    def promote(self):
        argv = ['promote-release.py', '--commit', COMMIT, '--tag', TAG, '--run', '99',
                '--db', '/unused/state.sqlite', '--release-id', '42', '--owner', 'worker',
                '--token', 'token', '--fence', '2', '--evidence', str(self.evidence), '--publish']
        with patch('sys.argv', argv), patch.object(promoter.subprocess, 'check_output', self.world.execute), redirect_stdout(io.StringIO()):
            promoter.main()

    def test_rejects_incomplete_run_platform_smoke_or_archive_before_mutation(self):
        for failure in ['run-status', 'run-failure', 'run-sha', 'job-status', 'job-failure', 'smoke', 'missing-macos', 'manifest']:
            with self.subTest(failure=failure):
                self.world = GitHubWorld()
                if failure == 'run-status':
                    self.world.run['status'] = 'in_progress'
                elif failure == 'run-failure':
                    self.world.run['conclusion'] = 'failure'
                elif failure == 'run-sha':
                    self.world.run['head_sha'] = 'b' * 40
                elif failure == 'job-status':
                    self.world.jobs[2][0]['status'] = 'in_progress'
                elif failure == 'job-failure':
                    self.world.jobs[2][0]['conclusion'] = 'failure'
                elif failure == 'smoke':
                    self.world.jobs[2][0]['steps'][0]['conclusion'] = 'failure'
                elif failure == 'missing-macos':
                    self.world.artifacts.pop()
                else:
                    self.world.archive(101, {'orca-linux.AppImage': b'appimage'})
                    self.world.artifacts[0]['digest'] = 'sha256:' + hashlib.sha256(self.world.archives[101]).hexdigest()
                with self.assertRaises(ValueError):
                    self.promote()
                self.assertEqual(self.world.mutations, [])
                self.assertEqual(self.world.row['intent_id'], 'promote-99')

    def test_partial_draft_recovers_without_clobber_and_records_platform_attempts(self):
        self.world.seed_draft({'orca-linux.AppImage': b'appimage'})
        self.promote()
        self.assertEqual(self.world.mutations, [('upload', 'latest-linux.yml'),
                                              ('upload', 'orca-macos-arm64.dmg'), ('edit', 301)])
        self.assertEqual(self.world.remote, self.world.files)
        saved = json.loads(self.evidence.read_text())
        self.assertEqual(saved['platforms']['linux']['artifactId'], 101)
        self.assertEqual(saved['platforms']['linux']['attempt'], 1)
        self.assertEqual(saved['platforms']['macos']['artifactId'], 102)
        self.assertEqual(saved['platforms']['macos']['attempt'], 2)
        self.assertEqual(json.loads(self.evidence.with_suffix('.release.json').read_text())['releaseId'], 301)

    def test_lost_create_partial_upload_or_publish_response_reconciles_same_release(self):
        for effect in ['create', 'upload', 'edit']:
            with self.subTest(effect=effect), tempfile.TemporaryDirectory() as temp:
                self.evidence = Path(temp) / 'promotion.json'
                self.world = GitHubWorld()
                self.world.lost = effect
                with self.assertRaises(subprocess.CalledProcessError):
                    self.promote()
                self.assertEqual(self.world.row['intent_id'], 'promote-99')
                self.promote()
                self.assertEqual(self.world.remote, self.world.files)
                self.assertFalse(self.world.release['draft'])
                self.assertEqual(self.world.mutations.count(('create', 301)), 1)
                self.assertEqual(self.world.mutations.count(('edit', 301)), 1)
                for name in ['orca-linux.AppImage', 'latest-linux.yml', 'orca-macos-arm64.dmg']:
                    self.assertEqual(self.world.mutations.count(('upload', name)), 1)

    def test_different_remote_bytes_block_publication_without_resolving_intent(self):
        self.world.seed_draft({**self.world.files, 'orca-macos-arm64.dmg': b'wrong'})
        with self.assertRaisesRegex(ValueError, 'remote asset integrity'):
            self.promote()
        self.assertEqual(self.world.mutations, [])
        self.assertTrue(self.world.release['draft'])
        self.assertEqual(self.world.row['intent_id'], 'promote-99')

    def test_expired_lease_or_stale_fence_at_publication_blocks_edit(self):
        self.world.seed_draft(self.world.files)
        self.world.expire_at = 3
        with self.assertRaises(subprocess.CalledProcessError):
            self.promote()
        self.assertEqual(self.world.mutations, [])
        self.assertTrue(self.world.release['draft'])
        self.assertEqual(self.world.row['intent_id'], 'promote-99')


if __name__ == '__main__':
    unittest.main()
