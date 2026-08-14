#!/usr/bin/env bash

# The outer remote invocation must remain `bash -o pipefail` so a caller never
# loses this wrapper's status to an unrelated pipe.
set -uo pipefail

workspace="${FOUNDATION_DEMO_WORKSPACE:-$PWD}"
cd "$workspace"

if [[ -r "${FOUNDATION_AGENT_ENV:-/root/.agent-env}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${FOUNDATION_AGENT_ENV:-/root/.agent-env}"
  set +a
fi

exec node scripts/foundation/phase-c-runtime-demo.mjs
