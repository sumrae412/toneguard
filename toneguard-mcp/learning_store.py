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
    "voice_fingerprint": "tg_voice_fingerprint",
    "relationships": "tg_relationships",
    "custom_rules": "tg_custom_rules",
    "stats": "tg_stats",
    "stats_history": "tg_stats_history",
}

# Voice sample caps per source — trained samples take precedence over
# auto-collected ones but shouldn't compete for the same budget.
MIN_VOICE_SAMPLE_CHARS = 30
VOICE_SAMPLE_CAP_TRAINED = 15
VOICE_SAMPLE_CAP_AUTO = 30

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

    def add_voice_sample(
        self, text: str, source: str = "auto"
    ) -> bool:
        """Append a voice sample tagged by source.

        Returns True on success, False if rejected (too short).

        Source semantics:
          - "auto": silently collected from the user's accepted/sent messages
          - "trained": explicitly pasted by the user via the Train Voice UI
        Deduplication by text content; if a sample already exists, the newer
        timestamp wins and "trained" upgrades over "auto".
        Per-source caps: trained=15, auto=30 — evicted oldest-first.
        """
        if not text or len(text) < MIN_VOICE_SAMPLE_CHARS:
            return False
        if source not in ("auto", "trained"):
            source = "auto"

        samples = self._data.get(STORAGE_KEYS["voice_samples"]) or []
        now = datetime.now(timezone.utc).isoformat()
        text_trim = text.strip()

        # Dedupe by text content. If an existing entry has the same text:
        #   - trained upgrades over auto
        #   - equal source → refresh the timestamp
        found = None
        for s in samples:
            if (s.get("text") or "").strip() == text_trim:
                found = s
                break
        if found is not None:
            if source == "trained" or found.get("source") == source:
                found["source"] = "trained" if source == "trained" or found.get("source") == "trained" else source
                found["timestamp"] = now
                self._data[STORAGE_KEYS["voice_samples"]] = samples
                self.save()
            return True

        samples.append({
            "text": text_trim[:500],
            "source": source,
            "timestamp": now,
        })

        # Per-source caps — evict oldest of the overflowing source only.
        trained = [s for s in samples if s.get("source") == "trained"]
        auto = [s for s in samples if s.get("source") != "trained"]
        if len(trained) > VOICE_SAMPLE_CAP_TRAINED:
            trained.sort(key=lambda s: s.get("timestamp") or "")
            trained = trained[-VOICE_SAMPLE_CAP_TRAINED:]
        if len(auto) > VOICE_SAMPLE_CAP_AUTO:
            auto.sort(key=lambda s: s.get("timestamp") or "")
            auto = auto[-VOICE_SAMPLE_CAP_AUTO:]
        # Keep arrival order approximately: concatenate sorted-by-timestamp.
        merged = sorted(trained + auto, key=lambda s: s.get("timestamp") or "")
        self._data[STORAGE_KEYS["voice_samples"]] = merged
        self.save()
        return True

    def get_learning_context(self, limit: int = 5) -> dict[str, Any]:
        """Recent decisions + voice samples for critic prompts.

        Prefers trained samples (up to `limit`), falls back to auto samples.
        This keeps user-curated style at the front of the prompt without
        losing the passive-collection signal for users who haven't trained.
        """
        decisions = self._data.get(STORAGE_KEYS["decisions"]) or []
        all_samples = self._data.get(STORAGE_KEYS["voice_samples"]) or []

        # Split, keep insertion order within each group.
        trained = [s for s in all_samples if s.get("source") == "trained"]
        auto = [s for s in all_samples if s.get("source") != "trained"]

        # Fill with trained up to limit, then auto to pad.
        picked = trained[-limit:]
        remaining = max(0, limit - len(picked))
        if remaining:
            picked = picked + auto[-remaining:]

        return {
            "recent_decisions": decisions[-limit:],
            "voice_samples": picked,
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
