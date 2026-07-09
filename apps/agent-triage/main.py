"""Container entrypoint for the Foundry hosted-agent runtime.

The Foundry platform starts the container with no arguments, expects
the agent to listen on ``PORT`` (default 8088) and to expose the
``invocations`` protocol path. ``InvocationsHostServer.run()`` honours
both via the underlying ``azure-ai-agentserver-core`` base class.

For local hot-reload during development, use ``agent_triage.dev``
instead — it wraps uvicorn with ``reload=True`` on port 8000.
"""

from __future__ import annotations

from agent_triage.server import app

if __name__ == "__main__":
    app.run()
