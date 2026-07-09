"""ASGI app exposing the triage agent over the Foundry `invocations` protocol.

`InvocationsHostServer` from `agent_framework_foundry_hosting` is itself
a Starlette ASGI app: it registers a POST `/invocations` handler that
accepts ``{"message": str, "stream": bool}`` and returns the agent's
text response. Designed to run unchanged behind a Foundry hosted-agent
container (see sibling `agent.yaml`).
"""

from __future__ import annotations

from agent_framework_foundry_hosting import InvocationsHostServer

from .agent import build_agent


def create_app() -> InvocationsHostServer:
    return InvocationsHostServer(build_agent())


app = create_app()
