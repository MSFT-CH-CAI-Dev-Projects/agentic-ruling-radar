"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Decision = {
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

type Filter = "all" | "relevant" | "rejected";

export default function TriagePage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/triage", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      setError(null);
      setDecisions(Array.isArray(data.decisions) ? data.decisions : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const total = decisions.length;
    const relevant = decisions.filter((d) => d.relevant).length;
    const stage1Dropped = decisions.filter((d) => !d.stage1_passed).length;
    const pct = total === 0 ? 0 : Math.round((relevant / total) * 100);
    return { total, relevant, stage1Dropped, pct };
  }, [decisions]);

  const filtered = useMemo(() => {
    if (filter === "relevant") return decisions.filter((d) => d.relevant);
    if (filter === "rejected") return decisions.filter((d) => !d.relevant);
    return decisions;
  }, [decisions, filter]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-primary">
          Use-Case 1 · Triage Log
        </p>
        <h1 className="text-3xl font-bold">Triage-Entscheide</h1>
        <p className="text-sm text-brand-gray">
          Jedes vom Agenten gescreente Bundesgerichtsurteil mit Stage-1-
          und Stage-2-Begründung. Zeigt, warum ein Urteil als relevant
          markiert wurde — oder warum nicht.
        </p>
        <Link
          href="/case-1"
          className="inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:underline"
        >
          ← Zurück zur Pipeline
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Screened" value={stats.total} />
        <Stat label="Relevant" value={stats.relevant} accent />
        <Stat label="Stage 1 verworfen" value={stats.stage1Dropped} />
        <Stat label="Relevanz-Quote" value={`${stats.pct} %`} />
      </section>

      <section className="border border-brand-gray-dark p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="flex gap-2">
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
              Alle ({decisions.length})
            </FilterTab>
            <FilterTab
              active={filter === "relevant"}
              onClick={() => setFilter("relevant")}
            >
              Relevant ({stats.relevant})
            </FilterTab>
            <FilterTab
              active={filter === "rejected"}
              onClick={() => setFilter("rejected")}
            >
              Verworfen ({decisions.length - stats.relevant})
            </FilterTab>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="text-xs text-brand-primary hover:underline"
          >
            Aktualisieren
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-700">
            Triage-Log nicht geladen: {error}
          </p>
        )}
        {!error && loading && (
          <p className="text-xs text-brand-gray">Lade Triage-Entscheide …</p>
        )}
        {!error && !loading && filtered.length === 0 && (
          <p className="text-xs text-brand-gray">
            Keine Einträge. Trigger eine Pipeline auf der Hauptseite.
          </p>
        )}
        {filtered.length > 0 && (
          <ul className="divide-y divide-brand-gray-dark/40">
            {filtered.map((d) => {
              const isOpen = expandedId === d.id;
              return (
                <li key={d.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : d.id)}
                    className="flex w-full items-start justify-between gap-4 text-left"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                        <span className="text-brand-primary">{d.docket}</span>
                        {d.decision_date && (
                          <span className="text-brand-gray">
                            · {d.decision_date}
                          </span>
                        )}
                        <span className="text-brand-gray">
                          · {formatTs(d.ts)}
                        </span>
                      </div>
                      <div className="text-sm text-brand-black">
                        {d.rationale}
                      </div>
                    </div>
                    <Badge relevant={d.relevant} stage1={d.stage1_passed} />
                  </button>
                  {isOpen && <DecisionDetail d={d} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={`border p-4 ${
        accent
          ? "border-brand-primary bg-brand-light"
          : "border-brand-gray-dark"
      }`}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-brand-gray">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold ${
          accent ? "text-brand-primary" : "text-brand-black"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-1 text-xs font-bold uppercase tracking-wider ${
        active
          ? "border-brand-primary bg-brand-primary text-white"
          : "border-brand-gray-dark text-brand-gray hover:text-brand-primary"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({
  relevant,
  stage1,
}: {
  relevant: boolean;
  stage1: boolean;
}) {
  if (!stage1) {
    return (
      <span className="shrink-0 self-center border border-brand-gray-dark px-2 py-1 text-xs font-bold uppercase text-brand-gray">
        Stage 1 ✗
      </span>
    );
  }
  if (relevant) {
    return (
      <span className="shrink-0 self-center border border-brand-primary bg-brand-primary px-2 py-1 text-xs font-bold uppercase text-white">
        Relevant ✓
      </span>
    );
  }
  return (
    <span className="shrink-0 self-center border border-brand-gray-dark px-2 py-1 text-xs font-bold uppercase text-brand-gray">
      Verworfen
    </span>
  );
}

function DecisionDetail({ d }: { d: Decision }) {
  return (
    <div className="mt-3 ml-4 border-l-2 border-brand-gray-dark/40 pl-4 text-xs space-y-2">
      <div>
        <span className="font-bold text-brand-gray">Stage 1 (Relevanz-Filter): </span>
        <span>{d.stage1_passed ? "bestanden" : "verworfen"} — </span>
        <span className="italic">{d.stage1_reason}</span>
      </div>
      {d.stage1_passed && (
        <div className="space-y-1">
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            <Kv k="Versicherung ist Partei" v={d.insurer_is_party} />
            <Kv k="Scope UV/IV" v={d.scope_uv_iv} />
          </div>
          <Kv k="Q1: Zur Publikation" v={d.q1_zur_publikation} reason={d.q1_reason} />
          <Kv k="Q2: Praxisänderung" v={d.q2_praxisaenderung} reason={d.q2_reason} />
          <Kv k="Q3: Praxisbestätigung" v={d.q3_praxisbestaetigung} reason={d.q3_reason} />
          <Kv k="Q4: Fallkonstellation" v={d.q4_interessante_fallkonstellation} reason={d.q4_reason} />
        </div>
      )}
      {d.source_url && (
        <div>
          <a
            href={d.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-primary hover:underline"
          >
            Quelle ↗
          </a>
          <span className="ml-3 text-brand-gray">run: {d.run_id}</span>
        </div>
      )}
    </div>
  );
}

function Kv({
  k,
  v,
  reason,
}: {
  k: string;
  v?: boolean | null;
  reason?: string | null;
}) {
  let display = "—";
  let cls = "text-brand-gray";
  if (v === true) {
    display = "Ja";
    cls = "text-brand-primary font-bold";
  } else if (v === false) {
    display = "Nein";
    cls = "text-brand-gray";
  }
  return (
    <div>
      <div>
        <span className="text-brand-gray">{k}: </span>
        <span className={cls}>{display}</span>
      </div>
      {reason && (
        <div className="ml-4 text-brand-gray italic">— {reason}</div>
      )}
    </div>
  );
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-CH", {
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
