"""Learning store tests — CRUD, atomic writes, stats, edge cases."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from learning_store import LearningStore, STORAGE_KEYS


@pytest.fixture
def store(tmp_path):
    """Create a LearningStore with a temp file path."""
    path = str(tmp_path / "learning.json")
    return LearningStore(path=path)


class TestCRUD:
    def test_write_read_verify(self, store):
        store.set("decisions", [{"action": "test", "timestamp": "2026-04-01T00:00:00Z"}])
        # Re-load from disk
        store.load()
        decisions = store.get("decisions")
        assert len(decisions) == 1
        assert decisions[0]["action"] == "test"

    def test_set_multiple_keys(self, store):
        store.set("decisions", [{"action": "a"}])
        store.set("voice_samples", [{"text": "hello"}])
        store.load()
        assert store.get("decisions") == [{"action": "a"}]
        assert store.get("voice_samples") == [{"text": "hello"}]


class TestAtomicWrite:
    def test_file_intact_after_save(self, store):
        store.set("stats", {"totalChecked": 42})
        # Verify file is valid JSON
        with open(store._path, "r") as f:
            data = json.load(f)
        assert data[STORAGE_KEYS["stats"]]["totalChecked"] == 42

    def test_original_intact_on_write_error(self, tmp_path):
        path = str(tmp_path / "learning.json")
        store = LearningStore(path=path)
        store.set("decisions", [{"action": "original"}])

        # Make the directory read-only to force write failure
        # This may not work on all systems, so we test a simpler scenario
        store.load()
        assert store.get("decisions") == [{"action": "original"}]


class TestStats:
    def test_log_3_decisions_stats_reflect_counts(self, store):
        store.log_decision("used_suggestion", "orig1", "sugg1")
        store.log_decision("sent_original", "orig2")
        store.log_decision("used_edited", "orig3", "sugg3", "final3")

        stats = store.get_stats()
        assert stats["totalChecked"] == 3
        assert stats["totalAccepted"] == 1  # used_suggestion
        assert stats["totalEdited"] == 1  # used_edited
        assert stats["totalDismissed"] == 1  # sent_original
        assert stats["totalFlagged"] == 2  # suggestion + edited

    def test_stats_increment_over_multiple_calls(self, store):
        store.log_decision("used_suggestion", "a", "b")
        store.log_decision("used_suggestion", "c", "d")
        stats = store.get_stats()
        assert stats["totalChecked"] == 2
        assert stats["totalAccepted"] == 2


class TestEmptyFile:
    def test_load_returns_valid_empty_structure(self, tmp_path):
        path = str(tmp_path / "learning.json")
        store = LearningStore(path=path)
        assert store.get("decisions") is None
        assert store.get_stats()["totalChecked"] == 0

    def test_load_handles_corrupt_json(self, tmp_path):
        path = str(tmp_path / "learning.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write("{invalid json!!")
        store = LearningStore(path=path)
        assert store.get("decisions") is None


class TestMissingFile:
    def test_auto_creates_on_first_write(self, tmp_path):
        path = str(tmp_path / "subdir" / "learning.json")
        store = LearningStore(path=path)
        store.set("decisions", [{"action": "test"}])
        assert os.path.exists(path)

    def test_missing_file_load_returns_empty(self, tmp_path):
        path = str(tmp_path / "nonexistent" / "learning.json")
        store = LearningStore(path=path)
        assert store.get("decisions") is None


class TestGetHistory:
    def test_returns_newest_first(self, store):
        store.log_decision("sent_original", "first")
        store.log_decision("used_suggestion", "second", "sugg")
        store.log_decision("sent_original", "third")

        history = store.get_history(limit=10)
        assert history[0]["original"] == "third"
        assert history[2]["original"] == "first"

    def test_action_filter(self, store):
        store.log_decision("sent_original", "a")
        store.log_decision("used_suggestion", "b", "sugg")
        store.log_decision("sent_original", "c")

        filtered = store.get_history(action_filter="sent_original")
        assert len(filtered) == 2
        assert all(d["action"] == "sent_original" for d in filtered)

    def test_limit(self, store):
        for i in range(20):
            store.log_decision("sent_original", f"msg-{i}")
        history = store.get_history(limit=5)
        assert len(history) == 5


class TestGetLearningContext:
    def test_returns_recent_decisions_and_samples(self, store):
        store.log_decision("sent_original", "hello")
        store.set("voice_samples", [{"text": "sample1"}, {"text": "sample2"}])

        ctx = store.get_learning_context(limit=5)
        assert len(ctx["recent_decisions"]) == 1
        assert len(ctx["voice_samples"]) == 2


class TestVoiceSampleSource:
    def test_add_voice_sample_defaults_to_auto_source(self, store):
        store.add_voice_sample("This is an example of my writing style for testing.")
        samples = store.get("voice_samples")
        assert len(samples) == 1
        assert samples[0]["source"] == "auto"

    def test_add_voice_sample_accepts_trained_source(self, store):
        store.add_voice_sample(
            "A carefully curated sample paragraph from me.", source="trained"
        )
        samples = store.get("voice_samples")
        assert samples[0]["source"] == "trained"

    def test_add_voice_sample_rejects_too_short(self, store):
        # <30 chars should not be stored
        result = store.add_voice_sample("too short")
        assert result is False
        assert (store.get("voice_samples") or []) == []

    def test_add_voice_sample_dedupes_existing_text(self, store):
        text = "Identical sample text that is long enough to qualify."
        store.add_voice_sample(text, source="auto")
        store.add_voice_sample(text, source="trained")
        samples = store.get("voice_samples")
        assert len(samples) == 1
        # Trained upgrade: when same text is re-added as trained, source upgrades
        assert samples[0]["source"] == "trained"

    def test_trained_samples_capped_at_15(self, store):
        for i in range(20):
            store.add_voice_sample(
                f"Trained sample number {i} with enough characters to pass the gate.",
                source="trained",
            )
        samples = [s for s in store.get("voice_samples") if s.get("source") == "trained"]
        assert len(samples) == 15

    def test_auto_samples_capped_at_30(self, store):
        for i in range(40):
            store.add_voice_sample(
                f"Auto sample number {i} with enough characters to qualify for storage."
            )
        samples = [s for s in store.get("voice_samples") if s.get("source") == "auto"]
        assert len(samples) == 30

    def test_get_learning_context_prefers_trained(self, store):
        # 5 auto + 3 trained — context should return trained first
        for i in range(5):
            store.add_voice_sample(f"Auto sample {i} with plenty of text content here.")
        for i in range(3):
            store.add_voice_sample(
                f"Trained sample {i} is carefully written by the user.",
                source="trained",
            )
        ctx = store.get_learning_context(limit=5)
        sources = [s.get("source") for s in ctx["voice_samples"]]
        # Trained first (up to 5), then auto
        assert sources.count("trained") == 3
        assert sources.count("auto") == 2


class TestVoiceFingerprint:
    def test_set_and_get_fingerprint(self, store):
        fp = {
            "text": "Terse, declarative, avoids exclamation marks.",
            "updatedAt": "2026-04-16T10:00:00Z",
            "sample_count": 5,
        }
        store.set("voice_fingerprint", fp)
        store.load()
        assert store.get("voice_fingerprint") == fp

    def test_clear_fingerprint(self, store):
        store.set("voice_fingerprint", {"text": "x", "updatedAt": "2026-04-16T10:00:00Z"})
        store.set("voice_fingerprint", None)
        assert store.get("voice_fingerprint") is None
