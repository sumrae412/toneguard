# Design: Replace the overlay word-level diff with a clean rewrite view

**Date:** 2026-06-15
**Status:** Approved (brainstorming → implementation)

## Problem

The overlay's "Changes" section renders an inline word-level diff (red
strikethrough removals interleaved with green insertions). It reads cleanly for
small tone edits but turns into an unreadable "salad" whenever the synthesizer
restructures a message — which is the common case for ToneGuard, since it merges
two critics and reorders/splits/renumbers sentences.

Root cause: the diff uses a longest-common-subsequence algorithm. When ~80% of
the text changes, LCS latches onto scattered single-word matches and interleaves
them, producing the cluttered output the user reported.

## Decision

Remove the diff entirely. The panel shows:

- **"Your message"** — the plain original (kept; it was never the problem)
- **"Suggested rewrite"** — the clean green editable box (unchanged)
- **"why" reasoning** — unchanged

No inline diff coloring, nothing to decode.

Considered and rejected:
- *Smart diff (auto-hide when messy)* — keeps complexity to solve a problem we
  can delete instead.
- *"What changed" bullets* — added value but adds a model-output field + logic;
  YAGNI for now.
- *Side-by-side / rewrite-only* — user chose to keep the plain original visible.

## Changes

This is a **net deletion** (~70 lines code + CSS + HTML).

| Surface | Change |
|---|---|
| `overlay.html` | Delete the `#tgDiffSection` block (`:47`). `#tgOriginalSection` stays, always visible. |
| `overlay-frame.js` | Delete `wordDiff` (`:131`), `buildDiffView` (`:175`). |
| `overlay-frame.js` | In `showResult`, delete the diff/original toggle (`:322`–`:332`); always show `originalSection`. |
| `overlay-frame.js` | Remove `diffSection` from the `els` map (`:46`) and the diff cleanup in `resetState` (`:211`) / `showResult` (`:323`). |
| `overlay-frame.css` | Delete `.tg-diff`, `.tg-diff-removed`, `.tg-diff-added` rules (light + dark, `:414`, `:424`, `:431`, `:535`–`:537`). |
| `manifest.json` | Bump version (extension dev-loop convention). |

## Verification

- `npm test` (vitest) green — no test should reference `wordDiff`/`buildDiffView`;
  if any do, delete those tests (the behavior is gone, not regressed).
- Manual: load unpacked, trigger a flagged message with a heavy rewrite, confirm
  the panel shows plain original + clean rewrite, no "Changes" section.

## Out of scope

- "What changed" bullets (future enhancement if desired).
- MCP-side analyzer output (no diff there; this is overlay-only).
