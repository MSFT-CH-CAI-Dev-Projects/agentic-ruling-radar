"""List rulings from search.bger.ch index + daily listing pages.

Powers Mode B (LATEST / date range) of the Ruling Radar demo. The
listing pages are the **cheap Stage-1 filter** in the triage workflow
(see ``specs/002-case1-refined/triage-refined.md §3``):

* deterministic UV/IV match on the Sachgebiet column,
* exclusion of pure "Prozessvoraussetzung" rows,
* capture of the `*` (Leitentscheid / "zur Publikation vorgesehen")
  marker for the Q1 relevance question downstream.

By doing the Stage-1 filter inside the tool we keep the LLM cost flat:
the agent only sees rows that already passed the cheap filter, then
spends tokens on Stage 2 (open + read each ruling).

Two public tools:

* :func:`bger_list_latest` — most recent N working days.
* :func:`bger_list_range` — explicit ``YYYY-MM-DD`` window.

Both return the same shape: a list of dicts with ``docket``,
``decision_date``, ``sachgebiet``, ``leitentscheid``, ``url``.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any

import httpx
from agent_framework import tool
from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

USER_AGENT = "RulingRadar/1.0 (+https://example.com; ruling-radar)"
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

_BGER_HOST = "https://search.bger.ch"
_INDEX_URL = (
    f"{_BGER_HOST}/ext/eurospider/live/de/php/aza/http/"
    "index_aza.php?lang=de&mode=index&search=false"
)
_DAY_URL = (
    f"{_BGER_HOST}/ext/eurospider/live/de/php/aza/http/"
    "index_aza.php?date={ymd}&lang=de&mode=news"
)

# Sachgebiet matchers. We keep them broad on purpose — the listing
# column uses inconsistent casing/spelling across years, and the cost
# of a false positive (open one extra ruling) is much lower than the
# cost of a false negative (miss a relevant case).
_KEEP_RE = re.compile(
    r"(unfallversicherung|invalidenversicherung"
    r"|assurance[-\s]accidents?|assurance[-\s]invalidit[ée])",
    re.IGNORECASE,
)
_DROP_RE = re.compile(
    r"(prozessvoraussetzung|conditions?\s+de\s+proc[eé]dure)",
    re.IGNORECASE,
)

_DAY_LINK_RE = re.compile(
    r"index_aza\.php\?date=(\d{8})&(?:amp;)?lang=de&(?:amp;)?mode=news"
)
_DOCKET_RE = re.compile(r"\b(\d[A-Z]_\d+/\d{4})\b")


def _decode_latin1(content: bytes) -> str:
    try:
        return content.decode("iso-8859-1")
    except UnicodeDecodeError:  # pragma: no cover
        return content.decode("utf-8", errors="replace")


async def _fetch(url: str, client: httpx.AsyncClient) -> str:
    r = await client.get(url)
    r.raise_for_status()
    return _decode_latin1(r.content)


def _parse_index_dates(html: str) -> list[str]:
    """Return available day codes (YYYYMMDD), newest first."""
    seen: list[str] = []
    for m in _DAY_LINK_RE.finditer(html):
        ymd = m.group(1)
        if ymd not in seen:
            seen.append(ymd)
    return seen


def _format_date(ymd: str) -> str:
    """Convert ``20260529`` -> ``2026-05-29``."""
    return f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"


def _row_to_entry(row: Tag, ymd: str) -> dict[str, Any] | None:
    """Extract one listing row. Returns ``None`` if the row is a header
    or doesn't contain a ruling link."""
    link = row.find("a", href=re.compile(r"highlight_docid=aza://"))
    if not link:
        return None
    url = link.get("href", "")
    # Docket is the link text, e.g. "8C_503/2024".
    docket_text = link.get_text(strip=True)
    m = _DOCKET_RE.search(docket_text)
    if not m:
        return None
    docket = m.group(1)
    decision_date = None
    for td in row.find_all("td"):
        text = td.get_text(strip=True)
        if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", text):
            try:
                decision_date = datetime.strptime(text, "%d.%m.%Y").date().isoformat()
            except ValueError:
                logger.warning("invalid decision date docket=%s date=%s", docket, text)
            break

    # Sachgebiet lives either in <CITE> (with optional `*` suffix
    # marking Leitentscheid) or in a plain <TD>. Walk all TDs and
    # pick the last non-empty text that isn't the docket or the date.
    sachgebiet_raw = ""
    cite = row.find("cite")
    if cite:
        sachgebiet_raw = cite.get_text(strip=True)
    else:
        for td in row.find_all("td"):
            text = td.get_text(strip=True)
            if not text or text == docket_text:
                continue
            # Skip date cells (DD.MM.YYYY).
            if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", text):
                continue
            sachgebiet_raw = text

    leitentscheid = sachgebiet_raw.endswith("*")
    sachgebiet = sachgebiet_raw.rstrip("*").strip()

    return {
        "docket": docket,
        "decision_date": decision_date,
        "sachgebiet": sachgebiet,
        "leitentscheid": leitentscheid,
        "url": url,
    }


def _parse_day_listing(html: str, ymd: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    entries: list[dict[str, Any]] = []
    for row in soup.find_all("tr"):
        entry = _row_to_entry(row, ymd)
        if entry:
            entries.append(entry)
    return entries


def _stage1_filter(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop rows that obviously don't concern UV/IV."""
    kept: list[dict[str, Any]] = []
    for r in rows:
        sg = r["sachgebiet"]
        if not sg:
            continue
        if _DROP_RE.search(sg):
            continue
        if not _KEEP_RE.search(sg):
            continue
        kept.append(r)
    return kept


async def _list_for_dates(dates: list[str], include_all: bool) -> dict[str, Any]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-CH,de;q=0.9",
    }
    all_rows: list[dict[str, Any]] = []
    async with httpx.AsyncClient(
        headers=headers, timeout=_TIMEOUT, follow_redirects=True
    ) as client:
        for ymd in dates:
            try:
                html = await _fetch(_DAY_URL.format(ymd=ymd), client)
            except httpx.HTTPError as exc:
                logger.warning("day listing failed ymd=%s err=%s", ymd, exc)
                return {
                    "error": f"HTTP error fetching listing for {_format_date(ymd)}: {exc}"
                }
            all_rows.extend(_parse_day_listing(html, ymd))

    kept = all_rows if include_all else _stage1_filter(all_rows)
    return {
        "dates_queried": [_format_date(d) for d in dates],
        "total_rows": len(all_rows),
        "kept_rows": len(kept),
        "rulings": kept,
    }


async def _available_dates() -> list[str]:
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "de-CH,de;q=0.9"}
    async with httpx.AsyncClient(
        headers=headers, timeout=_TIMEOUT, follow_redirects=True
    ) as client:
        html = await _fetch(_INDEX_URL, client)
    return _parse_index_dates(html)


@tool
async def bger_list_latest(days: int = 1, include_all: bool = False) -> dict:
    """List Stage-1-relevant rulings from the most recent N working days.

    Args:
        days: How many recent working days to scan (newest first).
            Default 1 (the most recent day with published rulings).
            The tool capped at 14 to avoid runaway scans.
        include_all: When True, skip the deterministic UV/IV filter
            and return every row. Default False — agent should keep
            this False to save tokens.

    Returns:
        Dict with ``dates_queried``, ``total_rows``, ``kept_rows`` and
        ``rulings`` (list of {docket, decision_date, sachgebiet,
        leitentscheid, url}). On HTTP failure: ``{"error": str}``.
    """
    days = max(1, min(int(days), 14))
    try:
        all_dates = await _available_dates()
    except httpx.HTTPError as exc:
        return {"error": f"HTTP error fetching index: {exc}"}
    if not all_dates:
        return {"error": "bger.ch index returned no dates."}
    return await _list_for_dates(all_dates[:days], include_all)


@tool
async def bger_list_range(
    start_date: str, end_date: str, include_all: bool = False
) -> dict:
    """List Stage-1-relevant rulings from a YYYY-MM-DD..YYYY-MM-DD window.

    Args:
        start_date: ISO date, inclusive. E.g. ``"2026-05-01"``.
        end_date: ISO date, inclusive. Must be >= start_date.
        include_all: See :func:`bger_list_latest`.

    Returns:
        Same shape as :func:`bger_list_latest`. Only dates that bger.ch
        actually has rulings for are queried (weekends/holidays drop
        out automatically). Capped at 30 calendar days.
    """
    try:
        d_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        d_end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError as exc:
        return {"error": f"Invalid date format (need YYYY-MM-DD): {exc}"}
    if d_end < d_start:
        return {"error": "end_date must be >= start_date"}
    if (d_end - d_start).days > 30:
        return {"error": "Window too wide (max 30 days)."}

    try:
        all_dates = await _available_dates()
    except httpx.HTTPError as exc:
        return {"error": f"HTTP error fetching index: {exc}"}

    selected: list[str] = []
    for ymd in all_dates:
        d = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
        if d_start <= d <= d_end:
            selected.append(ymd)
    if not selected:
        return {
            "dates_queried": [],
            "total_rows": 0,
            "kept_rows": 0,
            "rulings": [],
            "note": (
                "bger.ch has no published rulings in this window. "
                "Try a wider range or 'latest'."
            ),
        }
    return await _list_for_dates(selected, include_all)
