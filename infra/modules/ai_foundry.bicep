// Modern Microsoft Foundry: Microsoft.CognitiveServices/accounts with kind=AIServices
// + accounts/projects sub-resource. Explicitly NOT the legacy
// Microsoft.MachineLearningServices/workspaces (kind=Hub) form.

@description('Resource location. MUST be switzerlandnorth for this PoC unless explicitly overridden upstream.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Project sub-resource name.')
param projectName string = 'ruling-radar'
@description('Principal id granted Cognitive Services User + Azure AI Developer on this account.')
param userPrincipalId string
param tags object = {}

@description('Model deployments to create.')
param modelDeployments array = [
  { name: 'gpt-4.1',                model: 'gpt-4.1',                version: '2025-04-14', capacity: 50 }
  { name: 'gpt-4.1-mini',           model: 'gpt-4.1-mini',           version: '2025-04-14', capacity: 50 }
  { name: 'text-embedding-3-large', model: 'text-embedding-3-large', version: '1',          capacity: 50 }
]

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${namePrefix}-fndry'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: '${namePrefix}-fndry'
    allowProjectManagement: true
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: projectName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: 'Ruling Radar'
    description: 'Demo project for Ruling Radar — Swiss Federal Court ruling triage and summarization.'
  }
}

@batchSize(1)
resource deployments 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = [for d in modelDeployments: {
  parent: foundry
  dependsOn: [project]
  name: d.name
  sku: { name: 'GlobalStandard', capacity: d.capacity }
  properties: {
    model: { format: 'OpenAI', name: d.model, version: d.version }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}]

// Built-in role: Cognitive Services User
var csUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
// Built-in role: Azure AI Developer
var aiDevRoleId = '64702f94-c441-49e6-a78b-ef80e0188fee'
// Built-in role: Foundry User
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource roleCsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, userPrincipalId, csUserRoleId)
  scope: foundry
  properties: {
    principalId: userPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', csUserRoleId)
  }
}

resource roleAiDev 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, userPrincipalId, aiDevRoleId)
  scope: foundry
  properties: {
    principalId: userPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', aiDevRoleId)
  }
}

resource roleProjectFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, project.id, foundryUserRoleId)
  scope: foundry
  properties: {
    principalId: project.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
  }
}

output id string = foundry.id
output name string = foundry.name
output endpoint string = foundry.properties.endpoint
output projectName string = project.name
output projectPrincipalId string = project.identity.principalId
output projectEndpoint string = '${foundry.properties.endpoint}api/projects/${project.name}'
output deployedModels array = [for (d, i) in modelDeployments: { name: d.name, model: d.model }]
