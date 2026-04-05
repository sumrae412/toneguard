"""ToneGuard merge strategies — pure functions for conflict resolution.

Each function takes (local, remote) and returns the merged result.
Port of src/sync/merge.js — must produce identical output for the same inputs.
"""

from __future__ import annotations


def merge_decisions(local: list | None, remote: list | None) -> list:
    """Merge decision arrays: union by (timestamp+action), sort newest-first, trim to 100."""
    all_items = list(local or []) + list(remote or [])
    seen: set[str] = set()
    deduped: list[dict] = []

    for d in all_items:
        key = (d.get("timestamp") or "") + "|" + (d.get("action") or "")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(d)

    deduped.sort(key=lambda d: d.get("timestamp") or "", reverse=True)
    return deduped[:100]


def merge_voice_samples(local: list | None, remote: list | None) -> list:
    """Merge voice sample arrays: deduplicate by text content, keep newest 30."""
    all_items = list(local or []) + list(remote or [])
    seen: set[str] = set()
    deduped: list[dict] = []

    for s in all_items:
        key = s.get("text") or ""
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

    deduped.sort(key=lambda s: s.get("timestamp") or "", reverse=True)
    return deduped[:30]


def merge_relationships(local: dict | None, remote: dict | None) -> dict:
    """Merge relationship maps: per-key, take max messageCount and latest lastSeen."""
    local_map = local or {}
    remote_map = remote or {}
    merged: dict = {}
    all_keys = set(list(local_map.keys()) + list(remote_map.keys()))

    for key in all_keys:
        l = local_map.get(key, {"messageCount": 0, "lastSeen": None})
        r = remote_map.get(key, {"messageCount": 0, "lastSeen": None})

        merged[key] = {
            "messageCount": max(l.get("messageCount") or 0, r.get("messageCount") or 0),
            "lastSeen": l.get("lastSeen") if (l.get("lastSeen") or "") > (r.get("lastSeen") or "") else r.get("lastSeen"),
        }

    return merged


def merge_custom_rules(local: dict | None, remote: dict | None) -> dict:
    """Merge custom rules: last-write-wins based on updatedAt timestamp."""
    local_val = local or {"rules": "", "updatedAt": ""}
    remote_val = remote or {"rules": "", "updatedAt": ""}

    if (remote_val.get("updatedAt") or "") > (local_val.get("updatedAt") or ""):
        return {
            "rules": remote_val.get("rules", ""),
            "source": "remote",
            "updatedAt": remote_val.get("updatedAt", ""),
        }
    return {
        "rules": local_val.get("rules", ""),
        "source": "local",
        "updatedAt": local_val.get("updatedAt", ""),
    }


def _merge_by_mode(a: dict | None, b: dict | None) -> dict:
    """Merge byMode dicts: per-key max."""
    mode_a = a or {}
    mode_b = b or {}
    merged = {**mode_a}

    for key, val in mode_b.items():
        merged[key] = max(merged.get(key) or 0, val or 0)

    return merged


def merge_stats_history(local: list | None, remote: list | None) -> list:
    """Merge stats history: union by weekStart, take higher counts per week, trim to 12."""
    local_arr = local or []
    remote_arr = remote or []
    by_week: dict[str, dict] = {}

    for week in [*local_arr, *remote_arr]:
        key = week.get("weekStart") or ""
        existing = by_week.get(key)

        if existing is None:
            by_week[key] = {**week}
        else:
            by_week[key] = {
                "weekStart": key,
                "checked": max(existing.get("checked") or 0, week.get("checked") or 0),
                "flagged": max(existing.get("flagged") or 0, week.get("flagged") or 0),
                "accepted": max(existing.get("accepted") or 0, week.get("accepted") or 0),
                "edited": max(existing.get("edited") or 0, week.get("edited") or 0),
                "dismissed": max(existing.get("dismissed") or 0, week.get("dismissed") or 0),
                "byMode": _merge_by_mode(existing.get("byMode"), week.get("byMode")),
            }

    merged = list(by_week.values())
    merged.sort(key=lambda w: w.get("weekStart") or "")
    return merged[-12:]
