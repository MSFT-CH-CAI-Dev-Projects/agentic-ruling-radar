#!/usr/bin/env bash
# Diagnostics for the Ruling Radar demo.
#
# Usage:
#   bash scripts/diag.sh             # run "all"
#   bash scripts/diag.sh web         # web dev server health + last logs
#   bash scripts/diag.sh typecheck   # pnpm tsc --noEmit
#   bash scripts/diag.sh agent       # Foundry hosted agent status + recent logs
#   bash scripts/diag.sh cosmos      # Cosmos containers + doc counts
#   bash scripts/diag.sh azure       # Resource group health + recent activity log
#   bash scripts/diag.sh appinsights # Recent App Insights exceptions/traces
#
# Designed to be invoked by the agent (Copilot CLI) instead of asking the
# user for error messages. Reads the existing `az` CLI session.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# All resource identifiers are read from the environment (e.g. from
# `azd env get-values`) with neutral fallbacks, so this script carries no
# hard-coded, environment-specific values.
WEB_LOG=/tmp/ruling-radar-web.log
RG="${AZURE_RESOURCE_GROUP:-rg-ruling-radar}"
COSMOS_ACCOUNT="${AZURE_COSMOS_ACCOUNT:-}"
COSMOS_DB="${AZURE_COSMOS_DB:-rulingradar}"
APP_INSIGHTS="${AZURE_APP_INSIGHTS:-}"
PROJECT_ENDPOINT="${FOUNDRY_PROJECT_ENDPOINT:-}"
AGENT_NAMES=(agent-triage agent-summary)

section() { printf "\n\033[1;34m── %s ──\033[0m\n" "$1"; }
ok()      { printf "\033[1;32m✓\033[0m %s\n" "$1"; }
warn()    { printf "\033[1;33m!\033[0m %s\n" "$1"; }
err()     { printf "\033[1;31m✗\033[0m %s\n" "$1"; }

diag_web() {
  section "Web dev server (localhost:3000)"
  if curl -fsS -o /dev/null -m 3 http://localhost:3000; then
    ok "responding"
  else
    err "not responding"
  fi
  if [[ -f $WEB_LOG ]]; then
    section "Last 60 lines of $WEB_LOG"
    tail -n 60 "$WEB_LOG"
  else
    warn "no $WEB_LOG — start dev via 'bash scripts/dev.sh'"
  fi
}

diag_typecheck() {
  section "TypeScript noEmit (apps/web)"
  ( cd "$REPO_ROOT/apps/web" && pnpm exec tsc --noEmit ) && ok "clean" || err "errors above"
}

diag_agent() {
  local token
  token=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv 2>/dev/null) || { err "az token failed"; return 1; }
  for AGENT_NAME in "${AGENT_NAMES[@]}"; do
    section "Foundry $AGENT_NAME status"
    curl -fsS -H "Authorization: Bearer $token" \
      "${PROJECT_ENDPOINT}/agents/${AGENT_NAME}?api-version=v1" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('versions',{}).get('latest',{}); print('name:',d.get('name'),' latest_version:',v.get('version'),' kind:',v.get('definition',{}).get('kind'),' image:',v.get('definition',{}).get('image','')[:80])" \
      || err "agent fetch failed"

    section "Active versions ($AGENT_NAME)"
    curl -fsS -H "Authorization: Bearer $token" \
      "${PROJECT_ENDPOINT}/agents/${AGENT_NAME}/versions?api-version=v1" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); [print(' v'+str(v.get('version')), v.get('status','?')) for v in d.get('data',[])]" \
      || warn "could not list versions"
  done

  section "Recent container logs (best-effort via session_logstream not in this script)"
  warn "for live container logs use the Foundry MCP session_logstream tool from the agent"
}

diag_cosmos() {
  section "Cosmos containers (account=$COSMOS_ACCOUNT db=$COSMOS_DB)"
  az cosmosdb sql container list \
    --account-name "$COSMOS_ACCOUNT" -g "$RG" -d "$COSMOS_DB" \
    --query "[].{name:name, pk:partitionKey.paths}" -o table 2>&1 | sed 's/^/  /'

  section "Doc counts (via web BFF — requires 'bash scripts/dev.sh start')"
  if ! curl -fsS -o /dev/null -m 2 http://localhost:3000; then
    warn "web not up. Skipping doc counts."
    return 0
  fi
  local runs drafts triage
  runs=$(curl -fsS http://localhost:3000/api/rulings/history 2>/dev/null   | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('runs',[])))"     2>/dev/null || echo "?")
  drafts=$(curl -fsS http://localhost:3000/api/drafts 2>/dev/null         | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('drafts',[])))"   2>/dev/null || echo "?")
  triage=$(curl -fsS http://localhost:3000/api/triage 2>/dev/null         | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('decisions',[])))" 2>/dev/null || echo "?")
  printf "  %-20s %s\n" "batch_runs"        "$runs"
  printf "  %-20s %s\n" "rulings (drafts)"  "$drafts"
  printf "  %-20s %s\n" "triage_decisions"  "$triage"
}

diag_azure() {
  section "Resource group $RG"
  az resource list -g "$RG" --query "[].{name:name, type:type, location:location}" -o table 2>&1 | head -25 | sed 's/^/  /'

  section "Last 10 activity-log events (errors only, last 6h)"
  az monitor activity-log list -g "$RG" \
    --offset 6h --max-events 50 \
    --query "[?status.value=='Failed'].{time:eventTimestamp, op:operationName.localizedValue, status:status.value, msg:properties.statusMessage}" \
    -o table 2>&1 | head -15 | sed 's/^/  /'
}

diag_appinsights() {
  section "App Insights ($APP_INSIGHTS) — recent exceptions (last 1h)"
  local appid
  appid=$(az monitor app-insights component show --app "$APP_INSIGHTS" -g "$RG" --query appId -o tsv 2>/dev/null)
  if [[ -z $appid ]]; then
    err "could not resolve App Insights appId"
    return 1
  fi
  az monitor app-insights query --app "$appid" \
    --analytics-query "exceptions | where timestamp > ago(1h) | project timestamp, type, outerMessage, operation_Name | top 20 by timestamp desc" \
    -o table 2>&1 | head -25 | sed 's/^/  /'

  section "App Insights — recent traces (severityLevel >= 2, last 1h)"
  az monitor app-insights query --app "$appid" \
    --analytics-query "traces | where timestamp > ago(1h) and severityLevel >= 2 | project timestamp, severityLevel, message, operation_Name | top 20 by timestamp desc" \
    -o table 2>&1 | head -25 | sed 's/^/  /'
}

case "${1:-all}" in
  web)         diag_web ;;
  typecheck)   diag_typecheck ;;
  agent)       diag_agent ;;
  cosmos)      diag_cosmos ;;
  azure)       diag_azure ;;
  appinsights) diag_appinsights ;;
  all)
    diag_web
    diag_typecheck
    diag_agent
    diag_cosmos
    diag_azure
    diag_appinsights
    ;;
  *)
    echo "unknown subcommand: $1" >&2
    echo "usage: bash scripts/diag.sh [web|typecheck|agent|cosmos|azure|appinsights|all]" >&2
    exit 2
    ;;
esac
