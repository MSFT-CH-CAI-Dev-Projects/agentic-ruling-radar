# Ruling Radar

**Ruling Radar** is a demo that triages and summarizes Swiss Federal
Supreme Court rulings (*Bundesgerichtsurteile* from
[bger.ch](https://www.bger.ch)). It screens new rulings for relevance to
an accident/disability insurer and produces bilingual (German/French)
house-style draft summaries — orchestrated by a Next.js Backend-for-
Frontend (BFF) and two Microsoft Foundry hosted agents.

---

## ⚠️ Disclaimer — please read first

> **This is sample/demo code, provided for illustrative and educational
> purposes only.**
>
> - It is **not** an official Microsoft product or service.
> - It is provided **"AS IS", without warranty of any kind**, express or
>   implied (see [`LICENSE`](LICENSE)).
> - Microsoft and the authors make **no commitment** to maintain, update,
>   support, or fix this repository, and provide **no service-level
>   agreement (SLA)** of any kind.
> - It has **not** been hardened, security-reviewed, or validated for
>   production use. If you choose to run it in production, you do so
>   **entirely at your own risk** and are responsible for your own
>   security, compliance, data-protection, and operational review.
> - All example data is synthetic. No real personal data is included.
>
> See [`SUPPORT.md`](SUPPORT.md) for the (non-)support policy and
> [`SECURITY.md`](SECURITY.md) for how to report a security issue.

---

## What it does

1. **Single-URL mode** — you paste a `bger.ch` ruling URL. The BFF
   prefetches the fulltext and calls the **summary agent**, which
   produces a **bilingual DE/FR draft summary**. No triage — because you
   picked the URL, relevance is not gated.
2. **Batch — LATEST** — the BFF calls the **triage agent**, which crawls
   the most recent day(s) on `bger.ch`, deterministically filters to the
   accident/disability-insurance subject areas (Stage 1), then triages
   each candidate against a structured Q1–Q4 rubric (Stage 2). For every
   relevant docket, the BFF prefetches fulltext and fans out parallel
   **summary agent** calls.
3. **Batch — date range** — same as LATEST but for an arbitrary date
   range (kept small in the demo due to a synchronous invocation
   timeout).
4. **Triage log** (`/case-1/triage`) — every screened ruling, its
   per-question rationale, and its verdict, filterable by run.
5. **Drafts** (`/case-1/drafts`) — recent bilingual summaries, with an
   optional **"publish to SharePoint"** button (Microsoft Graph upload).

Every action shows a progress bar with phase labels, and BFF logs go to
Application Insights for diagnostics (`scripts/diag.sh appinsights`).

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│   /case-1   /case-1/drafts   /case-1/triage                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ fetch /api/rulings, /api/drafts/* …
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 15 BFF — apps/web/                                      │
│   • app/api/rulings/route.ts     — orchestrates Phase A + B      │
│   • lib/bger.ts                  — bger.ch fulltext prefetch     │
│   • lib/structured.ts            — parses <!-- structured --> tail│
│   • lib/sharepoint.ts            — Graph upload to SharePoint    │
│   • lib/cosmos.ts                — persistence (AAD, no keys)    │
└────────────┬───────────────────┬──────────────────┬─────────────┘
             │ POST .../invoc.   │ POST .../invoc.  │ AAD
             ▼                   ▼                  ▼
┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐
│ agent-triage       │  │ agent-summary      │  │ Cosmos DB         │
│ apps/agent-triage/ │  │ apps/agent-summary/│  │  • batch_runs    │
│  Stage 1 + Q1–Q4   │  │  Bilingual DE/FR   │  │  • triage_dec…   │
│  → triage_decisions│  │  → ruling_summaries│  │  • rulings       │
│  Tools: bger_*     │  │  Tool: bger_fetch  │  └──────────────────┘
│  model: gpt-4.1-m. │  │  model: gpt-4.1-m. │  ┌──────────────────┐
└────────────────────┘  └────────────────────┘  │  MS Graph         │
                                                │   /Drafts/*.md    │
                                                └──────────────────┘
```

- **Frontend + BFF**: Next.js 15 App Router (`apps/web/`), deployable to
  Azure Container Apps or runnable locally with `pnpm dev`.
- **Hosted agents**: two [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
  apps (Python 3.12, FastAPI `/invocations` endpoint each), registered as
  Foundry hosted-agent versions via `az acr build` + the Foundry agents
  API — **not** via azd. The BFF orchestrates the hand-off (triage
  decides which dockets are relevant; summary produces the drafts).
- **Models**: `gpt-4.1-mini` is the active agent model. The infra also
  deploys `gpt-4.1` and `text-embedding-3-large` (Standard SKU). The
  default region is **Switzerland North** (Swiss data residency); it is
  pinned by default and can be overridden.
- **Data**: Cosmos DB (NoSQL, serverless, Azure AD / Entra ID auth — no
  keys). Default database name `rulingradar`.
- **Identity**: local dev uses your `az login` session
  (`DefaultAzureCredential`); in Azure the web Container App uses a
  user-assigned managed identity. SharePoint upload uses one Microsoft
  Graph app registration with `Sites.Selected` (app-only).
- **Observability**: Application Insights traces for the BFF.

---

## Prerequisites

Install these once:

| Tool | Version | Purpose |
|---|---|---|
| [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) | latest | Auth + diagnostics + `az acr build` |
| [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) (`azd`) | latest | Infra + web deployment |
| [Node.js](https://nodejs.org) | ≥ 20 | Runs the web app |
| [pnpm](https://pnpm.io/installation) | 9.x | Web package manager |
| [Python](https://www.python.org/downloads/) | 3.12 | Agent development |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | latest | Agent dependency management |

You also need:

- An **Azure subscription** where you can create resources (Contributor).
- Access to **Microsoft Foundry** with quota for `gpt-4.1-mini` in your
  chosen region.
- *(Optional)* A **Microsoft 365 / SharePoint** site + a Graph app
  registration, only if you want the "publish draft to SharePoint"
  feature.

---

## First-time setup

Follow these steps in order. This assumes a clean machine and an empty
Azure environment. Expect ~30–60 minutes end-to-end.

### 1. Clone and sign in

```bash
git clone <this-repo-url>
cd ruling-radar
az login          # sign in to Azure
azd auth login    # sign in the Azure Developer CLI
```

### 2. Provision the Azure infrastructure + web app

`azd` reads parameters from environment values you set with `azd env
set`. The only required value is the environment name; the region is
pinned to Switzerland North by default.

```bash
azd init --environment ruling-radar        # creates a local azd env
azd env set AZURE_LOCATION         switzerlandnorth
azd env set AZURE_FOUNDRY_LOCATION switzerlandnorth

# Optional — only if you plan to use SharePoint publishing:
azd env set GRAPH_TENANT_ID     "$(az account show --query tenantId -o tsv)"
azd env set GRAPH_APP_CLIENT_ID "<your Graph app registration client id>"
azd env set --secret GRAPH_APP_CLIENT_SECRET      # paste when prompted
azd env set SHAREPOINT_SITE_URL "https://<tenant>.sharepoint.com/sites/<site>"
azd env set SHAREPOINT_DRIVE_ID 'b!xxxxxxxx'      # SINGLE quotes — drive ids contain '!'

azd up
```

`azd up` provisions: Cosmos DB, the Foundry account + project, Azure
Container Registry (ACR), Application Insights, a managed identity, and
(optionally) the Next.js Container App. Note the outputs — you will need
the **Foundry project endpoint** and the **Cosmos endpoint** in step 4.

> By default the web app is **not** deployed as a Container App
> (`deployWebApp=false`) so you can iterate locally. Set
> `azd env set DEPLOY_WEB_APP true` before `azd up` to deploy it.

### 3. Build and register the two hosted agents

The agents are **not** deployed by `azd`. Build each image with
`az acr build` and register a version through the Foundry agents API.
Replace `<your-registry>`, `<your-resource-group>`, and
`<your-project-endpoint>` with your values (from step 2 outputs).

```bash
# repeat for NAME=agent-triage and NAME=agent-summary
NAME=agent-triage
N=1
cd apps/$NAME

# a) build + push the image to your ACR
az acr build --resource-group <your-resource-group> --registry <your-registry> \
  --image $NAME:v$N --file Dockerfile .

# b) resolve the pushed digest
DIGEST=$(az acr repository show -n <your-registry> --image $NAME:v$N --query digest -o tsv)

# c) get a Foundry token
TOKEN=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv)

# d) register a new agent version (see the JSON body below)
curl -sS -X POST \
  "<your-project-endpoint>/agents/$NAME/versions?api-version=v1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Foundry-Features: HostedAgents=V1Preview" \
  -d '{
    "definition": {
      "kind": "hosted",
      "image": "<your-registry>.azurecr.io/'"$NAME"'@'"$DIGEST"'",
      "container_protocol_versions": [{"protocol":"invocations","version":"1.0.0"}],
      "cpu": "0.5",
      "memory": "1Gi",
      "environment_variables": {
        "AZURE_OPENAI_ENDPOINT": "https://<your-foundry>.cognitiveservices.azure.com/",
        "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME": "gpt-4.1-mini",
        "AZURE_OPENAI_API_VERSION": "preview"
      }
    }
  }'
cd ../..
```

Each hosted agent runs under its own Foundry-managed identity. On first
deploy, grant that identity access to your Foundry account (see
[Granting agent identities access](#granting-agent-identities-access)
below). The platform pulls container images using the Foundry project's
managed identity, not the agent's runtime identity. The Bicep grants
`AcrPull` to the project identity on the registry.

The BFF calls version-agnostic endpoints — Foundry routes to the latest
active version automatically:

```
<your-project-endpoint>/agents/agent-triage/endpoint/protocols/invocations?api-version=v1
<your-project-endpoint>/agents/agent-summary/endpoint/protocols/invocations?api-version=v1
```

### 4. Configure the web app

Copy the template and fill in your values from steps 2–3:

```bash
cp apps/web/.env.example apps/web/.env.local
# then edit apps/web/.env.local
```

At minimum set `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_COSMOS_ENDPOINT`.
See [Configuration reference](#configuration-reference) for all keys.

### 5. Run it

```bash
bash scripts/dev.sh start     # starts the web app in the background
bash scripts/dev.sh tail      # follow logs (Ctrl-C to stop tailing)
```

Open **http://localhost:3000** → **/case-1**. Paste a `bger.ch` ruling
URL and click through the single-URL flow to confirm everything works.

Stop the dev server later with `bash scripts/dev.sh stop`.

---

## Everyday usage (after first-time setup)

Once the infrastructure and agents exist, day-to-day use is just:

```bash
az login                    # if your session expired
bash scripts/dev.sh start   # start the web app
bash scripts/dev.sh tail    # follow logs
# ... use the app at http://localhost:3000/case-1 ...
bash scripts/dev.sh stop    # stop when done
```

You only need to repeat the first-time steps when:

- **You change agent code** → rebuild + re-register that agent (step 3,
  bump `N`).
- **You change infrastructure** (Bicep) → `azd up` again.
- **You change web env values** → edit `apps/web/.env.local` and restart
  the dev server.

### Using the app

- **Single URL**: paste a `bger.ch` URL → get a bilingual draft.
- **Batch (LATEST / date range)**: trigger a triage run → review the
  triage log at `/case-1/triage` → review drafts at `/case-1/drafts`.
- **Publish** (optional): from a draft, click publish to upload it to the
  configured SharePoint drive.

---

## Configuration reference

The web app (`apps/web/.env.local`) reads:

| Variable | Required | Description |
|---|---|---|
| `FOUNDRY_PROJECT_ENDPOINT` | ✅ | Foundry project endpoint. Use the `services.ai.azure.com` host, e.g. `https://<foundry>.services.ai.azure.com/api/projects/<project>`. |
| `AZURE_COSMOS_ENDPOINT` | ✅ | Cosmos account endpoint, e.g. `https://<account>.documents.azure.com:443/`. |
| `FOUNDRY_TRIAGE_AGENT_NAME` | ⬜ | Defaults to `agent-triage`. |
| `FOUNDRY_SUMMARY_AGENT_NAME` | ⬜ | Defaults to `agent-summary`. |
| `GRAPH_TENANT_ID` | ⬜ | Entra tenant id (SharePoint publishing). |
| `GRAPH_APP_CLIENT_ID` | ⬜ | Graph app registration client id. |
| `GRAPH_APP_CLIENT_SECRET` | ⬜ | Graph app client secret. |
| `SHAREPOINT_DRIVE_ID` | ⬜ | Target SharePoint drive id. |
| `SHAREPOINT_SITE_URL` | ⬜ | Target SharePoint site URL. |

The agents (`apps/<agent>/.env` for local dev) read:

| Variable | Description |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Foundry / Azure OpenAI endpoint (`cognitiveservices.azure.com`). |
| `AZURE_OPENAI_CHAT_DEPLOYMENT_NAME` | Chat model deployment, default `gpt-4.1-mini`. |
| `AZURE_OPENAI_API_VERSION` | API version, default `preview`. |
| `INSURER_NAME` | *(triage only, optional)* Insurer the triage screens relevance for. Default `die Unfallversicherung`. |

> **Secrets never leave your machine.** Real values live in gitignored
> files (`.env`, `.env.local`, root `.env.example`). Only the
> `*.env.example` templates are committed.

---

## House-style example summaries (local-only)

The summary agent can imitate an in-house summary style using a few-shot
set of "gold standard" example summaries in
`apps/agent-summary/src/agent_summary/data/exemplars/`.

These example `*.md` files are **intentionally gitignored** — they stay
on your machine (and in your locally built agent image) and are **never
pushed** to the repository. Only the drop-zone `README.md` is tracked.

To enable style mimicry, drop your own example summaries into that folder
(one ruling per `.md` file), then rebuild + re-register the summary
agent. If the folder has no examples, the agent still works — the
prompt simply omits the examples section (no behavior change). See the
folder's `README.md` for the file contract.

---

## Repository layout

```
ruling-radar/
├── README.md                    # ← you are here
├── LICENSE                      # MIT
├── SUPPORT.md                   # (non-)support policy
├── SECURITY.md                  # how to report a security issue
├── azure.yaml                   # azd config — only the web service
├── infra/                       # Bicep IaC
│   ├── main.bicep               # the resource stack
│   └── modules/                 # cosmos, foundry, app insights, mi, …
├── apps/
│   ├── web/                     # Next.js 15 BFF + UI
│   ├── agent-triage/            # Foundry hosted agent — Stage 1 + 2
│   └── agent-summary/           # Foundry hosted agent — bilingual summary
├── hooks/                       # azd postprovision/predown hooks
└── scripts/                     # dev.sh (background dev server) + diag.sh
```

---

## Troubleshooting

Run the self-service diagnostics first — it inspects your running app and
Azure resources so you don't have to guess:

```bash
bash scripts/diag.sh             # everything
bash scripts/diag.sh web         # web dev server health + last logs
bash scripts/diag.sh typecheck   # pnpm tsc --noEmit
bash scripts/diag.sh agent       # Foundry hosted-agent status
bash scripts/diag.sh cosmos      # Cosmos containers + doc counts
bash scripts/diag.sh azure       # resource group health + failed activity
bash scripts/diag.sh appinsights # exceptions + warning traces, last 1h
```

`diag.sh` reads resource identifiers from your environment (e.g. from
`azd env get-values`) with neutral fallbacks — export
`AZURE_RESOURCE_GROUP`, `AZURE_COSMOS_ACCOUNT`, `AZURE_APP_INSIGHTS`, and
`FOUNDRY_PROJECT_ENDPOINT` (or run inside an `azd` env) for full output.

| Symptom | Likely cause | Fix |
|---|---|---|
| `pnpm: command not found` | pnpm not installed | `npm install -g pnpm@9` (or use Corepack). |
| Web app won't start / port busy | port 3000 in use or a stale dev server | `bash scripts/dev.sh stop`, then `bash scripts/dev.sh start`. Check `bash scripts/dev.sh status`. |
| `DefaultAzureCredential` / 401 / 403 errors | not signed in, or wrong subscription | `az login`; `az account set --subscription <id>`. Confirm with `az account show`. |
| Agent call returns **404 / agent not found** | agent not registered, or wrong `FOUNDRY_PROJECT_ENDPOINT` | Verify with `bash scripts/diag.sh agent`. Ensure the endpoint uses the `services.ai.azure.com` host and the agent version is `active`. |
| Agent call returns **403** on the model | the agent's identity lacks OpenAI access | Grant both `Cognitive Services OpenAI User` **and** `Cognitive Services User` on the Foundry account (see below). |
| Cosmos **403 / Forbidden** | your identity lacks data-plane role | Assign **Cosmos DB Built-in Data Contributor** to your user/identity on the Cosmos account (the postprovision hook does this for the deployer). |
| Batch over a large date range **times out** | synchronous invocation limit | Use a smaller range (1–3 days) or `LATEST`. |
| SharePoint publish fails | Graph app not consented / wrong drive id | Confirm the app has `Sites.Selected` granted on the target site and that `SHAREPOINT_DRIVE_ID` is quoted with single quotes. |
| `az acr build` fails | not logged in / wrong registry name | `az login`; verify `--registry` and `--resource-group` names. |
| Summaries ignore your house style | no exemplars present, or image not rebuilt | Add `.md` files to the exemplars drop-zone, then rebuild + re-register the summary agent. |

### Granting agent identities access

Each Foundry hosted agent runs under its own Foundry-managed identity.
On first deploy, grant it access to your Foundry (Azure OpenAI) account.
Get the agent's principal id from the Foundry portal or an App
Insights auth exception, then:

```bash
AOAI=$(az cognitiveservices account show -g <your-resource-group> -n <your-foundry> --query id -o tsv)
PROJECT="$AOAI/projects/<your-project-name>"
PRINCIPAL=<agent runtime principal object id>

az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" --scope $AOAI
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services User" --scope $AOAI
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Foundry User" --scope $PROJECT
```

Both `Cognitive Services OpenAI User` **and** `Cognitive Services User`
are granted for direct account-level model calls. If calls still fail with
`Principal does not have access to API/Operation`, verify the runtime
identity's `Foundry User` grant on the project as well. The project's own
identity also needs `Foundry User` on the account; the Bicep provisions it.

For an existing environment provisioned before the project `AcrPull` grant
was added, grant that role to the Foundry project's `identity.principalId`
on the target registry. Allow time for RBAC propagation, then create a new
agent version using the same image digest. Granting the runtime identity
access does not replace the project's image-pull permission.

```bash
# AOAI and PROJECT are the account/project scopes defined above.
PROJECT_PRINCIPAL=$(az resource show --ids "$PROJECT" --api-version 2025-06-01 \
  --query identity.principalId -o tsv)
ACR=$(az acr show -g <your-resource-group> -n <your-registry> --query id -o tsv)

az role assignment create --assignee-object-id "$PROJECT_PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --role "AcrPull" --scope "$ACR"
az role assignment create --assignee-object-id "$PROJECT_PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --role "Foundry User" --scope "$AOAI"
```

Existing manually created role assignments can have different names from
the Bicep assignments. Before reprovisioning an existing environment, check
for these grants; otherwise ARM can report `RoleAssignmentExists`. Coordinate
any name alignment rather than deleting customer permissions blindly.

### Deployment troubleshooting

| Failure | What to check |
| --- | --- |
| `ImageError: Container registry authentication failed` | Verify the actual project's principal and its effective `AcrPull` on the registry referenced by the image. After propagation, register a new version and check that it becomes `active`; a successful registration response alone is not readiness. |
| `RequestConflict: Another operation is in progress` on the Foundry account | Project creation and model deployment must not modify the account concurrently. The Bicep now creates the project before deploying models and keeps model deployments sequential. |
| Agent HTTP 500 with underlying model HTTP 401 / `PermissionDenied` | Check the separate runtime account/project grants above and the project's account grant. Image-pull success does not prove model access. |
| Web cannot connect to Cosmos | Set `AZURE_COSMOS_ENDPOINT`; the Bicep now supplies it to the optional web Container App. Network access and Cosmos data permissions still need to be valid. |

The image-pull failure was reproduced without the project grant and resolved
by adding it, using unchanged images and no additional ACR connection. If that
grant is already effective and a fresh version still fails, this result does
not explain the remaining failure: retain the failed version's details and
investigate the actual identity, registry configuration, and network path.
The runtime grants above describe a working combination, not an experiment
proving that every grant is independently required.

---

## License

Released under the [MIT License](LICENSE). See the
[disclaimer](#️-disclaimer--please-read-first) above — this is
unsupported demo software, provided "AS IS".
