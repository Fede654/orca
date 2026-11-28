#!/usr/bin/env python3
"""Bind smoke-checked release assets to one candidate and workflow run."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

ASSETS = {'linux': ['orca-linux.AppImage', 'latest-linux.yml'],
          'macos': ['orca-macos-arm64.dmg']}


def digest(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.digest()


def receipt(root, platform, commit, tag, run, attempt):
    files = {}
    for name in ASSETS[platform]:
        path = root / name
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError('missing or empty asset: ' + name)
        files[name] = {'size': path.stat().st_size, 'sha256': digest(path).hex()}
    return dict(platform=platform, commit=commit, tag=tag, run=str(run),
                attempt=int(attempt), repoId=1432470272, smoke=True, files=files)


def verify(root, commit, tag, run):
    for platform in ASSETS:
        saved = json.loads((root / (platform + '.json')).read_text())
        actual = receipt(root, platform, commit, tag, run, saved['attempt'])
        if saved != actual or saved['attempt'] < 1:
            raise ValueError('candidate/run/integrity mismatch: ' + platform)
    text = (root / 'latest-linux.yml').read_text()
    sha = base64.b64encode(digest(root / 'orca-linux.AppImage', 'sha512')).decode()
    if (re.findall(r'^version: (.+)$', text, re.M) != [tag.removeprefix('v')]
            or re.findall(r'^path: (.+)$', text, re.M) != ['orca-linux.AppImage']
            or re.findall(r'^\s*- url: (.+)$', text, re.M) != ['orca-linux.AppImage']
            or set(re.findall(r'^\s*sha512: (.+)$', text, re.M)) != {sha}):
        raise ValueError('manifest does not describe the staged AppImage')
    return {name: digest(root / name).hex() for names in ASSETS.values() for name in names}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'verify'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--platform', choices=ASSETS)
    parser.add_argument('--attempt', type=int)
    args = parser.parse_args()
    if args.action == 'record':
        data = receipt(args.root, args.platform, args.commit, args.tag, args.run, args.attempt)
        (args.root / (args.platform + '.json')).write_text(json.dumps(data, indent=2) + '\n')
    else:
        print(json.dumps(verify(args.root, args.commit, args.tag, args.run)))


if __name__ == '__main__':
    main()
