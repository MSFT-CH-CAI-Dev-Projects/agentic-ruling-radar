@description('Resource location.')
param location string
@description('Container app name.')
param name string
@description('Container Apps environment id.')
param environmentId string
@description('User-assigned managed identity id.')
param userAssignedIdentityId string
@description('Container registry login server.')
param acrLoginServer string
@description('Full container image ref.')
param image string
@description('Plain-text environment variables.')
param envVars array = []
@description('Optional tag for azd service-name binding.')
param azdServiceName string = ''
param tags object = {}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: union(tags, empty(azdServiceName) ? {} : { 'azd-service-name': azdServiceName })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${userAssignedIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [ { weight: 100, latestRevision: true } ]
      }
      registries: [
        { server: acrLoginServer, identity: userAssignedIdentityId }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: envVars
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 3 }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
output name string = app.name
