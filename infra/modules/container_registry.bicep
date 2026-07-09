@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Managed identity principal id granted AcrPull.')
param pullPrincipalId string
param tags object = {}

var acrName = take(toLower(replace('${namePrefix}acr', '-', '')), 50)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// Built-in role: AcrPull
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, pullPrincipalId, acrPullRoleId)
  scope: acr
  properties: {
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output id string = acr.id
output name string = acr.name
output loginServer string = acr.properties.loginServer
