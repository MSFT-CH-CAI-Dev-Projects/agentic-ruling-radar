// TypeScript port of apps/agent-triage/src/agent_triage/tools/bger_fetcher.py
// (and selected helpers from bger_crawler.py).
//
// Purpose: BFF prefetches Bundesgerichtsurteile from search.bger.ch so that
// the `agent-summary` hosted agent receives the full text inline and can skip
// its `bger_fetch_ruling` tool roundtrip. This shaves 15-30s off each summary
// call and helps us stay under the 120s sync cap.

import * as cheerio from "cheerio";

const USER_AGENT = "RulingRadar/1.0 (+https://example.com; ruling-radar; bff-prefetch)";
const FETCH_TIMEOUT_MS = 30_000;

const AZA_URL_RE =
  /aza:\/\/(\d{2})-(\d{2})-(\d{4})-([0-9A-Za-z]+)-([0-9A-Za-z]+)-(\d{4})/;
const DOCKET_RE = /\b(\d[A-Z]_\d+\/\d{4})\b/;
const DATE_DE_RE = /\bvom\s+(\d{1,2}\.\s*[A-Za-zäöü]+\s*\d{4})\b/;
const DATE_ISO_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

const SECTION_HEADS = [
  "Sachverhalt",
  "Faits",
  "Fatti",
  "Erwägungen",
  "Considérant",
  "Considerando",
  "Demnach erkennt",
  "Par ces motifs",
  "Per questi motivi",
  "Dispositiv",
  "Dispositif",
  "Dispositivo",
];
const SECTION_RE = new RegExp(
  `^\\s*(${SECTION_HEADS.map(escapeRegex).join("|")})[:\\s]`,
  "gm",
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type RulingFetchResult = {
  docket: string;
  decision_date: string;
  language: "de" | "fr" | "it";
  source_url: string;
  title: string;
  sections: Record<string, string>;
  full_text: string;
  full_text_length: number;
};

export type RulingFetchError = {
  error: string;
  url: string;
};

function decodeLatin1(buf: ArrayBuffer): string {
  // bger.ch serves ISO-8859-1; Node's TextDecoder supports "latin1".
  return new TextDecoder("iso-8859-1").decode(buf);
}

function docketFromUrl(url: string): string | null {
  const m = AZA_URL_RE.exec(url);
  if (!m) return null;
  const [, , , , chamberNum, suffix, year] = m;
  return `${chamberNum}_${suffix}/${year}`;
}

function languageFromUrl(url: string): "de" | "fr" | "it" {
  const lower = url.toLowerCase();
  if (lower.includes("/fr/") || lower.includes("lang=fr")) return "fr";
  if (lower.includes("/it/") || lower.includes("lang=it")) return "it";
  return "de";
}

function splitSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const matches = [...text.matchAll(SECTION_RE)];
  if (matches.length === 0) {
    sections.preamble = text.trim();
    return sections;
  }
  if (matches[0].index! > 0) {
    sections.preamble = text.slice(0, matches[0].index!).trim();
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headRaw = m[1];
    const key = headRaw.toLowerCase().split(/\s+/)[0]; // "Demnach erkennt" -> "demnach"
    const bodyStart = m.index! + m[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    sections[key] = text.slice(bodyStart, bodyEnd).trim();
  }
  return sections;
}

function parseDocument(html: string, sourceUrl: string): RulingFetchResult {
  const $ = cheerio.load(html);
  // Strip nav/script/style early so they don't pollute extracted text.
  $("script, style, noscript").remove();
  // Cheerio's .text() collapses inline; we want line breaks between blocks.
  // Mirror BeautifulSoup's get_text("\n", strip=True) by inserting newlines.
  $("br").replaceWith("\n");
  $("p, div, tr, li, h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).append("\n");
  });
  let text = $("body").text() || $.text();
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  let docket = docketFromUrl(sourceUrl) ?? "";
  if (!docket) {
    const m = DOCKET_RE.exec(text);
    if (m) docket = m[1];
  }

  let decisionDate = "";
  const md = DATE_DE_RE.exec(text);
  if (md) {
    decisionDate = md[1];
  } else {
    const mi = DATE_ISO_RE.exec(text);
    if (mi) decisionDate = mi[1];
  }

  const title = $("title").first().text().trim();

  return {
    docket,
    decision_date: decisionDate,
    language: languageFromUrl(sourceUrl),
    source_url: sourceUrl,
    title,
    sections: splitSections(text),
    full_text: text,
    full_text_length: text.length,
  };
}

export async function fetchRuling(
  url: string,
): Promise<RulingFetchResult | RulingFetchError> {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "de-CH,de;q=0.9,fr;q=0.8,en;q=0.5",
  };
  try {
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status} fetching ruling`, url };
    }
    const buf = await res.arrayBuffer();
    const html = decodeLatin1(buf);
    return parseDocument(html, url);
  } catch (err) {
    return { error: `Fetch error: ${(err as Error).message}`, url };
  }
}

export function isFetchError(
  v: RulingFetchResult | RulingFetchError,
): v is RulingFetchError {
  return (v as RulingFetchError).error !== undefined;
}

// Trim full text to fit token budget. Preserves preamble + erwägungen +
// dispositiv when present; falls back to a head-truncate on raw text.
export function trimFullText(
  result: RulingFetchResult,
  maxChars = 24_000,
): string {
  if (result.full_text.length <= maxChars) return result.full_text;
  const sections = result.sections;
  const ordered = [
    "preamble",
    "sachverhalt",
    "faits",
    "fatti",
    "erwägungen",
    "considérant",
    "considerando",
    "demnach",
    "par",
    "per",
    "dispositiv",
    "dispositif",
    "dispositivo",
  ]
    .map((k) => (sections[k] ? `## ${k}\n${sections[k]}` : ""))
    .filter(Boolean)
    .join("\n\n");
  if (ordered && ordered.length <= maxChars) return ordered;
  const source = ordered || result.full_text;
  return source.slice(0, maxChars) + "\n\n[... truncated ...]";
}
