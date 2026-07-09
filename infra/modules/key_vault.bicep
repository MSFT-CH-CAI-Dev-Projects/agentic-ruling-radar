@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Tenant ID used by the vault.')
param tenantId string = subscription().tenantId
@description('Principal id (managed identity) that should be granted Key Vault Secrets User.')
param secretsUserPrincipalId string
@description('Optional Graph application client secret to seed at provision time. Leave empty to skip; postprovision.sh writes it if GRAPH_APP_CLIENT_SECRET is set in the azd env.')
@secure()
param graphAppClientSecret string = ''
param tags object = {}

var hasGraphSecret = !empty(graphAppClientSecret)

var vaultName = take(replace('${namePrefix}-kv', '-', ''), 24)

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
  }
}

// Built-in role: Key Vault Secrets User
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, secretsUserPrincipalId, kvSecretsUserRoleId)
  scope: kv
  properties: {
    principalId: secretsUserPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

resource graphSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (hasGraphSecret) {
  parent: kv
  name: 'graph-app-client-secret'
  properties: {
    value: graphAppClientSecret
    attributes: { enabled: true }
  }
}

output id string = kv.id
output name string = kv.name
output uri string = kv.properties.vaultUri
// Empty string when no secret was seeded at provision time. Consumers must
// fetch the secret URI dynamically (e.g. via az keyvault secret show) when
// the secret is added post-provision by the hooks/postprovision.sh script.
output graphSecretUri string = hasGraphSecret ? graphSecret.properties.secretUri : ''
