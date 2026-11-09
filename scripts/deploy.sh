#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: bash scripts/deploy.sh <azd-environment>" >&2
  exit 1
fi
ENVIRONMENT="$1"

for tool in az azd jq; do
  if ! command -v "$tool" >/dev/null; then
    echo "Required tool not found: $tool" >&2
    exit 1
  fi
done

env_value() {
  local value
  value="$(azd env get-value "$1" --environment "$ENVIRONMENT" --no-prompt)"
  if [[ -z "$value" ]]; then
    echo "Missing azd environment value: $1" >&2
    return 1
  fi
  printf '%s' "$value"
}

SUBSCRIPTION="$(env_value AZURE_SUBSCRIPTION_ID)"
DEPLOY_WEB="$(env_value DEPLOY_WEB_APP)"
if [[ "$DEPLOY_WEB" != true && "$DEPLOY_WEB" != false ]]; then
  echo "DEPLOY_WEB_APP must be true or false." >&2
  exit 1
fi
PAYLOAD="$(mktemp)"
VERSION_STATE="$(mktemp)"
WEB_DISABLED=false
cleanup() {
  local status=$?
  if [[ "$WEB_DISABLED" == true ]]; then
    if ! azd env set DEPLOY_WEB_APP true --environment "$ENVIRONMENT"; then
      echo "Failed to restore DEPLOY_WEB_APP=true after staged provisioning." >&2
      status=1
    fi
  fi
  rm -f -- "$PAYLOAD" "$VERSION_STATE"
  return "$status"
}
trap cleanup EXIT

az_cli() {
  az "$@" --subscription "$SUBSCRIPTION"
}

az_cli account show --query '{name:name,id:id,tenantId:tenantId}' -o json
if [[ "$DEPLOY_WEB" == true ]]; then
  # Build the real port-3000 web image before creating its Container App.
  azd env set DEPLOY_WEB_APP false --environment "$ENVIRONMENT"
  WEB_DISABLED=true
fi
azd provision --environment "$ENVIRONMENT" --no-prompt

RG="$(env_value AZURE_RESOURCE_GROUP)"
REGISTRY="$(env_value AZURE_CONTAINER_REGISTRY_NAME)"
LOGIN_SERVER="$(env_value AZURE_CONTAINER_REGISTRY_ENDPOINT)"
FOUNDRY="$(env_value AZURE_FOUNDRY_NAME)"
PROJECT_NAME="$(env_value AZURE_FOUNDRY_PROJECT_NAME)"
OPENAI_ENDPOINT="$(env_value AZURE_OPENAI_ENDPOINT)"
MODEL="$(env_value AZURE_OPENAI_CHAT_DEPLOYMENT_NAME)"
API_VERSION="$(env_value AZURE_OPENAI_API_VERSION)"
PROJECT_ENDPOINT="$(env_value AZURE_FOUNDRY_PROJECT_ENDPOINT)"
PROJECT_ENDPOINT="${PROJECT_ENDPOINT/.cognitiveservices.azure.com/.services.ai.azure.com}"
PROJECT_ENDPOINT="${PROJECT_ENDPOINT%/}"
ACCOUNT_SCOPE="/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$FOUNDRY"
PROJECT_SCOPE="$ACCOUNT_SCOPE/projects/$PROJECT_NAME"
TAG="deploy-$(date -u +%Y%m%d%H%M%S)"

agent_rest() {
  az_cli rest --resource https://ai.azure.com \
    --headers 'Foundry-Features=HostedAgents=V1Preview' 'Content-Type=application/json' \
    "$@" -o json
}

for agent in agent-triage agent-summary; do
  echo "Building $agent..."
  (
    cd "$ROOT/apps/$agent"
    az_cli acr build --resource-group "$RG" --registry "$REGISTRY" \
      --image "$agent:$TAG" --file Dockerfile .
  )
  digest="$(az_cli acr repository show --name "$REGISTRY" \
    --image "$agent:$TAG" --query digest -o tsv)"
  if [[ "$digest" != sha256:* ]]; then
    echo "Invalid image digest returned for $agent: $digest" >&2
    exit 1
  fi

  jq -n --arg image "$LOGIN_SERVER/$agent@$digest" \
    --arg endpoint "$OPENAI_ENDPOINT" --arg model "$MODEL" --arg api "$API_VERSION" \
    '{definition: {kind: "hosted", image: $image,
      container_protocol_versions: [{protocol: "invocations", version: "1.0.0"}],
      cpu: "0.5", memory: "1Gi",
      environment_variables: {AZURE_OPENAI_ENDPOINT: $endpoint,
        AZURE_OPENAI_CHAT_DEPLOYMENT_NAME: $model, AZURE_OPENAI_API_VERSION: $api}}}' \
    > "$PAYLOAD"
  agent_rest --method post \
    --url "$PROJECT_ENDPOINT/agents/$agent/versions?api-version=v1" \
    --body "@$PAYLOAD" > "$VERSION_STATE"
  version="$(jq -er '.version | select(. != null) | tostring' "$VERSION_STATE")"

  ready=false
  for ((attempt = 0; attempt < 60; attempt++)); do
    agent_rest --method get \
      --url "$PROJECT_ENDPOINT/agents/$agent/versions/$version?api-version=v1" \
      > "$VERSION_STATE"
    status="$(jq -er '.status' "$VERSION_STATE")"
    case "$status" in
      active)
        ready=true
        break
        ;;
      creating|starting|updating|provisioning)
        echo "Waiting for $agent v$version: $status"
        sleep 10
        ;;
      *)
        echo "Agent deployment did not become active: $agent v$version" >&2
        jq '{status, error}' "$VERSION_STATE" >&2
        exit 1
        ;;
    esac
  done
  if [[ "$ready" != true ]]; then
    echo "Timed out waiting for $agent v$version after 10 minutes." >&2
    exit 1
  fi

  principal="$(jq -er '.instance_identity.principal_id |
    select(type == "string" and length > 0)' "$VERSION_STATE")"
  for role in "Cognitive Services OpenAI User" "Cognitive Services User"; do
    az_cli role assignment create --assignee-object-id "$principal" \
      --assignee-principal-type ServicePrincipal --role "$role" \
      --scope "$ACCOUNT_SCOPE" --only-show-errors -o none
  done
  az_cli role assignment create --assignee-object-id "$principal" \
    --assignee-principal-type ServicePrincipal --role "Foundry User" \
    --scope "$PROJECT_SCOPE" --only-show-errors -o none
  echo "$agent v$version is active; runtime permissions assigned."
done

echo "Waiting 60 seconds for runtime RBAC propagation..."
sleep 60

if [[ "$DEPLOY_WEB" == true ]]; then
  (
    cd "$ROOT/apps/web"
    az_cli acr build --resource-group "$RG" --registry "$REGISTRY" \
      --image "web:$TAG" --file Dockerfile .
  )
  web_digest="$(az_cli acr repository show --name "$REGISTRY" \
    --image "web:$TAG" --query digest -o tsv)"
  if [[ "$web_digest" != sha256:* ]]; then
    echo "Invalid web image digest: $web_digest" >&2
    exit 1
  fi
  web_image="$LOGIN_SERVER/web@$web_digest"
  azd env set WEB_CONTAINER_IMAGE "$web_image" --environment "$ENVIRONMENT"
  azd env set DEPLOY_WEB_APP true --environment "$ENVIRONMENT"
  WEB_DISABLED=false
  azd provision --environment "$ENVIRONMENT" --no-prompt
  azd deploy web --from-package "$web_image" --environment "$ENVIRONMENT" --no-prompt
else
  echo "Web deployment disabled (DEPLOY_WEB_APP is not true)."
fi

echo "Deployment completed. Verify model-backed invocations and web persistence before handing it to a customer."
