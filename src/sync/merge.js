// ToneGuard merge strategies — pure functions for conflict resolution.
// Each function takes (local, remote) and returns the merged result.

/**
 * Merge decision arrays: union by (timestamp + action), sort newest-first, trim to 100.
 */
function mergeDecisions(local, remote) {
  const all = [...(local || []), ...(remote || [])];
  const seen = new Set();
  const deduped = [];

  for (const d of all) {
    const key = (d.timestamp || "") + "|" + (d.action || "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(d);
  }

  deduped.sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    return tb.localeCompare(ta);
  });

  return deduped.slice(0, 100);
}

/**
 * Merge voice sample arrays: deduplicate by text content, keep newest 30.
 */
function mergeVoiceSamples(local, remote) {
  const all = [...(local || []), ...(remote || [])];
  const seen = new Set();
  const deduped = [];

  for (const s of all) {
    const key = s.text || "";
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  deduped.sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    return tb.localeCompare(ta);
  });

  return deduped.slice(0, 30);
}

/**
 * Merge relationship maps: per-key, take max messageCount and latest lastSeen.
 */
function mergeRelationships(local, remote) {
  const localMap = local || {};
  const remoteMap = remote || {};
  const merged = {};
  const allKeys = new Set([...Object.keys(localMap), ...Object.keys(remoteMap)]);

  for (const key of allKeys) {
    const l = localMap[key] || { messageCount: 0, lastSeen: null };
    const r = remoteMap[key] || { messageCount: 0, lastSeen: null };

    merged[key] = {
      messageCount: Math.max(l.messageCount || 0, r.messageCount || 0),
      lastSeen: (l.lastSeen || "") > (r.lastSeen || "") ? l.lastSeen : r.lastSeen
    };
  }

  return merged;
}

/**
 * Merge custom rules: last-write-wins based on updatedAt timestamp.
 * Returns { rules, source } where source is "local" or "remote".
 */
function mergeCustomRules(local, remote) {
  const localVal = local || { rules: "", updatedAt: "" };
  const remoteVal = remote || { rules: "", updatedAt: "" };

  if ((remoteVal.updatedAt || "") > (localVal.updatedAt || "")) {
    return { rules: remoteVal.rules, source: "remote", updatedAt: remoteVal.updatedAt };
  }
  return { rules: localVal.rules, source: "local", updatedAt: localVal.updatedAt };
}

/**
 * Merge stats history: union by weekStart, take higher counts per week.
 */
function mergeStatsHistory(local, remote) {
  const localArr = local || [];
  const remoteArr = remote || [];
  const byWeek = new Map();

  for (const week of [...localArr, ...remoteArr]) {
    const key = week.weekStart || "";
    const existing = byWeek.get(key);

    if (!existing) {
      byWeek.set(key, { ...week });
    } else {
      byWeek.set(key, {
        weekStart: key,
        checked: Math.max(existing.checked || 0, week.checked || 0),
        flagged: Math.max(existing.flagged || 0, week.flagged || 0),
        accepted: Math.max(existing.accepted || 0, week.accepted || 0),
        edited: Math.max(existing.edited || 0, week.edited || 0),
        dismissed: Math.max(existing.dismissed || 0, week.dismissed || 0),
        byMode: mergeByMode(existing.byMode, week.byMode)
      });
    }
  }

  const merged = [...byWeek.values()];
  merged.sort((a, b) => (a.weekStart || "").localeCompare(b.weekStart || ""));

  return merged.slice(-12);
}

function mergeByMode(a, b) {
  const modeA = a || {};
  const modeB = b || {};
  const merged = { ...modeA };

  for (const [key, val] of Object.entries(modeB)) {
    merged[key] = Math.max(merged[key] || 0, val || 0);
  }

  return merged;
}

// Last-write-wins on updatedAt. Unlike raw voice_samples (CRDT-union),
// the fingerprint is a derived artifact regenerated on demand, so newest
// wins is the right semantics. Returns null when both sides are null.
function mergeVoiceFingerprint(local, remote) {
  if (local == null && remote == null) return null;
  if (local == null) return remote;
  if (remote == null) return local;
  const localAt = local.updatedAt || "";
  const remoteAt = remote.updatedAt || "";
  return remoteAt > localAt ? remote : local;
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardMerge = {
    mergeDecisions,
    mergeVoiceSamples,
    mergeVoiceFingerprint,
    mergeRelationships,
    mergeCustomRules,
    mergeStatsHistory
  };
}
