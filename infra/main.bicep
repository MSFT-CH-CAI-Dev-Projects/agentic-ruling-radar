// ─── Case 1 (Bundesgerichtsurteile) infrastructure ──────────────────────────
//
// This Bicep provisions the Azure footprint for the Case 1 refactor (branch
// `002-case1-refined`). It is the *minimum* set of resources required by
// `specs/002-case1-refined/ARCHITECTURE.md` §2 to run the hosted-agent
// pipeline end-to-end:
//
//   - Microsoft Foundry account + project + model deployments
//     (gpt-4.1, gpt-4.1-mini, text-embedding-3-large)
//   - Cosmos DB           (batch_runs, candidates, triage_decisions, rulings)
//   - Blob Storage        (rulings raw cache, draft .docx cache)
//   - AI Search           (Basic tier — indexes created post-provision)
//   - Key Vault           (Graph client secret, seeded later)
//   - Azure Container Registry  (Foundry pulls the agent image from here)
//   - Container Apps env  (only used when deployWebApp=true)
//   - Log Analytics + App Insights (OTel sink)
//   - User-Assigned Managed Identity + role assignments
//
// Removed vs. v1 (parked under `_parked/` and `apps/api/`):
//   - Document Intelligence  (Case 2 PDF parsing)
//   - The `apps/api` Container App   (no FastAPI middle tier in the new
//     architecture — the UI talks AG-UI directly to the Foundry hosted agent)
//   - Cosmos `insured_persons` / `claims` containers   (Case 2 data model)
//   - Storage `dossiers` / `parsed` containers          (Case 2)
//
// What is NOT in this Bicep (provisioned separately):
//   - The Foundry hosted agent itself — created via `foundry` CLI / MCP
//     `agent_create` after the agent image is pushed to ACR (Phase 1b).
//   - Foundry "Connections" (Search / Cosmos / Blob / App Insights) — added
//     via the Foundry portal or SDK on first run.
//   - Graph app registration (Sites.Selected) — manual one-shot per tenant.

targetScope = 'subscription'

@description('Azure region for all resources. Must be switzerlandnorth unless allowNonSwissRegion=true.')
param location string = 'switzerlandnorth'

@description('Azure region for the Microsoft Foundry account and model deployments. Must be switzerlandnorth unless allowNonSwissRegion=true.')
param foundryLocation string = 'switzerlandnorth'

@description('If false, fail fast unless location AND foundryLocation are switzerlandnorth.')
param allowNonSwissRegion bool = false

@description('Environment name (azd-supplied).')
param environmentName string

var namePrefix = take(toLower(replace(environmentName, '_', '-')), 12)
var resourceGroupName = 'rg-${environmentName}'

@description('Tags applied to every resource.')
param tags object = {
  'azd-env-name': environmentName
  project: 'ruling-radar'
  'data-class': 'synthetic'
  'case': 'case-1'
}

@description('Whether to deploy the Next.js Container App. Default false: run the UI locally during Phase 1a/1b. Flip to true once the SharePoint flow is wired (Phase 4).')
param deployWebApp bool = false

@description('Connect the web to Cosmos through a VNet/private endpoint; keep Cosmos public access and local keys disabled.')
param cosmosPrivateEndpoint bool = false

@description('Web image used during provisioning. Defaults to the initial placeholder.')
param webContainerImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@description('Optional CIDR allowed to access the web ingress. Empty preserves unrestricted access.')
param webAllowedIp string = ''

@description('Microsoft Graph application (client) id for SharePoint upload. Leave empty for Phase 1a/b; required from Phase 2 onwards (single-ruling SharePoint draft).')
param graphAppClientId string = ''

@description('Microsoft Graph application client secret. Stored only in Key Vault, optional at provision time; can be added later via `az keyvault secret set` or by re-running `azd provision` with the env var set.')
@secure()
param graphAppClientSecret string = ''

@description('SharePoint site URL where Case 1 drafts are uploaded. Leave empty until Phase 2.')
param sharepointSiteUrl string = ''

@description('SharePoint drive id of the target document library. Leave empty until Phase 2.')
param sharepointDriveId string = ''

// ─── Guards ──────────────────────────────────────────────────────────────────

var swissOk = location == 'switzerlandnorth' && foundryLocation == 'switzerlandnorth'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// Hard guard: fail fast on any non-Swiss region unless explicitly overridden.
module regionGuard 'modules/region_guard.bicep' = if (!swissOk && !allowNonSwissRegion) {
  name: 'region-guard-fail'
  scope: rg
  params: {
    location: location
    foundryLocation: foundryLocation
  }
}

// ─── Modules ─────────────────────────────────────────────────────────────────

module managedIdentity 'modules/managed_identity.bicep' = {
  name: 'mi'
  scope: rg
  params: { location: location, namePrefix: namePrefix, tags: tags }
}

module logAnalytics 'modules/log_analytics.bicep' = {
  name: 'law'
  scope: rg
  params: { location: location, namePrefix: namePrefix, tags: tags }
}

module appInsights 'modules/app_insights.bicep' = {
  name: 'ai'
  scope: rg
  params: { location: location, namePrefix: namePrefix, workspaceId: logAnalytics.outputs.workspaceId, tags: tags }
}

module containerRegistry 'modules/container_registry.bicep' = {
  name: 'acr'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    pullPrincipalId: managedIdentity.outputs.principalId
    projectPullPrincipalId: foundry.outputs.projectPrincipalId
    tags: tags
  }
}

module keyVault 'modules/key_vault.bicep' = {
  name: 'kv'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    secretsUserPrincipalId: managedIdentity.outputs.principalId
    privateAccess: cosmosPrivateEndpoint
    graphAppClientSecret: graphAppClientSecret
    tags: tags
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    dataContributorPrincipalId: managedIdentity.outputs.principalId
    privateAccess: cosmosPrivateEndpoint
    tags: tags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    dataContributorPrincipalId: managedIdentity.outputs.principalId
    privateAccess: cosmosPrivateEndpoint
    tags: tags
  }
}

module aiSearch 'modules/ai_search.bicep' = {
  name: 'search'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    dataContributorPrincipalId: managedIdentity.outputs.principalId
    tags: tags
  }
}

module foundry 'modules/ai_foundry.bicep' = {
  name: 'foundry'
  scope: rg
  params: {
    location: foundryLocation
    namePrefix: namePrefix
    userPrincipalId: managedIdentity.outputs.principalId
    tags: tags
  }
}

module privateNetwork 'modules/private_network.bicep' = if (deployWebApp && cosmosPrivateEndpoint) {
  name: 'private-network'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    cosmosAccountId: cosmos.outputs.id
    tags: tags
  }
}

module containerAppsEnv 'modules/container_apps_env.bicep' = if (deployWebApp) {
  name: 'cae'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    logAnalyticsCustomerId: logAnalytics.outputs.customerId
    logAnalyticsResourceId: logAnalytics.outputs.workspaceId
    infrastructureSubnetId: cosmosPrivateEndpoint ? privateNetwork.outputs.appSubnetId : ''
    tags: tags
  }
}

module webApp 'modules/container_app_web.bicep' = if (deployWebApp) {
  name: 'web-app'
  scope: rg
  params: {
    location: location
    name: '${namePrefix}-web'
    environmentId: containerAppsEnv.outputs.id
    userAssignedIdentityId: managedIdentity.outputs.id
    acrLoginServer: containerRegistry.outputs.loginServer
    image: webContainerImage
    allowedIp: webAllowedIp
    azdServiceName: 'web'
    tags: tags
    envVars: [
      // BFF (apps/web/app/api/rulings/route.ts) talks to the Foundry hosted
      // agent via the invocations protocol. The agent endpoint requires the
      // `services.ai.azure.com` host form, while `foundry.outputs.endpoint`
      // exposes the `cognitiveservices.azure.com` form — rewrite here so
      // operators don't have to remember it locally.
      { name: 'FOUNDRY_PROJECT_ENDPOINT', value: replace(foundry.outputs.projectEndpoint, '.cognitiveservices.azure.com', '.services.ai.azure.com') }
      // Two hosted agents: agent-triage (batch screener) + agent-summary
      // (per-ruling bilingual summary). The BFF orchestrates Phase A
      // (triage) → Phase B (fan-out summarize). See ARCHITECTURE.md.
      { name: 'FOUNDRY_TRIAGE_AGENT_NAME', value: 'agent-triage' }
      { name: 'FOUNDRY_SUMMARY_AGENT_NAME', value: 'agent-summary' }
      { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.outputs.endpoint }
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.outputs.connectionString }
      // Hint @azure/identity to use the UAMI's client id when running inside
      // the Container App (DefaultAzureCredential chain picks up ManagedIdentity).
      { name: 'AZURE_CLIENT_ID', value: managedIdentity.outputs.clientId }
    ]
  }
}

// ─── Outputs (consumed by azd + postprovision hook) ──────────────────────────

output AZURE_LOCATION string = location
output AZURE_FOUNDRY_LOCATION string = foundryLocation
output AZURE_RESOURCE_GROUP string = rg.name

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.outputs.name
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = deployWebApp ? containerAppsEnv.outputs.id : ''
output AZURE_CONTAINER_APP_WEB_NAME string = deployWebApp ? webApp.outputs.name : ''
output WEB_URL string = deployWebApp ? webApp.outputs.url : ''

output AZURE_FOUNDRY_ENDPOINT string = foundry.outputs.endpoint
output AZURE_FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output AZURE_FOUNDRY_NAME string = foundry.outputs.name
output AZURE_FOUNDRY_PROJECT_NAME string = foundry.outputs.projectName

// Foundry SDK / azure-identity friendly aliases (these match the env var
// names the agent package and Azure-OpenAI clients look for by default).
output AZURE_OPENAI_ENDPOINT string = foundry.outputs.endpoint
output AZURE_OPENAI_CHAT_DEPLOYMENT_NAME string = 'gpt-4.1-mini'
output AZURE_OPENAI_API_VERSION string = 'preview'

output AZURE_COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output AZURE_COSMOS_DATABASE string = cosmos.outputs.databaseName
output AZURE_COSMOS_ACCOUNT string = cosmos.outputs.accountName

output AZURE_STORAGE_ENDPOINT string = storage.outputs.primaryEndpoint
output AZURE_STORAGE_ACCOUNT string = storage.outputs.accountName

output AZURE_SEARCH_ENDPOINT string = aiSearch.outputs.endpoint
output AZURE_SEARCH_NAME string = aiSearch.outputs.name

output AZURE_KEY_VAULT_URI string = keyVault.outputs.uri
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name

output AZURE_APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.outputs.connectionString

output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = managedIdentity.outputs.clientId
output AZURE_USER_ASSIGNED_IDENTITY_ID string = managedIdentity.outputs.id

// SharePoint / Graph values pass through unchanged — empty until Phase 2.
output SHAREPOINT_SITE_URL string = sharepointSiteUrl
output SHAREPOINT_DRIVE_ID string = sharepointDriveId
output GRAPH_APP_CLIENT_ID string = graphAppClientId
output GRAPH_TENANT_ID string = subscription().tenantId
