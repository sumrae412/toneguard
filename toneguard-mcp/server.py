"""ToneGuard MCP Server — multi-agent tone analysis for Claude Code.

4 tools: analyze_message, log_decision, get_history, sync_status
"""

from __future__ import annotations

import logging
import os
import sys
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
