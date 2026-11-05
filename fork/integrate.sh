#!/usr/bin/env bash
# fork/integrate.sh: arma feat/integration = <tag de upstream> + fork/series (FORK.md §6).
#
#   fork/integrate.sh <vX.Y.Z> [--push]   integra sobre el tag y crea vX.Y.Z-hub.N
#   fork/integrate.sh <vX.Y.Z> --dry-run  integra sobre el tag y descarta el resultado
#   fork/integrate.sh --canary            prueba la serie contra upstream main, no deja nada
#   fork/integrate.sh --publish <vX.Y.Z-hub.N>  publica una integración ya armada (sin rearmar)
#
# Solo cherry-picks: no compila ni corre suites. Variables:
#   FORK_UPSTREAM_REMOTE (origin)  remoto de stablyai/orca
#   FORK_REMOTE (pr-fede654-orca)  remoto de Fede654/orca
#   FORK_REPO (Fede654/orca)       el fork en GitHub (rama por defecto, Actions)
#   FORK_WORKTREE (<repo>/../_worktrees/orca-integration)
#   FORK_SERIES (fork/series de este checkout)
set -o errexit -o nounset -o pipefail

UPSTREAM="${FORK_UPSTREAM_REMOTE:-origin}"
FORK="${FORK_REMOTE:-pr-fede654-orca}"
FORK_SLUG="${FORK_REPO:-Fede654/orca}"
DEST_BRANCH="feat/integration"
KEEP_WORKFLOW=".github/workflows/hub-release.yml"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIES="${FORK_SERIES:-$HERE/series}"
REPO="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)"
REPO="${REPO%/.git}"
WT="${FORK_WORKTREE:-$(dirname "$REPO")/_worktrees/orca-integration}"

die()  { printf 'integrate: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
g()    { git -C "$REPO" "$@"; }
w()    { git -C "$WT" "$@"; }

usage() { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

BASE="" PUSH=0 CANARY=0 DRY=0 PUBLISH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1 ;;
    --publish) PUBLISH="${2:-}"; [ $# -ge 2 ] && shift ;;
    --canary) CANARY=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage 0 ;;
    v[0-9]*) BASE="$1" ;;
    *) usage 1 ;;
  esac
  shift
done
# Publica: ramas de la serie que tengamos locales, la rama destino, rama por defecto, tag y
# guard. El tag tiene que apuntar a feat/integration: se publica lo que se revisó.
publish() {
  local tag="$1" kind ref _up _note b branches=()
  command -v gh >/dev/null || die "hace falta gh"
  g rev-parse -q --verify "refs/tags/$tag" >/dev/null || die "no existe el tag local $tag"
  [ "$(g rev-parse "$tag^{commit}")" = "$(g rev-parse "$DEST_BRANCH")" ] \
    || die "$tag no apunta a $DEST_BRANCH: reintegrá o revisá antes de publicar"
  ! g ls-remote --exit-code --tags "$FORK" "refs/tags/$tag" >/dev/null 2>&1 \
    || die "$tag ya está en el fork: los tags hub son inmutables"
  while IFS=$'\t' read -r kind ref _up _note || [ -n "${kind:-}" ]; do
    local cand=()
    case "${kind:-}" in
      topic) cand=("${ref%%@*}"); [[ "$ref" == *@* ]] && cand+=("${ref#*@}") ;;
      backport) [[ "$ref" == *@* ]] && cand=("${ref#*@}") ;;
    esac
    for b in "${cand[@]}"; do g rev-parse -q --verify "refs/heads/$b" >/dev/null && branches+=("$b"); done
  done < "$SERIES"
  # Las ramas de tema se rebasan: force-with-lease contra lo que vimos del fork. El valor
  # esperado va explícito: el remoto del fork no tiene refspec de fetch para estas ramas y
  # sin él git rechaza el lease ("stale info"). Si nunca la vimos, se trae ahora su punta.
  local lease=() refs=() expect
  for b in "${branches[@]}" "$DEST_BRANCH"; do
    g rev-parse -q --verify "refs/remotes/$FORK/$b" >/dev/null \
      || g fetch -q "$FORK" "+refs/heads/$b:refs/remotes/$FORK/$b" 2>/dev/null || true
    expect="$(g rev-parse -q --verify "refs/remotes/$FORK/$b" || true)"
    lease+=("--force-with-lease=refs/heads/$b:$expect")
    refs+=("refs/heads/$b:refs/heads/$b")
  done
  g push "${lease[@]}" "$FORK" "${refs[@]}"
  for b in "${branches[@]}" "$DEST_BRANCH"; do g update-ref "refs/remotes/$FORK/$b" "refs/heads/$b"; done
  # La rama destino es la por defecto del fork: workflow_dispatch, cache compartida con los
  # tags y sin eventos de upstream (FORK.md §7). La rama tiene que existir antes del cambio.
  if [ "$(gh api "repos/$FORK_SLUG" --jq .default_branch)" != "$DEST_BRANCH" ]; then
    gh api -X PATCH "repos/$FORK_SLUG" -f default_branch="$DEST_BRANCH" >/dev/null
    info "rama por defecto de $FORK_SLUG: $DEST_BRANCH"
  fi
  g push "$FORK" "refs/tags/$tag"
  "$HERE/actions-guard.sh" || info "AVISO: actions-guard falló; revisá los workflows del fork"
  info "build: https://github.com/$FORK_SLUG/actions/workflows/hub-release.yml"
  info "cache para el próximo tag: gh workflow run hub-release.yml -R $FORK_SLUG --ref $DEST_BRANCH -f ref=$DEST_BRANCH"
}

if [ -n "$PUBLISH" ]; then
  [[ "$PUBLISH" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-hub\.[0-9]+$ ]] || usage 1
  [ -z "$BASE" ] && [ "$CANARY$DRY$PUSH" = 000 ] || die "--publish va solo"
  [ -r "$SERIES" ] || die "no encuentro la serie: $SERIES"
  publish "$PUBLISH"; exit 0
fi
[ "$CANARY" -eq 1 ] || [[ "$BASE" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage 1
[ "$CANARY" -eq 1 ] && [ "$PUSH" -eq 1 ] && die "--canary no pushea"
[ "$DRY" -eq 1 ] && [ "$PUSH" -eq 1 ] && die "--dry-run no pushea"
[ "$CANARY" -eq 1 ] && DRY=1
[ -r "$SERIES" ] || die "no encuentro la serie: $SERIES"
[ "$(g config --get rerere.enabled || true)" = "true" ] \
  || die "activá rerere en el repo: git -C $REPO config rerere.enabled true"
[ ! -e "$WT" ] || die "$WT ya existe (¿integración a medias?). Revisalo y borralo con: git -C $REPO worktree remove --force $WT"

info "== fetch"
g fetch -q "$UPSTREAM" main
[ -n "$BASE" ] && g fetch -q "$UPSTREAM" tag "$BASE"
UPMAIN="$UPSTREAM/main"
if [ "$CANARY" -eq 1 ]; then BASE_REV="$(g rev-parse "$UPMAIN")"; BASE_NAME="$UPMAIN"
else BASE_REV="$(g rev-parse "$BASE^{commit}")"; BASE_NAME="$BASE"; fi

# Rama local si existe; si no, la del fork. Se trae solo esa rama: el fork espeja las
# miles de ramas de upstream y un fetch completo sería enorme.
resolve_branch() {
  if g rev-parse -q --verify "refs/heads/$1" >/dev/null; then printf '%s' "$1"; return 0; fi
  g fetch -q "$FORK" "+refs/heads/$1:refs/remotes/$FORK/$1" 2>/dev/null || return 1
  printf '%s' "$FORK/$1"
}

g worktree add -q --detach "$WT" "$BASE_REV"
cleanup_dry() { [ "$DRY" -eq 1 ] && g worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup_dry EXIT
info "== base: $BASE_NAME ($(w log -1 --format='%h %s' HEAD))"

# Aplica un commit; si rerere resuelve todo, sigue. Si no, se detiene.
pick() {
  local sha="$1"
  if w cherry-pick -x "$sha" >/dev/null 2>&1; then return 0; fi
  if [ -z "$(w diff --name-only --diff-filter=U)" ] && ! w diff --quiet --cached 2>/dev/null; then
    info "    conflicto resuelto por rerere en $(w log -1 --format=%h "$sha" 2>/dev/null || echo "$sha")"
    GIT_EDITOR=true w cherry-pick --continue >/dev/null
    return 0
  fi
  if w diff --cached --quiet && [ -z "$(w diff --name-only --diff-filter=U)" ]; then
    info "    $(g log -1 --format='%h %s' "$sha"): vacío sobre esta base, se saltea"
    w cherry-pick --skip >/dev/null; return 0
  fi
  info ""
  info "CONFLICTO aplicando $(g log -1 --format='%h %s' "$sha"):"
  w diff --name-only --diff-filter=U | sed 's/^/    /'
  info "Resolvelo en $WT (git add + git cherry-pick --continue; rerere lo recuerda)."
  info "Si el problema es del tema y no de la base, arreglalo en su rama, borrá el worktree"
  info "(git -C $REPO worktree remove --force $WT) y volvé a integrar."
  trap - EXIT
  exit 2
}

ANNOTATION="base: $BASE_NAME $(g rev-parse --short "$BASE_REV")"$'\n'
WARN=""
info "== serie ($SERIES)"
while IFS=$'\t' read -r kind ref up _note || [ -n "${kind:-}" ]; do
  case "${kind:-}" in ""|\#*) continue ;; esac
  case "$kind" in
    backport)
      # <sha> o <sha>@<rama>: la rama tiene el backport adaptado a la base (FORK.md §5).
      sha="${ref%%@*}"; adapted=""
      [[ "$ref" == *@* ]] && adapted="${ref#*@}"
      g cat-file -e "$sha^{commit}" 2>/dev/null || die "backport $sha: commit desconocido (¿fetch?)"
      if g merge-base --is-ancestor "$sha" "$BASE_REV"; then
        info "  backport $(g log -1 --format='%h %s' "$sha"): ya está en la base, se saltea"
        WARN+="  - sacar de la serie: backport $sha (ya en $BASE_NAME)${adapted:+ y retirar la rama $adapted}"$'\n'
        continue
      fi
      if [ -z "$adapted" ]; then
        info "  backport $(g log -1 --format='%h %s' "$sha")"
        pick "$sha"
        ANNOTATION+="backport $(g rev-parse --short "$sha") [$up] $(g log -1 --format=%s "$sha")"$'\n'
        continue
      fi
      br="$(resolve_branch "$adapted")" || die "backport $sha: no existe la rama adaptada $adapted"
      mapfile -t commits < <(g rev-list --reverse --no-merges "$(g merge-base "$br" "$BASE_REV")..$br")
      [ "${#commits[@]}" -gt 0 ] || die "backport $sha: la rama $adapted no tiene commits sobre la base"
      info "  backport $(g log -1 --format='%h %s' "$sha") (adaptado: $adapted, ${#commits[@]} commits)"
      for c in "${commits[@]}"; do pick "$c"; done
      ANNOTATION+="backport $(g rev-parse --short "$sha") via $adapted $(g rev-parse --short "$br") [$up] $(g log -1 --format=%s "$sha")"$'\n'
      ;;
    topic)
      # <rama> o <rama>@<adaptada>: la adaptada es el tema rearmado sobre el tag base, para
      # cuando la versión sobre main no aplica a ese tag. Vale solo para ese tag (FORK.md §5).
      adapted=""; [[ "$ref" == *@* ]] && { adapted="${ref#*@}"; ref="${ref%%@*}"; }
      if [ -n "$adapted" ]; then
        abr="$(resolve_branch "$adapted")" || die "topic $ref: no existe la rama adaptada $adapted"
        if [ "$(g merge-base "$abr" "$BASE_REV")" = "$BASE_REV" ]; then
          mapfile -t commits < <(g rev-list --reverse --no-merges "$BASE_REV..$abr")
          [ "${#commits[@]}" -gt 0 ] || die "topic $ref: la rama adaptada $adapted no tiene commits sobre la base"
          info "  topic $ref (adaptado: $adapted, ${#commits[@]} commits, $(g rev-parse --short "$abr"))"
          for c in "${commits[@]}"; do pick "$c"; done
          ANNOTATION+="topic $ref via $adapted $(g rev-parse --short "$abr") [$up] ${#commits[@]} commits"$'\n'
          continue
        fi
        info "  topic $ref: la adaptación $adapted es para otra base, se usa la rama de tema"
        # Contra main (canario) la adaptación nunca aplica; sobre otro tag, ya caducó.
        [ "$CANARY" -eq 1 ] || WARN+="  - sacar de la serie la adaptación @$adapted de $ref y retirar la rama (no es para $BASE_NAME)"$'\n'
      fi
      br="$(resolve_branch "$ref")" || die "topic $ref: no existe la rama (local ni $FORK/$ref)"
      mb="$(g merge-base "$br" "$UPMAIN")"
      mapfile -t commits < <(g rev-list --reverse --no-merges "$mb..$br")
      [ "${#commits[@]}" -gt 0 ] || { info "  topic $ref: sin commits propios, se saltea"; WARN+="  - topic vacío: $ref"$'\n'; continue; }
      # Commits cuyo patch ya está en la base (git cherry los marca con '-').
      pending="$(g cherry "$BASE_REV" "$br" "$mb" | awk '$1=="+"{print $2}')"
      if [ -z "$pending" ]; then
        info "  topic $ref: todo ya está en la base, se saltea"
        WARN+="  - sacar de la serie y retirar la rama: $ref (ya en $BASE_NAME)"$'\n'
        continue
      fi
      info "  topic $ref (${#commits[@]} commits, $(g rev-parse --short "$br"))"
      for c in "${commits[@]}"; do
        grep -qx "$c" <<<"$pending" || { info "    $(g log -1 --format='%h' "$c") ya en la base, se saltea"; continue; }
        pick "$c"
      done
      ANNOTATION+="topic $ref $(g rev-parse --short "$br") [$up] ${#commits[@]} commits"$'\n'
      ;;
    *) die "tipo desconocido en la serie: '$kind'" ;;
  esac
done < "$SERIES"

# Fuera los workflows de upstream: ni el tag ni la release disparan nada ajeno.
mapfile -t wf < <(w ls-files .github/workflows | grep -vx "$KEEP_WORKFLOW" || true)
if [ "${#wf[@]}" -gt 0 ]; then
  w rm -q -- "${wf[@]}"
  w -c user.name="$(g config user.name)" -c user.email="$(g config user.email)" \
    commit -q -m "fork: strip upstream workflows (${#wf[@]}); only hub-release.yml runs in the fork"
  info "== workflows de upstream sacados del árbol: ${#wf[@]}"
fi
w ls-files --error-unmatch "$KEEP_WORKFLOW" >/dev/null 2>&1 || die "falta $KEEP_WORKFLOW en el resultado (¿fork/tooling no entró?)"

if [ "$DRY" -eq 1 ]; then
  info ""; info "OK (sin tag ni rama): la serie aplica sobre $BASE_NAME ($(w rev-list --count "$BASE_REV..HEAD") commits)."
  [ -z "$WARN" ] || printf 'avisos:\n%s' "$WARN"
  exit 0
fi

ver="${BASE#v}"; n=1
while g rev-parse -q --verify "refs/tags/$BASE-hub.$n" >/dev/null || g ls-remote --exit-code --tags "$FORK" "refs/tags/$BASE-hub.$n" >/dev/null 2>&1; do n=$((n+1)); done
TAG="$BASE-hub.$n"
g branch -f "$DEST_BRANCH" "$(w rev-parse HEAD)"
g tag -a "$TAG" "$(w rev-parse HEAD)" -m "Orca $ver + serie del fork (hub.$n)" -m "$ANNOTATION"
g worktree remove --force "$WT"
trap - EXIT
info ""
info "listo: $DEST_BRANCH = $(g rev-parse --short "$DEST_BRANCH"), tag $TAG"
[ -z "$WARN" ] || printf 'avisos:\n%s' "$WARN"

if [ "$PUSH" -eq 1 ]; then
  publish "$TAG"
else
  info "para publicar: $HERE/integrate.sh --publish $TAG"
fi
