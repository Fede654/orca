#!/usr/bin/env python3
"""Promote the reviewed run's bytes; never build or replace release assets."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('staged_assets', HERE / 'staged-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
REPO = 'Fede654/orca'


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def api(path):
    return json.loads(command('gh', 'api', path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['commit', 'tag', 'run', 'db', 'release-id', 'owner', 'token', 'fence']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    ledger = ['python3', str(HERE / 'release-ledger.py'), '--db', args.db]
    identity = ['--repo', 'stablyai/orca', '--release-id', args.release_id]
    row = json.loads(command(*ledger, 'get', *identity))['result']['release']
    if (row['state'] != 'building' or row['integration_commit'] != args.commit
            or row['fork_tag'] != args.tag or row['run_id'] != args.run
            or row['intent_kind'] != 'release-promote' or not row['intent_id']):
        raise ValueError('ledger candidate/pending promotion mismatch')
    lease = ['--owner', args.owner, '--token', args.token, '--fence', args.fence]
    command(*ledger, 'renew', *identity, *lease, '--ttl', '300')
    repo = api('repos/' + REPO)
    if repo['id'] != 1432470272:
        raise ValueError('repository identity changed')
    run = api(f'repos/{REPO}/actions/runs/{args.run}')
    if (run['head_sha'] != args.commit or run['conclusion'] != 'success'
            or run['event'] != 'push' or run['workflow_id'] != 409894392
            or run['head_repository']['id'] != 1432470272
            or run['run_attempt'] != row['attempt']):
        raise ValueError('run is not the approved successful candidate/attempt')
    tag = api(f'repos/{REPO}/git/ref/tags/{args.tag}')['object']
    if tag['type'] == 'tag':
        tag = api(f'repos/{REPO}/git/tags/{tag["sha"]}')['object']
    if tag['type'] != 'commit' or tag['sha'] != args.commit:
        raise ValueError('immutable tag does not name candidate')
    with tempfile.TemporaryDirectory(prefix='orca-promote-') as temp:
        root = Path(temp)
        for platform in assets.ASSETS:
            command('gh', 'run', 'download', args.run, '--repo', REPO,
                    '--name', 'staged-' + platform, '--dir', str(root))
        expected = assets.verify(root, args.commit, args.tag, args.run)
        print(json.dumps(dict(repoId=repo['id'], commit=args.commit, tag=args.tag,
                              run=args.run, attempt=run['run_attempt'], assets=expected)))
        if not args.publish:
            return
        # Revalidate the lease immediately before the first external mutation.
        command(*ledger, 'renew', *identity, *lease, '--ttl', '300')
        releases = json.loads(command('gh', 'api', '--paginate', '--slurp',
                                     f'repos/{REPO}/releases?per_page=100'))
        matches = [r for page in releases for r in page if r['tag_name'] == args.tag]
        if len(matches) > 1:
            raise ValueError('ambiguous release')
        if not matches:
            command('gh', 'release', 'create', args.tag, '--repo', REPO, '--verify-tag',
                    '--draft', '--title', args.tag, '--notes',
                    f'Candidate {args.commit}; verified run https://github.com/{REPO}/actions/runs/{args.run}')
        release = api(f'repos/{REPO}/releases/tags/{args.tag}')
        names = {a['name'] for a in release['assets']}
        if names - expected.keys():
            raise ValueError('unexpected release assets; reconcile manually')
        missing = expected.keys() - names
        if missing and not release['draft']:
            raise ValueError('public release is incomplete; refusing mutation')
        if missing:
            command('gh', 'release', 'upload', args.tag, '--repo', REPO,
                    *[str(root / name) for name in sorted(missing)])
        remote = root / 'remote'
        command('gh', 'release', 'download', args.tag, '--repo', REPO, '--dir', str(remote))
        if any(not (remote / name).is_file() or assets.digest(remote / name).hex() != sha
               for name, sha in expected.items()):
            raise ValueError('remote asset integrity mismatch; retain pending intent')
        command(*ledger, 'renew', *identity, *lease, '--ttl', '300')
        if release['draft']:
            command('gh', 'release', 'edit', args.tag, '--repo', REPO, '--draft=false', '--latest')
        final = api(f'repos/{REPO}/releases/{release["id"]}')
        if final['draft'] or not final['published_at']:
            raise ValueError('publication not confirmed; retain pending intent')
        print(json.dumps(dict(releaseId=final['id'], url=final['html_url'], published=True,
                              intentId=row['intent_id'], assets=expected)))


if __name__ == '__main__':
    main()
