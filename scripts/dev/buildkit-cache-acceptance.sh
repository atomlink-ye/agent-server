#!/usr/bin/env bash
set -Eeuo pipefail

# BuildKit cache acceptance.  Every selected mode performs a real buildx build
# against the dependencies stage.  The builder and cache IDs are supplied by
# the caller and are never pruned or removed by this script.

mode="${1:-all}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
evidence_dir="${EVIDENCE_DIR:-$root/.local/buildkit-cache-acceptance-$(date +%Y%m%d-%H%M%S)-$$}"
output_mode="${BUILDKIT_ACCEPTANCE_OUTPUT:-type=cacheonly}"
run_id="$(date +%Y%m%d%H%M%S)-$$"
mkdir -p "$evidence_dir"
printf '%s\n' 'legacy --no-cache same-id experiment is intentionally excluded from acceptance: BuildKit may start the cache mount empty even when the id is unchanged.' >"$evidence_dir/legacy-no-cache-report.txt"

die() {
  printf 'buildkit_cache_invalid: %s\n' "$*" >&2
  exit 2
}

case "$mode" in
  all) ;;
  help)
    printf 'usage: buildkit-cache-acceptance.sh all\n'
    exit 2
    ;;
  *) die 'the mutation pair is stateful; run all in one invocation' ;;
esac

builder="${BUILDKIT_BUILDER:?set an isolated, lane-specific buildx builder name}"
cache_id="${PNPM_CACHE_ID:?set an isolated, lane-specific cache id}"
warm_cache_id="${PNPM_CACHE_ID_WARM:-${cache_id}-warm-${run_id}}"

command -v docker >/dev/null || die 'docker is required'
docker buildx version >/dev/null 2>&1 || die 'docker buildx is required (legacy builder is not accepted)'
docker buildx inspect "$builder" >/dev/null 2>&1 || die "isolated buildx builder is not available: $builder"

# Refuse the common shared/default names.  A lane-specific ID cannot be proven
# from a string alone, so callers remain responsible for selecting their lane;
# this guard prevents the most dangerous accidental shared-cache invocation.
case "$builder" in default|builder|shared|agent-server) die "shared builder name is not allowed: $builder" ;; esac
case "$cache_id" in default|builder|shared|agent-server-pnpm-store|pnpm-store) die "shared cache id is not allowed: $cache_id" ;; esac
case "$warm_cache_id" in default|builder|shared|agent-server-pnpm-store|pnpm-store) die "shared warm cache id is not allowed: $warm_cache_id" ;; esac

tmp="$(mktemp -d "${TMPDIR:-/tmp}/buildkit-cache-acceptance.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

copy_context() {
  local context="$1"
  mkdir -p "$context"
  # Keep the caller's checked-out, possibly uncommitted files while excluding
  # large/generated trees that cannot affect the dependencies target.
  tar -C "$root" \
    --exclude=.git --exclude=node_modules --exclude=.local --exclude=dist \
    --exclude=tmp --exclude=tasks/active --exclude=tasks/archive \
    -cf - . | tar -C "$context" -xf -
}

step_no=0
run_build() {
  local name="$1" build_context="$2" id="$3" cache_bust="$4"
  shift 4
  step_no=$((step_no + 1))
  local dir="$evidence_dir/$(printf '%02d-%s' "$step_no" "$name")"
  mkdir -p "$dir"
  local log="$dir/plain.log" rc start end duration
  build_cmd=(docker buildx build --builder "$builder" --target dependencies --progress=plain \
    --build-arg "PNPM_CACHE_ID=$id" --build-arg "PNPM_INSTALL_CACHE_BUST=$cache_bust" \
    --output "$output_mode")
  build_cmd+=("$@" "$build_context")
  printf '%q\n' "${build_cmd[@]}" >"$dir/command.txt"
  start="$(date +%s)"
  set +e
  "${build_cmd[@]}" >"$log" 2>&1
  rc=$?
  set -e
  end="$(date +%s)"
  duration=$((end - start))
  printf '%s\n' "$rc" >"$dir/rc"
  printf '%s\n' "$duration" >"$dir/duration_seconds"
  # pnpm emits cumulative Progress lines.  Only the final line is the result
  # for this install; summing every line would inflate both counters.
  last_progress="$(grep -Ei 'progress:.*reused.*downloaded|progress:.*downloaded.*reused' "$log" | tail -n 1 || true)"
  printf '%s\n' "$last_progress" >"$dir/pnpm-last-progress"
  [[ -n "$last_progress" ]] || { printf 'pnpm progress line was not found\n' >&2; return 1; }
  downloaded="$(printf '%s\n' "$last_progress" | sed -nE 's/.*downloaded[[:space:]]+([0-9]+).*/\1/p')"
  reused="$(printf '%s\n' "$last_progress" | sed -nE 's/.*reused[[:space:]]+([0-9]+).*/\1/p')"
  [[ "$downloaded" =~ ^[0-9]+$ && "$reused" =~ ^[0-9]+$ ]] || {
    printf 'could not parse final pnpm progress line: %s\n' "$last_progress" >&2
    return 1
  }
  printf 'downloaded=%s\nreused=%s\n' "$downloaded" "$reused" >"$dir/pnpm-counts"
  case "$name" in
    warm) warm_downloaded="$downloaded"; warm_reused="$reused" ;;
    lock-comment) lock_comment_downloaded="$downloaded"; lock_comment_reused="$reused" ;;
    layer-bust-same-id) same_id_downloaded="$downloaded"; same_id_reused="$reused" ;;
    layer-bust-new-id) cold_downloaded="$downloaded"; cold_reused="$reused" ;;
  esac
  printf 'build_step=%s rc=%s duration_seconds=%s downloaded=%s reused=%s evidence=%s\n' \
    "$name" "$rc" "$duration" "$downloaded" "$reused" "$dir"
  if [[ "$rc" != 0 ]]; then
    tail -n 80 "$log" >&2 || true
    return "$rc"
  fi
}

run_warm() {
  local context="$tmp/context-warm"
  copy_context "$context"
  printf '%s\n' "$warm_cache_id" >"$evidence_dir/warm-cache-id"
  run_build warm "$context" "$warm_cache_id" warm
}

run_lock_comment() {
  local context="$tmp/context-lock-comment"
  copy_context "$context"
  printf '\n# buildkit-cache-acceptance lock-comment %s\n' "$run_id" >>"$context/pnpm-lock.yaml"
  printf '%s\n' "# buildkit-cache-acceptance lock-comment $run_id" >"$evidence_dir/lock-comment.txt"
  run_build lock-comment "$context" "$warm_cache_id" warm
}

run_layer_bust_same_id() {
  local context="$tmp/context-layer-bust-same-id"
  copy_context "$context"
  run_build layer-bust-same-id "$context" "$warm_cache_id" "$run_id-same"
}

run_layer_bust_new_id() {
  local context="$tmp/context-layer-bust-new-id"
  local cold_id="${PNPM_CACHE_ID_COLD:-${cache_id}-cold-${run_id}}"
  case "$cold_id" in default|builder|shared|agent-server-pnpm-store|pnpm-store) die "shared cold cache id is not allowed: $cold_id" ;; esac
  copy_context "$context"
  printf '%s\n' "$cold_id" >"$evidence_dir/layer-bust-new-id-cache-id"
  run_build layer-bust-new-id "$context" "$cold_id" "$run_id-cold"
}

cache_metrics_checker='set -eu; warm_downloaded="$1"; lock_comment_downloaded="$2"; same_id_downloaded="$3"; cold_downloaded="$4"; lock_comment_reused="$5"; same_id_reused="$6"; printf "warm_downloaded=%s lock_comment_downloaded=%s layer_bust_same_id_downloaded=%s layer_bust_new_id_downloaded=%s lock_comment_reused=%s layer_bust_same_id_reused=%s\\n" "$warm_downloaded" "$lock_comment_downloaded" "$same_id_downloaded" "$cold_downloaded" "$lock_comment_reused" "$same_id_reused"; [ "$lock_comment_reused" -gt 0 ] || { printf "lock-comment did not reuse the warm cache\\n" >&2; exit 1; }; [ "$same_id_reused" -gt 0 ] || { printf "layer-bust same-id did not reuse the cache mount\\n" >&2; exit 1; }; [ "$cold_downloaded" -gt "$same_id_downloaded" ] || { printf "layer-bust new-id downloaded=%s is not greater than same-id downloaded=%s\\n" "$cold_downloaded" "$same_id_downloaded" >&2; exit 1; }; printf "cache_metrics=pass\\n"'

run_metrics_check() {
  local dir="$evidence_dir/05-cache-metrics"
  mkdir -p "$dir"
  printf '%q\n' bash -c "$cache_metrics_checker" _ "$@" >"$dir/command.txt"
  set +e
  bash -c "$cache_metrics_checker" _ "$@" >"$dir/output" 2>&1
  local rc=$?
  set -e
  printf '%s\n' "$rc" >"$dir/rc"
  cat "$dir/output"
  [[ "$rc" == 0 ]] || die 'cache metrics did not distinguish the persistent store from layer cache'
}

case "$mode" in
  all)
    run_warm
    run_lock_comment
    run_layer_bust_same_id
    run_layer_bust_new_id
    run_metrics_check \
      "$warm_downloaded" "$lock_comment_downloaded" "$same_id_downloaded" "$cold_downloaded" \
      "$lock_comment_reused" "$same_id_reused"
    ;;
esac

printf 'buildkit_cache_acceptance=real_buildx_warm_lock_comment_layer_bust_same_id_layer_bust_new_id\n'
printf 'buildkit_cache_evidence=%s\n' "$evidence_dir"
