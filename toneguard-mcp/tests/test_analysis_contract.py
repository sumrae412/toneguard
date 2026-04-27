"""Shared analysis contract tests for MCP parsing and fixture compatibility."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from analyzer import ToneAnalyzer, precheck_analysis


REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PRIVACY_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_-]+"),
    re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE),
    re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    re.compile(r"https?://", re.IGNORECASE),
    re.compile(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b"),
]


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _load_contracts() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    return (
        _read_json(REPO_ROOT / "shared/analysis/schema.json"),
        _read_json(REPO_ROOT / "shared/analysis/modes.json"),
        _read_json(REPO_ROOT / "shared/analysis/categories.json"),
    )


def _validate_analysis_result(
    result: dict[str, Any],
    modes: dict[str, Any],
    categories: dict[str, Any],
) -> None:
    allowed_modes = {mode["id"] for mode in modes["response_modes"]}
    allowed_categories = {category["id"] for category in categories["categories"]}

    assert "flagged" in result
    assert isinstance(result["flagged"], bool)

    if "confidence" in result:
        assert isinstance(result["confidence"], int | float)
        assert 0 <= result["confidence"] <= 1

    if "mode" in result:
        assert result["mode"] in allowed_modes

    if "categories" in result:
        assert isinstance(result["categories"], list)
        for category in result["categories"]:
            assert category in allowed_categories

    if "questions" in result:
        assert isinstance(result["questions"], list)
        assert len(result["questions"]) <= 3

    if "issues" in result:
        assert isinstance(result["issues"], list)
        for issue in result["issues"]:
            assert isinstance(issue.get("explanation"), str)
            if "category" in issue:
                assert issue["category"] in allowed_categories
            if "severity" in issue:
                assert issue["severity"] in {"low", "medium", "high"}
            if "quote_confidence" in issue:
                assert issue["quote_confidence"] in {
                    "exact",
                    "approximate",
                    "missing",
                }


def test_mcp_fixture_copy_matches_js_fixture() -> None:
    """Both JS and MCP contract tests should run against the same corpus."""
    js_fixture = REPO_ROOT / "tests/fixtures/analysis-corpus.json"
    mcp_fixture = MCP_ROOT / "tests/fixtures/analysis-corpus.json"

    assert _read_json(mcp_fixture) == _read_json(js_fixture)


def test_fixture_corpus_is_synthetic_and_privacy_safe() -> None:
    corpus = _read_json(MCP_ROOT / "tests/fixtures/analysis-corpus.json")

    assert corpus["privacy"]["source"] == "synthetic"
    assert corpus["privacy"]["contains_real_user_text"] is False

    for fixture in corpus["fixtures"]:
        assert fixture["synthetic"] is True
        for pattern in FORBIDDEN_PRIVACY_PATTERNS:
            assert not pattern.search(fixture["message"]), fixture["id"]


def test_expected_outputs_match_shared_schema_taxonomies() -> None:
    schema, modes, categories = _load_contracts()
    corpus = _read_json(MCP_ROOT / "tests/fixtures/analysis-corpus.json")

    assert "flagged" in schema["required"]
    for fixture in corpus["fixtures"]:
        _validate_analysis_result(fixture["expected"], modes, categories)


def test_mcp_parser_accepts_fixture_model_responses() -> None:
    """Mocked fixture responses should parse without live model calls."""
    _, modes, categories = _load_contracts()
    corpus = _read_json(MCP_ROOT / "tests/fixtures/analysis-corpus.json")

    for fixture in corpus["fixtures"]:
        parsed = ToneAnalyzer._parse_json(fixture["model_response"])
        _validate_analysis_result(parsed, modes, categories)
        assert parsed["flagged"] is fixture["expected"]["flagged"], fixture["id"]
        assert parsed.get("mode", "") == fixture["expected"]["mode"], fixture["id"]


def test_mcp_precheck_routes_corpus_conservatively() -> None:
    corpus = _read_json(MCP_ROOT / "tests/fixtures/analysis-corpus.json")
    routes = {
        fixture["id"]: precheck_analysis(fixture["message"])["route"]
        for fixture in corpus["fixtures"]
    }

    assert routes == {
        "safe_short_ack": "local_pass",
        "passive_aggressive": "standard",
        "defensive": "deep",
        "unclear_ask": "standard",
        "hedged": "standard",
        "high_stakes_conflict": "standard",
        "boundary_setting": "standard",
        "parse_edge": "standard",
        "non_issue_casual": "standard",
    }
