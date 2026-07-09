"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Draft = {
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

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      setError(null);
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const publish = useCallback(
    async (id: string) => {
      setPublishingId(id);
      setPublishError(null);
      try {
        const res = await fetch(
          `/api/drafts/${encodeURIComponent(id)}/publish`,
          { method: "POST" },
        );
        const data = await res.json();
        if (!res.ok) {
          setPublishError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  sharepoint_url: data.sharepoint_url ?? null,
                  sharepoint_published_at: new Date().toISOString(),
                }
              : d,
          ),
        );
      } catch (err) {
        setPublishError((err as Error).message);
      } finally {
        setPublishingId(null);
      }
    },
    [],
  );

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-primary">
          Use-Case 1 · Drafts
        </p>
        <h1 className="text-3xl font-bold">Drafts für juristische Review</h1>
        <p className="text-sm text-brand-gray">
          Alle als relevant triagierten Bundesgerichtsurteile, mit
          Zusammenfassung im Hausstil. In Production landen diese als
          Word-Dokument auf SharePoint — hier zum direkten Download als
          Markdown.
        </p>
        <Link
          href="/case-1"
          className="inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:underline"
        >
          ← Zurück zur Pipeline
        </Link>
      </header>

      <section className="border border-brand-gray-dark p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold">
            {loading ? "Lade Drafts …" : `${drafts.length} Drafts`}
          </h2>
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
            Drafts nicht geladen: {error}
          </p>
        )}
        {!error && !loading && drafts.length === 0 && (
          <p className="text-xs text-brand-gray">
            Noch keine Drafts. Sobald ein Urteil in der Pipeline als
            relevant triagiert wird, erscheint hier eine Zusammenfassung.
          </p>
        )}
        {drafts.length > 0 && (
          <ul className="divide-y divide-brand-gray-dark/40">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <button
                  type="button"
                  onClick={() =>
                    setSelectedId(selectedId === d.id ? null : d.id)
                  }
                  className="flex-1 text-left"
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                    {d.docket} · {formatTs(d.ts)}
                  </div>
                  <div className="text-sm text-brand-black">{d.title_de}</div>
                  {d.title_fr && (
                    <div className="text-xs text-brand-gray italic">
                      {d.title_fr}
                    </div>
                  )}
                </button>
                <a
                  href={`/api/drafts/${encodeURIComponent(d.id)}/download`}
                  className="shrink-0 self-center border border-brand-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white"
                  download
                >
                  ↓ .md
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="border border-brand-gray-dark p-6 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold">
              Vorschau: {selected.docket}
              {selected.decision_date && (
                <span className="ml-2 text-xs font-normal text-brand-gray">
                  · {selected.decision_date}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              {selected.source_url && (
                <a
                  href={selected.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-primary hover:underline"
                >
                  → Original auf bger.ch
                </a>
              )}
              {selected.sharepoint_url ? (
                <a
                  href={selected.sharepoint_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-green-700 hover:underline"
                >
                  ✓ Auf SharePoint
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => publish(selected.id)}
                  disabled={publishingId === selected.id}
                  className="border border-brand-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white disabled:opacity-50"
                >
                  {publishingId === selected.id
                    ? "Publiziere …"
                    : "Auf SharePoint publizieren"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-xs text-brand-gray hover:underline"
              >
                Schliessen
              </button>
            </div>
          </div>
          {publishError && publishingId === null && (
            <p className="text-xs text-red-700">
              SharePoint-Upload fehlgeschlagen: {publishError}
            </p>
          )}
          <article className="prose prose-sm max-w-none prose-headings:font-bold prose-h2:mt-6 prose-h2:border-b prose-h2:border-brand-gray-dark prose-h2:pb-1 prose-h3:mt-4 prose-h3:text-brand-primary prose-p:my-2 prose-li:my-0.5 prose-hr:my-6 prose-hr:border-brand-gray-dark">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {`# ${selected.title_de}\n\n${selected.summary_markdown}`}
            </ReactMarkdown>
          </article>
        </section>
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
