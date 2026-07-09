# agent-triage

Ruling Radar batch-triage agent. Built on Microsoft Agent Framework,
deployed as a Foundry hosted agent (invocations protocol).

## Job

Given an input like `LATEST` / `letzten N Tage` / a date range
(`YYYY-MM-DD bis YYYY-MM-DD`), the agent:

1. Calls the bger.ch listing tool (Stage 1 — deterministic
   Sachgebiet filter UV/IV).
2. Fetches each surviving ruling's fulltext.
3. Runs Stage 2 (party check + relevance questions Q1–Q4).
4. Emits one `## Triage`-Block per ruling + a JSON tail
   (`triage_decisions[]`).

It does **not** produce summaries — that's `agent-summary`'s job.
The BFF (`apps/web`) reads `triage_decisions[]`, persists to Cosmos,
and fans out per relevant docket to the summary agent.

## Local dev

```bash
cd apps/agent-triage
uv run python -m agent_triage.dev      # uvicorn :8000 with reload
```

Then test:

```bash
curl -s http://localhost:8000/invocations \
  -H 'Content-Type: application/json' \
  -d '{"message": "letzten 1 Tage", "stream": false}'
```

## Foundry deploy

```bash
cd apps/agent-triage
N=1
az acr build --resource-group <your-resource-group> --registry <your-registry> \
  --image agent-triage:v$N --file Dockerfile .
```

Then register the new version via the Foundry API (see the **Deploying
the agents** section of the repository `README.md` for the full recipe —
replace agent-name with `agent-triage`).
