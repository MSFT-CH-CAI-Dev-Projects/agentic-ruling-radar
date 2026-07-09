# agent-summary

Ruling Radar bilingual house-style summary agent. Built on Microsoft
Agent Framework, deployed as a Foundry hosted agent (invocations
protocol).

## Job

Given a single bger.ch URL — and ideally the prefetched fulltext —
the agent emits exactly one bilingual (DE/FR) summary draft in the
house style. **No triage.** It assumes the caller has already
decided this ruling deserves a summary (either via `agent-triage`
batch fan-out or a manual single-mode request from the UI).

## Input format

Two variants:

* **Preferred (BFF-prefetch)** — the BFF has fetched the ruling
  fulltext via `apps/web/lib/bger.ts` and passes it inline:

  ```
  URL: https://www.bger.ch/...
  ---FULLTEXT---
  <volltext>
  ```

* **Fallback** — only the URL, no `---FULLTEXT---` marker. The agent
  calls `bger_fetch_ruling(url)` to get the text itself.

## Output

* A `## Entwurf — Zusammenfassung` Markdown block (DE + FR mirror).
* A JSON tail with exactly one `ruling_summaries` entry (used by the
  BFF to persist into the `rulings` Cosmos container).

## Local dev

```bash
cd apps/agent-summary
uv run python -m agent_summary.dev      # uvicorn :8000 with reload
```

Test:

```bash
curl -s http://localhost:8000/invocations \
  -H 'Content-Type: application/json' \
  -d '{"message": "URL: https://www.bger.ch/ext/eurospider/live/de/php/aza/http/index.php?lang=de&type=show_document&highlight_docid=aza://08-09-2025-8C_231-2025", "stream": false}'
```

## Foundry deploy

```bash
cd apps/agent-summary
N=1
az acr build --resource-group <your-resource-group> --registry <your-registry> \
  --image agent-summary:v$N --file Dockerfile .
```

Then register the new version via the Foundry API (see the **Deploying
the agents** section of the repository `README.md` for the full recipe —
replace agent-name with `agent-summary`).
