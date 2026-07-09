#!/usr/bin/env bash
# azd predown hook — purge soft-deleted Key Vault so the next `azd up`
# can recreate it with the same name.
set -euo pipefail

if [[ -n "${AZURE_KEY_VAULT_NAME:-}" ]]; then
  echo "▶ azd predown: scheduling Key Vault purge for ${AZURE_KEY_VAULT_NAME}"
  az keyvault delete --name "$AZURE_KEY_VAULT_NAME" --only-show-errors 2>/dev/null || true
  az keyvault purge --name "$AZURE_KEY_VAULT_NAME" --only-show-errors 2>/dev/null || true
fi
echo "✓ predown complete."
