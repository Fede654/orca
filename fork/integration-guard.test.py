import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent


class IntegrationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='orca-integration-guard-')
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Guard test')
        self.git('config', 'user.email', 'guard@example.invalid')
        self.git('config', 'rerere.enabled', 'true')
        (self.root / 'payload').write_text('original\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        base = self.git('rev-parse', 'HEAD').strip()
        self.git('tag', 'v1.0.0')
        self.git('branch', 'fork/topic')
        self.git('checkout', '-qb', 'adapt/topic')
        (self.root / 'payload').write_text('retained\n')
        self.git('commit', '-qam', 'topic behavior')
        adapted = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', 'main')
        fork = self.root / 'fork'
        fork.mkdir()
        for name in ('integrate.sh', 'verify-integration-plan.py'):
            shutil.copy(SOURCE / name, fork / name)
        series = 'topic\tfork/topic@adapt/topic\tfork-only\tfixture\n'
        (fork / 'series').write_text(series)
        plan = {'schemaVersion': 1, 'base': 'v1.0.0', 'baseCommit': base,
                'historicalTarget': adapted, 'seriesSha256': hashlib.sha256(series.encode()).hexdigest(),
                'topics': [{'selector': 'fork/topic@adapt/topic',
                            'refs': {'fork/topic': base, 'adapt/topic': adapted}}],
                'retainedFiles': {'payload': hashlib.sha256(b'retained\n').hexdigest()}}
        (fork / 'integration-plan.json').write_text(json.dumps(plan))
        (self.root / 'FORK.md').write_text('fixture\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'reviewed preparation')
        self.git('branch', 'feat/integration')
        self.git('remote', 'add', 'origin', str(self.root))
        self.env = {**os.environ, 'FORK_REMOTE': 'origin', 'FORK_WORKTREE': str(self.root.parent / 'verify')}

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL, text=True)

    def reject(self, message, *args):
        before = self.git('show-ref')
        result = subprocess.run(['bash', 'fork/integrate.sh', *args], cwd=self.root,
                                env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(message, result.stdout + result.stderr)
        # Integration and published tags must survive a rejected operation.
        after = self.git('show-ref')
        protected = lambda text: [line for line in text.splitlines() if ' refs/tags/' in line or ' refs/heads/feat/integration' in line]
        self.assertEqual(protected(before), protected(after))

    def test_missing_plan_rejects_publish_before_effects(self):
        (self.root / 'fork/integration-plan.json').unlink()
        self.reject('reviewed plan and verifier are required', '--publish', 'v1.0.0-hub.1')

    def test_alternate_series_with_backport_is_rejected(self):
        alternate = self.root.parent / 'alternate-series'
        alternate.write_text((self.root / 'fork/series').read_text() + 'backport\tHEAD\tupstream\tinjected\n')
        self.env['FORK_SERIES'] = str(alternate)
        self.reject('series bytes differ', 'v1.0.0', '--dry-run')

    def test_matching_hash_does_not_allow_unsupported_backport(self):
        series = self.root / 'fork/series'
        series.write_text(series.read_text() + 'backport\tHEAD\tupstream\tinjected\n')
        plan = self.root / 'fork/integration-plan.json'
        data = json.loads(plan.read_text())
        data['seriesSha256'] = hashlib.sha256(series.read_bytes()).hexdigest()
        plan.write_text(json.dumps(data))
        self.git('add', '.')
        self.git('commit', '-qm', 'unsupported plan')
        self.reject('unsupported series entry', 'v1.0.0', '--dry-run')

    def test_dirty_metadata_is_rejected(self):
        (self.root / 'FORK.md').write_text('unreviewed\n')
        self.reject('metadata has uncommitted changes', 'v1.0.0', '--dry-run')

    def test_resolved_ref_moved_after_ls_remote_is_rejected(self):
        binary = Path(shutil.which('git')).resolve()
        tools = self.root.parent / 'tools'
        tools.mkdir()
        wrapper = tools / 'git'
        wrapper.write_text('#!/usr/bin/env python3\nimport os,subprocess,sys\na=sys.argv[1:]\n'
                           f'b={str(binary)!r}\n'
                           "if 'fetch' in a and any('refs/heads/adapt/topic:' in x for x in a):\n"
                           f" subprocess.run([b,'-C',{str(self.root)!r},'update-ref','refs/heads/adapt/topic','main'],check=True)\n"
                           'os.execv(b,[b,*a])\n')
        wrapper.chmod(0o755)
        self.env['PATH'] = str(tools) + os.pathsep + self.env['PATH']
        self.reject('resolved reference adapt/topic moved', 'v1.0.0', '--dry-run')

    def test_candidate_with_lost_behavior_cannot_publish(self):
        self.git('tag', 'v1.0.0-hub.1')
        # The candidate lost the retained payload. Reproduction must reject it before push.
        self.reject('retained adjustment', '--publish', 'v1.0.0-hub.1')


if __name__ == '__main__':
    unittest.main()
