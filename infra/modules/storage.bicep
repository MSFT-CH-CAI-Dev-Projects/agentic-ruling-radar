@description('Resource location.')
param location string
@description('Common resource name prefix.')
param namePrefix string
@description('Principal id granted Storage Blob Data Contributor.')
param dataContributorPrincipalId string
@description('Keep backing storage private and disable shared keys in private web deployments.')
param privateAccess bool = false
param tags object = {}

var storageName = take(toLower(replace('${namePrefix}stor', '-', '')), 24)

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: !privateAccess
    publicNetworkAccess: privateAccess ? 'Disabled' : 'Enabled'
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: sa
  name: 'default'
}

// Case 1 only: raw ruling HTML cache + draft .docx cache before SharePoint upload.
// Case 2 containers (dossiers, parsed) intentionally omitted — parked.
var containerNames = [ 'rulings', 'drafts' ]

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for n in containerNames: {
  parent: blobSvc
  name: n
  properties: { publicAccess: 'None' }
}]

// Built-in role: Storage Blob Data Contributor
var blobDataContribRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sa.id, dataContributorPrincipalId, blobDataContribRoleId)
  scope: sa
  properties: {
    principalId: dataContributorPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContribRoleId)
  }
}

output id string = sa.id
output accountName string = sa.name
output primaryEndpoint string = sa.properties.primaryEndpoints.blob
