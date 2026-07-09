@description('Primary deployment region (must be switzerlandnorth unless override).')
param location string

@description('Foundry region (must be switzerlandnorth unless override).')
param foundryLocation string

resource fail 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'region-guard-fail'
  location: location
  kind: 'AzureCLI'
  identity: { type: 'None' }
  properties: {
    azCliVersion: '2.60.0'
    scriptContent: 'echo "ERROR: location and foundryLocation must both be switzerlandnorth (got ${location} / ${foundryLocation}). Set allowNonSwissRegion=true to override." ; exit 1'
    retentionInterval: 'PT1H'
    cleanupPreference: 'OnSuccess'
  }
}
