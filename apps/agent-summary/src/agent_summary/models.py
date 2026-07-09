"""Pydantic model for a bilingual house-style ruling summary draft.

The Markdown body is a bilingual DE/FR summary (title + prose + French
mirror). We store the rendered Markdown directly — the structure is
enforced by prompt, not by individual fields.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RulingSummary(BaseModel):
    docket: str
    decision_date: str | None = None
    source_url: str | None = None
    title_de: str
    title_fr: str | None = None
    summary_markdown: str = Field(..., description="Bilingual DE + FR Markdown body.")
    style_tier: Literal["tier-0-prompt-only", "tier-1-few-shot"] = "tier-0-prompt-only"
    generated_at: datetime = Field(default_factory=datetime.utcnow)
