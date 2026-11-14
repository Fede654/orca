#!/usr/bin/env bash
# Sella la build del fork (tema fork/release-identity, src/shared/fork-build.ts): About muestra
# X.Y.Z-hub.N y el updater sigue las releases de este repo. Sin sello, como upstream.
# Uso (en CI, desde la raíz del repo): fork/stamp-fork-build.sh <vX.Y.Z-hub.N | X.Y.Z-hub.N | vacío>
# Exporta FORK_VERSION en $GITHUB_ENV si sella.
set -euo pipefail
stamp=src/shared/fork-build-stamp.ts
if [ ! -f "$stamp" ]; then echo "sin el tema fork/release-identity: build sin sello"; exit 0; fi
v="${1#v}"
if [ -z "$v" ]; then echo "sin versión de fork: build sin sello"; exit 0; fi
[[ "$v" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-hub\.[0-9]+$ ]] || { echo "versión de fork inválida: $v"; exit 1; }
base="$(node -p "require('./package.json').version")"
[ "${BASH_REMATCH[1]}" = "$base" ] || { echo "$v no es una build de $base (package.json)"; exit 1; }
[[ "$GITHUB_REPOSITORY" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || { echo "repo inválido: $GITHUB_REPOSITORY"; exit 1; }
printf '%s\n' \
  "// Sellado por hub-release.yml para $v ($GITHUB_SHA)." \
  "export const FORK_BUILD_STAMP: { version: string; repo: string } | null = {" \
  "  version: '$v'," \
  "  repo: '$GITHUB_REPOSITORY'" \
  "}" > "$stamp"
cat "$stamp"
echo "FORK_VERSION=$v" >> "$GITHUB_ENV"
