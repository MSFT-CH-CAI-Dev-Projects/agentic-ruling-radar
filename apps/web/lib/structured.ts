/**
 * Parse the structured JSON tail emitted by both hosted agents
 * (agent-triage and agent-summary).
 *
 * Contract (see apps/agent-triage/src/agent_triage/agent.py and
 * apps/agent-summary/src/agent_summary/agent.py):
 * the agent appends a single fenced ```json block at the very end of
 * its response, preceded by an HTML marker `<!-- structured -->`.
 *
 * Shape: { triage_decisions: [...], ruling_summaries: [...] }.
 *
 * If the tail is missing or malformed we return null and the BFF
 * persists only the run-level Markdown. Never throws.
 */
export type RawTriageDecision = {
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
};

export type RawRulingSummary = {
  docket: string;
  decision_date?: string | null;
  source_url?: string | null;
  title_de: string;
  title_fr?: string | null;
  summary_markdown: string;
  style_tier?: string;
};

export type BatchMeta = {
  dates_queried?: string;
  total_screened?: number;
  stage1_passed?: number;
};

export type StructuredTail = {
  triage_decisions: RawTriageDecision[];
  ruling_summaries: RawRulingSummary[];
};

export type ParsedAgentOutput = {
  visibleMarkdown: string;
  structured: StructuredTail | null;
  batchMeta: BatchMeta | null;
};

const TAIL_RE =
  /<!--\s*structured\s*-->\s*```json\s*([\s\S]+?)\s*```\s*$/i;

/**
 * Repair common agent-side JSON-escape mistakes that would otherwise
 * crash JSON.parse. Most frequent offender: anonymized party names
 * like "A.________" arriving as literal "A.\u________" which is not
 * a valid \uXXXX escape. We rewrite any \u not followed by 4 hex
 * digits to the safe placeholder "u". Same for other invalid
 * single-char escapes we don't expect from the agent.
 */
function repairJsonEscapes(s: string): { repaired: string; changes: number } {
  let changes = 0;
  // Invalid \u escapes: \u not followed by exactly 4 hex digits.
  const fixedU = s.replace(/\\u(?![0-9a-fA-F]{4})/g, () => {
    changes += 1;
    return "u";
  });
  // Stray backslashes before chars that aren't valid JSON escape chars.
  // Valid: " \ / b f n r t u  → keep those. Drop the backslash before
  // anything else (e.g. \_ \. \, \space).
  const fixedAll = fixedU.replace(/\\([^"\\/bfnrtu])/g, (_, ch) => {
    changes += 1;
    return ch;
  });
  return { repaired: fixedAll, changes };
}

export function parseAgentOutput(raw: string): ParsedAgentOutput {
  const batchMeta = parseBatchMeta(raw);
  // Belt-and-braces strip: even if JSON parse fails below, the user must
  // never see the raw <!-- structured --> tail block in the UI. We compute
  // the visible portion as soon as we locate the marker, regardless of
  // whether the JSON inside is parseable.
  const visibleMarkdown = stripStructuredTail(raw);
  const m = raw.match(TAIL_RE);
  if (!m) return { visibleMarkdown, structured: null, batchMeta };
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    const { repaired, changes } = repairJsonEscapes(m[1]);
    if (changes > 0) {
      try {
        parsed = JSON.parse(repaired);
        console.warn(
          `[structured] repaired ${changes} invalid JSON escape(s) in agent tail`,
        );
      } catch (err2) {
        console.warn(
          "[structured] JSON.parse failed even after repair:",
          (err2 as Error).message,
        );
        return { visibleMarkdown, structured: null, batchMeta };
      }
    } else {
      console.warn(
        "[structured] JSON.parse failed on structured tail:",
        (err as Error).message,
      );
      return { visibleMarkdown, structured: null, batchMeta };
    }
  }
  if (!isStructuredTail(parsed)) {
    console.warn("[structured] tail JSON did not match expected shape");
    return { visibleMarkdown, structured: null, batchMeta };
  }
  return { visibleMarkdown, structured: parsed, batchMeta };
}

/**
 * Strip the `<!-- structured -->` JSON tail from agent output even when
 * the strict TAIL_RE doesn't match (e.g. trailing whitespace after the
 * closing fence, missing closing fence, or extra characters appended).
 * The user must never see the raw JSON tail in the UI regardless of
 * parse outcome.
 */
function stripStructuredTail(raw: string): string {
  const markerIdx = raw.search(/<!--\s*structured\s*-->/i);
  if (markerIdx === -1) return raw;
  return raw.slice(0, markerIdx).trimEnd();
}

/**
 * Parse the human-readable batch funnel header from the agent's
 * markdown. The agent emits a block like:
 *
 *   ## Batch-Triage
 *   - **Zeitraum**: 2026-05-29
 *   - **Gesichtet**: 34 Urteile · **Stufe 1 bestanden**: 2
 *
 * We surface those numbers in the UI so users see the full pipeline
 * funnel (scanned → stage-1 → LLM-triaged) rather than just the
 * narrowed-down count.
 */
function parseBatchMeta(raw: string): BatchMeta | null {
  if (!/##\s*Batch-Triage/i.test(raw)) return null;
  const meta: BatchMeta = {};
  const z = raw.match(/\*\*Zeitraum\*\*\s*:\s*([^\n·]+?)(?=\s*\n|·)/i);
  if (z) meta.dates_queried = z[1].trim();
  const g = raw.match(
    /\*\*Gesichtet\*\*\s*:\s*(\d+)\s*Urteile?\s*·\s*\*\*Stufe\s*1\s*bestanden\*\*\s*:\s*(\d+)/i,
  );
  if (g) {
    meta.total_screened = parseInt(g[1], 10);
    meta.stage1_passed = parseInt(g[2], 10);
  }
  return meta.total_screened !== undefined ? meta : null;
}

function isStructuredTail(v: unknown): v is StructuredTail {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.triage_decisions) && Array.isArray(o.ruling_summaries);
}
