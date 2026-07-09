# House-style example summaries (drop-zone)

This folder is the **drop-zone** for your own exemplary summaries — the
"gold standard" reference summaries that show your in-house style
(tone, structure, level of detail).

## Local-only by design

The example `*.md` files in this folder are **gitignored** — they stay
on your machine (and in your locally built agent image) and are **never
pushed** to the repository. Only this `README.md` is tracked. This keeps
any organization-specific reference material out of the public repo.

Add your files here locally, then build/deploy the agent image (the
Docker build copies whatever is present in this folder at build time).

## Contract

* **One ruling per file**, extension `.md`.
* **Filename** = docket like `8C_231-2025.md` (purely cosmetic — the
  loader ignores filenames apart from `README.md`).
* **Content** = the *full* summary, exactly as it would be published.
  Optionally prefixed with a `# <Titel>` H1.

## How it's used

`agent_summary.exemplars.load_exemplars()` reads every `*.md` in this
folder (except `README.md`), concatenates them, and prepends them to the
agent's system prompt as a "Beispiel-Zusammenfassungen (Hausstil)"
section. The agent is instructed to **imitate the style, not the
content**.

## Current state

Empty in the repository. If no example files are present, the loader
returns an empty string and the agent prompt is unchanged (no behaviour
regression). Drop your own examples in here to enable few-shot style
mimicry.
