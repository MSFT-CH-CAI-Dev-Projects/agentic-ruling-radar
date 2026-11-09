@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Log Analytics customer (workspace) id.')
param logAnalyticsCustomerId string
@description('Log Analytics resource id (used to look up the shared key).')
param logAnalyticsResourceId string
@description('Optional subnet delegated to Microsoft.App/environments.')
param infrastructureSubnetId string = ''
param tags object = {}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: split(logAnalyticsResourceId, '/')[8]
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: empty(infrastructureSubnetId) ? null : {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    zoneRedundant: false
  }
}

output id string = env.id
output name string = env.name
output defaultDomain string = env.properties.defaultDomain
