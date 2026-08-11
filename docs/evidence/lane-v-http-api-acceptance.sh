#!/usr/bin/env bash
set -euo pipefail

# Lane V acceptance client. Every platform mutation/read below is an HTTP call.
# No database, MCP, internal module, smoke helper, or dispatcher shortcut is used.

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
TOKEN="${TOKEN:-token-local-dev}"
FOREIGN_TOKEN="${FOREIGN_TOKEN:-}"
FOREIGN_OWNER_ASSERTION="${FOREIGN_OWNER_ASSERTION:-}"
WORKSPACE_MODE="${WORKSPACE_MODE:-create}"
LABEL="${LABEL:-lane-v-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/workspace/.local/lane-v-http-evidence/$LABEL}"
POLL_SECONDS="${POLL_SECONDS:-5}"
POLL_LIMIT="${POLL_LIMIT:-240}"
NEEDS_HUMAN_REVIEW=false
BASE_URL="${BASE_URL%/}"

if [[ ! "$LABEL" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  printf 'LABEL must contain only letters, digits, dot, underscore, or dash.\n' >&2
  exit 2
fi

mkdir -p "$EVIDENCE_DIR"
STATE_FILE="$EVIDENCE_DIR/state.json"
REQUEST_INDEX_FILE="$EVIDENCE_DIR/request-index"
test -f "$STATE_FILE" || printf '{}\n' >"$STATE_FILE"
test -f "$REQUEST_INDEX_FILE" || printf '0\n' >"$REQUEST_INDEX_FILE"

require_tool() {
  command -v "$1" >/dev/null
}

require_tool curl
require_tool jq

next_index() {
  local value
  value="$(<"$REQUEST_INDEX_FILE")"
  value="$((value + 1))"
  printf '%s\n' "$value" >"$REQUEST_INDEX_FILE"
  printf '%04d' "$value"
}

state_set() {
  local key="$1" value="$2" tmp
  tmp="$STATE_FILE.tmp"
  jq --arg key "$key" --arg value "$value" '.[$key] = $value' "$STATE_FILE" >"$tmp"
  mv "$tmp" "$STATE_FILE"
}

state_get() {
  jq -er --arg key "$1" '.[$key]' "$STATE_FILE"
}

request_json() {
  local name="$1" method="$2" path="$3" expected="$4"
  local request_file="${5:-}" idempotency_key="${6:-}"
  local index prefix response_file status
  local -a curl_args
  index="$(next_index)"
  prefix="$EVIDENCE_DIR/${index}-${name}"
  response_file="$prefix.response.json"

  if [[ -n "$request_file" ]]; then
    cp "$request_file" "$prefix.request.json"
  else
    printf '{}\n' >"$prefix.request.json"
  fi
  jq -n \
    --arg method "$method" \
    --arg path "$path" \
    --arg authorization 'Bearer <redacted>' \
    --arg idempotency_key "$idempotency_key" \
    '{method:$method,path:$path,headers:({authorization:$authorization,content_type:"application/json"} + (if $idempotency_key == "" then {} else {idempotency_key:$idempotency_key} end))}' \
    >"$prefix.request-meta.json"

  curl_args=(
    curl -sS --connect-timeout 5 --max-time 60 -o "$response_file" -w '%{http_code}' -X "$method"
    "$BASE_URL$path"
    -H "Authorization: Bearer $TOKEN"
    -H 'content-type: application/json'
  )
  if [[ -n "$idempotency_key" ]]; then
    curl_args+=(-H "Idempotency-Key: $idempotency_key")
  fi
  if [[ -n "$request_file" ]]; then
    curl_args+=(--data-binary "@$request_file")
  fi

  status="$("${curl_args[@]}")"
  jq -n --arg status "$status" --arg expected "$expected" \
    '{http_status:($status|tonumber),expected_statuses:($expected|split(",")|map(tonumber))}' \
    >"$prefix.response-meta.json"
  printf '%s\n' "$prefix" >"$EVIDENCE_DIR/last-prefix"
  if [[ ",$expected," != *",$status,"* ]]; then
    printf 'HTTP mismatch: %s %s expected=%s actual=%s body=%s\n' \
      "$method" "$path" "$expected" "$status" "$(<"$response_file")" >&2
    return 1
  fi
  printf '%s\n' "$response_file"
}

json_request_file() {
  local name="$1"
  local file="$EVIDENCE_DIR/request-$name.json"
  jq -n "${@:2}" >"$file"
  printf '%s\n' "$file"
}

assert_jq() {
  local file="$1" expression="$2" label="$3"
  if ! jq -e "$expression" "$file" >/dev/null; then
    printf 'Assertion failed: %s file=%s expression=%s\n' "$label" "$file" "$expression" >&2
    return 1
  fi
  printf '%s\n' "$label" >>"$EVIDENCE_DIR/assertions-passed.txt"
}

publish_source() {
  local kind="$1" source="$2"
  local validate_path import_path publish_prefix import_definition_field
  local source_request validate_response import_response version_id definition_id publish_response

  case "$kind" in
    environment)
      validate_path='/api/v1/environment-packages:validate'
      import_path='/api/v1/environments:import'
      publish_prefix='/api/v1/environment-versions'
      import_definition_field='definition'
      ;;
    lead|worker|reviewer)
      validate_path='/api/v1/agent-packages:validate'
      import_path='/api/v1/agents:import'
      publish_prefix='/api/v1/agent-versions'
      import_definition_field='agent'
      ;;
    team)
      validate_path='/api/v1/team-packages:validate'
      import_path='/api/v1/teams:import'
      publish_prefix='/api/v1/team-versions'
      import_definition_field='team'
      ;;
    *)
      printf 'Unknown kind: %s\n' "$kind" >&2
      return 2
      ;;
  esac

  source_request="$EVIDENCE_DIR/request-$kind-source.json"
  jq -n --arg source "$source" '{source:$source}' >"$source_request"
  validate_response="$(request_json "$kind-validate" POST "$validate_path" 200 "$source_request")"
  assert_jq "$validate_response" '.valid == true and (.fingerprint | startswith("sha256:"))' "$kind package validates"

  import_response="$(request_json "$kind-import" POST "$import_path" 201 "$source_request" "$LABEL-$kind-import")"
  version_id="$(jq -er '.version.id' "$import_response")"
  definition_id="$(jq -er --arg field "$import_definition_field" '.[$field].id' "$import_response")"
  assert_jq "$import_response" \
    ".version.id == \"$version_id\" and .version.definition_id == \"$definition_id\" and .version.status == \"draft\"" \
    "$kind import returns coherent draft lineage"

  publish_response="$(request_json "$kind-publish" POST "$publish_prefix/$version_id:publish" 200 "$EVIDENCE_DIR/empty.json" "$LABEL-$kind-publish")"
  assert_jq "$publish_response" \
    ".id == \"$version_id\" and .definition_id == \"$definition_id\" and .status == \"published\" and .published_at != null" \
    "$kind publish preserves lineage and reaches published"
  if [[ "$kind" == 'team' ]]; then
    assert_jq "$publish_response" \
      ".environment_version_id == \"$(state_get environment_version_id)\" and .spec.environmentVersionId == \"$(state_get environment_version_id)\" and .spec.lead.agentVersionId == \"$(state_get lead_version_id)\" and ([.spec.roster[].agentVersionId] | sort) == ([\"$(state_get worker_version_id)\",\"$(state_get reviewer_version_id)\"] | sort)" \
      'published Team resolves the exact Environment and Agent versions'
  fi
  state_set "${kind}_definition_id" "$definition_id"
  state_set "${kind}_version_id" "$version_id"
}

prepare_definitions() {
  printf '{}\n' >"$EVIDENCE_DIR/empty.json"

  local readiness workspace_request workspace_response created_workspace_id workspace_read
  readiness="$(request_json readiness GET /health/ready 200)"
  assert_jq "$readiness" '.status == "ready" or .ready == true' 'service readiness is reported over HTTP'
  case "$WORKSPACE_MODE" in
    create)
      workspace_request="$(json_request_file workspace --arg name "$LABEL workspace" '{name:$name}')"
      workspace_response="$(request_json workspace-create POST /api/v1/workspaces 201 "$workspace_request")"
      created_workspace_id="$(jq -er '.workspace_id' "$workspace_response")"
      state_set created_workspace_id "$created_workspace_id"
      workspace_read="$(request_json workspace-read GET "/api/v1/workspaces/$created_workspace_id" 200)"
      assert_jq "$workspace_read" ".workspace_id == \"$created_workspace_id\"" 'created workspace is readable through API'
      ;;
    token)
      state_set workspace_mode token
      ;;
    *)
      printf 'WORKSPACE_MODE must be create or token.\n' >&2
      return 2
      ;;
  esac

  local environment_source lead_source worker_source reviewer_source team_source
  environment_source="$(cat <<EOF
apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: $LABEL-environment
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
EOF
)"
  publish_source environment "$environment_source"

  lead_source="$(cat <<EOF
apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: $LABEL-lead
spec:
  description: Lane V HTTP-only acceptance lead
  instructions: >-
    Act directly as Team Lead using only the canonical Team tools exposed in the current turn.
    Never use provider subagents, shell, filesystem, or prose instead of a required tool call.
    On an empty board create exactly two Work items in this order, then stop:
    Work A, subject LANE_V_A, assigned to worker, no dependency_refs, requiring a first submission with marker LANE_V_A_V1_MISSING and a corrected second submission with marker LANE_V_A_FINAL after feedback;
    Work B, subject LANE_V_B, assigned to reviewer, no dependency_refs, requiring marker LANE_V_B_OK.
    When the first attempts for Work A and Work B are completed, call team_work_request_changes exactly once for work-1 with assignee worker and feedback exactly LANE_V_FEEDBACK_ADD_FINAL_MARKER, accept work-2, then stop.
    When work-1 attempt 2 contains LANE_V_A_FINAL, accept work-1, then create exactly one Work C with subject LANE_V_C assigned to reviewer, dependency_refs exactly [work-1, work-2], and requiring marker LANE_V_C_OK; then stop.
    When work-3 is completed with LANE_V_C_OK, accept work-3 and send exactly one direct message to reviewer with summary LANE_V_DIRECT_MESSAGE_MARKER, then stop.
    On the next legal turn, when every Work is accepted and no attempt is active, call team_finish exactly once.
    Never repeat a successful mutation or invent a work_ref.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/team-state
      kind: tool
    - ref: agent-server/team-work-list
      kind: tool
    - ref: agent-server/team-work-create
      kind: tool
    - ref: agent-server/team-work-accept-v2
      kind: tool
    - ref: agent-server/team-work-request-changes
      kind: tool
    - ref: agent-server/team-message-send
      kind: tool
    - ref: agent-server/team-finish
      kind: tool
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: Execute exactly the next legal Team transition for the Lane V scenario.
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: done
EOF
)"

  worker_source="$(cat <<EOF
apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: $LABEL-worker
spec:
  description: Lane V HTTP-only acceptance worker
  instructions: >-
    Act directly as the assigned Team worker using only canonical Team tools.
    On attempt 1 for LANE_V_A, submit exactly one result containing LANE_V_A_V1_MISSING and deliberately omit LANE_V_A_FINAL, then stop.
    After request changes with feedback LANE_V_FEEDBACK_ADD_FINAL_MARKER, submit exactly one corrected result containing both LANE_V_FEEDBACK_ADD_FINAL_MARKER and LANE_V_A_FINAL, then stop.
    Never mutate another Work, never repeat a successful submission, and never use provider subagents.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/team-state
      kind: tool
    - ref: agent-server/team-work-list
      kind: tool
    - ref: agent-server/team-work-checkpoint
      kind: tool
    - ref: agent-server/team-work-submit
      kind: tool
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: Execute exactly the assigned Lane V Work transition.
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: done
EOF
)"

  reviewer_source="$(cat <<EOF
apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: $LABEL-reviewer
spec:
  description: Lane V HTTP-only acceptance reviewer
  instructions: >-
    Act directly as the assigned Team reviewer using only canonical Team tools.
    For subject LANE_V_B submit exactly one result containing LANE_V_B_OK.
    For subject LANE_V_C, which must only run after work-1 and work-2 are accepted, submit exactly one result containing LANE_V_C_OK.
    Never mutate another Work, never repeat a successful submission, never send a message, and never use provider subagents.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/team-state
      kind: tool
    - ref: agent-server/team-work-list
      kind: tool
    - ref: agent-server/team-work-checkpoint
      kind: tool
    - ref: agent-server/team-work-submit
      kind: tool
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: Execute exactly the assigned Lane V Work transition.
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: done
EOF
)"

  publish_source lead "$lead_source"
  publish_source worker "$worker_source"
  publish_source reviewer "$reviewer_source"

  team_source="$(cat <<EOF
apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: $LABEL-team
spec:
  environmentVersionId: $(state_get environment_version_id)
  lead:
    name: lead
    agentVersionId: $(state_get lead_version_id)
  roster:
    - name: worker
      agentVersionId: $(state_get worker_version_id)
    - name: reviewer
      agentVersionId: $(state_get reviewer_version_id)
  coordination:
    taskAssignment: lead_or_self_claim
EOF
)"
  publish_source team "$team_source"
}

start_journey() {
  local team_id team_version work_request work_response work_id
  local sibling_request sibling_response run_request run_response
  team_id="$(state_get team_definition_id)"
  team_version="$(state_get team_version_id)"

  work_request="$(json_request_file work-main --arg definition_id "$team_id" --arg definition_version_id "$team_version" --arg title "$LABEL main" '{definition_id:$definition_id,definition_version_id:$definition_version_id,title:$title}')"
  work_response="$(request_json work-create-main POST /api/v1/works 201 "$work_request")"
  work_id="$(jq -er '.work.id' "$work_response")"
  if [[ "$(jq -r '.created_workspace_id // empty' "$STATE_FILE")" != '' ]]; then
    assert_jq "$work_response" ".work.definition_id == \"$team_id\" and .work.definition_version_id == \"$team_version\" and .work.workspace_id == \"$(state_get created_workspace_id)\" and .work.origin == \"created\"" 'main Work belongs to the API-created workspace and published Team identity'
  else
    assert_jq "$work_response" ".work.definition_id == \"$team_id\" and .work.definition_version_id == \"$team_version\" and (.work.workspace_id | test(\"^[0-9a-fA-F-]{36}$\")) and .work.origin == \"created\"" 'main Work belongs to the token default scope and published Team identity'
    state_set effective_workspace_id "$(jq -er '.work.workspace_id' "$work_response")"
  fi
  state_set work_id "$work_id"

  for sibling in 1 2; do
    sibling_request="$(json_request_file "work-sibling-$sibling" --arg definition_id "$team_id" --arg definition_version_id "$team_version" --arg title "$LABEL sibling $sibling" '{definition_id:$definition_id,definition_version_id:$definition_version_id,title:$title}')"
    sibling_response="$(request_json "work-create-sibling-$sibling" POST /api/v1/works 201 "$sibling_request")"
    state_set "sibling_work_id_$sibling" "$(jq -er '.work.id' "$sibling_response")"
  done
  jq -en \
    --arg main "$work_id" \
    --arg one "$(state_get sibling_work_id_1)" \
    --arg two "$(state_get sibling_work_id_2)" \
    '[$main,$one,$two] | length == (unique | length)' >/dev/null

  run_request="$(json_request_file work-run --arg trigger_ref "$LABEL-main-run" '{trigger_kind:"manual",trigger_ref:$trigger_ref}')"
  run_response="$(request_json work-run-start POST "/api/v1/works/$work_id/runs" 202 "$run_request")"
  assert_jq "$run_response" ".work_run.work_id == \"$work_id\" and .work_run.bound_at != null and .execution_receipt.reused == false" 'WorkRun is newly bound to a root Task'
  state_set work_run_id "$(jq -er '.work_run.id' "$run_response")"
  state_set root_task_id "$(jq -er '.execution_receipt.source_refs.task_id' "$run_response")"
}

poll_terminal() {
  local root_task_id team_run_id='' task_response team_response status attempt revision decision_request decision_response
  local completion_decision_sent=false
  root_task_id="$(state_get root_task_id)"
  for attempt in $(seq 1 "$POLL_LIMIT"); do
    task_response="$(request_json "task-poll-$attempt" GET "/api/v1/tasks/$root_task_id" 200)"
    status="$(jq -er '.status' "$task_response")"
    team_response="$(request_json "team-run-discovery-$attempt" GET "/api/v1/tasks/$root_task_id/team-run" 200)"
    if jq -e 'type == "object" and .id != null' "$team_response" >/dev/null; then
      if [[ -z "$team_run_id" ]]; then
        team_run_id="$(jq -er '.id' "$team_response")"
        state_set team_run_id "$team_run_id"
      fi
      if [[ "$completion_decision_sent" == false ]] && jq -e '.status == "waiting" and .completion_approval_required == true' "$team_response" >/dev/null; then
        revision="$(jq -er '.revision' "$team_response")"
        decision_request="$(json_request_file completion-approve --argjson revision "$revision" '{decision:"approve",expected_revision:$revision}')"
        decision_response="$(request_json completion-approve POST "/api/v1/team-runs/$team_run_id/completion-decisions" 200 "$decision_request")"
        assert_jq "$decision_response" ".team_run.id == \"$team_run_id\" and .decision.decision == \"approve\"" 'completion approval is supplied only after the API reports a pending approval gate'
        completion_decision_sent=true
      fi
    fi
    if [[ "$status" == 'completed' || "$status" == 'failed' || "$status" == 'cancelled' ]]; then
      break
    fi
    sleep "$POLL_SECONDS"
  done
  if [[ "$status" != 'completed' ]]; then
    printf 'Root Task did not complete successfully: status=%s body=%s\n' "$status" "$(<"$task_response")" >&2
    return 1
  fi
  assert_jq "$task_response" '.status == "completed" and .latest_run.status == "succeeded"' 'root Task and latest technical run succeeded'

  if [[ -z "$team_run_id" ]]; then
    team_response="$(request_json team-run-discovery-final GET "/api/v1/tasks/$root_task_id/team-run" 200)"
    team_run_id="$(jq -er '.id' "$team_response")"
    state_set team_run_id "$team_run_id"
  fi
  team_response="$(request_json team-run-final GET "/api/v1/team-runs/$team_run_id" 200)"
  assert_jq "$team_response" '.status == "succeeded" and .phase == "done"' 'TeamRun reached succeeded/done'
}

walk_cursor_pages() {
  local name="$1" path="$2" array_field="$3"
  local cursor='' encoded_cursor page=0 response next combined="$EVIDENCE_DIR/$name-combined.json"
  local -A seen_cursors=()
  printf '[]\n' >"$combined"
  while :; do
    page="$((page + 1))"
    if ((page > 1000)); then
      printf 'Cursor walk exceeded 1000 pages: %s\n' "$name" >&2
      return 1
    fi
    if [[ -z "$cursor" ]]; then
      response="$(request_json "$name-page-$page" GET "$path?limit=1" 200)"
    else
      if [[ -n "${seen_cursors[$cursor]:-}" ]]; then
        printf 'Cursor loop detected: %s cursor=%s\n' "$name" "$cursor" >&2
        return 1
      fi
      seen_cursors[$cursor]=1
      encoded_cursor="$(jq -nr --arg value "$cursor" '$value | @uri')"
      response="$(request_json "$name-page-$page" GET "$path?limit=1&cursor=$encoded_cursor" 200)"
    fi
    jq --arg field "$array_field" -s '.[0] + .[1][$field]' "$combined" "$response" >"$combined.tmp"
    mv "$combined.tmp" "$combined"
    next="$(jq -r '.next_cursor // empty' "$response")"
    [[ -n "$next" ]] || break
    cursor="$next"
  done
  jq -e 'length == (unique_by(.id) | length)' "$combined" >/dev/null
  jq -e '([.[] | [.created_at,.id]]) as $keys | $keys == ($keys | sort)' "$combined" >/dev/null
  state_set "${name}_page_count" "$page"
}

create_and_cancel_pagination_run() {
  local work_id run_request run_response second_task_id second_run_id cancel_response task_response run_read_response attempt
  work_id="$(state_get work_id)"
  run_request="$(json_request_file work-run-pagination --arg trigger_ref "$LABEL-pagination-run" '{trigger_kind:"manual",trigger_ref:$trigger_ref}')"
  run_response="$(request_json work-run-start-pagination POST "/api/v1/works/$work_id/runs" 202 "$run_request")"
  state_set pagination_work_run_id "$(jq -er '.work_run.id' "$run_response")"
  second_task_id="$(jq -er '.execution_receipt.source_refs.task_id' "$run_response")"
  state_set pagination_root_task_id "$second_task_id"
  cancel_response="$(request_json pagination-task-cancel POST "/api/v1/tasks/$second_task_id:cancel" '200,202')"
  second_run_id="$(jq -er '.run_id' "$cancel_response")"
  assert_jq "$cancel_response" ".task_id == \"$second_task_id\" and (.status == \"cancelled\" or .status == \"cancellation_requested\")" 'second WorkRun cancellation is accepted only through the public Task API'
  for attempt in $(seq 1 60); do
    task_response="$(request_json "pagination-task-poll-$attempt" GET "/api/v1/tasks/$second_task_id" 200)"
    run_read_response="$(request_json "pagination-run-poll-$attempt" GET "/api/v1/runs/$second_run_id" 200)"
    if jq -e '.status == "cancelled"' "$task_response" >/dev/null && jq -e '.status == "cancelled"' "$run_read_response" >/dev/null; then
      printf '%s\n' 'second WorkRun Task and technical Run reached cancelled' >>"$EVIDENCE_DIR/assertions-passed.txt"
      return 0
    fi
    sleep 2
  done
  printf 'Second WorkRun did not reach cancelled through the public Task API.\n' >&2
  return 1
}

collect_records_and_trace() {
  local work_id work_run_id root_task_id team_run_id response trace_file run_id cursor page events_response next last_sequence
  local tree_response members_response tasks_response messages_response run_response combined_events run_keys
  local primary_token foreign_response primary_page primary_cursor
  local max_event_pages=0 max_event_count=0 event_count
  local -A seen_event_cursors=()
  work_id="$(state_get work_id)"
  work_run_id="$(state_get work_run_id)"
  root_task_id="$(state_get root_task_id)"
  team_run_id="$(state_get team_run_id)"

  create_and_cancel_pagination_run

  walk_cursor_pages works /api/v1/works works
  assert_jq "$EVIDENCE_DIR/works-combined.json" \
    ". as \$items | [\"$work_id\",\"$(state_get sibling_work_id_1)\",\"$(state_get sibling_work_id_2)\"] as \$targets | all(\$targets[]; . as \$target | ([\$items[] | select(.id == \$target)] | length) == 1)" \
    'Work cursor walk returns every Lane V Work exactly once'
  walk_cursor_pages work-runs "/api/v1/works/$work_id/runs" work_runs
  assert_jq "$EVIDENCE_DIR/work-runs-combined.json" \
    ". as \$items | [\"$work_run_id\",\"$(state_get pagination_work_run_id)\"] as \$targets | all(\$targets[]; . as \$target | ([\$items[] | select(.id == \$target)] | length) == 1)" \
    'WorkRun cursor walk returns both distinct WorkRuns exactly once'
  if (( $(state_get work-runs_page_count) < 2 )); then
    printf 'WorkRun pagination was expected to cover at least two pages.\n' >&2
    return 1
  fi

  response="$(request_json work-run-read GET "/api/v1/works/$work_id/runs/$work_run_id" 200)"
  assert_jq "$response" ".capture_status == \"complete\" and .work.id == \"$work_id\" and .work_run.id == \"$work_run_id\"" 'exact WorkRun projection is readable'
  tree_response="$(request_json task-tree GET "/api/v1/tasks/$root_task_id/tree" 200)"
  assert_jq "$tree_response" ".root_task_id == \"$root_task_id\" and (.tasks | length == (unique_by(.task_id) | length))" 'Task tree has the expected root and unique Task IDs'
  members_response="$(request_json team-members GET "/api/v1/team-runs/$team_run_id/members" 200)"
  assert_jq "$members_response" "([.[].name] | sort) == ([\"lead\",\"reviewer\",\"worker\"] | sort) and all(.[]; .team_run_id == \"$team_run_id\")" 'Team members expose the exact roster for this TeamRun'
  tasks_response="$(request_json team-tasks GET "/api/v1/team-runs/$team_run_id/tasks" 200)"
  assert_jq "$tasks_response" "([.[].subject] | sort) == ([\"LANE_V_A\",\"LANE_V_B\",\"LANE_V_C\"] | sort) and all(.[]; .team_run_id == \"$team_run_id\" and .status == \"accepted\")" 'Team tasks expose A/B/C as accepted records'
  messages_response="$(request_json team-direct-messages GET "/api/v1/team-runs/$team_run_id/direct-messages" 200)"
  assert_jq "$messages_response" 'length == 1 and (map(select(.summary == "LANE_V_DIRECT_MESSAGE_MARKER" and (.status == "delivered" or .status == "read"))) | length == 1)' 'direct-message API exposes exactly one message, the unique marker'

  trace_file="$(request_json work-run-trace GET "/api/v1/works/$work_id/runs/$work_run_id/trace" 200)"
  cp "$trace_file" "$EVIDENCE_DIR/trace.json"
  assert_jq "$trace_file" ".capture_status == \"complete\" and .work.id == \"$work_id\" and .work_run.id == \"$work_run_id\"" 'trace is complete for the exact WorkRun'
  assert_jq "$trace_file" '([.edges[].kind] | unique | sort) == (["assignment","declared_dependency","feedback","observed_message"] | sort)' 'one trace contains all four typed edge kinds'
  assert_jq "$trace_file" 'all(.edges[]; (.kind == "observed_message" and .guarantee == "ordered_observation") or (.kind == "declared_dependency" and .guarantee == "declared_relation") or ((.kind == "assignment" or .kind == "feedback") and .guarantee == "derived_relation"))' 'edge guarantees match edge kinds'
  assert_jq "$trace_file" '([.edges[] | [.source_created_at,.source_refs.team_run_id,(.sequence // 0)]]) as $keys | $keys == ($keys | sort)' 'trace edges are globally ordered by the contract tuple'
  assert_jq "$trace_file" '([.events[] | [.created_at,.source_refs.run_id,.sequence]]) as $keys | $keys == ($keys | sort)' 'trace events are globally ordered by the contract tuple'
  assert_jq "$trace_file" '. as $trace | ($trace.work_items[] | select(.subject == "LANE_V_A")) as $a | ($trace.work_items[] | select(.subject == "LANE_V_B")) as $b | ($trace.work_items[] | select(.subject == "LANE_V_C")) as $c | ($c.dependency_ids | sort) == ([$a.id,$b.id] | sort) and ([.edges[] | select(.kind == "declared_dependency") | [.dependent_work_item_id,.prerequisite_work_item_id]] | sort) == ([[$c.id,$a.id],[$c.id,$b.id]] | sort)' 'declared dependencies are exactly C to A and C to B'
  assert_jq "$trace_file" '. as $trace | ($trace.work_items[] | select(.subject == "LANE_V_A")) as $a | ($a.attempts[] | select(.attempt_no == 2)) as $a2 | ($a.attempts | length) == 2 and $a2.feedback_capture_status == "redacted" and ([.edges[] | select(.kind == "feedback" and .work_item_id == $a.id and .attempt_id == $a2.id)] | length) == 1' 'feedback belongs exactly to A attempt 2 and is honestly redacted'
  assert_jq "$trace_file" '([.work_items[].attempts[].id] | sort) == ([.edges[] | select(.kind == "assignment") | .attempt_id] | sort)' 'assignment edges exactly cover every attempt'
  assert_jq "$trace_file" '[.edges[] | if .kind == "observed_message" then [.kind,.source_refs.team_message_id] elif .kind == "declared_dependency" then [.kind,.dependent_work_item_id,.prerequisite_work_item_id] else [.kind,.attempt_id] end] as $keys | ($keys | length) == ($keys | unique | length)' 'typed edge source keys contain no duplicates'
  assert_jq "$trace_file" 'all(.runs[]; .status == "succeeded" or .status == "cancelled") and any(.runs[]; (.provider // "") != "" and (.model // "") != "") and all(.runs[]; if (.provider // "") != "" or (.model // "") != "" then (.provider // "") != "" and (.model // "") != "" and (((.provider + "/" + .model) | test("fake|mock|stub|scripted";"i")) | not) else true end)' 'trace contains only real terminal provider/model labels when populated'
  if ! jq -e -s '.[0] as $messages | .[1] as $trace | ($messages[] | select(.summary == "LANE_V_DIRECT_MESSAGE_MARKER")) as $marker | any($trace.edges[]; .kind == "observed_message" and .sequence == $marker.sequence and .source_created_at == $marker.created_at)' "$messages_response" "$trace_file" >/dev/null; then
    printf 'Direct marker could not be correlated to an observed_message trace edge.\n' >&2
    return 1
  fi
  printf '%s\n' 'direct marker correlates to observed_message by sequence and timestamp' >>"$EVIDENCE_DIR/assertions-passed.txt"

  jq -r '[.runs[].source_refs.run_id // empty] | unique[]' "$trace_file" >"$EVIDENCE_DIR/technical-run-ids.txt"
  printf '[]\n' >"$EVIDENCE_DIR/public-event-keys.json"
  while IFS= read -r run_id; do
    [[ -n "$run_id" ]] || continue
    run_response="$(request_json "technical-run-$run_id" GET "/api/v1/runs/$run_id" 200)"
    assert_jq "$run_response" '.status == "succeeded" or .status == "cancelled"' "technical Run $run_id is terminal"
    cursor=0
    page=0
    combined_events="$EVIDENCE_DIR/events-$run_id-combined.json"
    printf '[]\n' >"$combined_events"
    seen_event_cursors=()
    while :; do
      page="$((page + 1))"
      if ((page > 1000)); then
        printf 'Event pagination exceeded 1000 pages for run %s.\n' "$run_id" >&2
        return 1
      fi
      events_response="$(request_json "events-$run_id-page-$page" GET "/api/v1/runs/$run_id/events?after=$cursor" 200)"
      jq -e --arg run "$run_id" --argjson after "$cursor" 'all(.events[]; .run_id == $run and .sequence > $after) and (([.events[].sequence]) as $sequences | $sequences == ($sequences | sort) and ($sequences | length) == ($sequences | unique | length))' "$events_response" >/dev/null
      jq -s '.[0] + .[1].events' "$combined_events" "$events_response" >"$combined_events.tmp"
      mv "$combined_events.tmp" "$combined_events"
      next="$(jq -r '.next_cursor // empty' "$events_response")"
      [[ -n "$next" ]] || break
      last_sequence="$(jq -er '.events[-1].sequence' "$events_response")"
      if [[ "$next" != "$last_sequence" || -n "${seen_event_cursors[$next]:-}" ]]; then
        printf 'Invalid or repeated event cursor for run %s: next=%s last=%s\n' "$run_id" "$next" "$last_sequence" >&2
        return 1
      fi
      seen_event_cursors[$next]=1
      cursor="$next"
    done
    if ((page > max_event_pages)); then max_event_pages="$page"; fi
    event_count="$(jq -er 'length' "$combined_events")"
    if ((event_count > max_event_count)); then max_event_count="$event_count"; fi
    jq -e '([.[].sequence]) as $sequences | $sequences == ($sequences | sort) and ($sequences | length) == ($sequences | unique | length)' "$combined_events" >/dev/null
    run_keys="$EVIDENCE_DIR/events-$run_id-keys.json"
    jq --arg run "$run_id" '[.[] | [$run,.sequence]]' "$combined_events" >"$run_keys"
    jq -s '.[0] + .[1]' "$EVIDENCE_DIR/public-event-keys.json" "$run_keys" >"$EVIDENCE_DIR/public-event-keys.tmp"
    mv "$EVIDENCE_DIR/public-event-keys.tmp" "$EVIDENCE_DIR/public-event-keys.json"
  done <"$EVIDENCE_DIR/technical-run-ids.txt"
  jq '[.events[] | [.source_refs.run_id,.sequence]] | sort' "$trace_file" >"$EVIDENCE_DIR/trace-event-keys.json"
  jq 'sort' "$EVIDENCE_DIR/public-event-keys.json" >"$EVIDENCE_DIR/public-event-keys-sorted.json"
  if ! jq -e -s '.[0] == .[1]' "$EVIDENCE_DIR/public-event-keys-sorted.json" "$EVIDENCE_DIR/trace-event-keys.json" >/dev/null; then
    printf 'Public event pages do not exactly match trace event keys.\n' >&2
    return 1
  fi
  if ((max_event_count > 100)); then
    printf '{"events_cross_page_covered":true,"max_pages":%d,"max_events":%d}\n' "$max_event_pages" "$max_event_count" >"$EVIDENCE_DIR/pagination-coverage.json"
  else
    printf '{"events_cross_page_covered":false,"max_pages":%d,"max_events":%d,"reason":"no technical run exceeded 100 public events"}\n' "$max_event_pages" "$max_event_count" >"$EVIDENCE_DIR/pagination-coverage.json"
  fi
  if [[ -n "$FOREIGN_TOKEN" ]]; then
    if [[ "$FOREIGN_TOKEN" == "$TOKEN" ]]; then
      printf 'FOREIGN_TOKEN must differ from TOKEN.\n' >&2
      return 1
    fi
    if [[ "$FOREIGN_OWNER_ASSERTION" != 'different-tenant-or-workspace-confirmed' ]]; then
      printf 'FOREIGN_OWNER_ASSERTION=different-tenant-or-workspace-confirmed is required; a different token string alone does not prove a foreign Work owner.\n' >&2
      return 1
    fi
    primary_page="$(request_json owner-primary-page GET /api/v1/works?limit=1 200)"
    primary_cursor="$(jq -er '.next_cursor' "$primary_page")"
    primary_token="$TOKEN"
    TOKEN="$FOREIGN_TOKEN"
    foreign_response="$(request_json owner-foreign-works GET /api/v1/works?limit=100 200)"
    assert_jq "$foreign_response" ".works as \$items | all([\"$work_id\",\"$(state_get sibling_work_id_1)\",\"$(state_get sibling_work_id_2)\"][]; . as \$target | ([\$items[] | select(.id == \$target)] | length) == 0)" 'foreign owner cannot enumerate Lane V Works'
    foreign_response="$(request_json owner-foreign-primary-cursor GET "/api/v1/works?limit=1&cursor=$(jq -nr --arg value "$primary_cursor" '$value | @uri')" 400)"
    assert_jq "$foreign_response" '.error.code == "invalid_cursor" or .code == "invalid_cursor"' 'foreign owner cannot reuse the primary owner cursor'
    foreign_response="$(request_json owner-foreign-work-runs GET "/api/v1/works/$work_id/runs" 200)"
    assert_jq "$foreign_response" '.work_runs == []' 'foreign owner sees no WorkRuns for the primary Work'
    request_json owner-foreign-trace GET "/api/v1/works/$work_id/runs/$work_run_id/trace" 404 >/dev/null
    request_json owner-foreign-task GET "/api/v1/tasks/$root_task_id" 404 >/dev/null
    request_json owner-foreign-team-run GET "/api/v1/team-runs/$team_run_id" 404 >/dev/null
    TOKEN="$primary_token"
    printf '{"owner_scope":"pass","trace_narrative":"pending","overall":"pending"}\n' >"$EVIDENCE_DIR/human-gates.json"
  else
    printf '{"owner_scope":"pending","owner_scope_reason":"FOREIGN_TOKEN was not provisioned","trace_narrative":"pending","overall":"pending"}\n' >"$EVIDENCE_DIR/human-gates.json"
  fi
  NEEDS_HUMAN_REVIEW=true

  jq -n \
    --arg work_id "$work_id" \
    --arg work_run_id "$work_run_id" \
    --arg root_task_id "$root_task_id" \
    --arg team_run_id "$team_run_id" \
    '{work_id:$work_id,work_run_id:$work_run_id,root_task_id:$root_task_id,team_run_id:$team_run_id}' \
    >"$EVIDENCE_DIR/id-graph.json"
}

case "${1:-all}" in
  definitions)
    prepare_definitions
    ;;
  start)
    start_journey
    ;;
  poll)
    poll_terminal
    ;;
  collect)
    collect_records_and_trace
    ;;
  all)
    prepare_definitions
    start_journey
    poll_terminal
    collect_records_and_trace
    ;;
  *)
    printf 'Usage: %s [definitions|start|poll|collect|all]\n' "$0" >&2
    exit 2
    ;;
esac

if [[ "$NEEDS_HUMAN_REVIEW" == true ]]; then
  printf 'Lane V HTTP evidence captured but not signed: automated or human gates remain pending: %s\n' "$EVIDENCE_DIR" >&2
  exit 3
fi
printf 'Lane V HTTP phase evidence ready: %s\n' "$EVIDENCE_DIR"
