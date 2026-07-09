"""Local-dev entrypoint: load .env, then start uvicorn with reload.

Usage::

    cd apps/agent-triage
    uv run python -m agent_triage.dev

The server binds ``0.0.0.0:8000`` by default. Override with the
``AGENT_TRIAGE_HOST`` / ``AGENT_TRIAGE_PORT`` env vars.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def main() -> None:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / ".env",  # apps/agent-triage/.env
        here.parents[4] / ".env",  # repo root .env
    ]
    for candidate in candidates:
        if candidate.exists():
            load_dotenv(candidate, override=True)

    import uvicorn

    uvicorn.run(
        "agent_triage.server:app",
        host=os.environ.get("AGENT_TRIAGE_HOST", "0.0.0.0"),
        port=int(os.environ.get("AGENT_TRIAGE_PORT", "8000")),
        reload=True,
        reload_dirs=[str(here.parent)],
    )


if __name__ == "__main__":
    main()
