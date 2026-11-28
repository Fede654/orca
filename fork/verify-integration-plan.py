#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description='Validate reviewed fork references and retained file contents')
parser.add_argument('phase', choices=['refs', 'tree', 'pin'])
parser.add_argument('--root', required=True)
parser.add_argument('--plan', required=True)
parser.add_argument('--base', required=True)
parser.add_argument('--series', required=True)
parser.add_argument('--ref')
parser.add_argument('--revision', default='HEAD')
parser.add_argument('--remote', default='pr-fede654-orca')
args = parser.parse_args()
plan = json.loads(Path(args.plan).read_text())

def git(*command):
    return subprocess.check_output(['git', '-C', args.root, *command])

def fail(message):
    raise SystemExit('integration plan: ' + message)

if args.base != plan['base']:
    fail(f"base {args.base} has no reviewed plan (expected {plan['base']}); port every topic and review retained files first")
if git('rev-parse', args.base + '^{commit}').decode().strip() != plan['baseCommit']:
    fail('base tag moved')
if plan.get('schemaVersion') != 1:
    fail('unsupported plan schema')
series_bytes = Path(args.series).read_bytes()
if hashlib.sha256(series_bytes).hexdigest() != plan.get('seriesSha256'):
    fail('series bytes differ from reviewed plan')
selected = []
for line in series_bytes.decode().splitlines():
    if not line or line.startswith('#'):
        continue
    fields = line.split('\t')
    if len(fields) != 4 or fields[0] != 'topic':
        fail('unsupported series entry (only reviewed topic entries are supported)')
    selected.append(fields[1])
if selected != [topic['selector'] for topic in plan['topics']]:
    fail('series differs from reviewed topic list')
for topic in plan['topics']:
    if set(topic['selector'].split('@')) != set(topic['refs']):
        fail('topic pins do not match selector')
if args.phase == 'pin':
    pins = [topic['refs'][args.ref] for topic in plan['topics'] if args.ref in topic['refs']]
    if len(set(pins)) != 1:
        fail('reference has no unambiguous reviewed pin')
    commit = pins[0]
    if git('rev-parse', commit + '^{commit}').decode().strip() != commit:
        fail('pin is not a commit')
    print(commit)
    raise SystemExit(0)
if args.phase == 'refs':
    names = [ref for topic in plan['topics'] for ref in topic['selector'].split('@')]
    remote = dict(line.split('\t')[::-1] for line in git('ls-remote', args.remote, *['refs/heads/' + name for name in names]).decode().splitlines())
    for topic in plan['topics']:
        for name, expected in topic['refs'].items():
            if remote.get('refs/heads/' + name) != expected:
                fail(f'remote {name} missing or changed; review and refresh plan')
            local = subprocess.run(['git', '-C', args.root, 'rev-parse', '--verify', 'refs/heads/' + name], capture_output=True, text=True)
            if local.returncode == 0 and local.stdout.strip() != expected:
                fail(f'local {name} shadows reviewed remote; do not integrate it')
else:
    for name, expected in plan['retainedFiles'].items():
        result = subprocess.run(['git', '-C', args.root, 'show', args.revision + ':' + name], capture_output=True)
        if result.returncode or hashlib.sha256(result.stdout).hexdigest() != expected:
            fail(f'retained adjustment changed or missing: {name}; review its new content explicitly')
print('integration plan: ' + args.phase + ' verified')
