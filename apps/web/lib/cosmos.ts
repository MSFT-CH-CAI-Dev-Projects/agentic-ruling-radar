/**
 * Cosmos persistence for Ruling Radar.
 *
 * Each invocation of the agent (single-URL or batch) is persisted as
 * one document in the existing `batch_runs` container (partition key
 * `/run_id`). For single-URL runs the doc represents one ruling; for
 * batch runs it represents the whole batch (the agent's response
 * contains every per-ruling sub-result inline).
 *
 * Structured per-ruling decomposition (Cosmos containers
 * `triage_decisions` + `rulings`) lands in a future phase once the
 * agent emits structured output.
 *
 * Auth: managed identity in prod (web container's user-assigned MI
 * has Cosmos Data Contributor in infra/main.bicep). Local dev uses
 * `az login` via DefaultAzureCredential.
 */
import { DefaultAzureCredential } from "@azure/identity";
import { CosmosClient, Container } from "@azure/cosmos";

const DB_NAME = "rulingradar";
const RUNS_CONTAINER = "batch_runs";
const TRIAGE_CONTAINER = "triage_decisions";
const RULINGS_CONTAINER = "rulings";

export type RunDoc = {
  id: string;
  run_id: string;
  mode: "single" | "batch";
  user_input: string;
  agent_response_md: string;
  agent_session_id?: string;
  duration_ms: number;
  ts: string;
};

export type TriageDecisionDoc = {
  id: string;
  docket: string;
  run_id: string;
  decision_date?: string | null;
  source_url?: string | null;
  stage1_passed: boolean;
  stage1_reason: string;
  insurer_is_party?: boolean | null;
  scope_uv_iv?: boolean | null;
  q1_zur_publikation?: boolean | null;
  q1_reason?: string | null;
  q2_praxisaenderung?: boolean | null;
  q2_reason?: string | null;
  q3_praxisbestaetigung?: boolean | null;
  q3_reason?: string | null;
  q4_interessante_fallkonstellation?: boolean | null;
  q4_reason?: string | null;
  relevant: boolean;
  rationale: string;
  ts: string;
};

export type RulingSummaryDoc = {
  id: string;
  docket: string;
  run_id: string;
  title_de: string;
  title_fr?: string | null;
  summary_markdown: string;
  source_url?: string | null;
  decision_date?: string | null;
  style_tier?: string;
  sharepoint_url?: string | null;
  sharepoint_published_at?: string | null;
  ts: string;
};

let cached: {
  client: CosmosClient;
  runs: Container;
  triage: Container;
  rulings: Container;
} | null = null;

function getContainers(): {
  runs: Container;
  triage: Container;
  rulings: Container;
} | null {
  const endpoint = process.env.AZURE_COSMOS_ENDPOINT;
  if (!endpoint) return null;
  if (cached) return cached;
  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  const db = client.database(DB_NAME);
  cached = {
    client,
    runs: db.container(RUNS_CONTAINER),
    triage: db.container(TRIAGE_CONTAINER),
    rulings: db.container(RULINGS_CONTAINER),
  };
  return cached;
}

export async function persistRun(doc: RunDoc): Promise<void> {
  const c = getContainers();
  if (!c) return;
  await c.runs.items.upsert(doc);
}

export async function listRecentRuns(limit = 20): Promise<RunDoc[]> {
  const c = getContainers();
  if (!c) return [];
  const { resources } = await c.runs.items
    .query<RunDoc>({
      query:
        "SELECT TOP @n c.id, c.run_id, c.mode, c.user_input, c.agent_response_md, c.agent_session_id, c.duration_ms, c.ts FROM c ORDER BY c.ts DESC",
      parameters: [{ name: "@n", value: limit }],
    })
    .fetchAll();
  return resources;
}

export async function getRun(id: string): Promise<RunDoc | null> {
  const c = getContainers();
  if (!c) return null;
  try {
    const { resource } = await c.runs.item(id, id).read<RunDoc>();
    return resource ?? null;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

export async function listRecentRulings(limit = 50): Promise<RulingSummaryDoc[]> {
  const c = getContainers();
  if (!c) return [];
  const { resources } = await c.rulings.items
    .query<RulingSummaryDoc>({
      query:
        "SELECT TOP @n c.id, c.docket, c.run_id, c.title_de, c.title_fr, c.summary_markdown, c.source_url, c.decision_date, c.style_tier, c.sharepoint_url, c.sharepoint_published_at, c.ts FROM c ORDER BY c.ts DESC",
      parameters: [{ name: "@n", value: limit }],
    })
    .fetchAll();
  return resources;
}

export async function getRulingById(id: string): Promise<RulingSummaryDoc | null> {
  const c = getContainers();
  if (!c) return null;
  const { resources } = await c.rulings.items
    .query<RulingSummaryDoc>({
      query: "SELECT * FROM c WHERE c.id = @id",
      parameters: [{ name: "@id", value: id }],
    })
    .fetchAll();
  return resources[0] ?? null;
}

export async function listRecentTriageDecisions(
  limit = 100,
): Promise<TriageDecisionDoc[]> {
  const c = getContainers();
  if (!c) return [];
  const { resources } = await c.triage.items
    .query<TriageDecisionDoc>({
      query:
        "SELECT TOP @n c.id, c.docket, c.run_id, c.decision_date, c.source_url, c.stage1_passed, c.stage1_reason, c.insurer_is_party, c.scope_uv_iv, c.q1_zur_publikation, c.q1_reason, c.q2_praxisaenderung, c.q2_reason, c.q3_praxisbestaetigung, c.q3_reason, c.q4_interessante_fallkonstellation, c.q4_reason, c.relevant, c.rationale, c.ts FROM c ORDER BY c.ts DESC",
      parameters: [{ name: "@n", value: limit }],
    })
    .fetchAll();
  return resources;
}

export async function persistTriageDecisions(
  decisions: TriageDecisionDoc[],
): Promise<number> {
  const c = getContainers();
  if (!c || decisions.length === 0) return 0;
  let n = 0;
  for (const d of decisions) {
    await c.triage.items.upsert(d);
    n += 1;
  }
  return n;
}

export async function persistRulingSummaries(
  summaries: RulingSummaryDoc[],
): Promise<number> {
  const c = getContainers();
  if (!c || summaries.length === 0) return 0;
  let n = 0;
  for (const s of summaries) {
    await c.rulings.items.upsert(s);
    n += 1;
  }
  return n;
}

export async function updateRulingSharePoint(
  id: string,
  docket: string,
  sharepointUrl: string,
): Promise<RulingSummaryDoc | null> {
  const c = getContainers();
  if (!c) return null;
  const existing = await getRulingById(id);
  if (!existing) return null;
  const updated: RulingSummaryDoc = {
    ...existing,
    sharepoint_url: sharepointUrl,
    sharepoint_published_at: new Date().toISOString(),
  };
  await c.rulings.items.upsert(updated);
  return updated;
}
