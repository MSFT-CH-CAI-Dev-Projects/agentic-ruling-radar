@description('Resource location.')
param location string

@description('Common resource name prefix.')
param namePrefix string

@description('Common resource tags.')
param tags object = {}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

output workspaceId string = law.id
output customerId string = law.properties.customerId
