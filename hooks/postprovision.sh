#!/usr/bin/env bash
# azd postprovision hook — Case 1 (branch 002-case1-refined).
#
# Phase 1a/b responsibilities:
#   1. Optionally seed the Graph client secret into Key Vault.
#   2. Grant the *deployer* (current `az` user) data-plane access on
#      Cosmos / Blob / Search / Foundry so local dev + seeders work
#      without bouncing through the agent's managed identity.
#   3. Print the next-step commands.
#
# Removed vs. v1: apps/api seeders (insured_persons, claims, dossier
# index, AI-Search bootstrap) — Case 1 has no dossier data, and the new
# `ruling-summaries` + `house-style-exemplars` indexes are bootstrapped
# from inside the agent container (Phase 2+).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "▶ azd postprovision (Case 1) — granting data-plane RBAC to deployer …"

: "${AZURE_RESOURCE_GROUP:?missing AZURE_RESOURCE_GROUP — re-run azd provision}"

# 1. Push GRAPH_APP_CLIENT_SECRET → Key Vault (only if explicitly opted in).
#    Phase 1a/b doesn't need this; skip unless WRITE_GRAPH_SECRET=1 is set
#    so the leftover v1 secret in azd env doesn't trip the hook.
if [[ "${WRITE_GRAPH_SECRET:-0}" == "1" && -n "${GRAPH_APP_CLIENT_SECRET:-}" ]]; then
  # AZURE_KEY_VAULT_URI looks like https://<name>.vault.azure.net/
  # Strip scheme + trailing slash + domain to get the bare vault name.
  KV_HOST="${AZURE_KEY_VAULT_URI#https://}"
  KV_HOST="${KV_HOST%%/*}"
  KV_NAME="${KV_HOST%%.*}"
  if [[ -n "$KV_NAME" ]]; then
    echo "  · Writing graph-app-client-secret to KV $KV_NAME"
    az keyvault secret set \
      --vault-name "$KV_NAME" \
      --name graph-app-client-secret \
      --value "$GRAPH_APP_CLIENT_SECRET" \
      --only-show-errors >/dev/null
  fi
fi

# 2. Grant data-plane roles to the deployer.
DEPLOYER_OID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RG="${AZURE_RESOURCE_GROUP}"

if [[ -n "$DEPLOYER_OID" ]]; then
  STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
  if [[ -n "$STORAGE_ACCOUNT" ]]; then
    SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT"
    echo "  · Storage Blob Data Contributor → deployer on $STORAGE_ACCOUNT"
    az role assignment create \
      --assignee-object-id "$DEPLOYER_OID" \
      --assignee-principal-type User \
      --role "Storage Blob Data Contributor" \
      --scope "$SCOPE" \
      --only-show-errors >/dev/null 2>&1 || true
  fi

  COSMOS_ACCOUNT="${AZURE_COSMOS_ACCOUNT:-$(az cosmosdb list -g "$RG" --query "[0].name" -o tsv 2>/dev/null || true)}"
  if [[ -n "$COSMOS_ACCOUNT" ]]; then
    SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.DocumentDB/databaseAccounts/$COSMOS_ACCOUNT"
    echo "  · Cosmos DB Built-in Data Contributor → deployer on $COSMOS_ACCOUNT"
    az cosmosdb sql role assignment create \
      --account-name "$COSMOS_ACCOUNT" \
      --resource-group "$RG" \
      --role-definition-id "00000000-0000-0000-0000-000000000002" \
      --principal-id "$DEPLOYER_OID" \
      --scope "$SCOPE" \
      --only-show-errors >/dev/null 2>&1 || true
  fi

  SEARCH_NAME="${AZURE_SEARCH_NAME:-}"
  if [[ -n "$SEARCH_NAME" ]]; then
    SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.Search/searchServices/$SEARCH_NAME"
    echo "  · Search Index Data Contributor → deployer on $SEARCH_NAME"
    az role assignment create \
      --assignee-object-id "$DEPLOYER_OID" \
      --assignee-principal-type User \
      --role "Search Index Data Contributor" \
      --scope "$SCOPE" \
      --only-show-errors >/dev/null 2>&1 || true
  fi

  FOUNDRY_NAME="${AZURE_FOUNDRY_NAME:-}"
  if [[ -n "$FOUNDRY_NAME" ]]; then
    SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$FOUNDRY_NAME"
    echo "  · Cognitive Services User + Azure AI Developer → deployer on $FOUNDRY_NAME"
    az role assignment create \
      --assignee-object-id "$DEPLOYER_OID" \
      --assignee-principal-type User \
      --role "Cognitive Services User" \
      --scope "$SCOPE" \
      --only-show-errors >/dev/null 2>&1 || true
    az role assignment create \
      --assignee-object-id "$DEPLOYER_OID" \
      --assignee-principal-type User \
      --role "Azure AI Developer" \
      --scope "$SCOPE" \
      --only-show-errors >/dev/null 2>&1 || true
  fi

  echo "  · Waiting 20s for RBAC propagation …"
  sleep 20
fi

# 3. Next steps.
echo ""
echo "✓ Provision complete."
echo ""
echo "  Next:"
echo "    eval \"\$(azd env get-values)\""
echo "    # write .env into both agent packages (same vars):"
echo "    for d in apps/agent-triage apps/agent-summary; do"
echo "      cat > \$d/.env <<EOF"
echo "    AZURE_OPENAI_ENDPOINT=\$AZURE_OPENAI_ENDPOINT"
echo "    AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=\$AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"
echo "    AZURE_OPENAI_API_VERSION=\$AZURE_OPENAI_API_VERSION"
echo "    EOF"
echo "    done"
echo ""
echo "    # Terminal A — triage agent (port 8000):"
echo "    cd apps/agent-triage && uv run python -m agent_triage.dev"
echo ""
echo "    # Terminal B — summary agent (port 8001 to avoid clash):"
echo "    cd apps/agent-summary && AGENT_SUMMARY_PORT=8001 uv run python -m agent_summary.dev"
echo ""
echo "    # Terminal C — web UI:"
echo "    cd apps/web && pnpm dev"
