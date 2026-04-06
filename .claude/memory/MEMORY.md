# Project Memory

<!-- Index of memory files. Each entry: - [Title](file.md) — one-line description -->
<!-- Keep entries under 150 chars. Content goes in individual files, not here. -->

## Gotchas

- **Sonnet model ID:** Use `claude-sonnet-4-20250514`, NOT `claude-sonnet-4-5-20250514`. The `-4-5-` variant does not exist and returns a 404 error.
- **Build system:** Use `hatchling` as pyproject.toml build backend, not legacy `setuptools.backends._legacy:_Backend`.
- **Python version:** System Python is 3.9.6 (too old for fastmcp). Use `uv` to manage Python + venv. Install with `curl -LsSf https://astral.sh/uv/install.sh | sh`.
- **Running tests:** `source $HOME/.local/bin/env && uv run --extra dev pytest tests/ -v` (not bare `pytest`).
