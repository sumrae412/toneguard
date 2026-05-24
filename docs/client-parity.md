# ToneGuard Client Parity

| Capability | Chrome | MCP | PWA | Android |
|---|---|---|---|---|
| Shared base prompt artifact | Yes | Partial | Generated artifact exists | Generated raw resource exists |
| Shared landing prompt artifact | Yes | Yes | Generated artifact exists | No |
| Generated freshness tests | Yes | Via JS gate | Yes | Resource generated |
| Golden fixture contract tests | Yes | Yes | Uses JS parser path | Partial |
| Deterministic local pass | Yes | Yes | Yes | Yes |
| Deep route metadata | Yes | Yes | Yes | Yes |
| Structured issue cards | Yes | Parser-compatible | Yes | Parser-compatible later |
| Intent mode | Default setting | Prompt API parameter-ready | Per-check selector | API parameter-ready |
| Voice preservation strength | Popup/options setting | Analyzer parameter | Per-check selector | Spinner setting |
| Typed failures | Yes | Existing exceptions isolated | Yes | Result fields |
| Retry/copy diagnostics UI | Yes | N/A | Yes | App UI follow-up |
| Local telemetry summary | Yes | Not yet | Yes | Not yet |
| Site profiles | Yes | Not yet | PWA profile | Not yet |

All four clients now expose intent mode and voice preservation strength to the user. Voice strength uses the canonical taxonomy across every surface: `preserve`, `balanced`, `polish`, `rewrite` (matches `toneguard-mcp/analyzer.py:VOICE_STRENGTH_LABELS`). Older Android builds shipped a `light`/`balanced`/`strong` taxonomy that silently downgraded to `balanced` server-side; that drift was fixed in the same change that added the PWA selector.
