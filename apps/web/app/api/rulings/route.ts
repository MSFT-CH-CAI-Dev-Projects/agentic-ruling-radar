import { DefaultAzureCredential } from "@azure/identity";
import { NextRequest, NextResponse } from "next/server";

import { fetchRuling, isFetchError, trimFullText } from "@/lib/bger";
import {
  persistRulingSummaries,
  persistRun,
  persistTriageDecisions,
  type RulingSummaryDoc,
  type TriageDecisionDoc,
} from "@/lib/cosmos";
import { parseAgentOutput } from "@/lib/structured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const FOUNDRY_RESOURCE = "https://ai.azure.com";

let credential: DefaultAzureCredential | null = null;
function getCredential(): DefaultAzureCredential {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

function getInvocationUrl(agentName: string): string {
  const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "FOUNDRY_PROJECT_ENDPOINT is not set. Expected something like " +
        "https://<account>.services.ai.azure.com/api/projects/<project>",
    );
  }
  const trimmed = endpoint.replace(/\/+$/, "");
  return `${trimmed}/agents/${agentName}/endpoint/protocols/invocations?api-version=v1`;
}

function getTriageInvocationUrl(): string {
  const name =
    process.env.FOUNDRY_TRIAGE_AGENT_NAME ??
    process.env.FOUNDRY_AGENT_NAME ?? // legacy fallback
    "agent-triage";
  return getInvocationUrl(name);
}

function getSummaryInvocationUrl(): string {
  const name = process.env.FOUNDRY_SUMMARY_AGENT_NAME ?? "agent-summary";
  return getInvocationUrl(name);
}

type AgentResponse = {
  response?: string;
  session_id?: string;
  [key: string]: unknown;
};

export async function POST(req: NextRequest) {
  let body: { mode?: string; url?: string; rangeStart?: string; rangeEnd?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = ((body.mode ?? "single").toLowerCase() === "batch" ? "batch" : "single") as
    | "single"
    | "batch";

  let token: string;
  try {
    const tokenResponse = await getCredential().getToken(
      `${FOUNDRY_RESOURCE}/.default`,
    );
    if (!tokenResponse?.token) throw new Error("Empty token from DAC");
    token = tokenResponse.token;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Failed to acquire Entra token for Foundry. In local dev, run 'az login'. " +
          `Underlying: ${(err as Error).message}`,
      },
      { status: 502 },
    );
  }

  const startedAt = Date.now();
  let visibleMarkdown = "";
  let structured: ReturnType<typeof parseAgentOutput>["structured"] = null;
  let batchMeta: ReturnType<typeof parseAgentOutput>["batchMeta"] = null;
  let sessionId: string | undefined;
  let raw: AgentResponse | null = null;
  let userInputForPersist = "";

  if (mode === "single") {
    // Single mode: BFF prefetches fulltext, calls SUMMARY agent only.
    const url = body.url?.trim();
    if (!url) {
      return NextResponse.json(
        { error: "Mode 'single' requires a non-empty 'url'." },
        { status: 400 },
      );
    }

    let summaryUrl: string;
    try {
      summaryUrl = getSummaryInvocationUrl();
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    const message = await buildSummaryMessage(url);
    userInputForPersist = `[single] ${url}`;

    const callResult = await safeCallAgent(summaryUrl, token, message);
    if (!callResult.ok) {
      return summaryError(callResult);
    }

    visibleMarkdown = callResult.parsed.visibleMarkdown;
    structured = callResult.parsed.structured;
    batchMeta = callResult.parsed.batchMeta;
    sessionId = callResult.sessionId;
    raw = callResult.raw;
  } else {
    // Batch mode:
    //   Phase A — call TRIAGE agent with date range or LATEST.
    //   Phase B — fan out per relevant docket to SUMMARY agent.

    let triageUrl: string;
    let summaryUrl: string;
    try {
      triageUrl = getTriageInvocationUrl();
      summaryUrl = getSummaryInvocationUrl();
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    const triageMessage = buildTriageMessage(body);
    userInputForPersist = triageMessage;

    const triageResult = await safeCallAgent(triageUrl, token, triageMessage);
    if (!triageResult.ok) {
      return triageError(triageResult);
    }

    visibleMarkdown = triageResult.parsed.visibleMarkdown;
    structured = triageResult.parsed.structured;
    batchMeta = triageResult.parsed.batchMeta;
    sessionId = triageResult.sessionId;
    raw = triageResult.raw;

    // Phase B — fan out per relevant docket. BFF prefetches fulltext via
    // apps/web/lib/bger.ts and passes inline; saves the per-call tool roundtrip.
    if (structured) {
      const relevant = structured.triage_decisions.filter(
        (d) => d.relevant && d.source_url,
      );
      const SUMMARY_CAP = 5;
      const toSummarize = relevant.slice(0, SUMMARY_CAP);
      const skippedSummaries = relevant.length - toSummarize.length;
      console.log(
        `[rulings] phase-b fan-out: ${relevant.length} relevant, ` +
          `${toSummarize.length} to summarize (cap ${SUMMARY_CAP})`,
      );

      const summaryResults = await runWithConcurrency(
        toSummarize,
        3,
        async (d) => {
          const t0 = Date.now();
          const message = await buildSummaryMessage(d.source_url!);
          try {
            const res = await callAgent(summaryUrl, token, message);
            const dt = Date.now() - t0;
            if (!res.ok) {
              console.warn(
                `[rulings] phase-b ${d.docket} failed status=${res.status} dt=${dt}ms`,
              );
              return null;
            }
            const sum = res.parsed.structured?.ruling_summaries?.[0];
            if (!sum) {
              console.warn(
                `[rulings] phase-b ${d.docket} returned no summary ` +
                  `(structured=${!!res.parsed.structured}) dt=${dt}ms`,
              );
              return null;
            }
            console.log(
              `[rulings] phase-b ${d.docket} ok title_de="${sum.title_de}" dt=${dt}ms`,
            );
            return sum;
          } catch (err) {
            console.warn(
              `[rulings] phase-b ${d.docket} error:`,
              (err as Error).message,
            );
            return null;
          }
        },
      );

      const summaries = summaryResults.filter(
        (x): x is NonNullable<typeof x> => x !== null,
      );
      structured = {
        ...structured,
        ruling_summaries: summaries,
      };

      if (summaries.length > 0) {
        visibleMarkdown += `\n\n---\n\n## Volltext-Zusammenfassungen (${summaries.length})\n\n`;
        visibleMarkdown += summaries
          .map((s) => `### ${s.docket} — ${s.title_de}\n\n${s.summary_markdown}`)
          .join("\n\n---\n\n");
      }
      if (skippedSummaries > 0) {
        visibleMarkdown += `\n\n> Hinweis: ${skippedSummaries} weitere relevante Urteile wurden triagiert, aber nicht volltext-zusammengefasst (Cap ${SUMMARY_CAP} pro Batch-Lauf).`;
      }
    }
  }

  const runId = sessionId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const ts = new Date().toISOString();
  try {
    await persistRun({
      id: runId,
      run_id: runId,
      mode,
      user_input: userInputForPersist,
      agent_response_md: visibleMarkdown,
      agent_session_id: sessionId,
      duration_ms: Date.now() - startedAt,
      ts,
    });
  } catch (err) {
    console.warn("[rulings] Cosmos persist failed (non-fatal):", (err as Error).message);
  }

  let structuredCounts: { decisions: number; summaries: number } | null = null;
  if (structured) {
    try {
      const decisions: TriageDecisionDoc[] = structured.triage_decisions.map(
        (d) => ({
          ...d,
          id: `${runId}__${slugDocket(d.docket)}`,
          run_id: runId,
          ts,
        }),
      );
      const summaries: RulingSummaryDoc[] = structured.ruling_summaries.map(
        (s) => {
          const match = structured!.triage_decisions.find(
            (d) => d.docket === s.docket,
          );
          return {
            ...s,
            id: `${runId}__${slugDocket(s.docket)}`,
            run_id: runId,
            source_url: s.source_url ?? match?.source_url ?? null,
            decision_date: s.decision_date ?? match?.decision_date ?? null,
            ts,
          };
        },
      );
      const [dn, sn] = await Promise.all([
        persistTriageDecisions(decisions),
        persistRulingSummaries(summaries),
      ]);
      structuredCounts = { decisions: dn, summaries: sn };
    } catch (err) {
      console.warn(
        "[rulings] Cosmos structured persist failed (non-fatal):",
        (err as Error).message,
      );
    }
  }

  return NextResponse.json({
    response: visibleMarkdown,
    sessionId,
    runId,
    structured,
    structuredCounts,
    batchMeta,
    raw,
  });
}

type AgentCallResult =
  | {
      ok: true;
      status: number;
      sessionId: string | undefined;
      parsed: ReturnType<typeof parseAgentOutput> & {
        visibleMarkdown: string;
        structured: ReturnType<typeof parseAgentOutput>["structured"];
        batchMeta: ReturnType<typeof parseAgentOutput>["batchMeta"];
      };
      raw: AgentResponse | null;
    }
  | {
      ok: false;
      status: number;
      upstream: unknown;
    };

async function safeCallAgent(
  invocationUrl: string,
  token: string,
  message: string,
): Promise<AgentCallResult> {
  try {
    return await callAgent(invocationUrl, token, message);
  } catch (err) {
    return { ok: false, status: 502, upstream: (err as Error).message };
  }
}

async function callAgent(
  invocationUrl: string,
  token: string,
  message: string,
): Promise<AgentCallResult> {
  const upstream = await fetch(invocationUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Foundry-Features": "HostedAgents=V1Preview",
    },
    body: JSON.stringify({ message, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, upstream: tryParse(text) ?? text };
  }
  const parsedJson = tryParse(text) as AgentResponse | null;
  const rawMd = parsedJson?.response ?? text;
  const parsed = parseAgentOutput(rawMd);
  return {
    ok: true,
    status: upstream.status,
    sessionId: parsedJson?.session_id,
    parsed,
    raw: parsedJson,
  };
}

function summaryError(r: { ok: false; status: number; upstream: unknown }) {
  const friendly =
    r.status === 408 || r.status === 504
      ? "Der Summary-Agent hat das Foundry-Zeitlimit überschritten. Bitte erneut versuchen oder eine andere URL wählen."
      : `Summary agent returned ${r.status}`;
  return NextResponse.json(
    { error: friendly, upstream: r.upstream },
    { status: r.status },
  );
}

function triageError(r: { ok: false; status: number; upstream: unknown }) {
  const friendly =
    r.status === 408 || r.status === 504
      ? "Der Triage-Agent hat das Foundry-Zeitlimit überschritten. Bitte wähle einen kürzeren Zeitraum (z. B. LATEST oder 1–2 Tage) oder reduziere die Anzahl Urteile."
      : `Triage agent returned ${r.status}`;
  return NextResponse.json(
    { error: friendly, upstream: r.upstream },
    { status: r.status },
  );
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

function slugDocket(docket: string): string {
  return docket.replace(/[^A-Za-z0-9_-]+/g, "_");
}

async function buildSummaryMessage(url: string): Promise<string> {
  // Prefetch fulltext via the BFF helper. If it fails, fall back to
  // URL-only — the summary agent has bger_fetch_ruling as a tool fallback.
  const tFetch0 = Date.now();
  try {
    const fetched = await fetchRuling(url);
    if (isFetchError(fetched)) {
      console.warn(`[rulings] summary prefetch failed for ${url}: ${fetched.error}`);
      return `URL: ${url}`;
    }
    const inlineText = trimFullText(fetched, 24_000);
    console.log(
      `[rulings] summary prefetch ok url=${url} ` +
        `len=${fetched.full_text_length} trimmed=${inlineText.length} ` +
        `dt=${Date.now() - tFetch0}ms`,
    );
    return `URL: ${url}\n---FULLTEXT---\n${inlineText}`;
  } catch (err) {
    console.warn(
      `[rulings] summary prefetch threw for ${url}: ${(err as Error).message}`,
    );
    return `URL: ${url}`;
  }
}

function buildTriageMessage(body: { rangeStart?: string; rangeEnd?: string }): string {
  const start = body.rangeStart?.trim();
  const end = body.rangeEnd?.trim();
  if (start && end) {
    return (
      `Bitte triagiere alle Bundesgerichtsurteile im Zeitraum ${start} bis ${end} ` +
      `(ISO-Format YYYY-MM-DD). Verwende das Tool bger_list_range.`
    );
  }
  return (
    "Bitte triagiere die LATEST Bundesgerichtsurteile (nur den neuesten " +
    "verfügbaren Tag). Verwende das Tool bger_list_latest mit days=1."
  );
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
