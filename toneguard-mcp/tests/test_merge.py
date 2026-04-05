"""Merge parity tests — must produce identical output to tests/merge.test.js."""

from merge import (
    merge_decisions,
    merge_voice_samples,
    merge_relationships,
    merge_custom_rules,
    merge_stats_history,
)


# --- mergeDecisions ---


class TestMergeDecisions:
    def test_merges_two_disjoint_arrays(self):
        local = [{"timestamp": "2026-04-01T10:00:00Z", "action": "sent_original", "original": "a"}]
        remote = [{"timestamp": "2026-04-02T10:00:00Z", "action": "used_suggestion", "original": "b"}]
        result = merge_decisions(local, remote)
        assert len(result) == 2
        assert result[0]["original"] == "b"  # newest first

    def test_deduplicates_by_timestamp_action(self):
        d = {"timestamp": "2026-04-01T10:00:00Z", "action": "sent_original", "original": "same"}
        result = merge_decisions([d], [{**d}])
        assert len(result) == 1

    def test_trims_to_100(self):
        local = [
            {
                "timestamp": f"2026-01-01T{i:02d}:00:00Z",
                "action": "sent_original",
                "original": f"local-{i}",
            }
            for i in range(80)
        ]
        remote = [
            {
                "timestamp": f"2026-02-01T{i:02d}:00:00Z",
                "action": "sent_original",
                "original": f"remote-{i}",
            }
            for i in range(80)
        ]
        result = merge_decisions(local, remote)
        assert len(result) == 100

    def test_handles_empty_arrays(self):
        assert merge_decisions([], []) == []
        assert merge_decisions(None, []) == []
        assert merge_decisions([], None) == []
        assert merge_decisions(None, None) == []

    def test_handles_one_side_empty(self):
        data = [{"timestamp": "2026-04-01T10:00:00Z", "action": "sent_original", "original": "a"}]
        assert merge_decisions(data, []) == data
        assert merge_decisions([], data) == data

    def test_sorts_newest_first(self):
        old = {"timestamp": "2026-01-01T00:00:00Z", "action": "sent_original", "original": "old"}
        recent = {"timestamp": "2026-04-01T00:00:00Z", "action": "sent_original", "original": "new"}
        result = merge_decisions([old], [recent])
        assert result[0]["original"] == "new"
        assert result[1]["original"] == "old"


# --- mergeVoiceSamples ---


class TestMergeVoiceSamples:
    def test_merges_disjoint_samples(self):
        local = [{"text": "hello world", "timestamp": "2026-04-01T10:00:00Z"}]
        remote = [{"text": "goodbye world", "timestamp": "2026-04-02T10:00:00Z"}]
        result = merge_voice_samples(local, remote)
        assert len(result) == 2

    def test_deduplicates_by_text_content(self):
        s = {"text": "same message", "timestamp": "2026-04-01T10:00:00Z"}
        result = merge_voice_samples([s], [{**s, "timestamp": "2026-04-02T10:00:00Z"}])
        assert len(result) == 1

    def test_trims_to_30(self):
        local = [
            {"text": f"local-{i}", "timestamp": f"2026-01-01T{i:02d}:00:00Z"}
            for i in range(20)
        ]
        remote = [
            {"text": f"remote-{i}", "timestamp": f"2026-02-01T{i:02d}:00:00Z"}
            for i in range(20)
        ]
        result = merge_voice_samples(local, remote)
        assert len(result) == 30

    def test_handles_empty_null(self):
        assert merge_voice_samples(None, None) == []
        assert merge_voice_samples([], []) == []


# --- mergeRelationships ---


class TestMergeRelationships:
    def test_merges_disjoint_contacts(self):
        local = {"alice": {"messageCount": 5, "lastSeen": "2026-04-01T10:00:00Z"}}
        remote = {"bob": {"messageCount": 3, "lastSeen": "2026-04-02T10:00:00Z"}}
        result = merge_relationships(local, remote)
        assert set(result.keys()) == {"alice", "bob"}

    def test_takes_max_message_count(self):
        local = {"alice": {"messageCount": 5, "lastSeen": "2026-04-01T10:00:00Z"}}
        remote = {"alice": {"messageCount": 8, "lastSeen": "2026-03-01T10:00:00Z"}}
        result = merge_relationships(local, remote)
        assert result["alice"]["messageCount"] == 8

    def test_takes_latest_last_seen(self):
        local = {"alice": {"messageCount": 5, "lastSeen": "2026-04-01T10:00:00Z"}}
        remote = {"alice": {"messageCount": 3, "lastSeen": "2026-04-05T10:00:00Z"}}
        result = merge_relationships(local, remote)
        assert result["alice"]["lastSeen"] == "2026-04-05T10:00:00Z"

    def test_handles_empty_null(self):
        assert merge_relationships(None, None) == {}
        assert merge_relationships({}, {}) == {}

    def test_handles_one_side_missing(self):
        local = {"alice": {"messageCount": 5, "lastSeen": "2026-04-01T10:00:00Z"}}
        result = merge_relationships(local, {})
        assert result["alice"]["messageCount"] == 5


# --- mergeCustomRules ---


class TestMergeCustomRules:
    def test_takes_remote_when_newer(self):
        local = {"rules": "old rules", "updatedAt": "2026-04-01T10:00:00Z"}
        remote = {"rules": "new rules", "updatedAt": "2026-04-02T10:00:00Z"}
        result = merge_custom_rules(local, remote)
        assert result["rules"] == "new rules"
        assert result["source"] == "remote"

    def test_keeps_local_when_newer(self):
        local = {"rules": "local rules", "updatedAt": "2026-04-03T10:00:00Z"}
        remote = {"rules": "remote rules", "updatedAt": "2026-04-02T10:00:00Z"}
        result = merge_custom_rules(local, remote)
        assert result["rules"] == "local rules"
        assert result["source"] == "local"

    def test_handles_empty_null(self):
        result = merge_custom_rules(None, None)
        assert result["rules"] == ""
        assert result["source"] == "local"

    def test_handles_one_side_null(self):
        local = {"rules": "my rules", "updatedAt": "2026-04-01T10:00:00Z"}
        result = merge_custom_rules(local, None)
        assert result["rules"] == "my rules"


# --- mergeStatsHistory ---


class TestMergeStatsHistory:
    def test_merges_disjoint_weeks(self):
        local = [{"weekStart": "2026-03-24T00:00:00Z", "checked": 10, "flagged": 3}]
        remote = [{"weekStart": "2026-03-31T00:00:00Z", "checked": 5, "flagged": 1}]
        result = merge_stats_history(local, remote)
        assert len(result) == 2

    def test_takes_max_counts_for_overlapping_weeks(self):
        local = [{"weekStart": "2026-03-24T00:00:00Z", "checked": 10, "flagged": 3, "accepted": 2, "edited": 1, "dismissed": 0}]
        remote = [{"weekStart": "2026-03-24T00:00:00Z", "checked": 8, "flagged": 5, "accepted": 1, "edited": 0, "dismissed": 3}]
        result = merge_stats_history(local, remote)
        assert len(result) == 1
        assert result[0]["checked"] == 10
        assert result[0]["flagged"] == 5
        assert result[0]["dismissed"] == 3

    def test_trims_to_12_weeks(self):
        weeks = [
            {
                "weekStart": f"2026-0{min(i + 1, 9)}-01T00:00:00Z",
                "checked": i,
                "flagged": 0,
                "accepted": 0,
                "edited": 0,
                "dismissed": 0,
            }
            for i in range(15)
        ]
        result = merge_stats_history(weeks, [])
        assert len(result) <= 12

    def test_merges_by_mode_taking_max(self):
        local = [{
            "weekStart": "2026-03-24T00:00:00Z", "checked": 10, "flagged": 5,
            "accepted": 0, "edited": 0, "dismissed": 0,
            "byMode": {"tone": 3, "polish": 2},
        }]
        remote = [{
            "weekStart": "2026-03-24T00:00:00Z", "checked": 8, "flagged": 4,
            "accepted": 0, "edited": 0, "dismissed": 0,
            "byMode": {"tone": 1, "both": 3},
        }]
        result = merge_stats_history(local, remote)
        assert result[0]["byMode"] == {"tone": 3, "polish": 2, "both": 3}

    def test_handles_empty_null(self):
        assert merge_stats_history(None, None) == []
        assert merge_stats_history([], []) == []
