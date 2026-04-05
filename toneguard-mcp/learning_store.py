"""JSON file-backed learning storage for ToneGuard.

Stores decisions, voice samples, relationships, custom rules, and stats
at ~/.toneguard/learning.json with atomic writes.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

STORAGE_KEYS = {
    "decisions": "tg_decisions",
    "voice_samples": "tg_voice_samples",
    "relationships": "tg_relationships",
    "custom_rules": "tg_custom_rules",
    "stats": "tg_stats",
    "stats_history": "tg_stats_history",
}

DEFAULT_STATS = {
    "totalChecked": 0,
    "totalFlagged": 0,
    "totalAccepted": 0,
    "totalEdited": 0,
    "totalDismissed": 0,
}


class LearningStore:
    """File-backed learning store at ~/.toneguard/learning.json."""

    def __init__(self, path: Optional[str] = None):
        if path is None:
            path = os.path.join(Path.home(), ".toneguard", "learning.json")
        self._path = path
        self._data: dict[str, Any] = {}
        self.load()

    def load(self) -> dict[str, Any]:
        """Read JSON file, return empty dict if missing/corrupt."""
        try:
            with open(self._path, "r") as f:
                self._data = json.load(f)
                if not isinstance(self._data, dict):
                    self._data = {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            self._data = {}
        return self._data

    def save(self) -> None:
        """Atomic write: write to .tmp, then rename."""
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        dir_name = os.path.dirname(self._path)
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f, indent=2)
            os.replace(tmp_path, self._path)
        except Exception:
            # Clean up temp file on failure
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def get(self, key: str) -> Any:
        """Get a storage key's value."""
        storage_key = STORAGE_KEYS.get(key, key)
        return self._data.get(storage_key)

    def set(self, key: str, value: Any) -> None:
        """Set a storage key and save."""
        storage_key = STORAGE_KEYS.get(key, key)
        self._data[storage_key] = value
        self.save()

    def log_decision(
        self,
        action: str,
        original: str,
        suggestion: str = "",
        final_text: str = "",
    ) -> None:
        """Append to decisions and update stats."""
        decisions = self._data.get(STORAGE_KEYS["decisions"]) or []
        decisions.append({
            "action": action,
            "original": original,
            "suggestion": suggestion,
            "finalText": final_text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        # Trim to 100
        self._data[STORAGE_KEYS["decisions"]] = decisions[-100:]

        # Update stats
        stats = self._data.get(STORAGE_KEYS["stats"]) or {**DEFAULT_STATS}
        stats["totalChecked"] = stats.get("totalChecked", 0) + 1
        if action == "used_suggestion":
            stats["totalAccepted"] = stats.get("totalAccepted", 0) + 1
            stats["totalFlagged"] = stats.get("totalFlagged", 0) + 1
        elif action == "used_edited":
            stats["totalEdited"] = stats.get("totalEdited", 0) + 1
            stats["totalFlagged"] = stats.get("totalFlagged", 0) + 1
        elif action == "sent_original":
            stats["totalDismissed"] = stats.get("totalDismissed", 0) + 1
        self._data[STORAGE_KEYS["stats"]] = stats

        self.save()

    def get_learning_context(self, limit: int = 5) -> dict[str, Any]:
        """Recent decisions + voice samples for critic prompts."""
        decisions = self._data.get(STORAGE_KEYS["decisions"]) or []
        voice_samples = self._data.get(STORAGE_KEYS["voice_samples"]) or []
        return {
            "recent_decisions": decisions[-limit:],
            "voice_samples": voice_samples[-limit:],
        }

    def get_history(
        self, limit: int = 10, action_filter: Optional[str] = None
    ) -> list[dict]:
        """Query decisions with optional filter."""
        decisions = self._data.get(STORAGE_KEYS["decisions"]) or []
        if action_filter:
            decisions = [d for d in decisions if d.get("action") == action_filter]
        # Return newest first
        return list(reversed(decisions[-limit:]))

    def get_stats(self) -> dict:
        """Return current stats dict."""
        return self._data.get(STORAGE_KEYS["stats"]) or {**DEFAULT_STATS}
