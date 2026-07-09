@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Log Analytics workspace resource id.')
param workspaceId string
param tags object = {}

resource ai 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceId
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output connectionString string = ai.properties.ConnectionString
output instrumentationKey string = ai.properties.InstrumentationKey
