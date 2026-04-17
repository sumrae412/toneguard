"""ToneGuard MCP Server — multi-agent tone analysis for Claude Code.

7 tools:
  analyze_message, log_decision, get_history, sync_status,
  train_voice, regenerate_fingerprint, get_voice_profile
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastmcp import FastMCP

from analyzer import ToneAnalyzer
from learning_store import LearningStore
from sync import SyncManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("toneguard.server")

# --- Initialize components ---

STYLE_RULES_PATH = str(Path(__file__).parent.parent / "style-rules.md")

learning_store = LearningStore()
analyzer = ToneAnalyzer(style_rules_path=STYLE_RULES_PATH, learning_store=learning_store)
sync_manager = SyncManager(learning_store=learning_store)

# --- FastMCP server ---

mcp = FastMCP("ToneGuard")


@mcp.tool()
async def analyze_message(
    message: str,
    context: str = "",
    recipient: str = "",
) -> dict:
    """Check a message for tone issues, get a rubric-scored rewrite.

    Two critics (Claude Haiku for tone, GPT-4o-mini for clarity) analyze the
    message in parallel, each producing a competing rewrite. A synthesizer
    (Claude Sonnet) picks the best rewrite, scores it on a 6-dimension rubric
    (tone, clarity, brevity, empathy, directness, voice_fidelity), and refines
    it if any dimension falls below B.

    Args:
        message: The message text to analyze
        context: Optional context about where/why the message is being sent
        recipient: Optional recipient name (used to load relationship data)

    Returns:
        dict with: flagged, issues, rewrite, confidence, diff, agents,
        rubric (per-dimension grades/scores/notes), overall_grade,
        overall_score, rewrite_source, refinement_passes, grade_history
    """
    return await analyzer.analyze(message, context, recipient)


@mcp.tool()
async def log_decision(
    action: str,
    original: str,
    suggestion: str = "",
    final_text: str = "",
) -> dict:
    """Record what you did with a suggestion. Helps ToneGuard learn.

    Args:
        action: One of "used_suggestion", "sent_original", "used_edited"
        original: The original message text
        suggestion: The suggestion that was offered
        final_text: What was actually sent (for "used_edited")
    """
    learning_store.log_decision(action, original, suggestion, final_text)
    sync_manager.schedule_push("decisions")
    sync_manager.schedule_push("stats_history")
    return {"logged": True, "decisions_count": len(learning_store.get("decisions") or [])}


@mcp.tool()
async def get_history(
    limit: int = 10,
    action_filter: str = "",
) -> dict:
    """View recent decisions and stats.

    Args:
        limit: Max number of decisions to return
        action_filter: Optional filter by action type (e.g. "used_suggestion")
    """
    return {
        "decisions": learning_store.get_history(limit, action_filter or None),
        "stats": learning_store.get_stats(),
    }


@mcp.tool()
async def sync_status() -> dict:
    """Check Supabase sync health."""
    return {
        "connected": sync_manager.connected,
        "last_sync": sync_manager.last_sync_at,
    }


@mcp.tool()
async def train_voice(samples: list[str]) -> dict:
    """Register pasted writing samples as the user's explicit voice training set.

    Each sample is stored with source="trained" (distinguishing it from
    auto-collected samples). Rejects samples shorter than 30 chars. Dedupes
    by text content. Trained samples are preferred over auto samples when
    the synthesizer prompt is built.

    Args:
        samples: List of message texts the user wants the rewriter to mimic.

    Returns:
        { accepted: int, rejected: int, trained_total: int }
    """
    if not isinstance(samples, list):
        return {"error": "samples must be a list of strings"}
    accepted = 0
    rejected = 0
    for text in samples:
        if not isinstance(text, str):
            rejected += 1
            continue
        if learning_store.add_voice_sample(text, source="trained"):
            accepted += 1
        else:
            rejected += 1
    sync_manager.schedule_push("voice_samples")
    stored = learning_store.get("voice_samples") or []
    trained_total = sum(1 for s in stored if s.get("source") == "trained")
    return {
        "accepted": accepted,
        "rejected": rejected,
        "trained_total": trained_total,
    }


@mcp.tool()
async def regenerate_fingerprint() -> dict:
    """Compress the user's trained voice samples into a style fingerprint.

    The fingerprint is a ~200-token markdown block (tone defaults, preferred
    phrasings, avoided phrasings, formality register, opening/closing
    patterns). Stored as voice_fingerprint and synced. Once present (with
    >=3 trained samples), the analyzer injects it into the synthesizer
    prompt in place of raw samples — sharper signal, lower token cost.

    Returns:
        { ok: bool, fingerprint?: str, sample_count?: int, error?: str }
    """
    try:
        text = await analyzer.generate_fingerprint()
    except ValueError as err:
        return {"ok": False, "error": str(err)}
    except Exception as err:
        logger.exception("fingerprint generation failed")
        return {"ok": False, "error": str(err)}

    stored = learning_store.get("voice_samples") or []
    sample_count = sum(1 for s in stored if s.get("source") == "trained")
    fingerprint = {
        "text": text,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sample_count": sample_count,
    }
    learning_store.set("voice_fingerprint", fingerprint)
    sync_manager.schedule_push("voice_fingerprint")
    return {"ok": True, "fingerprint": text, "sample_count": sample_count}


@mcp.tool()
async def get_voice_profile() -> dict:
    """Return the user's current voice training state.

    Useful for the options page (show what the user has trained, when the
    fingerprint was last regenerated, whether it's stale).

    Returns:
        {
          trained_samples: [{text, timestamp}],
          auto_samples: [{text, timestamp}],
          fingerprint: {text, updatedAt, sample_count} | null,
        }
    """
    stored = learning_store.get("voice_samples") or []
    trained = [
        {"text": s.get("text", ""), "timestamp": s.get("timestamp", "")}
        for s in stored
        if s.get("source") == "trained"
    ]
    auto = [
        {"text": s.get("text", ""), "timestamp": s.get("timestamp", "")}
        for s in stored
        if s.get("source") != "trained"
    ]
    return {
        "trained_samples": trained,
        "auto_samples": auto,
        "fingerprint": learning_store.get("voice_fingerprint"),
    }


async def _startup() -> None:
    """Initialize sync on startup."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if api_key:
        await sync_manager.init(api_key)
    else:
        logger.warning("ANTHROPIC_API_KEY not set — sync disabled")


async def _shutdown() -> None:
    """Flush pending pushes on shutdown."""
    await sync_manager.stop()


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
