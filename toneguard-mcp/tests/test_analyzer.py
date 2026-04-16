"""Analyzer tests — mock API clients, verify parallel dispatch, rubric, and self-grading."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from analyzer import (
    ToneAnalyzer,
    _compute_diff,
    _compute_overall,
    _find_weak_dimensions,
    _normalize_rubric,
    _score_to_grade,
    GRADE_THRESHOLD,
    MAX_REFINEMENT_PASSES,
    RUBRIC_DIMENSIONS,
)
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


def _make_rubric(**overrides):
    """Build a rubric dict with all dimensions at 90 by default."""
    rubric = {}
    for dim in RUBRIC_DIMENSIONS:
        rubric[dim] = {"score": overrides.get(dim, 90), "note": "ok"}
    return rubric


def _make_critic_response(flagged=True, rewrite="Fixed message", confidence=0.85):
    """Build a critic-shaped JSON response."""
    issues = []
    if flagged:
        issues = [{"rule": "test-issue", "quote": "test", "explanation": "test"}]
    return json.dumps({
        "flagged": flagged,
        "issues": issues,
        "suggestion": "fix it" if flagged else "",
        "rewrite": rewrite if flagged else "",
        "confidence": confidence,
    })


def _make_synthesis_response(
    flagged=True,
    rewrite="Better message",
    rewrite_source="merged",
    rubric=None,
):
    """Build a synthesizer-shaped JSON response with rubric."""
    if rubric is None:
        rubric = _make_rubric()
    issues = []
    if flagged:
        issues = [{"rule": "test-issue", "quote": "test", "explanation": "test"}]
    return json.dumps({
        "flagged": flagged,
        "issues": issues,
        "rewrite": rewrite if flagged else "",
        "confidence": 0.85,
        "rewrite_source": rewrite_source,
        "rubric": rubric,
    })


def _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp, refine_resps=None):
    """Wire up mock API calls for both critics and synthesizer."""
    refine_resps = refine_resps or []
    synth_call_count = 0

    async def mock_claude_create(**kwargs):
        nonlocal synth_call_count
        if "claude-haiku" in kwargs.get("model", ""):
            msg = MagicMock()
            msg.content = [MagicMock(text=claude_resp)]
            return msg
        # Sonnet calls: first is synthesis, rest are refinements
        msg = MagicMock()
        if synth_call_count == 0:
            msg.content = [MagicMock(text=synth_resp)]
        elif synth_call_count - 1 < len(refine_resps):
            msg.content = [MagicMock(text=refine_resps[synth_call_count - 1])]
        else:
            msg.content = [MagicMock(text=synth_resp)]
        synth_call_count += 1
        return msg

    mock_gpt_choice = MagicMock()
    mock_gpt_choice.message.content = gpt_resp
    mock_gpt_resp = MagicMock()
    mock_gpt_resp.choices = [mock_gpt_choice]

    async def mock_gpt_create(**kwargs):
        return mock_gpt_resp

    analyzer._anthropic.messages.create = mock_claude_create
    analyzer._openai.chat.completions.create = mock_gpt_create


class TestParallelDispatch:
    @pytest.mark.asyncio
    async def test_calls_both_critics_in_parallel(self, analyzer):
        """Both Claude and GPT should be called for each analysis."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response(rewrite="GPT version")
        synth_resp = _make_synthesis_response()

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)

        result = await analyzer.analyze("As per my last email, I just wanted to check in")

        assert result["flagged"] is True
        assert len(result["issues"]) >= 1
        assert result["agents"]["claude"] == "ok"
        assert result["agents"]["gpt"] == "ok"


class TestMalformedOutput:
    @pytest.mark.asyncio
    async def test_handles_malformed_critic_json(self, analyzer):
        """Graceful fallback when critic returns invalid JSON."""
        # Claude returns garbage, synth still works
        mock_claude = MagicMock()
        mock_claude.content = [MagicMock(text="This is not JSON at all!!!")]

        synth_resp = _make_synthesis_response(flagged=False)
        synth_msg = MagicMock()
        synth_msg.content = [MagicMock(text=synth_resp)]

        call_count = 0

        async def mock_claude_create(**kwargs):
            nonlocal call_count
            call_count += 1
            if "claude-haiku" in kwargs.get("model", ""):
                return mock_claude
            return synth_msg

        analyzer._anthropic.messages.create = mock_claude_create

        gpt_response = json.dumps({
            "flagged": False, "issues": [], "suggestion": "", "rewrite": "", "confidence": 0.9
        })
        mock_gpt_choice = MagicMock()
        mock_gpt_choice.message.content = gpt_response
        mock_gpt_resp = MagicMock()
        mock_gpt_resp.choices = [mock_gpt_choice]

        async def mock_gpt_create(**kwargs):
            return mock_gpt_resp

        analyzer._openai.chat.completions.create = mock_gpt_create

        result = await analyzer.analyze("Hello")
        assert "flagged" in result
        assert "agents" in result

    @pytest.mark.asyncio
    async def test_handles_code_fenced_json(self, analyzer):
        """Critics sometimes wrap JSON in markdown code fences."""
        fenced = '```json\n{"flagged": false, "issues": [], "suggestion": "", "rewrite": "", "confidence": 0.95}\n```'
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


class TestScoreToGrade:
    """Grade conversion from numeric scores."""

    def test_grade_boundaries(self):
        assert _score_to_grade(100) == "A"
        assert _score_to_grade(93) == "A"
        assert _score_to_grade(92) == "A-"
        assert _score_to_grade(90) == "A-"
        assert _score_to_grade(89) == "B+"
        assert _score_to_grade(87) == "B+"
        assert _score_to_grade(86) == "B"
        assert _score_to_grade(83) == "B"
        assert _score_to_grade(82) == "B-"
        assert _score_to_grade(80) == "B-"
        assert _score_to_grade(79) == "C+"
        assert _score_to_grade(73) == "C"
        assert _score_to_grade(70) == "C-"
        assert _score_to_grade(60) == "D"
        assert _score_to_grade(59) == "F"
        assert _score_to_grade(0) == "F"


class TestNormalizeRubric:
    """Rubric normalization — add grades, clamp scores, fill missing dims."""

    def test_adds_letter_grades(self):
        result = {"rubric": {"tone": {"score": 93, "note": "great"}}}
        normalized = _normalize_rubric(result)
        assert normalized["rubric"]["tone"]["grade"] == "A"

    def test_clamps_scores(self):
        result = {"rubric": {"tone": {"score": 150, "note": "over"}}}
        normalized = _normalize_rubric(result)
        assert normalized["rubric"]["tone"]["score"] == 100

    def test_fills_missing_dimensions(self):
        result = {"rubric": {"tone": {"score": 90, "note": "ok"}}}
        normalized = _normalize_rubric(result)
        for dim in RUBRIC_DIMENSIONS:
            assert dim in normalized["rubric"]
        # Missing dims get F
        assert normalized["rubric"]["clarity"]["grade"] == "F"

    def test_no_rubric_passthrough(self):
        result = {"flagged": False}
        assert _normalize_rubric(result) == result


class TestComputeOverall:
    """Overall grade is average of dimension scores."""

    def test_perfect_scores(self):
        rubric = _make_rubric(tone=100, clarity=100, brevity=100, empathy=100, directness=100, voice_fidelity=100)
        overall = _compute_overall(rubric)
        assert overall["grade"] == "A"
        assert overall["score"] == 100

    def test_mixed_scores(self):
        rubric = _make_rubric(tone=90, clarity=80, brevity=85, empathy=70, directness=95, voice_fidelity=88)
        overall = _compute_overall(rubric)
        # Average is ~84.7, rounds to 85 → B
        assert overall["score"] == 85
        assert overall["grade"] == "B"

    def test_empty_rubric(self):
        overall = _compute_overall({})
        assert overall["grade"] == "F"
        assert overall["score"] == 0


class TestFindWeakDimensions:
    """Detect dimensions below the B threshold."""

    def test_all_strong(self):
        rubric = _make_rubric()  # All at 90
        assert _find_weak_dimensions(rubric) == []

    def test_one_weak(self):
        rubric = _make_rubric(clarity=70)
        weak = _find_weak_dimensions(rubric)
        assert len(weak) == 1
        assert weak[0]["name"] == "clarity"
        assert weak[0]["score"] == 70

    def test_multiple_weak(self):
        rubric = _make_rubric(clarity=70, empathy=60, directness=50)
        weak = _find_weak_dimensions(rubric)
        assert len(weak) == 3
        names = {d["name"] for d in weak}
        assert names == {"clarity", "empathy", "directness"}

    def test_at_threshold_not_weak(self):
        rubric = _make_rubric(tone=GRADE_THRESHOLD)
        assert _find_weak_dimensions(rubric) == []


class TestRubricInSynthesis:
    """Synthesizer returns rubric scores and competing rewrite metadata."""

    @pytest.mark.asyncio
    async def test_rubric_present_in_flagged_result(self, analyzer):
        """Rubric should be present when message is flagged."""
        claude_resp = _make_critic_response(rewrite="Claude fix")
        gpt_resp = _make_critic_response(rewrite="GPT fix")
        synth_resp = _make_synthesis_response(
            rewrite="Best fix",
            rewrite_source="merged",
            rubric=_make_rubric(tone=95, clarity=88, brevity=92, empathy=90, directness=85, voice_fidelity=91),
        )

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)
        result = await analyzer.analyze("problematic message")

        assert "rubric" in result
        assert "overall_grade" in result
        assert "overall_score" in result
        assert "rewrite_source" in result
        assert "refinement_passes" in result
        assert "grade_history" in result

        # Check all dimensions present with grades
        for dim in RUBRIC_DIMENSIONS:
            assert dim in result["rubric"]
            assert "grade" in result["rubric"][dim]
            assert "score" in result["rubric"][dim]

    @pytest.mark.asyncio
    async def test_rewrite_source_field(self, analyzer):
        """Response should indicate which critic's rewrite was the base."""
        claude_resp = _make_critic_response(rewrite="Claude version")
        gpt_resp = _make_critic_response(rewrite="GPT version")
        synth_resp = _make_synthesis_response(rewrite_source="claude")

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)
        result = await analyzer.analyze("test")

        assert result.get("rewrite_source") == "claude"


class TestSelfGrading:
    """Self-grading loop triggers when rubric dimensions are below B."""

    @pytest.mark.asyncio
    async def test_no_refinement_when_all_strong(self, analyzer):
        """No refinement pass when all dimensions >= B."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        synth_resp = _make_synthesis_response(rubric=_make_rubric())  # All 90

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)
        result = await analyzer.analyze("test message")

        assert result["refinement_passes"] == 0
        assert len(result["grade_history"]) == 1

    @pytest.mark.asyncio
    async def test_one_refinement_pass(self, analyzer):
        """One refinement when a dimension is weak, then improved."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        # Initial synthesis has weak clarity
        synth_resp = _make_synthesis_response(
            rubric=_make_rubric(clarity=70),
        )
        # Refinement fixes clarity
        refined = json.dumps({
            "rewrite": "Refined message",
            "rubric": _make_rubric(clarity=90),
        })

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp, refine_resps=[refined])
        result = await analyzer.analyze("test message")

        assert result["refinement_passes"] == 1
        assert len(result["grade_history"]) == 2
        assert result["grade_history"][0]["pass"] == 0
        assert result["grade_history"][1]["pass"] == 1
        # Final rubric should show improved clarity
        assert result["rubric"]["clarity"]["score"] == 90
        assert result["rewrite"] == "Refined message"

    @pytest.mark.asyncio
    async def test_max_refinement_passes_respected(self, analyzer):
        """Stops refining after MAX_REFINEMENT_PASSES even if still weak."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        # Synthesis has weak clarity that never improves
        synth_resp = _make_synthesis_response(rubric=_make_rubric(clarity=60))
        still_weak = json.dumps({
            "rewrite": "Still not great",
            "rubric": _make_rubric(clarity=65),
        })

        _mock_analyzer_apis(
            analyzer, claude_resp, gpt_resp, synth_resp,
            refine_resps=[still_weak, still_weak],
        )
        result = await analyzer.analyze("test message")

        assert result["refinement_passes"] == MAX_REFINEMENT_PASSES
        assert len(result["grade_history"]) == MAX_REFINEMENT_PASSES + 1

    @pytest.mark.asyncio
    async def test_skips_grading_for_unflagged(self, analyzer):
        """Clean messages skip the self-grading loop entirely."""
        claude_resp = _make_critic_response(flagged=False)
        gpt_resp = _make_critic_response(flagged=False)
        synth_resp = _make_synthesis_response(flagged=False)

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)
        result = await analyzer.analyze("This is a perfectly fine message")

        # No rubric, no refinement for unflagged messages
        assert result.get("refinement_passes") is None or result.get("refinement_passes") == 0


class TestStylePreservation:
    """Voice samples are included in synthesizer prompt for style matching."""

    def test_voice_samples_in_synthesizer_prompt(self, analyzer):
        """Synthesizer prompt includes voice samples for style matching."""
        analyzer.store.set("voice_samples", [
            {"text": "hey, quick heads up — the deploy is done"},
            {"text": "can we sync on this tomorrow? no rush"},
        ])
        prompt = analyzer._build_synthesizer_prompt(
            "test message",
            {"flagged": True, "issues": [], "rewrite": "x"},
            {"flagged": True, "issues": [], "rewrite": "y"},
        )
        assert "quick heads up" in prompt
        assert "no rush" in prompt
        assert "voice_fidelity" in prompt
        assert "Voice Samples" in prompt

    def test_empty_voice_samples_no_section(self, analyzer):
        """No voice samples section when store is empty."""
        prompt = analyzer._build_synthesizer_prompt(
            "test",
            {"flagged": False, "issues": []},
            {"flagged": False, "issues": []},
        )
        assert "Voice Samples" not in prompt
