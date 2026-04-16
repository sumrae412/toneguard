"""ToneGuard multi-agent analyzer — 2 critics + synthesizer + self-grading.

Runs Claude Haiku and GPT-4o-mini in parallel (each producing a competing
rewrite), synthesizes with Claude Sonnet using rubric scoring, then
self-grades and refines if any dimension falls below B.
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

# Rubric dimensions evaluated by the synthesizer
RUBRIC_DIMENSIONS = [
    "tone",
    "clarity",
    "brevity",
    "empathy",
    "directness",
    "voice_fidelity",
]

# Self-grade threshold: any dimension below this triggers refinement
GRADE_THRESHOLD = 83  # B

# Maximum refinement passes before returning best attempt
MAX_REFINEMENT_PASSES = 2


def _score_to_grade(score: int) -> str:
    """Convert numeric score (0-100) to letter grade."""
    if score >= 93:
        return "A"
    if score >= 90:
        return "A-"
    if score >= 87:
        return "B+"
    if score >= 83:
        return "B"
    if score >= 80:
        return "B-"
    if score >= 77:
        return "C+"
    if score >= 73:
        return "C"
    if score >= 70:
        return "C-"
    if score >= 60:
        return "D"
    return "F"


class ToneAnalyzer:
    """Multi-agent tone analysis: 2 critics → synthesizer → self-grade."""

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

    def _build_context(
        self, message: str, context: str = "", recipient: str = ""
    ) -> str:
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
            samples = "\n".join(
                f"- {s.get('text', '')}" for s in learning["voice_samples"]
            )
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
        """Run both critics in parallel, synthesize, then self-grade."""
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
            claude_result = _empty_critic_result()
        if not gpt_ok:
            logger.error("GPT critic failed: %s", gpt_result)
            gpt_result = _empty_critic_result()

        # Synthesize with rubric scoring and competing rewrites
        synthesis = await self._synthesize(message, claude_result, gpt_result)
        synthesis["agents"] = {
            "claude": "ok" if claude_ok else "error",
            "gpt": "ok" if gpt_ok else "error",
        }

        # Self-grade loop: refine if any rubric dimension < B
        if synthesis.get("flagged") and synthesis.get("rubric"):
            synthesis = await self._self_grade(message, synthesis)

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

    def _build_synthesizer_prompt(
        self,
        original: str,
        claude_result: dict,
        gpt_result: dict,
    ) -> str:
        """Build the synthesizer prompt with rubric scoring and rewrite competition."""
        voice_samples = self.store.get_learning_context(limit=5).get(
            "voice_samples", []
        )
        voice_section = ""
        if voice_samples:
            samples_text = "\n".join(
                f"- {s.get('text', '')}" for s in voice_samples
            )
            voice_section = (
                f"\n## User Voice Samples (match this style in the rewrite)\n\n"
                f"{samples_text}\n"
            )

        return (
            "You are a synthesis judge and writing coach. Two critics analyzed a "
            "message for tone and clarity issues. Each produced their own rewrite.\n\n"
            f"## Original Message\n\n{original}\n\n"
            f"## Claude Critic Output\n\n{json.dumps(claude_result, indent=2)}\n\n"
            f"## GPT Critic Output\n\n{json.dumps(gpt_result, indent=2)}\n"
            f"{voice_section}\n"
            "## Your Task\n\n"
            "1. **Evaluate issues:** For each issue from either critic, decide: "
            "ADOPT (include in final), REJECT (false positive), or DEFER (borderline).\n\n"
            "2. **Pick the best rewrite:** Compare the two competing rewrites from "
            "the critics. Pick the stronger one as your base, then improve it by "
            "incorporating the best elements from the other. If the user has voice "
            "samples, the rewrite MUST sound like them — match their rhythm, "
            "vocabulary, and level of formality.\n\n"
            "3. **Score the rewrite** on a rubric with 6 dimensions. For each, "
            "give a numeric score 0-100 and a brief note:\n"
            "   - **tone**: Emotional register — no passive-aggression or manipulation\n"
            "   - **clarity**: Easy to understand on first read\n"
            "   - **brevity**: Minimum words to convey the point\n"
            "   - **empathy**: Awareness of recipient's perspective\n"
            "   - **directness**: Gets to the point without hedging\n"
            "   - **voice_fidelity**: Matches the user's natural style (from voice samples)\n\n"
            "Return ONLY valid JSON:\n"
            "```json\n"
            "{\n"
            '  "flagged": true,\n'
            '  "issues": [{"rule": "str", "quote": "str", "explanation": "str"}],\n'
            '  "rewrite": "the best rewrite",\n'
            '  "confidence": 0.85,\n'
            '  "rewrite_source": "claude" | "gpt" | "merged",\n'
            '  "rubric": {\n'
            '    "tone": {"score": 93, "note": "brief note"},\n'
            '    "clarity": {"score": 87, "note": "brief note"},\n'
            '    "brevity": {"score": 90, "note": "brief note"},\n'
            '    "empathy": {"score": 95, "note": "brief note"},\n'
            '    "directness": {"score": 83, "note": "brief note"},\n'
            '    "voice_fidelity": {"score": 90, "note": "brief note"}\n'
            "  }\n"
            "}\n"
            "```"
        )

    async def _synthesize(
        self,
        original: str,
        claude_result: dict,
        gpt_result: dict,
    ) -> dict[str, Any]:
        """Synthesize two critic outputs with rubric scoring."""
        prompt = self._build_synthesizer_prompt(original, claude_result, gpt_result)

        try:
            resp = await self._anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            result = self._parse_json(resp.content[0].text)
        except Exception as e:
            logger.error("Synthesizer failed: %s", e)
            # Fallback: merge issues from both critics, no rubric
            all_issues = claude_result.get("issues", []) + gpt_result.get(
                "issues", []
            )
            best_rewrite = (
                claude_result.get("rewrite", "")
                or claude_result.get("suggestion", "")
                or gpt_result.get("rewrite", "")
                or gpt_result.get("suggestion", "")
            )
            result = {
                "flagged": claude_result.get("flagged", False)
                or gpt_result.get("flagged", False),
                "issues": all_issues,
                "rewrite": best_rewrite,
                "confidence": max(
                    claude_result.get("confidence", 0),
                    gpt_result.get("confidence", 0),
                ),
                "rewrite_source": "claude" if claude_result.get("rewrite") else "gpt",
            }

        # Normalize rubric: add letter grades from scores
        result = _normalize_rubric(result)

        # Add diff
        rewrite = result.get("rewrite", "")
        if rewrite:
            result["diff"] = _compute_diff(original, rewrite)
        else:
            result["diff"] = []

        # Initialize grade history
        rubric = result.get("rubric")
        if rubric:
            overall = _compute_overall(rubric)
            result["overall_grade"] = overall["grade"]
            result["overall_score"] = overall["score"]
            result["refinement_passes"] = 0
            result["grade_history"] = [
                {
                    "pass": 0,
                    "overall_grade": overall["grade"],
                    "overall_score": overall["score"],
                }
            ]

        return result

    async def _self_grade(
        self, original: str, result: dict[str, Any]
    ) -> dict[str, Any]:
        """Refine the rewrite if any rubric dimension scores below threshold."""
        rubric = result.get("rubric", {})
        refinement_attempts = 0

        while refinement_attempts < MAX_REFINEMENT_PASSES:
            weak_dims = _find_weak_dimensions(rubric)
            if not weak_dims:
                break  # All dimensions at or above threshold

            logger.info(
                "Self-grade pass %d: weak dimensions %s",
                refinement_attempts + 1,
                [d["name"] for d in weak_dims],
            )

            refinement_prompt = _build_refinement_prompt(
                original, result["rewrite"], rubric, weak_dims
            )

            try:
                resp = await self._anthropic.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=2048,
                    messages=[{"role": "user", "content": refinement_prompt}],
                )
                refined = self._parse_json(resp.content[0].text)
            except Exception as e:
                logger.error("Self-grade refinement failed on pass %d: %s",
                             refinement_attempts + 1, e)
                break

            # Count attempt after successful API call (not on exception)
            refinement_attempts += 1

            # Update rewrite if refinement produced one
            if refined.get("rewrite"):
                result["rewrite"] = refined["rewrite"]
                result["diff"] = _compute_diff(original, refined["rewrite"])

            # Update rubric — if refinement didn't return one, break to
            # avoid looping on stale scores that will never improve
            if refined.get("rubric"):
                refined = _normalize_rubric(refined)
                result["rubric"] = refined["rubric"]
                rubric = refined["rubric"]
                overall = _compute_overall(rubric)
                result["overall_grade"] = overall["grade"]
                result["overall_score"] = overall["score"]
                result["grade_history"].append(
                    {
                        "pass": refinement_attempts,
                        "overall_grade": overall["grade"],
                        "overall_score": overall["score"],
                    }
                )
            else:
                logger.warning(
                    "Refinement pass %d returned no rubric — stopping loop",
                    refinement_attempts,
                )
                break

        result["refinement_passes"] = refinement_attempts
        return result

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any]:
        """Parse JSON from critic output, handling markdown code fences."""
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [ln for ln in lines if not ln.strip().startswith("```")]
            text = "\n".join(lines)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
            return {
                "flagged": False,
                "issues": [],
                "suggestion": "",
                "rewrite": "",
                "confidence": 0,
            }


# ---------------------------------------------------------------------------
# Helper functions (module-level, testable independently)
# ---------------------------------------------------------------------------


def _empty_critic_result() -> dict[str, Any]:
    """Default result when a critic fails."""
    return {
        "flagged": False,
        "issues": [],
        "suggestion": "",
        "rewrite": "",
        "confidence": 0,
    }


def _normalize_rubric(result: dict[str, Any]) -> dict[str, Any]:
    """Add letter grades to rubric scores; ensure all dimensions present."""
    rubric = result.get("rubric")
    if not isinstance(rubric, dict):
        return result

    for dim in RUBRIC_DIMENSIONS:
        entry = rubric.get(dim)
        if isinstance(entry, dict) and "score" in entry:
            score = min(100, max(0, int(entry["score"])))
            entry["score"] = score
            entry["grade"] = _score_to_grade(score)
        else:
            rubric[dim] = {"score": 0, "grade": "F", "note": "not evaluated"}

    result["rubric"] = rubric
    return result


def _compute_overall(rubric: dict[str, Any]) -> dict[str, Any]:
    """Compute overall grade as average of all rubric dimension scores."""
    scores = []
    for dim in RUBRIC_DIMENSIONS:
        entry = rubric.get(dim, {})
        if isinstance(entry, dict) and "score" in entry:
            scores.append(entry["score"])
    if not scores:
        return {"grade": "F", "score": 0}
    avg = round(sum(scores) / len(scores))
    return {"grade": _score_to_grade(avg), "score": avg}


def _find_weak_dimensions(rubric: dict[str, Any]) -> list[dict[str, Any]]:
    """Return rubric dimensions scoring below the grade threshold."""
    weak = []
    for dim in RUBRIC_DIMENSIONS:
        entry = rubric.get(dim, {})
        if isinstance(entry, dict) and entry.get("score", 0) < GRADE_THRESHOLD:
            weak.append({"name": dim, "score": entry["score"], "note": entry.get("note", "")})
    return weak


def _build_refinement_prompt(
    original: str,
    current_rewrite: str,
    rubric: dict,
    weak_dims: list[dict],
) -> str:
    """Build the self-grade refinement prompt."""
    weak_summary = "\n".join(
        f"- **{d['name']}**: scored {d['score']}/100 — {d['note']}"
        for d in weak_dims
    )
    rubric_json = json.dumps(rubric, indent=2)

    return (
        "You are refining a message rewrite. The previous version scored below B "
        "on some rubric dimensions.\n\n"
        f"## Original Message\n\n{original}\n\n"
        f"## Current Rewrite\n\n{current_rewrite}\n\n"
        f"## Current Rubric Scores\n\n{rubric_json}\n\n"
        f"## Weak Dimensions (need improvement)\n\n{weak_summary}\n\n"
        "## Your Task\n\n"
        "Rewrite the message to improve the weak dimensions WITHOUT regressing "
        "the strong ones. Then re-score ALL dimensions.\n\n"
        "Return ONLY valid JSON:\n"
        "```json\n"
        "{\n"
        '  "rewrite": "improved rewrite",\n'
        '  "rubric": {\n'
        '    "tone": {"score": 93, "note": "brief note"},\n'
        '    "clarity": {"score": 87, "note": "brief note"},\n'
        '    "brevity": {"score": 90, "note": "brief note"},\n'
        '    "empathy": {"score": 95, "note": "brief note"},\n'
        '    "directness": {"score": 83, "note": "brief note"},\n'
        '    "voice_fidelity": {"score": 90, "note": "brief note"}\n'
        "  }\n"
        "}\n"
        "```"
    )


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
