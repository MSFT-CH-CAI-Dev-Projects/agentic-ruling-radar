@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Principal id granted Cosmos DB Built-in Data Contributor.')
param dataContributorPrincipalId string
param tags object = {}

var accountName = toLower(replace('${namePrefix}-cosmos', '_', '-'))
var databaseName = 'rulingradar'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [ { locationName: location, failoverPriority: 0, isZoneRedundant: false } ]
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

// Case 1 container set (see specs/002-case1-refined/ARCHITECTURE.md §4).
// Each container is written by the `persist` tool inside the hosted agent.
var case1Containers = [
  { name: 'batch_runs',        partitionKey: '/run_id' }
  { name: 'candidates',        partitionKey: '/run_id' }
  { name: 'triage_decisions',  partitionKey: '/docket' }
  { name: 'rulings',           partitionKey: '/docket' }
]

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in case1Containers: {
  parent: db
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: { paths: [ c.partitionKey ], kind: 'Hash' }
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
  }
}]

// Built-in role: Cosmos DB Built-in Data Contributor (data-plane)
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource sqlRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, dataContributorPrincipalId, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: dataContributorPrincipalId
    scope: cosmos.id
  }
}

output id string = cosmos.id
output accountName string = cosmos.name
output endpoint string = cosmos.properties.documentEndpoint
output databaseName string = databaseName
