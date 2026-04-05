"""ToneGuard multi-agent analyzer — 2 critics + synthesizer.

Runs Claude Haiku and GPT-4o-mini in parallel, then synthesizes with Claude Sonnet.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import anthropic
import openai

from learning_store import LearningStore

logger = logging.getLogger("toneguard.analyzer")

CRITICS_DIR = Path(__file__).parent / "critics"
STYLE_RULES_MTIME_CHECK_INTERVAL = 60  # seconds


class ToneAnalyzer:
    """Multi-agent tone analysis: 2 critics → synthesizer."""

    def __init__(self, style_rules_path: str, learning_store: LearningStore):
        self.style_rules_path = style_rules_path
        self.store = learning_store
        self._style_rules: str = ""
        self._style_rules_mtime: float = 0
        self._last_mtime_check: float = 0
        self._claude_prompt: str = ""
        self._gpt_prompt: str = ""
        self._load_critic_prompts()
        self._reload_style_rules()

        self._anthropic = anthropic.AsyncAnthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        )
        self._openai = openai.AsyncOpenAI(
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        )

    def _load_critic_prompts(self) -> None:
        claude_path = CRITICS_DIR / "claude-tone.md"
        gpt_path = CRITICS_DIR / "gpt-tone.md"
        self._claude_prompt = claude_path.read_text() if claude_path.exists() else ""
        self._gpt_prompt = gpt_path.read_text() if gpt_path.exists() else ""

    def _reload_style_rules(self) -> None:
        try:
            mtime = os.path.getmtime(self.style_rules_path)
            if mtime != self._style_rules_mtime:
                with open(self.style_rules_path, "r") as f:
                    self._style_rules = f.read()
                self._style_rules_mtime = mtime
        except OSError:
            pass

    def _maybe_reload_style_rules(self) -> None:
        now = time.time()
        if now - self._last_mtime_check > STYLE_RULES_MTIME_CHECK_INTERVAL:
            self._last_mtime_check = now
            self._reload_style_rules()

    def _build_context(self, message: str, context: str = "", recipient: str = "") -> str:
        self._maybe_reload_style_rules()
        learning = self.store.get_learning_context(limit=5)
        parts = [f"## Message to analyze\n\n{message}"]

        if context:
            parts.append(f"## Context\n\n{context}")
        if recipient:
            rel = (self.store.get("relationships") or {}).get(recipient, {})
            parts.append(
                f"## Recipient: {recipient}\n"
                f"Messages exchanged: {rel.get('messageCount', 'unknown')}\n"
                f"Last contact: {rel.get('lastSeen', 'unknown')}"
            )
        if self._style_rules:
            parts.append(f"## Style Rules\n\n{self._style_rules}")
        if learning["voice_samples"]:
            samples = "\n".join(f"- {s.get('text', '')}" for s in learning["voice_samples"])
            parts.append(f"## Voice Samples\n\n{samples}")
        if learning["recent_decisions"]:
            decisions = "\n".join(
                f"- {d.get('action', '')}: \"{d.get('original', '')[:80]}...\""
                for d in learning["recent_decisions"]
            )
            parts.append(f"## Recent Decisions\n\n{decisions}")

        return "\n\n---\n\n".join(parts)

    async def analyze(
        self,
        message: str,
        context: str = "",
        recipient: str = "",
    ) -> dict[str, Any]:
        """Run both critics in parallel, then synthesize."""
        user_context = self._build_context(message, context, recipient)

        # Run critics in parallel
        claude_result, gpt_result = await asyncio.gather(
            self._call_claude(user_context),
            self._call_gpt(user_context),
            return_exceptions=True,
        )

        # Handle partial failures
        claude_ok = not isinstance(claude_result, Exception)
        gpt_ok = not isinstance(gpt_result, Exception)

        if not claude_ok:
            logger.error("Claude critic failed: %s", claude_result)
            claude_result = {"flagged": False, "issues": [], "suggestion": "", "confidence": 0}
        if not gpt_ok:
            logger.error("GPT critic failed: %s", gpt_result)
            gpt_result = {"flagged": False, "issues": [], "suggestion": "", "confidence": 0}

        # Synthesize
        synthesis = await self._synthesize(message, claude_result, gpt_result)
        synthesis["agents"] = {
            "claude": "ok" if claude_ok else "error",
            "gpt": "ok" if gpt_ok else "error",
        }
        return synthesis

    async def _call_claude(self, user_context: str) -> dict[str, Any]:
        resp = await self._anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=self._claude_prompt,
            messages=[{"role": "user", "content": user_context}],
        )
        return self._parse_json(resp.content[0].text)

    async def _call_gpt(self, user_context: str) -> dict[str, Any]:
        resp = await self._openai.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=1024,
            messages=[
                {"role": "system", "content": self._gpt_prompt},
                {"role": "user", "content": user_context},
            ],
        )
        return self._parse_json(resp.choices[0].message.content or "")

    async def _synthesize(
        self,
        original: str,
        claude_result: dict,
        gpt_result: dict,
    ) -> dict[str, Any]:
        """Synthesize two critic outputs into final result."""
        prompt = (
            "You are a synthesis judge. Two critics analyzed a message for tone and clarity issues.\n\n"
            f"## Original Message\n\n{original}\n\n"
            f"## Claude Critic Output\n\n{json.dumps(claude_result, indent=2)}\n\n"
            f"## GPT Critic Output\n\n{json.dumps(gpt_result, indent=2)}\n\n"
            "## Your Task\n\n"
            "For each issue from either critic, decide: ADOPT (include in final), REJECT (false positive), or DEFER (borderline).\n"
            "Write the best possible rewrite combining the strongest catches from both critics.\n"
            "Return ONLY valid JSON:\n"
            '{"flagged": bool, "issues": [{"rule": str, "quote": str, "explanation": str}], '
            '"rewrite": str, "confidence": float}'
        )

        try:
            resp = await self._anthropic.messages.create(
                model="claude-sonnet-4-5-20250514",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            result = self._parse_json(resp.content[0].text)
        except Exception as e:
            logger.error("Synthesizer failed: %s", e)
            # Fallback: merge issues from both critics
            all_issues = claude_result.get("issues", []) + gpt_result.get("issues", [])
            result = {
                "flagged": claude_result.get("flagged", False) or gpt_result.get("flagged", False),
                "issues": all_issues,
                "rewrite": claude_result.get("suggestion", "") or gpt_result.get("suggestion", ""),
                "confidence": max(
                    claude_result.get("confidence", 0),
                    gpt_result.get("confidence", 0),
                ),
            }

        # Add diff
        rewrite = result.get("rewrite", "")
        if rewrite:
            result["diff"] = _compute_diff(original, rewrite)
        else:
            result["diff"] = []

        return result

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any]:
        """Parse JSON from critic output, handling markdown code fences."""
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            # Remove first and last lines (fences)
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON object in the text
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
            return {"flagged": False, "issues": [], "suggestion": "", "confidence": 0}


def _compute_diff(original: str, rewrite: str) -> list[dict[str, str]]:
    """Word-level diff between original and rewrite."""
    orig_words = original.split()
    new_words = rewrite.split()

    # Simple LCS-based diff
    m, n = len(orig_words), len(new_words)
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if orig_words[i - 1] == new_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    # Backtrack to build diff
    diff: list[dict[str, str]] = []
    i, j = m, n
    result: list[tuple[str, str]] = []

    while i > 0 or j > 0:
        if i > 0 and j > 0 and orig_words[i - 1] == new_words[j - 1]:
            result.append(("same", orig_words[i - 1]))
            i -= 1
            j -= 1
        elif j > 0 and (i == 0 or dp[i][j - 1] >= dp[i - 1][j]):
            result.append(("added", new_words[j - 1]))
            j -= 1
        else:
            result.append(("removed", orig_words[i - 1]))
            i -= 1

    result.reverse()

    # Merge consecutive same-type spans
    for type_, text in result:
        if diff and diff[-1]["type"] == type_:
            diff[-1]["text"] += " " + text
        else:
            diff.append({"type": type_, "text": text})

    return diff
