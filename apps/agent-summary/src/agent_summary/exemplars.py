"""Few-shot house-style exemplary summaries.

A domain expert can drop in a handful of "gold standard" summaries
that show the *house style* (tone, structure, level of detail). We drop
them in as Markdown files under ``data/exemplars/`` and inject them
into the agent's system prompt as a "Beispiel-Zusammenfassungen"
section.

Contract for contributors (kept in ``data/exemplars/README.md``):

* One ruling per file, ``*.md``.
* Filename = docket like ``8C_231-2025.md`` (purely cosmetic).
* Content = the *full* house-style summary, exactly as it would appear
  on SharePoint. Optionally prefixed with ``# <Titel>`` H1.

If the folder is empty (default state), this module returns an empty
string and the agent prompt is unchanged — no behaviour regression.

Note: the ``*.md`` exemplar files are intentionally gitignored, so any
in-house examples you add stay local and are never pushed to the repo.
"""

from __future__ import annotations

from importlib.resources import files
from typing import Final

_EXEMPLAR_PACKAGE: Final = "agent_summary.data.exemplars"


def load_exemplars() -> str:
    """Return a Markdown block to inject, or empty string if none."""
    try:
        root = files(_EXEMPLAR_PACKAGE)
    except ModuleNotFoundError:
        return ""

    blocks: list[str] = []
    for resource in sorted(root.iterdir(), key=lambda r: r.name):
        if not resource.is_file() or not resource.name.endswith(".md"):
            continue
        if resource.name == "README.md":
            continue
        text = resource.read_text(encoding="utf-8").strip()
        if not text:
            continue
        blocks.append(text)

    if not blocks:
        return ""

    header = (
        "\n\n# Beispiel-Zusammenfassungen (Hausstil)\n\n"
        "Die folgenden Zusammenfassungen sind echte Hausstil-Vorlagen. "
        "Imitiere Ton, Struktur und Level of Detail — aber kopiere keinen "
        "Inhalt; jedes neue Urteil erhält seine eigene fachliche Würdigung.\n\n"
    )
    return header + "\n\n---\n\n".join(blocks) + "\n"
