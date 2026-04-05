"""Analyzer tests — mock API clients, verify parallel dispatch and fallbacks."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from analyzer import ToneAnalyzer, _compute_diff
from learning_store import LearningStore


@pytest.fixture
def store(tmp_path):
    return LearningStore(path=str(tmp_path / "learning.json"))


@pytest.fixture
def analyzer(store, tmp_path):
    # Create a minimal style rules file
    rules_path = tmp_path / "style-rules.md"
    rules_path.write_text("Be direct. No passive aggression.")
    return ToneAnalyzer(style_rules_path=str(rules_path), learning_store=store)


class TestParallelDispatch:
    @pytest.mark.asyncio
    async def test_calls_both_critics_in_parallel(self, analyzer):
        """Both Claude and GPT should be called for each analysis."""
        claude_response = json.dumps({
            "flagged": True,
            "issues": [{"rule": "passive-aggression", "quote": "as per my last email", "explanation": "sounds hostile"}],
            "suggestion": "Following up on my earlier email",
            "confidence": 0.85,
        })
        gpt_response = json.dumps({
            "flagged": True,
            "issues": [{"rule": "wordiness", "quote": "I just wanted to", "explanation": "unnecessary filler"}],
            "suggestion": "Following up:",
            "confidence": 0.75,
        })
        synthesis_response = json.dumps({
            "flagged": True,
            "issues": [
                {"rule": "passive-aggression", "quote": "as per my last email", "explanation": "sounds hostile"},
            ],
            "rewrite": "Following up on my earlier email",
            "confidence": 0.82,
        })

        # Mock Claude API (both critic and synthesizer)
        mock_claude_msg = MagicMock()
        mock_claude_msg.content = [MagicMock(text=claude_response)]
        mock_synth_msg = MagicMock()
        mock_synth_msg.content = [MagicMock(text=synthesis_response)]

        call_count = 0

        async def mock_claude_create(**kwargs):
            nonlocal call_count
            call_count += 1
            if "claude-haiku" in kwargs.get("model", ""):
                return mock_claude_msg
            return mock_synth_msg

        analyzer._anthropic.messages.create = mock_claude_create

        # Mock GPT API
        mock_gpt_choice = MagicMock()
        mock_gpt_choice.message.content = gpt_response
        mock_gpt_resp = MagicMock()
        mock_gpt_resp.choices = [mock_gpt_choice]

        async def mock_gpt_create(**kwargs):
            return mock_gpt_resp

        analyzer._openai.chat.completions.create = mock_gpt_create

        result = await analyzer.analyze("As per my last email, I just wanted to check in")

        assert result["flagged"] is True
        assert len(result["issues"]) >= 1
        assert result["agents"]["claude"] == "ok"
        assert result["agents"]["gpt"] == "ok"


class TestMalformedOutput:
    @pytest.mark.asyncio
    async def test_handles_malformed_critic_json(self, analyzer):
        """Graceful fallback when critic returns invalid JSON."""
        # Claude returns garbage
        mock_claude = MagicMock()
        mock_claude.content = [MagicMock(text="This is not JSON at all!!!")]

        async def mock_claude_create(**kwargs):
            return mock_claude

        analyzer._anthropic.messages.create = mock_claude_create

        # GPT returns valid JSON
        gpt_response = json.dumps({
            "flagged": False, "issues": [], "suggestion": "", "confidence": 0.9
        })
        mock_gpt_choice = MagicMock()
        mock_gpt_choice.message.content = gpt_response
        mock_gpt_resp = MagicMock()
        mock_gpt_resp.choices = [mock_gpt_choice]

        async def mock_gpt_create(**kwargs):
            return mock_gpt_resp

        analyzer._openai.chat.completions.create = mock_gpt_create

        result = await analyzer.analyze("Hello")
        # Should not crash — returns a valid result
        assert "flagged" in result
        assert "agents" in result

    @pytest.mark.asyncio
    async def test_handles_code_fenced_json(self, analyzer):
        """Critics sometimes wrap JSON in markdown code fences."""
        fenced = '```json\n{"flagged": false, "issues": [], "suggestion": "", "confidence": 0.95}\n```'
        parsed = ToneAnalyzer._parse_json(fenced)
        assert parsed["flagged"] is False
        assert parsed["confidence"] == 0.95


class TestDiffComputation:
    def test_identical_text(self):
        diff = _compute_diff("hello world", "hello world")
        assert len(diff) == 1
        assert diff[0]["type"] == "same"

    def test_complete_replacement(self):
        diff = _compute_diff("old text", "new words")
        types = {d["type"] for d in diff}
        assert "added" in types or "removed" in types

    def test_partial_change(self):
        diff = _compute_diff("I think we should maybe try this", "We should try this")
        # Should have a mix of same, added, removed
        assert any(d["type"] == "same" for d in diff)

    def test_empty_inputs(self):
        diff = _compute_diff("", "")
        assert diff == []


class TestPromptAssembly:
    def test_includes_learning_context(self, analyzer):
        analyzer.store.log_decision("used_suggestion", "test msg", "better msg")
        analyzer.store.set("voice_samples", [{"text": "sample voice"}])
        ctx = analyzer._build_context("Check this message")
        assert "test msg" in ctx
        assert "sample voice" in ctx

    def test_includes_relationship_data(self, analyzer):
        analyzer.store.set("relationships", {"alice": {"messageCount": 42, "lastSeen": "2026-04-01"}})
        ctx = analyzer._build_context("hi alice", recipient="alice")
        assert "42" in ctx
        assert "alice" in ctx
