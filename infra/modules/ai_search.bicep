@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Principal id granted Search Service + Index Data Contributor.')
param dataContributorPrincipalId string
param tags object = {}

var searchName = toLower(replace('${namePrefix}-search', '_', '-'))

resource search 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: searchName
  location: location
  tags: tags
  sku: { name: 'basic' }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    semanticSearch: 'free'
    authOptions: { aadOrApiKey: { aadAuthFailureMode: 'http401WithBearerChallenge' } }
    publicNetworkAccess: 'enabled'
    disableLocalAuth: false
  }
}

// Built-in role: Search Index Data Contributor
var indexDataContribRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
// Built-in role: Search Service Contributor
var serviceContribRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'

resource roleIdx 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, dataContributorPrincipalId, indexDataContribRoleId)
  scope: search
  properties: {
    principalId: dataContributorPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataContribRoleId)
  }
}

resource roleSvc 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, dataContributorPrincipalId, serviceContribRoleId)
  scope: search
  properties: {
    principalId: dataContributorPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceContribRoleId)
  }
}

output id string = search.id
output name string = search.name
output endpoint string = 'https://${search.name}.search.windows.net'
