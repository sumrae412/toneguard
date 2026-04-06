"""Live integration test — calls real APIs to validate multi-model pipeline.

Run with: uv run --extra dev pytest tests/test_live_integration.py -v -s
Requires ANTHROPIC_API_KEY and OPENAI_API_KEY in .env
"""

import os
import sys
import asyncio
import json
from pathlib import Path

import pytest

# Load .env
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

sys.path.insert(0, str(Path(__file__).parent.parent))

from analyzer import ToneAnalyzer
from learning_store import LearningStore

pytestmark = pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY") or not os.environ.get("OPENAI_API_KEY"),
    reason="API keys not set",
)


@pytest.fixture
def analyzer(tmp_path):
    store = LearningStore(str(tmp_path / "learning.json"))
    style_rules = Path(__file__).parent.parent.parent / "style-rules.md"
    return ToneAnalyzer(str(style_rules), store)


class TestLiveMultiModel:
    """Validate the full 2-critic + synthesizer pipeline with real APIs."""

    async def test_clean_message_not_flagged(self, analyzer):
        """A professional, clear message should pass with minimal/no flags."""
        result = await analyzer.analyze(
            "Hey Sarah, could you send me the Q3 report by Friday? "
            "I'd like to review it before the Monday meeting. Thanks!"
        )
        print(f"\n--- Clean message result ---\n{json.dumps(result, indent=2)}")

        assert "flagged" in result
        assert "issues" in result
        assert "agents" in result
        assert result["agents"]["claude"] == "ok"
        assert result["agents"]["gpt"] == "ok"
        # Clean message should not be flagged
        assert result["flagged"] is False

    async def test_passive_aggressive_message_flagged(self, analyzer):
        """A clearly passive-aggressive message should be flagged."""
        result = await analyzer.analyze(
            "Per my last email, as I mentioned before, it would be great "
            "if you could actually get this done this time. Just a thought.",
            context="Follow-up on missed deadline",
        )
        print(f"\n--- Passive-aggressive result ---\n{json.dumps(result, indent=2)}")

        assert result["flagged"] is True
        assert len(result["issues"]) > 0
        assert result["agents"]["claude"] == "ok"
        assert result["agents"]["gpt"] == "ok"
        # Should provide a rewrite
        assert result.get("rewrite", "") != ""

    async def test_wordy_message_gets_clarity_feedback(self, analyzer):
        """A wordy, hedging message should get clarity suggestions."""
        result = await analyzer.analyze(
            "I was just kind of thinking that maybe we could possibly "
            "look into potentially exploring the option of perhaps considering "
            "whether or not it might be a good idea to maybe restructure the team."
        )
        print(f"\n--- Wordy message result ---\n{json.dumps(result, indent=2)}")

        assert result["flagged"] is True
        assert len(result["issues"]) > 0
        # Rewrite should be significantly shorter
        rewrite = result.get("rewrite", "")
        assert rewrite != ""
        assert len(rewrite) < len(
            "I was just kind of thinking that maybe we could possibly "
            "look into potentially exploring the option of perhaps considering "
            "whether or not it might be a good idea to maybe restructure the team."
        )

    async def test_diff_computed_on_rewrite(self, analyzer):
        """When a rewrite is provided, diff should be computed."""
        result = await analyzer.analyze(
            "Per my last email, I need this ASAP. Not sure why this is so hard."
        )
        print(f"\n--- Diff result ---\n{json.dumps(result, indent=2)}")

        if result.get("rewrite"):
            assert "diff" in result
            assert isinstance(result["diff"], list)
            assert len(result["diff"]) > 0
            for chunk in result["diff"]:
                assert "type" in chunk
                assert "text" in chunk
                assert chunk["type"] in ("same", "added", "removed")

    async def test_agents_status_always_present(self, analyzer):
        """Agent status should always be returned."""
        result = await analyzer.analyze("Hello, how are you?")
        assert "agents" in result
        assert result["agents"]["claude"] in ("ok", "error")
        assert result["agents"]["gpt"] in ("ok", "error")
