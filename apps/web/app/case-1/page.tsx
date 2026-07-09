"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Mode = "single" | "batch";
type BatchKind = "latest" | "range";

type AgentResult =
  | { status: "idle" }
  | { status: "loading"; mode: Mode }
  | {
      status: "ok";
      response: string;
      sessionId?: string;
      structured?: StructuredTail | null;
      batchMeta?: BatchMeta | null;
      mode?: Mode;
    }
  | { status: "error"; message: string; details?: unknown };

type BatchMeta = {
  dates_queried?: string;
  total_screened?: number;
  stage1_passed?: number;
};

type StructuredTail = {
  triage_decisions: Array<{
    docket: string;
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
  }>;
  ruling_summaries: Array<{
    docket: string;
    title_de: string;
    title_fr?: string | null;
    summary_markdown: string;
  }>;
};

type RunDoc = {
  id: string;
  run_id: string;
  mode: "single" | "batch";
  user_input: string;
  agent_response_md: string;
  agent_session_id?: string;
  duration_ms: number;
  ts: string;
};

export default function Case1Page() {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [batchKind, setBatchKind] = useState<BatchKind>("latest");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [result, setResult] = useState<AgentResult>({ status: "idle" });
  const [history, setHistory] = useState<RunDoc[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/rulings/history", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setHistoryError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setHistoryError(null);
      setHistory(Array.isArray(data.runs) ? data.runs : []);
    } catch (err) {
      setHistoryError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  async function handleRun() {
    let payload: Record<string, string>;
    if (mode === "single") {
      if (!url.trim()) {
        setResult({ status: "error", message: "Bitte URL eingeben." });
        return;
      }
      payload = { mode: "single", url: url.trim() };
    } else {
      if (batchKind === "range") {
        if (!rangeStart || !rangeEnd) {
          setResult({
            status: "error",
            message: "Bitte Start- und End-Datum eingeben (YYYY-MM-DD).",
          });
          return;
        }
        if (rangeStart > rangeEnd) {
          setResult({
            status: "error",
            message: "End-Datum muss ≥ Start-Datum sein.",
          });
          return;
        }
        payload = { mode: "batch", rangeStart, rangeEnd };
      } else {
        payload = { mode: "batch" };
      }
    }

    setResult({ status: "loading", mode });
    try {
      const res = await fetch("/api/rulings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({
          status: "error",
          message: data.error ?? `HTTP ${res.status}`,
          details: data.upstream ?? data,
        });
        return;
      }
      setResult({
        status: "ok",
        response: data.response ?? "(leere Antwort)",
        sessionId: data.sessionId,
        structured: data.structured ?? null,
        batchMeta: data.batchMeta ?? null,
        mode,
      });
      void refreshHistory();
    } catch (err) {
      setResult({
        status: "error",
        message: (err as Error).message ?? "Netzwerkfehler",
      });
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-primary">
          Use-Case 1
        </p>
        <h1 className="text-3xl font-bold">Ruling Radar</h1>
        <p className="text-sm text-brand-gray">
          New Swiss Federal Court rulings, automatically triaged for
          Relevanz geprüft und im Hausstil zusammengefasst — als Draft für
          die juristische Review.
        </p>
        <Link
          href="/case-1/drafts"
          className="inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:underline"
        >
          → Drafts für juristische Review
        </Link>
        <Link
          href="/case-1/triage"
          className="ml-4 inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:underline"
        >
          → Triage-Log
        </Link>
      </header>

      <section className="border border-brand-gray-dark">
        <div className="flex border-b border-brand-gray-dark">
          <ModeTab active={mode === "single"} onClick={() => setMode("single")}>
            Einzelnes Urteil
          </ModeTab>
          <ModeTab active={mode === "batch"} onClick={() => setMode("batch")}>
            Batch (LATEST / Datumsbereich)
          </ModeTab>
        </div>

        <div className="p-6 space-y-4">
          {mode === "single" ? (
            <>
              <label htmlFor="ruling-url" className="block text-sm font-bold">
                URL des Bundesgerichtsurteils
              </label>
              <input
                id="ruling-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.bger.ch/ext/eurospider/live/de/php/aza/http/index.php?..."
                className="w-full border border-brand-gray-dark px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
                disabled={result.status === "loading"}
              />
              <p className="text-xs text-brand-gray">
                Beispiel: <code>8C_231/2025</code>. Der Agent fetcht das Urteil
                und erzeugt direkt einen bilingualen Hausstil-Draft —
                <strong> ohne Triage</strong>, da Sie das Urteil manuell ausgewählt
                haben.
              </p>
            </>
          ) : (
            <>
              <fieldset className="space-y-3">
                <legend className="block text-sm font-bold">Modus</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="batch-kind"
                    value="latest"
                    checked={batchKind === "latest"}
                    onChange={() => setBatchKind("latest")}
                    disabled={result.status === "loading"}
                    className="mt-1"
                  />
                  <span>
                    <strong>LATEST</strong> — der neueste verfügbare Tag auf
                    bger.ch.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="batch-kind"
                    value="range"
                    checked={batchKind === "range"}
                    onChange={() => setBatchKind("range")}
                    disabled={result.status === "loading"}
                    className="mt-1"
                  />
                  <span>
                    <strong>Datumsbereich</strong> — alle UV/IV-Urteile in einem
                    Zeitfenster (max. 30 Tage).
                  </span>
                </label>
              </fieldset>

              {batchKind === "range" && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label htmlFor="range-start" className="block text-xs font-bold">
                      Start (YYYY-MM-DD)
                    </label>
                    <input
                      id="range-start"
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      disabled={result.status === "loading"}
                      className="mt-1 w-full border border-brand-gray-dark px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="range-end" className="block text-xs font-bold">
                      Ende (YYYY-MM-DD)
                    </label>
                    <input
                      id="range-end"
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      disabled={result.status === "loading"}
                      className="mt-1 w-full border border-brand-gray-dark px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <p className="text-xs text-brand-gray">
                Der Agent ruft den bger.ch-Crawler, filtert deterministisch auf
                Unfall- und Invalidenversicherung (Stufe 1) und triagiert jeden
                Treffer einzeln. Bei vielen Treffern wird die Volltext-
                Zusammenfassung auf die ersten 5 relevanten Urteile beschränkt.
              </p>
            </>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleRun}
              disabled={result.status === "loading"}
              className="bg-brand-primary px-4 py-2 text-sm font-bold text-brand-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {result.status === "loading" ? "Läuft …" : "Pipeline starten"}
            </button>
          </div>
        </div>
      </section>

      <ResultPanel result={result} />

      <HistoryPanel
        runs={history}
        error={historyError}
        onSelect={(run) =>
          setResult({
            status: "ok",
            response: run.agent_response_md,
            sessionId: run.agent_session_id,
          })
        }
        onRefresh={refreshHistory}
      />

      <div className="border-l-4 border-brand-yellow bg-brand-light p-3 text-xs">
        <strong>Hinweis:</strong> Phase 5 — Pro-Urteil-Karten im Batch-Modus
        mit relevanten und verworfenen Triage-Entscheiden, sowie Links zum
        Original auf bger.ch (<code>agent-triage:v1 + agent-summary:v1</code>).
        SharePoint-Upload via Microsoft Graph.
      </div>
    </div>
  );
}

function ModeTab({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={
        "px-4 py-3 text-sm font-bold " +
        (active
          ? "border-b-2 border-brand-primary text-brand-primary"
          : "text-brand-gray hover:text-brand-primary") +
        (disabled ? " cursor-not-allowed opacity-50 hover:text-brand-gray" : "")
      }
    >
      {children}
    </button>
  );
}

function ResultPanel({ result }: { result: AgentResult }) {
  if (result.status === "idle") return null;

  if (result.status === "loading") {
    return (
      <section className="border border-brand-gray-dark p-6 space-y-3">
        <h2 className="text-sm font-bold">Agent-Antwort</h2>
        <LoadingProgress mode={result.mode} />
      </section>
    );
  }

  if (result.status === "error") {
    return (
      <section className="border-l-4 border-red-600 bg-red-50 p-4">
        <h2 className="text-sm font-bold text-red-900">Fehler</h2>
        <p className="mt-2 text-sm text-red-900">{result.message}</p>
        {result.details != null && (
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs text-red-900/80">
            {typeof result.details === "string"
              ? result.details
              : JSON.stringify(result.details, null, 2)}
          </pre>
        )}
      </section>
    );
  }

  // Prefer structured per-ruling rendering for batch runs with a parsed tail.
  const useStructured =
    result.mode === "batch" &&
    result.structured &&
    result.structured.triage_decisions.length > 0;

  return (
    <section className="border border-brand-gray-dark p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">Agent-Antwort</h2>
        {result.sessionId && (
          <span className="text-xs text-brand-gray">
            Session <code>{result.sessionId}</code>
          </span>
        )}
      </div>

      {useStructured ? (
        <StructuredBatchView
          structured={result.structured!}
          batchMeta={result.batchMeta ?? null}
          rawMarkdown={result.response}
        />
      ) : (
        <article className="prose prose-sm max-w-none prose-headings:font-bold prose-h2:mt-6 prose-h2:border-b prose-h2:border-brand-gray-dark prose-h2:pb-1 prose-h3:mt-4 prose-h3:text-brand-primary prose-p:my-2 prose-li:my-0.5 prose-code:rounded prose-code:bg-brand-light prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-normal prose-code:before:hidden prose-code:after:hidden prose-hr:my-6 prose-hr:border-brand-gray-dark">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {result.response}
          </ReactMarkdown>
        </article>
      )}
    </section>
  );
}

function LoadingProgress({ mode }: { mode: Mode }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Empirically: single ~30-50s, batch Phase A ~30-50s + Phase B ~30s/relevant.
  // Estimated total: single 45s, batch 90s. Used for the determinate fill.
  const estimatedTotal = mode === "single" ? 45 : 90;
  const pct = Math.min(95, Math.round((elapsed / estimatedTotal) * 100));

  const phase = pickPhase(mode, elapsed);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold text-brand-primary">{phase}</span>
        <span className="text-brand-gray tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-brand-gray-dark/20">
        <div
          className="h-full bg-brand-primary transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-brand-gray">
        {mode === "batch"
          ? "Batch kann 1–3 Minuten dauern. Bitte Tab offen lassen."
          : "Einzelnes Urteil dauert typischerweise 30–60s."}
      </p>
    </div>
  );
}

function pickPhase(mode: Mode, elapsed: number): string {
  if (mode === "single") {
    if (elapsed < 4) return "Verbinde mit Foundry Hosted Agent …";
    if (elapsed < 12) return "Lade Volltext von bger.ch …";
    if (elapsed < 40) return "Erstelle Zusammenfassung im Hausstil (DE/FR) …";
    return "Fast fertig — finalisiere Ergebnis …";
  }
  if (elapsed < 4) return "Verbinde mit Foundry Hosted Agent …";
  if (elapsed < 10) return "Lade bger.ch Listing …";
  if (elapsed < 18) return "Stufe 1: filtere UV/IV-Urteile …";
  if (elapsed < 50) return "Stufe 2: Triage Q1–Q4 pro Treffer …";
  if (elapsed < 90) return "Erstelle bilinguale Zusammenfassungen …";
  return "Fast fertig — finalisiere Drafts …";
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function StructuredBatchView({
  structured,
  batchMeta,
  rawMarkdown,
}: {
  structured: StructuredTail;
  batchMeta: BatchMeta | null;
  rawMarkdown: string;
}) {
  const summariesByDocket = new Map(
    structured.ruling_summaries.map((s) => [s.docket, s]),
  );
  const relevant = structured.triage_decisions.filter((d) => d.relevant);
  const dropped = structured.triage_decisions.filter((d) => !d.relevant);
  const totalScreened = batchMeta?.total_screened;
  const stage1 =
    batchMeta?.stage1_passed ?? structured.triage_decisions.length;

  return (
    <div className="space-y-3">
      {batchMeta && (
        <div className="border-l-4 border-brand-primary bg-brand-light p-3 text-xs leading-relaxed">
          {batchMeta.dates_queried && (
            <div>
              <strong>Zeitraum:</strong> {batchMeta.dates_queried}
            </div>
          )}
          {totalScreened !== undefined && (
            <div className="mt-1">
              <strong>Pipeline:</strong> {totalScreened} Urteile auf bger.ch
              gesichtet → <strong>{stage1}</strong> nach Stufe 1 (UV/IV-Filter) →{" "}
              <strong>{relevant.length}</strong> als relevant triagiert
            </div>
          )}
          <div className="mt-1 text-brand-gray">
            Stufe 1 ist ein deterministischer Filter im Crawler (nur
            Unfall-/Invalidenversicherung). Nicht-UV/IV-Urteile werden
            nicht ans LLM geschickt, um Token zu sparen.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="bg-brand-light px-2 py-1">
          <strong>{structured.triage_decisions.length}</strong> LLM-triagiert
        </span>
        <span className="bg-brand-primary px-2 py-1 text-brand-white">
          <strong>{relevant.length}</strong> relevant
        </span>
        <span className="border border-brand-gray-dark px-2 py-1 text-brand-gray">
          <strong>{dropped.length}</strong> verworfen
        </span>
      </div>

      {relevant.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-primary">
            Relevant ({relevant.length})
          </h3>
          {relevant.map((d) => (
            <RulingCard
              key={d.docket}
              decision={d}
              summary={summariesByDocket.get(d.docket)}
              defaultOpen={true}
            />
          ))}
        </div>
      )}

      {dropped.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-gray">
            Verworfen ({dropped.length}) — klicken zum Aufklappen
          </h3>
          {dropped.map((d) => (
            <RulingCard
              key={d.docket}
              decision={d}
              summary={undefined}
              defaultOpen={false}
            />
          ))}
        </div>
      )}

      <details className="border-t border-brand-gray-dark/40 pt-3">
        <summary className="cursor-pointer text-xs text-brand-gray hover:text-brand-primary">
          Raw Agent-Antwort anzeigen
        </summary>
        <article className="prose prose-sm max-w-none pt-3 prose-headings:font-bold prose-h3:text-brand-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{rawMarkdown}</ReactMarkdown>
        </article>
      </details>
    </div>
  );
}

function RulingCard({
  decision,
  summary,
  defaultOpen,
}: {
  decision: StructuredTail["triage_decisions"][number];
  summary: StructuredTail["ruling_summaries"][number] | undefined;
  defaultOpen: boolean;
}) {
  const verdict = decision.relevant
    ? { label: "relevant", cls: "bg-brand-primary text-brand-white" }
    : { label: "verworfen", cls: "bg-brand-gray-dark text-brand-white" };
  return (
    <details
      open={defaultOpen}
      className="border border-brand-gray-dark/60 bg-brand-white"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-brand-light">
        <code className="text-xs font-bold text-brand-primary">
          {decision.docket}
        </code>
        {decision.decision_date && (
          <span className="text-xs text-brand-gray">
            {decision.decision_date}
          </span>
        )}
        <span className={`px-2 py-0.5 text-xs font-bold ${verdict.cls}`}>
          {verdict.label}
        </span>
        {decision.source_url && (
          <a
            href={decision.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto text-xs text-brand-primary hover:underline"
          >
            → bger.ch
          </a>
        )}
      </summary>
      <div className="space-y-2 border-t border-brand-gray-dark/40 px-3 py-3 text-xs">
        <div>
          <strong>Stufe 1:</strong>{" "}
          {decision.stage1_passed ? "✅ bestanden" : "❌ verworfen"} ·{" "}
          {decision.stage1_reason}
        </div>
        {decision.stage1_passed && (
          <div className="space-y-2">
            <div>
              <strong>Versicherung Partei:</strong>{" "}
              {decision.insurer_is_party === true
                ? "Ja"
                : decision.insurer_is_party === false
                  ? "Nein"
                  : "n.a."}
            </div>
            <div className="space-y-1">
              <QRow
                label="Q1 Publikation"
                value={decision.q1_zur_publikation}
                reason={decision.q1_reason}
              />
              <QRow
                label="Q2 Praxisänderung"
                value={decision.q2_praxisaenderung}
                reason={decision.q2_reason}
              />
              <QRow
                label="Q3 Praxisbestätigung"
                value={decision.q3_praxisbestaetigung}
                reason={decision.q3_reason}
              />
              <QRow
                label="Q4 Fallkonstellation"
                value={decision.q4_interessante_fallkonstellation}
                reason={decision.q4_reason}
              />
            </div>
          </div>
        )}
        <div className="border-l-2 border-brand-gray-dark/40 pl-2 italic text-brand-gray">
          {decision.rationale}
        </div>
        {summary && (
          <div className="mt-2 border-t border-brand-gray-dark/40 pt-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-brand-primary">
              Draft-Zusammenfassung
            </div>
            <article className="prose prose-sm max-w-none prose-headings:font-bold prose-h3:mt-3 prose-h3:text-brand-primary prose-h3:text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {summary.summary_markdown}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>
    </details>
  );
}

function fmtBool(v: boolean | null | undefined): string {
  if (v === true) return "Ja";
  if (v === false) return "Nein";
  return "n.a.";
}

function QRow({
  label,
  value,
  reason,
}: {
  label: string;
  value: boolean | null | undefined;
  reason: string | null | undefined;
}) {
  const yes = value === true;
  const no = value === false;
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        <span className="font-bold">{label}:</span>
        <span
          className={
            yes
              ? "font-bold text-brand-primary"
              : no
                ? "text-brand-gray"
                : "text-brand-gray"
          }
        >
          {fmtBool(value)}
        </span>
      </div>
      {reason && (
        <div className="ml-4 text-brand-gray italic">— {reason}</div>
      )}
    </div>
  );
}

function HistoryPanel({
  runs,
  error,
  onSelect,
  onRefresh,
}: {
  runs: RunDoc[];
  error: string | null;
  onSelect: (run: RunDoc) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="border border-brand-gray-dark p-6 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">Verlauf</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-brand-primary hover:underline"
        >
          Aktualisieren
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-700">
          Verlauf nicht geladen: {error}
        </p>
      )}
      {!error && runs.length === 0 && (
        <p className="text-xs text-brand-gray">
          Noch keine Pipeline-Läufe persistiert. Starte oben eine Triage,
          um den ersten Eintrag zu erzeugen.
        </p>
      )}
      {runs.length > 0 && (
        <ul className="divide-y divide-brand-gray-dark/40">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run)}
                className="flex w-full items-baseline justify-between gap-4 py-2 text-left hover:bg-brand-light/50"
              >
                <span className="flex-1 truncate text-xs text-brand-black">
                  <span className="mr-2 inline-block w-12 font-bold uppercase text-brand-primary">
                    {run.mode}
                  </span>
                  {run.user_input}
                </span>
                <span className="shrink-0 text-xs text-brand-gray">
                  {formatTs(run.ts)} · {Math.round(run.duration_ms / 1000)}s
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
