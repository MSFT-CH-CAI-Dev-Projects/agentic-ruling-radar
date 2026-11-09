"""Fetch and parse a single Bundesgerichtsurteil from search.bger.ch.

Replaces the Phase-1a stub. Two things to know about bger.ch:

1. Pages are server-rendered, Latin-1 encoded. httpx's chardet will
   often get this right, but we force ``iso-8859-1`` to avoid the
   v1-era mojibake (`Erw\xc3\xa4gungen` instead of `Erwägungen`).

2. The "show_document" page bundles everything in a single
   ``<div id='content'>`` or ``<div class='paragraph'>`` blob. Most
   of the metadata (parties, Abteilung, Sachverhalt headings) lives
   inline in plain text, separated by `<br>`/blank lines. We extract
   what we can with light regex; the LLM downstream does the heavy
   lifting on free-text sections.

Used by the triage agent's tool list. Side-effect free (no caching,
no logging beyond Python `logging` — Cosmos persistence lives at the
agent orchestration layer, see Phase 3c/3d).
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from agent_framework import tool
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

USER_AGENT = "RulingRadar/1.0 (+https://example.com; ruling-radar)"
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

_DOCKET_RE = re.compile(r"\b(\d[A-Z]_\d+/\d{4})\b")
_DATE_DE_RE = re.compile(r"\bvom\s+(\d{1,2}\.\s*[A-Za-zäöü]+\s*\d{4})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_AZA_URL_RE = re.compile(
    r"aza://(\d{2})-(\d{2})-(\d{4})-([0-9A-Za-z]+)-([0-9A-Za-z]+)-(\d{4})",
)
# Section headings we try to split the ruling body on. Order matters —
# we pass them to a single regex with alternation.
_SECTION_HEADS = [
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
]
_SECTION_RE = re.compile(
    r"^\s*(?P<head>" + "|".join(re.escape(s) for s in _SECTION_HEADS) + r")[:\s]",
    re.MULTILINE,
)


def _decode_latin1(content: bytes) -> str:
    """Decode bger.ch HTML. ISO-8859-1 with a UTF-8 fallback for safety."""
    try:
        return content.decode("iso-8859-1")
    except UnicodeDecodeError:  # pragma: no cover - extremely unlikely
        return content.decode("utf-8", errors="replace")


def _canonical_ruling_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.hostname == "www.bger.ch" and parsed.path.startswith(
        "/ext/eurospider/live/"
    ):
        parsed = parsed._replace(scheme="https", netloc="search.bger.ch")
        return urlunsplit(parsed)
    return url


def _docket_from_url(url: str) -> str | None:
    """Extract docket like ``8C_231/2025`` from a show_document URL."""
    m = _AZA_URL_RE.search(url)
    if not m:
        return None
    chamber_num, suffix, year = m.group(4), m.group(5), m.group(6)
    return f"{chamber_num}_{suffix}/{year}"


def _language_from_url(url: str) -> str:
    lower = url.lower()
    if "/fr/" in lower or "lang=fr" in lower:
        return "fr"
    if "/it/" in lower or "lang=it" in lower:
        return "it"
    return "de"


def _split_sections(text: str) -> dict[str, str]:
    """Split full text on canonical section headings.

    Returns a dict keyed by lower-case canonical name. Missing sections
    just don't appear. The chunk before the first match is stored under
    ``"preamble"`` (contains parties, Abteilung, etc.).
    """
    sections: dict[str, str] = {}
    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        sections["preamble"] = text.strip()
        return sections

    if matches[0].start() > 0:
        sections["preamble"] = text[: matches[0].start()].strip()

    for i, m in enumerate(matches):
        head_raw = m.group("head")
        key = head_raw.lower().split()[0]  # "Demnach erkennt" -> "demnach"
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[key] = text[body_start:body_end].strip()
    return sections


def _parse(html: str, source_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    # Strip nav / script / style early so they don't pollute get_text.
    for el in soup(["script", "style", "noscript"]):
        el.decompose()

    text = soup.get_text("\n", strip=True)
    # Collapse runs of blank lines so section heuristics work.
    text = re.sub(r"\n{3,}", "\n\n", text)

    docket = _docket_from_url(source_url) or ""
    if not docket:
        m = _DOCKET_RE.search(text)
        if m:
            docket = m.group(1)

    date = ""
    m = _DATE_DE_RE.search(text)
    if m:
        date = m.group(1)
    elif _DATE_ISO_RE.search(text):
        date = _DATE_ISO_RE.search(text).group(1)  # type: ignore[union-attr]

    title = ""
    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)

    sections = _split_sections(text)

    return {
        "docket": docket,
        "decision_date": date,
        "language": _language_from_url(source_url),
        "source_url": source_url,
        "title": title,
        "sections": sections,
        "full_text": text,
        "full_text_length": len(text),
    }


@tool
async def bger_fetch_ruling(url: str) -> dict:
    """Fetch a Swiss Federal Court ruling page and return parsed content.

    Args:
        url: Full ``search.bger.ch`` URL of a single ruling. Either the
            ``show_document`` variant (preferred — contains the full
            text) or any URL that redirects to it.

    Returns:
        Dict with keys ``docket``, ``decision_date``, ``language``,
        ``source_url``, ``title``, ``sections`` (dict of canonical
        sections — ``preamble``, ``sachverhalt``, ``erwägungen``,
        ``dispositiv``, ``faits``, ``considérant``, ``dispositif``,
        plus IT equivalents), ``full_text`` (joined plain text),
        ``full_text_length``. On HTTP error: ``{"error": str, "url": str}``
        so the agent can react in its prompt instead of crashing.
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-CH,de;q=0.9,fr;q=0.8,en;q=0.5",
    }
    try:
        async with httpx.AsyncClient(
            headers=headers, timeout=_TIMEOUT, follow_redirects=True
        ) as client:
            r = await client.get(_canonical_ruling_url(url))
            r.raise_for_status()
            html = _decode_latin1(r.content)
    except httpx.HTTPError as exc:
        logger.warning("bger_fetch_ruling failed url=%s err=%s", url, exc)
        return {
            "error": f"HTTP error fetching ruling: {exc}",
            "url": url,
        }

    return _parse(html, url)
