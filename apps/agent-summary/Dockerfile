# Multi-stage build for the Ruling Radar hosted agent.
#
# Stage 1 ("builder") installs the project + deps into a venv using uv,
# which is dramatically faster than pip and matches local dev tooling.
# Stage 2 ("runtime") copies just the venv + source into a slim image,
# exposes the Foundry-standard port 8088, and runs main.py.
#
# NOTE: No BuildKit cache mounts — `az acr build` runs the classic
# Docker builder which does not support them.

# ---------- builder ----------
FROM python:3.12-slim AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /bin/

WORKDIR /app

# Install deps first (cached layer) before copying source.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev

COPY src ./src
COPY main.py ./
RUN uv sync --frozen --no-dev

# ---------- runtime ----------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/main.py /app/main.py

# Foundry hosted runtime overrides PORT, but 8088 is the local default.
EXPOSE 8088

CMD ["python", "main.py"]
