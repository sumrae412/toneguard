# ToneGuard Analysis Contract

ToneGuard analysis results are defined by `shared/analysis/schema.json`.

Canonical shared inputs:

- `shared/analysis/schema.json`
- `shared/analysis/modes.json`
- `shared/analysis/categories.json`
- `shared/analysis/site-profiles.json`
- `shared/prompts/base.md`
- `shared/prompts/landing.md`
- `shared/routing/precheck-rules.json`

Regenerate packaged artifacts with:

```bash
node scripts/generate_shared_artifacts.mjs
```

Generated files include:

- `prompts/base.txt`
- `prompts/landing.txt`
- `toneguard-mcp/critics/landing.md`
- `pwa/generated-prompts.js`
- `android/app/src/main/res/raw/toneguard_base_prompt.txt`

The response keeps legacy fields (`flagged`, `confidence`, `mode`, `readability`, `red_flags`, `categories`, `reasoning`, `suggestion`, `has_questions`, `questions`) and adds:

- `issues`: structured issue cards, while still accepting legacy MCP issue objects.
- `routing`: local pass, standard, deep, or blocked error metadata.
- `intent_mode`: rewrite style mode.
- `voice`: voice preservation metadata.
- `site_profile`: platform-specific behavior metadata.

Telemetry is local-only and allowlisted by `shared/telemetry/schema.json`.
It stores summary fields like route, model, diagnostic code, and categories.
It must not store raw messages, prompts, recipients, API keys, emails, phone numbers, or full URLs.
