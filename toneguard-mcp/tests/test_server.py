"""Server integration tests — tool invocations with mocked APIs."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def store(tmp_path):
    from learning_store import LearningStore
    return LearningStore(path=str(tmp_path / "learning.json"))


class TestLogDecision:
    def test_log_decision_updates_store(self, store):
        """log_decision should update learning store and return count."""
        store.log_decision("used_suggestion", "hello", "hi there")
        decisions = store.get("decisions")
        assert len(decisions) == 1
        assert decisions[0]["action"] == "used_suggestion"

    def test_log_decision_increments_stats(self, store):
        """Multiple decisions should be reflected in stats."""
        store.log_decision("used_suggestion", "a", "b")
        store.log_decision("sent_original", "c")
        store.log_decision("used_edited", "d", "e", "f")
        stats = store.get_stats()
        assert stats["totalChecked"] == 3
        assert stats["totalAccepted"] == 1
        assert stats["totalDismissed"] == 1
        assert stats["totalEdited"] == 1


class TestGetHistory:
    def test_query_filters_work(self, store):
        store.log_decision("used_suggestion", "a", "b")
        store.log_decision("sent_original", "c")
        store.log_decision("used_suggestion", "d", "e")

        all_history = store.get_history(limit=10)
        assert len(all_history) == 3

        filtered = store.get_history(limit=10, action_filter="used_suggestion")
        assert len(filtered) == 2
        assert all(d["action"] == "used_suggestion" for d in filtered)


class TestSyncStatus:
    def test_disconnected_state(self):
        from learning_store import LearningStore
        from sync import SyncManager
        import tempfile, os

        path = os.path.join(tempfile.mkdtemp(), "learning.json")
        store = LearningStore(path=path)
        sm = SyncManager(learning_store=store)
        assert sm.connected is False
        assert sm.last_sync_at is None
