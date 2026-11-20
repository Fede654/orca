import importlib.util
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('release-ledger.py')
spec = importlib.util.spec_from_file_location('release_ledger', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Ledger, LedgerError = module.Ledger, module.LedgerError


class ReleaseLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='orca-ledger-')
        self.path = Path(self.temp.name) / 'state.sqlite'
        self.now = 1000
        self.ledger = Ledger(self.path, lambda: self.now)
        self.ledger.register('stablyai/orca', '42', 'v1.4.266', 'a' * 40)

    def tearDown(self):
        self.ledger.close()
        self.temp.cleanup()

    def claim(self, owner='orky'):
        receipt = self.ledger.claim('stablyai/orca', '42', owner, 300)
        lease = receipt['lease']
        return {'repo': 'stablyai/orca', 'release_id': '42', 'owner': owner,
                'token': lease['token'], 'fence': lease['fence']}

    def transition(self, credentials, state, **changes):
        version = self.ledger.get('stablyai/orca', '42')['version']
        return self.ledger.transition(**credentials, version=version, state=state, **changes)

    def test_two_processes_cannot_claim_same_repository(self):
        self.ledger.register('stablyai/orca', '43', 'v1.4.267', 'b' * 40)
        processes = [subprocess.Popen([sys.executable, str(SCRIPT), '--db', str(self.path),
                     'claim', '--repo', 'stablyai/orca', '--release-id', release,
                     '--owner', owner], stdout=subprocess.PIPE, text=True)
                     for release, owner in [('42', 'first'), ('43', 'second')]]
        results = [json.loads(process.communicate(timeout=20)[0]) for process in processes]
        self.assertEqual(sorted(result['ok'] for result in results), [False, True])
        self.assertIn('already claimed', next(result['error'] for result in results if not result['ok']))

    def test_expiry_fences_old_owner_even_after_owner_name_is_reused(self):
        old = self.claim()
        self.now = 1301
        new = self.claim()
        self.assertEqual(new['fence'], 2)
        with self.assertRaisesRegex(LedgerError, 'stale'):
            self.transition(old, 'preparing')
        self.transition(new, 'preparing')
        with self.assertRaisesRegex(LedgerError, 'stale'):
            self.ledger.lease_action(**old)

    def test_duplicate_owner_and_stale_cas_are_rejected(self):
        credentials = self.claim()
        with self.assertRaisesRegex(LedgerError, 'already claimed'):
            self.claim()
        version = self.ledger.get('stablyai/orca', '42')['version']
        self.transition(credentials, 'preparing')
        with self.assertRaisesRegex(LedgerError, 'CAS'):
            self.ledger.transition(**credentials, version=version, state='review-required')

    def test_identity_is_immutable_and_registration_is_idempotent(self):
        row = self.ledger.register('stablyai/orca', '42', 'v1.4.266', 'a' * 40)
        self.assertEqual(row['version'], 0)
        for release, tag, commit in [('42', 'v1.4.266', 'b' * 40), ('42', 'v1.4.267', 'a' * 40), ('43', 'v1.4.266', 'a' * 40)]:
            with self.assertRaisesRegex(LedgerError, 'identity changed'):
                self.ledger.register('stablyai/orca', release, tag, commit)

    def test_restart_recovers_intent_and_macos_reuses_run(self):
        credentials = self.claim()
        self.transition(credentials, 'preparing')
        self.transition(credentials, 'review-required', integration_commit='c' * 40, fork_tag='v1.4.266-hub.3', intent_id='push-1', intent_kind='tag-push')
        self.ledger.close()
        self.ledger = Ledger(self.path, lambda: self.now)
        self.assertEqual(self.ledger.get('stablyai/orca', '42')['intent_id'], 'push-1')
        self.now = 1301
        credentials = self.claim('recovered')
        self.transition(credentials, 'tagged', resolve_intent='push-1')
        self.transition(credentials, 'building', run_id='44763205045', attempt=1)
        self.transition(credentials, 'linux-published')
        self.transition(credentials, 'macos-pending', intent_id='macos-2', intent_kind='macos-retry')
        with self.assertRaisesRegex(LedgerError, 'cannot be replaced'):
            self.transition(credentials, 'macos-pending', run_id='different-run')
        with self.assertRaisesRegex(LedgerError, 'cannot be replaced'):
            self.transition(credentials, 'macos-pending', fork_tag='v1.4.266-hub.4')
        self.transition(credentials, 'macos-pending', attempt=2, resolve_intent='macos-2')
        result = self.transition(credentials, 'complete')
        self.assertEqual((result['run_id'], result['attempt'], result['linux_published']), ('44763205045', 2, 1))

    def test_pending_intent_and_failed_resume_survive_release(self):
        credentials = self.claim()
        self.transition(credentials, 'preparing', intent_id='review-1', intent_kind='tag-push')
        with self.assertRaisesRegex(LedgerError, 'unresolved intent'):
            self.transition(credentials, 'preparing', intent_id='other', intent_kind='tag-push')
        self.transition(credentials, 'failed')
        self.ledger.lease_action(**credentials)
        credentials = self.claim('replacement')
        self.assertEqual(credentials['fence'], 2)
        self.assertEqual(self.ledger.get('stablyai/orca', '42')['intent_id'], 'review-1')
        with self.assertRaisesRegex(LedgerError, 'intent ID mismatch'):
            self.transition(credentials, 'preparing', resolve_intent='wrong')
        self.transition(credentials, 'preparing', resolve_intent='review-1')

    def test_invalid_transition_rolls_back_identity_fields(self):
        credentials = self.claim()
        with self.assertRaisesRegex(LedgerError, 'invalid state'):
            self.transition(credentials, 'building', run_id='1')
        self.assertIsNone(self.ledger.get('stablyai/orca', '42')['run_id'])

    def failed_build(self, credentials):
        self.transition(credentials, 'preparing', integration_commit='c' * 40, fork_tag='v1.4.266-hub.1')
        self.transition(credentials, 'review-required')
        self.transition(credentials, 'tagged')
        self.transition(credentials, 'building', run_id='run-1', attempt=1)
        return self.transition(credentials, 'failed')

    def corrected_candidate(self, credentials, **overrides):
        options = {'version': self.ledger.get('stablyai/orca', '42')['version'],
                   'integration_commit': 'd' * 40, 'fork_tag': 'v1.4.266-hub.2', 'reviewed': True}
        options.update(overrides)
        return self.ledger.candidate(**credentials, **options)

    def test_corrected_code_creates_candidate_without_rewriting_failed_history(self):
        credentials = self.claim()
        failed = self.failed_build(credentials)
        current = self.corrected_candidate(credentials)
        self.assertEqual((current['generation'], current['state'], current['run_id']), (2, 'preparing', None))
        self.transition(credentials, 'review-required')
        self.transition(credentials, 'tagged')
        with self.assertRaisesRegex(LedgerError, 'another candidate'):
            self.transition(credentials, 'building', run_id='run-1', attempt=1)
        self.transition(credentials, 'building', run_id='run-2', attempt=1)
        complete = self.transition(credentials, 'complete')
        history = self.ledger.history('stablyai/orca', '42')
        self.assertEqual(history[0], failed)
        self.assertEqual(history[1], complete)
        self.assertEqual([(row['generation'], row['fork_tag'], row['run_id'], row['state']) for row in history],
                         [(1, 'v1.4.266-hub.1', 'run-1', 'failed'), (2, 'v1.4.266-hub.2', 'run-2', 'complete')])
        self.assertEqual(complete['upstream_commit'], 'a' * 40)

    def test_capacity_failure_requires_same_candidate_run_and_tag(self):
        credentials = self.claim()
        self.failed_build(credentials)
        self.transition(credentials, 'building')
        self.transition(credentials, 'linux-published')
        self.transition(credentials, 'macos-pending')
        self.transition(credentials, 'failed')
        with self.assertRaisesRegex(LedgerError, 'same code commit'):
            self.corrected_candidate(credentials, integration_commit='c' * 40)
        self.transition(credentials, 'macos-pending', attempt=2)
        row = self.transition(credentials, 'complete')
        self.assertEqual((row['generation'], row['fork_tag'], row['run_id'], row['attempt']),
                         (1, 'v1.4.266-hub.1', 'run-1', 2))
        self.assertEqual(len(self.ledger.history('stablyai/orca', '42')), 1)

    def test_candidate_switch_requires_reconciled_intent_review_and_current_lease_cas(self):
        credentials = self.claim()
        self.failed_build(credentials)
        self.transition(credentials, 'failed', intent_id='unknown-effect', intent_kind='build-start')
        self.ledger.close()
        self.ledger = Ledger(self.path, lambda: self.now)
        with self.assertRaisesRegex(LedgerError, 'pending intent'):
            self.corrected_candidate(credentials)
        self.transition(credentials, 'failed', resolve_intent='unknown-effect')
        with self.assertRaisesRegex(LedgerError, 'reviewed code correction'):
            self.corrected_candidate(credentials, reviewed=False)
        with self.assertRaisesRegex(LedgerError, 'CAS'):
            self.corrected_candidate(credentials, version=0)
        old = credentials
        self.now = 1301
        credentials = self.claim('new-owner')
        with self.assertRaisesRegex(LedgerError, 'stale'):
            self.corrected_candidate(old)
        self.corrected_candidate(credentials)
        self.assertEqual(len(self.ledger.history('stablyai/orca', '42')), 2)

    def test_previously_used_candidate_code_or_tag_cannot_be_recycled(self):
        credentials = self.claim()
        self.failed_build(credentials)
        self.corrected_candidate(credentials)
        self.transition(credentials, 'failed')
        with self.assertRaisesRegex(LedgerError, 'already has a candidate'):
            self.corrected_candidate(credentials, integration_commit='c' * 40, fork_tag='v1.4.266-hub.3')
        with self.assertRaisesRegex(LedgerError, 'another candidate'):
            self.corrected_candidate(credentials, integration_commit='e' * 40, fork_tag='v1.4.266-hub.1')
        self.assertEqual(len(self.ledger.history('stablyai/orca', '42')), 2)

    def test_version_one_database_preserves_candidate_when_migrated(self):
        legacy_path = Path(self.temp.name) / 'legacy.sqlite'
        with sqlite3.connect(legacy_path) as db:
            db.executescript("""
                CREATE TABLE releases (
                  repo TEXT NOT NULL, release_id TEXT NOT NULL, tag TEXT NOT NULL,
                  upstream_commit TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered',
                  version INTEGER NOT NULL DEFAULT 0, integration_commit TEXT, fork_tag TEXT,
                  run_id TEXT, attempt INTEGER NOT NULL DEFAULT 0,
                  linux_published INTEGER NOT NULL DEFAULT 0, resume_state TEXT,
                  intent_id TEXT, intent_kind TEXT,
                  PRIMARY KEY(repo, release_id), UNIQUE(repo, tag)
                );
                PRAGMA user_version=1;
            """)
            db.execute("INSERT INTO releases(repo,release_id,tag,upstream_commit,state,integration_commit,fork_tag,run_id,attempt,resume_state) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       ('stablyai/orca', '42', 'v1.4.266', 'a' * 40, 'failed', 'c' * 40, 'v1.4.266-hub.1', 'run-1', 1, 'building'))
        migrated = Ledger(legacy_path)
        try:
            row = migrated.history('stablyai/orca', '42')[0]
            self.assertEqual((row['generation'], row['fork_tag'], row['run_id'], row['state']),
                             (1, 'v1.4.266-hub.1', 'run-1', 'failed'))
        finally:
            migrated.close()

    def test_database_in_checkout_is_rejected(self):
        root = Path(self.temp.name) / 'checkout'
        root.mkdir()
        (root / '.git').write_text('gitdir: elsewhere')
        with self.assertRaisesRegex(LedgerError, 'outside every Git checkout'):
            Ledger(root / 'state.sqlite')


if __name__ == '__main__':
    unittest.main()
