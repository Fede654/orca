#!/usr/bin/env python3
"""Promote the reviewed run's bytes; never build or replace release assets."""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('staged_assets', HERE / 'staged-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
REPO = 'Fede654/orca'


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def api(path):
    return json.loads(command('gh', 'api', path))


def pages(path):
    return json.loads(command('gh', 'api', '--paginate', '--slurp', path))


def download_staging(root, args, run):
    listed = [artifact for page in pages(f'repos/{REPO}/actions/runs/{args.run}/artifacts?per_page=100')
              for artifact in page['artifacts']]
    evidence = {}
    for platform in assets.ASSETS:
        matches = [a for a in listed if a['name'] == 'staged-' + platform]
        if len(matches) != 1:
            raise ValueError('missing or ambiguous platform artifact: ' + platform)
        artifact = matches[0]
        source = artifact['workflow_run']
        if (artifact['expired'] or str(source['id']) != args.run
                or source['head_sha'] != args.commit or source['repository_id'] != 1432470272):
            raise ValueError('artifact candidate identity mismatch')
        archive = subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/artifacts/{artifact["id"]}/zip'])
        if artifact['digest'] != 'sha256:' + hashlib.sha256(archive).hexdigest():
            raise ValueError('artifact archive integrity mismatch')
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            allowed = {*assets.ASSETS[platform], platform + '.json'}
            # Receipts and binaries must come from their own platform's archive.
            for member in zipped.infolist():
                if member.filename in allowed:
                    (root / member.filename).write_bytes(zipped.read(member))
            if not all((root / name).is_file() for name in allowed):
                raise ValueError('platform archive is incomplete: ' + platform)
        saved = json.loads((root / (platform + '.json')).read_text())
        attempt = saved['attempt']
        if not 1 <= attempt <= run['run_attempt']:
            raise ValueError('artifact receipt attempt is not approved')
        jobs = [job for page in pages(f'repos/{REPO}/actions/runs/{args.run}/attempts/{attempt}/jobs?per_page=100')
                for job in page['jobs']]
        job_name = 'appimage' if platform == 'linux' else 'macos'
        matches = [job for job in jobs if job['name'] == job_name]
        if len(matches) != 1:
            raise ValueError('missing or ambiguous platform job: ' + job_name)
        job = matches[0]
        smoke = [step for step in job['steps'] if step['name'] == 'Smoke check']
        if (job['status'] != 'completed' or job['conclusion'] != 'success'
                or str(job['run_id']) != args.run or job['run_attempt'] != attempt
                or job['head_sha'] != args.commit or len(smoke) != 1
                or smoke[0]['status'] != 'completed' or smoke[0]['conclusion'] != 'success'):
            raise ValueError('platform job/smoke is not successful: ' + job_name)
        evidence[platform] = dict(artifactId=artifact['id'], digest=artifact['digest'],
                                  attempt=attempt, jobId=job['id'])
    return evidence


def save_evidence(path, data):
    if path.exists() and json.loads(path.read_text()) != data:
        raise ValueError('promotion evidence changed; reconcile before proceeding')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, sort_keys=True, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['commit', 'tag', 'run', 'db', 'release-id', 'owner', 'token', 'fence']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--evidence', type=Path, required=True)
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
    if (run['head_sha'] != args.commit or run['status'] != 'completed' or run['conclusion'] != 'success'
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
        platforms = download_staging(root, args, run)
        expected = assets.verify(root, args.commit, args.tag, args.run)
        evidence = dict(repoId=repo['id'], commit=args.commit, tag=args.tag,
                        run=args.run, attempt=run['run_attempt'], platforms=platforms, assets=expected)
        save_evidence(args.evidence, evidence)
        print(json.dumps(evidence))
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
            releases = pages(f'repos/{REPO}/releases?per_page=100')
            matches = [r for page in releases for r in page if r['tag_name'] == args.tag]
        if len(matches) != 1:
            raise ValueError('release creation not reconciled; retain pending intent')
        release = api(f'repos/{REPO}/releases/{matches[0]["id"]}')
        if release['tag_name'] != args.tag:
            raise ValueError('release ID no longer names the approved tag')
        save_evidence(args.evidence.with_suffix('.release.json'),
                      dict(repoId=repo['id'], tag=args.tag, commit=args.commit, releaseId=release['id']))
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
        if final['draft'] or not final['published_at'] or final['tag_name'] != args.tag:
            raise ValueError('publication not confirmed; retain pending intent')
        print(json.dumps(dict(releaseId=final['id'], url=final['html_url'], published=True,
                              intentId=row['intent_id'], assets=expected)))


if __name__ == '__main__':
    main()
