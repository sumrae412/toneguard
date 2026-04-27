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
    _read_prompt,
    _score_to_grade,
    normalize_voice_strength,
    precheck_analysis,
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


class TestPromptLoading:
    def test_read_prompt_strips_generated_header(self, tmp_path):
        """Generated metadata should not be sent as model instructions."""
        prompt_path = tmp_path / "prompt.md"
        prompt_path.write_text(
            "Generated from shared/. Do not edit directly.\n\n"
            "You are ToneGuard.\n"
        )

        assert _read_prompt(prompt_path) == "You are ToneGuard.\n"


class TestPrecheckAnalysis:
    def test_local_pass_for_safe_ack(self):
        result = precheck_analysis("sounds good")

        assert result == {
            "route": "local_pass",
            "precheck_hits": ["phrase:sounds good"],
            "should_call_model": False,
        }

    def test_deep_route_for_conflict_phrase(self):
        result = precheck_analysis(
            "I do not know why this is so hard to understand."
        )

        assert result["route"] == "deep"
        assert result["should_call_model"] is True
        assert "phrase:why this is so hard" in result["precheck_hits"]

    def test_standard_route_for_normal_message(self):
        assert precheck_analysis("Please send the draft today.") == {
            "route": "standard",
            "precheck_hits": [],
            "should_call_model": True,
        }


class TestVoiceStrength:
    def test_normalizes_unknown_voice_strength(self):
        assert normalize_voice_strength("preserve") == "preserve"
        assert normalize_voice_strength("unknown") == "balanced"


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
    async def test_safe_ack_skips_model_calls(self, analyzer):
        """Obvious short acknowledgments should pass locally."""
        analyzer._anthropic.messages.create = AsyncMock()
        analyzer._openai.chat.completions.create = AsyncMock()

        result = await analyzer.analyze("sounds good")

        assert result["flagged"] is False
        assert result["routing"]["route"] == "local_pass"
        analyzer._anthropic.messages.create.assert_not_called()
        analyzer._openai.chat.completions.create.assert_not_called()

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

    @pytest.mark.asyncio
    async def test_refinement_api_failure_mid_loop(self, analyzer):
        """If refinement API fails on pass 2, stops gracefully with pass 1 result."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        synth_resp = _make_synthesis_response(rubric=_make_rubric(clarity=60))
        # Pass 1 improves but still weak; pass 2 will throw
        pass1_ok = json.dumps({
            "rewrite": "Slightly better",
            "rubric": _make_rubric(clarity=75),
        })

        synth_call_count = 0

        async def mock_claude_create(**kwargs):
            nonlocal synth_call_count
            if "claude-haiku" in kwargs.get("model", ""):
                msg = MagicMock()
                msg.content = [MagicMock(text=claude_resp)]
                return msg
            msg = MagicMock()
            if synth_call_count == 0:
                msg.content = [MagicMock(text=synth_resp)]
            elif synth_call_count == 1:
                msg.content = [MagicMock(text=pass1_ok)]
            else:
                raise RuntimeError("API timeout on pass 2")
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

        result = await analyzer.analyze("test message")

        # Should have completed pass 1 but stopped on pass 2 failure
        assert result["refinement_passes"] == 1
        assert result["rewrite"] == "Slightly better"
        assert result["rubric"]["clarity"]["score"] == 75

    @pytest.mark.asyncio
    async def test_refinement_missing_rubric_stops_loop(self, analyzer):
        """If refinement returns rewrite but no rubric, loop stops to avoid stale scores."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        synth_resp = _make_synthesis_response(rubric=_make_rubric(clarity=60))
        # Refinement returns rewrite but omits rubric
        no_rubric = json.dumps({
            "rewrite": "Improved but no scores",
        })

        _mock_analyzer_apis(
            analyzer, claude_resp, gpt_resp, synth_resp,
            refine_resps=[no_rubric],
        )
        result = await analyzer.analyze("test message")

        # Should stop after 1 attempt due to missing rubric
        assert result["refinement_passes"] == 1
        assert result["rewrite"] == "Improved but no scores"
        # Grade history should only have the initial entry (no new one without rubric)
        assert len(result["grade_history"]) == 1

    @pytest.mark.asyncio
    async def test_synthesis_missing_rubric_skips_grading(self, analyzer):
        """If synthesizer returns no rubric at all, self-grading is skipped."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        # Synthesizer response with no rubric key
        synth_resp = json.dumps({
            "flagged": True,
            "issues": [{"rule": "test", "quote": "test", "explanation": "test"}],
            "rewrite": "A rewrite",
            "confidence": 0.8,
            "rewrite_source": "merged",
        })

        _mock_analyzer_apis(analyzer, claude_resp, gpt_resp, synth_resp)
        result = await analyzer.analyze("test message")

        # No rubric → no self-grading
        assert "rubric" not in result or result.get("rubric") is None
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
            voice_strength="preserve",
        )
        assert "quick heads up" in prompt
        assert "no rush" in prompt
        assert "voice_fidelity" in prompt
        assert "Voice Samples" in prompt
        assert "Voice Preservation Strength" in prompt
        assert "preserve" in prompt

    def test_empty_voice_samples_no_section(self, analyzer):
        """No voice samples section when store is empty."""
        prompt = analyzer._build_synthesizer_prompt(
            "test",
            {"flagged": False, "issues": []},
            {"flagged": False, "issues": []},
        )
        assert "Voice Samples" not in prompt
        assert "Voice Fingerprint" not in prompt


class TestVoiceFingerprintPreference:
    """Fingerprint replaces raw samples when the user has explicitly trained."""

    def test_fingerprint_used_when_3plus_trained_samples_present(self, analyzer):
        analyzer.store.set("voice_fingerprint", {
            "text": "### Tone defaults\n- terse\n### Preferred phrasings\n- em-dashes",
            "updatedAt": "2026-04-16T10:00:00Z",
            "sample_count": 5,
        })
        analyzer.store.set("voice_samples", [
            {"text": "sample A text here", "source": "trained",
             "timestamp": "2026-04-16T00:00:00Z"},
            {"text": "sample B text here", "source": "trained",
             "timestamp": "2026-04-16T00:01:00Z"},
            {"text": "sample C text here", "source": "trained",
             "timestamp": "2026-04-16T00:02:00Z"},
        ])
        prompt = analyzer._build_synthesizer_prompt(
            "test",
            {"flagged": True, "issues": [], "rewrite": "x"},
            {"flagged": True, "issues": [], "rewrite": "y"},
        )
        assert "Voice Fingerprint" in prompt
        assert "em-dashes" in prompt
        # Raw samples NOT injected when fingerprint is used
        assert "Voice Samples" not in prompt

    def test_falls_back_to_raw_when_trained_count_below_3(self, analyzer):
        """<3 trained samples: fingerprint skipped even if present (too sparse)."""
        analyzer.store.set("voice_fingerprint", {
            "text": "some fingerprint",
            "updatedAt": "2026-04-16T10:00:00Z",
            "sample_count": 2,
        })
        analyzer.store.set("voice_samples", [
            {"text": "only two trained samples here", "source": "trained",
             "timestamp": "2026-04-16T00:00:00Z"},
            {"text": "second trained sample here", "source": "trained",
             "timestamp": "2026-04-16T00:01:00Z"},
        ])
        prompt = analyzer._build_synthesizer_prompt(
            "test",
            {"flagged": True, "issues": [], "rewrite": "x"},
            {"flagged": True, "issues": [], "rewrite": "y"},
        )
        assert "Voice Fingerprint" not in prompt
        assert "Voice Samples" in prompt

    def test_no_fingerprint_raw_samples_used(self, analyzer):
        """No fingerprint set → fall back to raw samples."""
        analyzer.store.set("voice_samples", [
            {"text": "auto sample text here"},
        ])
        prompt = analyzer._build_synthesizer_prompt(
            "test",
            {"flagged": True, "issues": [], "rewrite": "x"},
            {"flagged": True, "issues": [], "rewrite": "y"},
        )
        assert "Voice Samples" in prompt
        assert "Voice Fingerprint" not in prompt

    async def test_generate_fingerprint_rejects_sparse_input(self, analyzer):
        """Fewer than 3 samples → raise ValueError (no partial fingerprint)."""
        import pytest
        with pytest.raises(ValueError, match="needs >=3"):
            await analyzer.generate_fingerprint(samples=["just one"])


class TestLandingCritic:
    """Descriptive landing view runs in parallel with tone/clarity critics."""

    @pytest.mark.asyncio
    async def test_landing_skipped_for_short_messages(self, analyzer):
        """Short messages (<10 words) short-circuit to null fields — no API call."""
        result = await analyzer._call_landing("hey quick question", context="")
        assert result == {
            "takeaway": None,
            "tone_felt": None,
            "next_action": None,
        }

    @pytest.mark.asyncio
    async def test_landing_parses_structured_response(self, analyzer):
        """Haiku returns the three-field JSON; parser normalizes to fields."""
        landing_json = (
            '{"takeaway": "They want a status update", '
            '"tone_felt": "urgent, terse", '
            '"next_action": "send a status update"}'
        )

        async def mock_create(**kwargs):
            msg = MagicMock()
            msg.content = [MagicMock(text=landing_json)]
            return msg

        analyzer._anthropic.messages.create = mock_create
        result = await analyzer._call_landing(
            "Hey — what's going on with the deploy? Haven't heard a peep all day.",
            context="",
        )
        assert result["takeaway"] == "They want a status update"
        assert result["tone_felt"] == "urgent, terse"
        assert result["next_action"] == "send a status update"

    @pytest.mark.asyncio
    async def test_analyze_attaches_landing_to_result(self, analyzer):
        """Full analyze() pipeline surfaces landing in synthesis['landing']."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        synth_resp = _make_synthesis_response()
        landing_json = (
            '{"takeaway": "They need the doc today", '
            '"tone_felt": "rushed, polite", '
            '"next_action": "share the doc"}'
        )

        # Route Haiku calls: the tone critic gets the normal critic response,
        # landing gets the landing JSON — distinguished by system prompt.
        async def mock_claude_create(**kwargs):
            msg = MagicMock()
            system = kwargs.get("system", "") or ""
            model = kwargs.get("model", "")
            if "claude-haiku" in model and "landing" in system.lower():
                msg.content = [MagicMock(text=landing_json)]
            elif "claude-haiku" in model:
                msg.content = [MagicMock(text=claude_resp)]
            else:
                # Sonnet (synthesizer)
                msg.content = [MagicMock(text=synth_resp)]
            return msg

        mock_gpt_choice = MagicMock()
        mock_gpt_choice.message.content = gpt_resp
        mock_gpt_resp = MagicMock()
        mock_gpt_resp.choices = [mock_gpt_choice]

        async def mock_gpt_create(**kwargs):
            return mock_gpt_resp

        analyzer._anthropic.messages.create = mock_claude_create
        analyzer._openai.chat.completions.create = mock_gpt_create

        result = await analyzer.analyze(
            "Can you send me the doc today? Need it before the meeting please.",
            context="",
        )
        assert result["landing"]["takeaway"] == "They need the doc today"
        assert result["landing"]["tone_felt"] == "rushed, polite"
        assert result["agents"]["landing"] == "ok"

    @pytest.mark.asyncio
    async def test_landing_failure_does_not_block_rewrite(self, analyzer):
        """Landing throwing must not fail the overall analyze() call."""
        claude_resp = _make_critic_response()
        gpt_resp = _make_critic_response()
        synth_resp = _make_synthesis_response()

        async def mock_claude_create(**kwargs):
            system = kwargs.get("system", "") or ""
            model = kwargs.get("model", "")
            if "claude-haiku" in model and "landing" in system.lower():
                raise RuntimeError("landing api down")
            msg = MagicMock()
            if "claude-haiku" in model:
                msg.content = [MagicMock(text=claude_resp)]
            else:
                msg.content = [MagicMock(text=synth_resp)]
            return msg

        mock_gpt_choice = MagicMock()
        mock_gpt_choice.message.content = gpt_resp
        mock_gpt_resp = MagicMock()
        mock_gpt_resp.choices = [mock_gpt_choice]

        async def mock_gpt_create(**kwargs):
            return mock_gpt_resp

        analyzer._anthropic.messages.create = mock_claude_create
        analyzer._openai.chat.completions.create = mock_gpt_create

        result = await analyzer.analyze(
            "Please send me the document today if you can manage it.",
            context="",
        )
        # Landing absent or null but analysis still returned a valid rewrite
        assert result.get("landing") is None
        assert result["agents"]["landing"] == "error"
        assert result.get("rewrite")
