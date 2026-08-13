#!/usr/bin/env bash
set -Eeuo pipefail

# Real provider-toolchain acceptance.  The toolchain is deliberately exercised
# through its command line (rather than by importing implementation details),
# so this also works against a prepared Linux image.  Artifact overrides are
# passed through unchanged; a caller that has credentials can use the manifest
# URLs instead.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manifest="${PROVIDER_MANIFEST:-$root/provider-toolchain/providers.manifest.json}"
node_bin="$(command -v node || true)"
evidence_dir="${EVIDENCE_DIR:-$root/.local/provider-toolchain-acceptance-$(date +%Y%m%d-%H%M%S)-$$}"
mkdir -p "$evidence_dir"

die() {
  printf 'provider_toolchain_acceptance_failed: %s\n' "$*" >&2
  exit 1
}

[[ -f "$manifest" ]] || die "manifest not found: $manifest"
probe="${PROVIDER_SESSION_PROBE:-$root/scripts/dev/provider-session-probe.mjs}"
[[ -n "$probe" ]] || die 'PROVIDER_SESSION_PROBE is required; provider-session positives cannot be skipped'
[[ -x "$probe" ]] || die "PROVIDER_SESSION_PROBE is not executable: $probe"

# A prepared image is useful on non-Linux hosts and for CI.  It must contain
# bash, node, flock, tar and pnpm.  Local artifact paths outside the repository
# are bind-mounted at the same absolute path when docker is used.
if [[ "${PROVIDER_ACCEPTANCE_INNER:-0}" != 1 && -n "${PROVIDER_ACCEPTANCE_IMAGE:-}" ]]; then
  command -v docker >/dev/null || die 'PROVIDER_ACCEPTANCE_IMAGE requires docker'
  image_evidence="$evidence_dir/docker"
  mkdir -p "$image_evidence"
  docker_args=(run --rm --platform "${PROVIDER_ACCEPTANCE_PLATFORM:-linux/amd64}" \
    -v "$root:/workspace:ro" -v "$evidence_dir:/evidence" -w /workspace)
  for var in PROVIDER_ARTIFACT_OPENCODE_FILE PROVIDER_ARTIFACT_CLAUDE_FILE PROVIDER_ARTIFACT_CODEX_FILE PROVIDER_SESSION_PROBE; do
    value="${!var:-}"
    if [[ "$value" = /* && -e "$value" ]]; then
      docker_args+=(-v "$value:$value:ro")
    fi
  done
  for var in PROVIDER_MANIFEST PROVIDER_ARTIFACT_BASE_URL \
    PROVIDER_ARTIFACT_OPENCODE_FILE PROVIDER_ARTIFACT_OPENCODE_SHA256 PROVIDER_ARTIFACT_OPENCODE_BINARY_SHA256 \
    PROVIDER_ARTIFACT_CLAUDE_FILE PROVIDER_ARTIFACT_CLAUDE_SHA256 PROVIDER_ARTIFACT_CLAUDE_BINARY_SHA256 \
    PROVIDER_ARTIFACT_CODEX_FILE PROVIDER_ARTIFACT_CODEX_SHA256 PROVIDER_ARTIFACT_CODEX_BINARY_SHA256 \
    PROVIDER_BINARY_OPENCODE_SHA256 PROVIDER_BINARY_CLAUDE_SHA256 PROVIDER_BINARY_CODEX_SHA256 \
    PROVIDER_SESSION_PROBE; do
    value="${!var:-}"
    if [[ "$var" == PROVIDER_SESSION_PROBE && "$value" == "$root/"* ]]; then
      value="/workspace/${value#"$root/"}"
    fi
    [[ -n "$value" ]] && docker_args+=(-e "$var=$value")
  done
  # Pass credential names through Docker without rendering their values into
  # command evidence. The inner probe forwards only this explicit allowlist to
  # Paseo/provider children.
  for var in OPENCODE_GO_API_KEY ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_MODEL \
    ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL \
    ANTHROPIC_SMALL_FAST_MODEL CLAUDE_CODE_SUBAGENT_MODEL OPENAI_API_KEY OPENAI_BASE_URL CODEX_API_KEY; do
    [[ -n "${!var:-}" ]] && docker_args+=(-e "$var")
  done
  docker_args+=(-e PROVIDER_ACCEPTANCE_INNER=1 -e EVIDENCE_DIR=/evidence -e PROVIDER_VOLUME_ROOT=/tmp/provider-toolchain-volume)
  docker_args+=("$PROVIDER_ACCEPTANCE_IMAGE" bash /workspace/scripts/dev/provider-toolchain-acceptance.sh)
  set +e
  docker "${docker_args[@]}" >"$image_evidence/docker.output" 2>&1
  rc=$?
  set -e
  printf '%s\n' "docker ${docker_args[*]}" >"$image_evidence/docker.command"
  printf '%s\n' "$rc" >"$image_evidence/docker.rc"
  cat "$image_evidence/docker.output"
  exit "$rc"
fi

[[ "$(uname -s)" == Linux ]] || die 'provider toolchain acceptance needs Linux or PROVIDER_ACCEPTANCE_IMAGE'
[[ -n "$node_bin" ]] || die 'node is required'

toolchain="$root/provider-toolchain/scripts/provider-toolchain.mjs"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/provider-toolchain-acceptance.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

step_no=0
last_output=''
last_rc=0
run_step() {
  local name="$1" expected="$2"
  shift 2
  step_no=$((step_no + 1))
  local dir="$evidence_dir/$(printf '%02d-%s' "$step_no" "$name")"
  mkdir -p "$dir"
  # command.txt is the exact argv, one shell-escaped word per line; it is
  # evidence only and is never evaluated.
  printf '%q\n' "$@" >"$dir/command.txt"
  set +e
  "$@" >"$dir/output" 2>&1
  local rc=$?
  set -e
  printf '%s\n' "$rc" >"$dir/rc"
  last_output="$dir/output"
  last_rc="$rc"
  if [[ "$expected" != any && "$rc" != "$expected" ]]; then
    printf 'provider step %s expected rc=%s got rc=%s\n' "$name" "$expected" "$rc" >&2
    cat "$dir/output" >&2
    return 1
  fi
  if [[ "$expected" == any && "$rc" == 0 ]]; then
    printf 'provider step %s expected failure but got rc=0\n' "$name" >&2
    return 1
  fi
  printf 'provider_step=%s rc=%s evidence=%s\n' "$name" "$rc" "$dir" >&2
}

run_expected_failure() {
  local name="$1"
  shift
  run_step "$name" any "$@"
}

# The provider configuration boundary is checked using a disposable snapshot,
# never the checked-out worktree.  A valid snapshot may change only the
# checked-in provider selection config; adding a TypeScript file is a mutation the checker must
# reject.  Keep this as a real git diff --no-index invocation so the command,
# its non-zero diff status and checker output are all retained by run_step.
run_provider_config_checker() {
  local name="$1" expected="$2" baseline="$3" candidate="$4" mode="$5"
  run_step "$name" "$expected" bash -c '
    set -u
    baseline="$1"
    candidate="$2"
    mode="$3"
    set +e
    names="$(git diff --no-index --name-only -- "$baseline" "$candidate" 2>&1)"
    diff_rc=$?
    set -e
    printf "git_diff_rc=%s\n%s\n" "$diff_rc" "$names"
    [ "$diff_rc" -eq 1 ] || { printf "checker expected a changed snapshot\n" >&2; exit 1; }
    normalized="$(printf "%s\n" "$names" | sed -E "s#^.*/(config/real-provider-defaults.env|src/[^/]+\\.ts)\$#\\1#" | sort -u)"
    printf "normalized_files=%s\n" "$normalized"
    if [ "$mode" = positive ]; then
      [ "$normalized" = config/real-provider-defaults.env ] || {
        printf "provider config checker rejected unexpected files\n" >&2
        exit 1
      }
      case "$normalized" in *.ts) exit 1 ;; esac
    else
      case "$normalized" in
        *"config/real-provider-defaults.env"*"src/"*.ts*)
          printf "provider config checker correctly rejected TypeScript mutation\n"
          exit 1
          ;;
        *)
          printf "provider config checker did not observe the TypeScript mutation\n" >&2
          exit 1
          ;;
      esac
    fi
  ' _ "$baseline" "$candidate" "$mode"
}

# The same checker is run against the clean marker and a disposable polluted
# copy.  It deliberately returns non-zero for the polluted marker, proving the
# count assertion is not only a shell condition in the harness itself.
writer_count_checker='set -u; marker="$1"; lines="$(cat "$marker" 2>&1)"; rc=$?; printf "marker_rc=%s\\n%s\\n" "$rc" "$lines"; [ "$rc" -eq 0 ] || exit 1; [ "$(printf "%s\\n" "$lines" | sed "/^$/d" | wc -l | tr -d " ")" = 3 ] || { printf "writer count is not three\\n" >&2; exit 1; }; for provider in opencode claude codex; do [ "$(printf "%s\\n" "$lines" | grep -cx "$provider")" = 1 ] || { printf "writer count for %s is not one\\n" "$provider" >&2; exit 1; }; done; printf "writer_count=3\\n"'

# Preserve caller-provided artifact/binary overrides in every child command.
# The toolchain reads these names directly; no synthetic artifacts are made by
# this harness.
provider_env=()
for var in PROVIDER_ARTIFACT_BASE_URL \
  PROVIDER_ARTIFACT_OPENCODE_FILE PROVIDER_ARTIFACT_OPENCODE_SHA256 PROVIDER_ARTIFACT_OPENCODE_BINARY_SHA256 \
  PROVIDER_ARTIFACT_CLAUDE_FILE PROVIDER_ARTIFACT_CLAUDE_SHA256 PROVIDER_ARTIFACT_CLAUDE_BINARY_SHA256 \
  PROVIDER_ARTIFACT_CODEX_FILE PROVIDER_ARTIFACT_CODEX_SHA256 PROVIDER_ARTIFACT_CODEX_BINARY_SHA256 \
  PROVIDER_BINARY_OPENCODE_SHA256 PROVIDER_BINARY_CLAUDE_SHA256 PROVIDER_BINARY_CODEX_SHA256; do
  [[ -n "${!var:-}" ]] && provider_env+=("$var=${!var}")
done

volume="$tmp/volume"
tool=("$node_bin" "$toolchain")

# Initial state, real frozen init, status and validate/attach.
run_step status-initial 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"status": "not_installed"' "$last_output" || die 'initial status was not not_installed'
run_step init 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" init
run_step status-ready 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"status": "ready"' "$last_output" || die 'init did not leave ready status'
run_step validate 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" validate
run_step current-link-mutation 0 unlink "$volume/current"
run_step status-current-link-missing 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"reason": "current_release_invalid"' "$last_output" || die 'status accepted a missing current release link'
run_expected_failure validate-current-link-missing env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" validate
run_step init-repairs-current-link 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" init
run_step validate-repaired-current-link 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" validate

snapshot_base="$tmp/provider-config-snapshot-base"
snapshot_positive="$tmp/provider-config-snapshot-positive"
snapshot_negative="$tmp/provider-config-snapshot-negative"
mkdir -p "$snapshot_base/config" "$snapshot_positive/config" "$snapshot_negative/config"
cp "$root/config/real-provider-defaults.env" "$snapshot_base/config/real-provider-defaults.env"
sed 's/^PASEO_PROVIDER=opencode$/PASEO_PROVIDER=claude/' \
  "$root/config/real-provider-defaults.env" >"$snapshot_positive/config/real-provider-defaults.env"
run_step provider-config-parse-positive 0 bash -c \
  'set -eu; set -a; . "$1"; set +a; test "$PASEO_PROVIDER" = claude; printf "PASEO_PROVIDER=%s\\n" "$PASEO_PROVIDER"' \
  _ "$snapshot_positive/config/real-provider-defaults.env"
cp -a "$snapshot_positive/." "$snapshot_negative/"
mkdir -p "$snapshot_negative/src"
printf 'export const acceptanceMutation = true;\n' >"$snapshot_negative/src/acceptance-mutation.ts"
run_provider_config_checker provider-config-diff-positive 0 "$snapshot_base" "$snapshot_positive" positive
run_provider_config_checker provider-config-diff-negative any "$snapshot_base" "$snapshot_negative" negative

release_bin="$volume/current/bin"
release_paseo_bin="$volume/current/paseo-toolchain/node_modules/.bin"
path_node_dir="$(dirname "$node_bin")"
path_value="$release_bin:$path_node_dir:/usr/bin:/bin"
run_step path-positive 0 env PATH="$path_value" PROVIDER_EXPECTED_BIN="$release_bin/" node --input-type=module -e \
  'import { pathToFileURL } from "node:url"; const { resolveProviderBinary } = await import(pathToFileURL(process.argv[1]).href); for (const p of ["opencode", "claude", "codex"]) { const b = await resolveProviderBinary(p); if (!b.startsWith(process.env.PROVIDER_EXPECTED_BIN)) throw new Error(`${p} resolved outside release`); }' \
  "$root/scripts/dev/resolve-provider.mjs"
run_expected_failure path-negative env PATH="$tmp/empty" OPENCODE_BIN= "$node_bin" "$root/scripts/dev/resolve-opencode.mjs" --check
grep -q 'provider_environment_invalid: opencode not found in PATH' "$last_output" || die 'negative PATH check did not fail closed'

# A bad checksum must fail with the toolchain's checksum exit code and durable
# failure status, not merely make a static assertion in this harness.
bad_volume="$tmp/bad-checksum-volume"
bad_env=("${provider_env[@]}" PROVIDER_ARTIFACT_OPENCODE_SHA256=0000000000000000000000000000000000000000000000000000000000000000)
run_step checksum-mismatch 21 env "${bad_env[@]}" PROVIDER_VOLUME_ROOT="$bad_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" init
run_step checksum-status 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$bad_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"status": "checksum_mismatch"' "$last_output" || die 'checksum mismatch did not persist failure status'

# Kill a live init after a provider write.  status must classify the abandoned
# install as not_installed, after which an unmodified init must recover.
kill_volume="$tmp/kill-volume"
run_expected_failure kill-during-init env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$kill_volume" PROVIDER_MANIFEST="$manifest" \
  PROVIDER_TOOLCHAIN_KILL_HOOK='kill -KILL "$PPID"' "${tool[@]}" init
run_step status-after-kill 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$kill_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"status": "not_installed"' "$last_output" || die 'status after killed init did not recover to not_installed'
run_expected_failure validate-after-kill-before-recovery env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$kill_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" validate
run_step init-after-kill 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$kill_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" init
run_step validate-after-kill 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$kill_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" validate

# Two writers must serialize on the toolchain lock and publish one complete
# release.  The marker is appended once per provider by the implementation;
# exactly one opencode/claude/codex line proves the second writer reused it.
concurrent_volume="$tmp/concurrent-volume"
writer_marker="$tmp/writer-marker"
mkdir -p "$concurrent_volume"
cmd_env=("${provider_env[@]}" PROVIDER_VOLUME_ROOT="$concurrent_volume" PROVIDER_MANIFEST="$manifest" PROVIDER_TOOLCHAIN_WRITER_MARKER="$writer_marker")
step_no=$((step_no + 1))
concurrent_dir="$evidence_dir/$(printf '%02d-concurrent-init' "$step_no")"
mkdir -p "$concurrent_dir"
printf '%q\n' env "${cmd_env[@]}" "${tool[@]}" init >"$concurrent_dir/command.txt"
set +e
env "${cmd_env[@]}" "${tool[@]}" init >"$concurrent_dir/one.output" 2>&1 &
pid_one=$!
env "${cmd_env[@]}" "${tool[@]}" init >"$concurrent_dir/two.output" 2>&1 &
pid_two=$!
wait "$pid_one"; rc_one=$?
wait "$pid_two"; rc_two=$?
set -e
printf '%s\n' "$rc_one" >"$concurrent_dir/one.rc"
printf '%s\n' "$rc_two" >"$concurrent_dir/two.rc"
cat "$concurrent_dir/one.output" "$concurrent_dir/two.output" >"$concurrent_dir/output"
[[ "$rc_one" == 0 && "$rc_two" == 0 ]] || { cat "$concurrent_dir/output" >&2; die 'concurrent init failed'; }
printf 'provider_step=concurrent-init rc=%s,%s evidence=%s\n' "$rc_one" "$rc_two" "$concurrent_dir" >&2
run_step writer-count-positive 0 bash -c "$writer_count_checker" _ "$writer_marker"
contaminated_marker="$tmp/writer-marker-contaminated"
cp "$writer_marker" "$contaminated_marker"
printf 'opencode\n' >>"$contaminated_marker"
run_step writer-count-negative any bash -c "$writer_count_checker" _ "$contaminated_marker"
run_step concurrent-status 0 env "${provider_env[@]}" PROVIDER_VOLUME_ROOT="$concurrent_volume" PROVIDER_MANIFEST="$manifest" "${tool[@]}" status
grep -q '"status": "ready"' "$last_output" || die 'concurrent init did not leave ready status'

# A session probe is intentionally mandatory.  It receives one provider name
# per invocation and must perform the real provider-session positive path: the
# hook contract requires a real Paseo create-session call and a successful
# session interaction, not a provider --version check.  The hook owns
# credentials and application-specific protocol details.
for provider in opencode claude codex; do
  run_step "provider-session-$provider" 0 env PATH="$release_bin:$release_paseo_bin:$PATH" \
    PROVIDER_TOOLCHAIN_VOLUME="$volume" PROVIDER_RELEASE_BIN="$release_bin" \
    PROVIDER_SESSION_RUNTIME_ROOT="$tmp/session-runtime" \
    PROVIDER_MANIFEST="$manifest" "$probe" "$provider"
done
run_expected_failure provider-session-mutation env PATH="$release_bin:$release_paseo_bin:$PATH" OPENCODE_BIN="$tmp/missing-opencode" \
  PROVIDER_TOOLCHAIN_VOLUME="$volume" PROVIDER_RELEASE_BIN="$release_bin" \
  PROVIDER_SESSION_RUNTIME_ROOT="$tmp/session-runtime" PROVIDER_MANIFEST="$manifest" \
  PROVIDER_SESSION_MUTATION=provider-binary-missing "$probe" opencode

printf 'provider_toolchain_acceptance=real_init_status_validate_path_checksum_kill_concurrency_sessions\n'
printf 'provider_toolchain_evidence=%s\n' "$evidence_dir"
