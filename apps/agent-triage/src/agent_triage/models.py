"""Pydantic model for a single relevance triage decision.

Stage 1 is a deterministic listing filter + Stage 2 an LLM relevance
check. Used as documentation + a contract for the BFF persistence layer
(``triage_decisions`` Cosmos container, PK ``/docket``).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TriageDecision(BaseModel):
    """Outcome of the two-stage relevance triage for one ruling.

    Fields whose stage didn't run stay ``None`` so a reviewer can see
    where a ruling was dropped (e.g. ``stage1_passed=False`` ⇒ Stage 2
    fields are all ``None``).
    """

    docket: str = Field(..., description="bger.ch docket, e.g. 8C_231/2025")
    decision_date: str | None = Field(None, description="Decision date, free-form.")
    source_url: str | None = None

    # Stage 1 — deterministic listing filter (Sachgebiet match).
    stage1_passed: bool
    stage1_reason: str = Field(
        ...,
        description=(
            "Listing-level reason, e.g. 'Sachgebiet contains Unfallversicherung' "
            "or 'dropped: Prozessvoraussetzung'."
        ),
    )

    # Stage 2a — party check.
    insurer_is_party: bool | None = None
    scope_uv_iv: bool | None = None

    # Stage 2b — substantive relevance questions.
    q1_zur_publikation: bool | None = Field(
        None,
        description="Zur Publikation vorgesehen? Mirrors the * marker from the listing.",
    )
    q1_reason: str | None = Field(
        None, description="1-2 sentence rationale for Q1 (DE)."
    )
    q2_praxisaenderung: bool | None = None
    q2_reason: str | None = Field(
        None, description="1-2 sentence rationale for Q2 (DE)."
    )
    q3_praxisbestaetigung: bool | None = None
    q3_reason: str | None = Field(
        None, description="1-2 sentence rationale for Q3 (DE)."
    )
    q4_interessante_fallkonstellation: bool | None = None
    q4_reason: str | None = Field(
        None, description="1-2 sentence rationale for Q4 (DE)."
    )

    # Final verdict.
    relevant: bool = Field(
        ...,
        description="Final verdict. False if stage1 dropped or stage2 says no.",
    )
    rationale: str = Field(
        ...,
        description="Short, jurist-readable explanation, persisted for audit.",
    )
    decided_at: datetime = Field(default_factory=datetime.utcnow)
