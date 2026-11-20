#!/usr/bin/env python3
"""Durable release coordination. This program never performs release side effects."""
import argparse
import json
from pathlib import Path
import sqlite3
import time
import uuid

STATES = {
    'discovered': {'preparing', 'failed'},
    'preparing': {'review-required', 'failed'},
    'review-required': {'tagged', 'failed'},
    'tagged': {'building', 'failed'},
    'building': {'linux-published', 'complete', 'failed'},
    'linux-published': {'macos-pending', 'complete', 'failed'},
    'macos-pending': {'complete', 'failed'},
    'complete': set(),
    'failed': set(),
}


class LedgerError(Exception):
    pass


class Ledger:
    def __init__(self, path, clock=time.time):
        self.clock = clock
        path = Path(path).expanduser().resolve()
        if any((parent / '.git').exists() for parent in path.parents):
            raise LedgerError('database must be outside every Git checkout')
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, timeout=15, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        if self.db.execute('PRAGMA user_version').fetchone()[0] not in (0, 1, 2):
            self.db.close()
            raise LedgerError('unsupported ledger schema version')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS releases (
              repo TEXT NOT NULL, release_id TEXT NOT NULL, tag TEXT NOT NULL,
              upstream_commit TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered',
              version INTEGER NOT NULL DEFAULT 0, integration_commit TEXT, fork_tag TEXT,
              run_id TEXT, attempt INTEGER NOT NULL DEFAULT 0,
              linux_published INTEGER NOT NULL DEFAULT 0, resume_state TEXT,
              intent_id TEXT, intent_kind TEXT,
              PRIMARY KEY(repo, release_id), UNIQUE(repo, tag)
            );
            CREATE TABLE IF NOT EXISTS leases (
              repo TEXT PRIMARY KEY, release_id TEXT, owner TEXT, token TEXT,
              fence INTEGER NOT NULL DEFAULT 0, expires REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS candidate_history (
              repo TEXT NOT NULL, release_id TEXT NOT NULL, generation INTEGER NOT NULL,
              integration_commit TEXT, fork_tag TEXT, run_id TEXT, snapshot TEXT NOT NULL,
              PRIMARY KEY(repo,release_id,generation), UNIQUE(repo,fork_tag), UNIQUE(repo,run_id)
            );
        ''')

        def migrate():
            columns = {row['name'] for row in self.db.execute('PRAGMA table_info(releases)')}
            if 'generation' not in columns:
                self.db.execute('ALTER TABLE releases ADD COLUMN generation INTEGER NOT NULL DEFAULT 1')
            self.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS release_candidate_tag ON releases(repo,fork_tag) WHERE fork_tag IS NOT NULL')
            self.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS release_candidate_run ON releases(repo,run_id) WHERE run_id IS NOT NULL')
            self.db.execute('PRAGMA user_version=2')
        self.transaction(migrate)

    def close(self):
        self.db.close()

    def transaction(self, operation):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            result = operation()
            self.db.execute('COMMIT')
            return result
        except Exception:
            self.db.execute('ROLLBACK')
            raise

    def get(self, repo, release_id):
        row = self.db.execute('SELECT * FROM releases WHERE repo=? AND release_id=?', (repo, release_id)).fetchone()
        if row is None:
            raise LedgerError('release not registered')
        return dict(row)

    def register(self, repo, release_id, tag, commit):
        if not all(isinstance(value, str) and value.strip() for value in (repo, release_id, tag, commit)):
            raise LedgerError('identity fields must be nonempty')
        def operation():
            row = self.db.execute('SELECT * FROM releases WHERE repo=? AND (release_id=? OR tag=?)', (repo, release_id, tag)).fetchone()
            if row:
                if (row['release_id'], row['tag'], row['upstream_commit']) != (release_id, tag, commit):
                    raise LedgerError('immutable upstream identity changed')
                return dict(row)
            self.db.execute('INSERT INTO releases(repo,release_id,tag,upstream_commit) VALUES(?,?,?,?)', (repo, release_id, tag, commit))
            return self.get(repo, release_id)
        return self.transaction(operation)

    def claim(self, repo, release_id, owner, ttl):
        if not owner.strip() or not 0 < ttl <= 3600:
            raise LedgerError('owner required and lease TTL must be in (0,3600] seconds')
        def operation():
            row = self.get(repo, release_id)
            if row['state'] == 'complete':
                raise LedgerError('release already complete')
            lease = self.db.execute('SELECT * FROM leases WHERE repo=?', (repo,)).fetchone()
            now = self.clock()
            if lease and lease['owner'] is not None and lease['expires'] > now:
                raise LedgerError('repository already claimed (even by the same owner)')
            fence = lease['fence'] + 1 if lease else 1
            token = str(uuid.uuid4())
            self.db.execute('INSERT INTO leases(repo,release_id,owner,token,fence,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(repo) DO UPDATE SET release_id=excluded.release_id,owner=excluded.owner,token=excluded.token,fence=excluded.fence,expires=excluded.expires', (repo, release_id, owner, token, fence, now + ttl))
            self.db.execute('UPDATE releases SET version=version+1 WHERE repo=? AND release_id=?', (repo, release_id))
            return {'release': self.get(repo, release_id), 'lease': dict(self.db.execute('SELECT * FROM leases WHERE repo=?', (repo,)).fetchone())}
        return self.transaction(operation)

    def authorize(self, repo, release_id, owner, token, fence):
        lease = self.db.execute('SELECT * FROM leases WHERE repo=?', (repo,)).fetchone()
        if not lease or (lease['release_id'], lease['owner'], lease['token'], lease['fence']) != (release_id, owner, token, fence) or lease['expires'] <= self.clock():
            raise LedgerError('lease expired or owner/token/fence is stale')

    def transition(self, repo, release_id, owner, token, fence, version, state, **changes):
        def operation():
            self.authorize(repo, release_id, owner, token, fence)
            row = self.get(repo, release_id)
            if row['version'] != version:
                raise LedgerError('CAS version mismatch')
            if row['state'] == 'complete':
                raise LedgerError('completed release is terminal')
            allowed = STATES[row['state']] if row['state'] != 'failed' else {row['resume_state']}
            if state not in STATES or (state != row['state'] and state not in allowed):
                raise LedgerError('invalid state transition')
            for field in ('integration_commit', 'fork_tag', 'run_id'):
                value = changes.get(field)
                if value is not None:
                    if not value.strip() or (row[field] is not None and row[field] != value):
                        raise LedgerError(field + ' cannot be replaced')
                    if field in ('fork_tag', 'run_id'):
                        self.ensure_unused(repo, field, value, release_id)
                    row[field] = value
            attempt = changes.get('attempt')
            if attempt is not None:
                if attempt < row['attempt'] or attempt < 1:
                    raise LedgerError('attempt cannot decrease or be zero')
                row['attempt'] = attempt
            if state in {'tagged', 'building', 'linux-published', 'macos-pending', 'complete'} and not (row['integration_commit'] and row['fork_tag']):
                raise LedgerError('integration commit and fork tag required')
            if state in {'building', 'linux-published', 'macos-pending', 'complete'} and not (row['run_id'] and row['attempt'] > 0):
                raise LedgerError('run ID and attempt required')
            if state in {'linux-published', 'macos-pending', 'complete'}:
                row['linux_published'] = 1
            if row['linux_published'] and state in {'preparing', 'review-required', 'tagged', 'building'}:
                raise LedgerError('Linux already published; reuse existing run for macOS')
            intent_id, intent_kind = changes.get('intent_id'), changes.get('intent_kind')
            resolved = changes.get('resolve_intent')
            if resolved is not None:
                if resolved != row['intent_id']:
                    raise LedgerError('pending intent ID mismatch')
                row['intent_id'] = row['intent_kind'] = None
            if intent_id is not None or intent_kind is not None:
                if not intent_id or intent_kind not in {'tag-push', 'build-start', 'macos-retry'} or row['intent_id'] is not None:
                    raise LedgerError('invalid intent or unresolved intent already exists')
                row['intent_id'], row['intent_kind'] = intent_id, intent_kind
            if state == 'complete' and row['intent_id'] is not None:
                raise LedgerError('reconcile pending intent before completion')
            if state == 'failed' and row['state'] != 'failed':
                row['resume_state'] = row['state']
            columns = ('integration_commit', 'fork_tag', 'run_id', 'attempt', 'linux_published', 'resume_state', 'intent_id', 'intent_kind')
            self.db.execute('UPDATE releases SET state=?,version=version+1,' + ','.join(name + '=?' for name in columns) + ' WHERE repo=? AND release_id=? AND version=?', (state, *(row[name] for name in columns), repo, release_id, version))
            return self.get(repo, release_id)
        return self.transaction(operation)

    def history(self, repo, release_id):
        return self.transaction(lambda: [json.loads(row['snapshot']) for row in self.db.execute(
            'SELECT snapshot FROM candidate_history WHERE repo=? AND release_id=? ORDER BY generation',
            (repo, release_id))] + [self.get(repo, release_id)])

    def ensure_unused(self, repo, field, value, release_id):
        archived = self.db.execute('SELECT 1 FROM candidate_history WHERE repo=? AND ' + field + '=?', (repo, value)).fetchone()
        active = self.db.execute('SELECT 1 FROM releases WHERE repo=? AND ' + field + '=? AND release_id<>?', (repo, value, release_id)).fetchone()
        if archived or active:
            raise LedgerError(field + ' already belongs to another candidate')

    def candidate(self, repo, release_id, owner, token, fence, version, integration_commit, fork_tag, reviewed):
        def operation():
            self.authorize(repo, release_id, owner, token, fence)
            row = self.get(repo, release_id)
            if row['version'] != version:
                raise LedgerError('CAS version mismatch')
            if row['intent_id'] is not None:
                raise LedgerError('reconcile pending intent before changing candidate')
            if not reviewed or row['state'] != 'failed' or not row['integration_commit'] or not row['fork_tag']:
                raise LedgerError('new candidate requires reviewed code correction to a failed candidate')
            if not integration_commit.strip() or integration_commit == row['integration_commit']:
                raise LedgerError('same code commit must reuse the existing candidate and run')
            prior = self.db.execute('SELECT 1 FROM candidate_history WHERE repo=? AND release_id=? AND integration_commit=?', (repo, release_id, integration_commit)).fetchone()
            if prior:
                raise LedgerError('code commit already has a candidate')
            if not fork_tag.strip() or fork_tag == row['fork_tag']:
                raise LedgerError('new candidate requires an unused fork tag')
            self.ensure_unused(repo, 'fork_tag', fork_tag, release_id)
            self.db.execute('INSERT INTO candidate_history(repo,release_id,generation,integration_commit,fork_tag,run_id,snapshot) VALUES(?,?,?,?,?,?,?)',
                (repo, release_id, row['generation'], row['integration_commit'], row['fork_tag'], row['run_id'], json.dumps(row, sort_keys=True)))
            self.db.execute("UPDATE releases SET generation=generation+1,version=version+1,state='preparing',integration_commit=?,fork_tag=?,run_id=NULL,attempt=0,linux_published=0,resume_state=NULL WHERE repo=? AND release_id=? AND version=?",
                (integration_commit, fork_tag, repo, release_id, version))
            return self.get(repo, release_id)
        return self.transaction(operation)

    def lease_action(self, repo, release_id, owner, token, fence, ttl=None):
        def operation():
            self.authorize(repo, release_id, owner, token, fence)
            if ttl is None:
                self.db.execute('UPDATE leases SET owner=NULL,token=NULL,expires=0 WHERE repo=?', (repo,))
            else:
                if not 0 < ttl <= 3600:
                    raise LedgerError('lease TTL must be in (0,3600] seconds')
                self.db.execute('UPDATE leases SET expires=? WHERE repo=?', (self.clock() + ttl, repo))
            return dict(self.db.execute('SELECT * FROM leases WHERE repo=?', (repo,)).fetchone())
        return self.transaction(operation)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, help='SQLite path outside any checkout; local filesystem only')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    for command in ('register', 'get', 'history', 'claim', 'transition', 'candidate', 'renew', 'release'):
        sub = commands.add_parser(command)
        sub.add_argument('--repo', required=True)
        sub.add_argument('--release-id', required=True)
        if command == 'register':
            sub.add_argument('--tag', required=True)
            sub.add_argument('--commit', required=True)
        if command in ('claim', 'transition', 'candidate', 'renew', 'release'):
            sub.add_argument('--owner', required=True)
        if command in ('claim', 'renew'):
            sub.add_argument('--ttl', type=float, default=300)
        if command in ('transition', 'candidate', 'renew', 'release'):
            sub.add_argument('--token', required=True)
            sub.add_argument('--fence', type=int, required=True)
        if command == 'candidate':
            sub.add_argument('--version', type=int, required=True)
            sub.add_argument('--integration-commit', required=True)
            sub.add_argument('--fork-tag', required=True)
            sub.add_argument('--reviewed', action='store_true', required=True)
        if command == 'transition':
            sub.add_argument('--version', type=int, required=True)
            sub.add_argument('--state', required=True, choices=STATES)
            for field in ('integration-commit', 'fork-tag', 'run-id', 'intent-id', 'intent-kind', 'resolve-intent'):
                sub.add_argument('--' + field)
            sub.add_argument('--attempt', type=int)
    args = vars(parser.parse_args())
    ledger = None
    try:
        ledger = Ledger(args.pop('db'))
        command = args.pop('command')
        if command == 'list':
            result = [dict(row) for row in ledger.db.execute('SELECT * FROM releases ORDER BY repo,release_id')]
        elif command == 'get':
            result = {'release': ledger.get(**args), 'lease': None}
            lease = ledger.db.execute('SELECT * FROM leases WHERE repo=?', (args['repo'],)).fetchone()
            if lease:
                result['lease'] = dict(lease)
        elif command in ('renew', 'release'):
            result = ledger.lease_action(**args)
        else:
            result = getattr(ledger, command)(**args)
        print(json.dumps({'ok': True, 'result': result}, sort_keys=True))
    except (LedgerError, sqlite3.Error, OSError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        raise SystemExit(1)
    finally:
        if ledger:
            ledger.close()


if __name__ == '__main__':
    main()
