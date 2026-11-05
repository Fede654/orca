#!/usr/bin/env bash
# fork/actions-guard.sh: deja activo en el fork solo hub-release.yml (FORK.md §7).
#   fork/actions-guard.sh              aplica la política de actions y desactiva por la API
#                                      todo workflow registrado que no sea hub-release.yml
#   fork/actions-guard.sh --check      solo informa; exit 1 si algo está fuera de lugar
#   fork/actions-guard.sh --sync-main  sincroniza main del fork con upstream con Actions
#                                      apagado (si no, el push a main dispara los de upstream)
#                                      y después aplica el guard
# Correrlo al habilitar Actions y después de cada push de integración. main se sincroniza
# solo con --sync-main.
set -o errexit -o nounset -o pipefail

REPO_SLUG="${FORK_REPO:-Fede654/orca}"
KEEP=".github/workflows/hub-release.yml"
API="repos/$REPO_SLUG/actions/permissions"
# hub-release.yml y sus acciones compuestas usan acciones de GitHub (actions/*) y pnpm/setup.
PATTERNS=('pnpm/setup@*')
MODE="${1:-}"
case "$MODE" in ""|--check|--sync-main) ;; *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;; esac

command -v gh >/dev/null || { echo "actions-guard: hace falta gh" >&2; exit 1; }

apply_policy() {
  gh api -X PUT "$API" -F enabled=true -f allowed_actions=selected >/dev/null
  local args=() p
  for p in "${PATTERNS[@]}"; do args+=(-f "patterns_allowed[]=$p"); done
  gh api -X PUT "$API/selected-actions" -F github_owned_allowed=true -F verified_allowed=false "${args[@]}" >/dev/null
}

check_policy() {
  local want got
  want="true selected true false $(printf '%s,' "${PATTERNS[@]}")"
  got="$(gh api "$API" --jq '"\(.enabled) \(.allowed_actions)"') $(gh api "$API/selected-actions" --jq '"\(.github_owned_allowed) \(.verified_allowed) \(.patterns_allowed | sort | join(","))"'),"
  echo "política de actions: $got"
  [ "$got" = "$want" ]
}

if [ "$MODE" = "--sync-main" ]; then
  gh api -X PUT "$API" -F enabled=false >/dev/null
  trap 'apply_policy; echo "Actions reactivado"' EXIT
  echo "Actions apagado; sincronizando main de $REPO_SLUG con upstream…"
  gh repo sync "$REPO_SLUG" --branch main
fi

[ "$MODE" = "--check" ] || apply_policy

rows="$(gh api --paginate "repos/$REPO_SLUG/actions/workflows?per_page=100" \
  --jq '.workflows[] | [.id, .state, .path] | @tsv')"
total=0 active=0 disabled_now=0
while IFS=$'\t' read -r id state path; do
  [ -n "${id:-}" ] || continue
  total=$((total+1))
  [ "$path" = "$KEEP" ] && continue
  [ "$state" = "active" ] || continue
  active=$((active+1))
  if [ "$MODE" = "--check" ]; then
    echo "  activo: $path"
  else
    gh api -X PUT "repos/$REPO_SLUG/actions/workflows/$id/disable" >/dev/null
    disabled_now=$((disabled_now+1))
  fi
done <<<"$rows"

if [ "$MODE" = "--check" ]; then
  echo "workflows registrados: $total; de upstream activos: $active"
  check_policy && [ "$active" -eq 0 ]
else
  echo "workflows registrados: $total; desactivados ahora: $disabled_now (solo queda activo $KEEP)"
fi
