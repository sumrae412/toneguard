import { describe, it, expect } from "vitest";
import {
  mergeDecisions,
  mergeVoiceSamples,
  mergeRelationships,
  mergeCustomRules,
  mergeStatsHistory
} from "./merge-exports.mjs";

describe("mergeDecisions", () => {
  it("merges two disjoint arrays", () => {
    const local = [{ timestamp: "2026-04-01T10:00:00Z", action: "sent_original", original: "a" }];
    const remote = [{ timestamp: "2026-04-02T10:00:00Z", action: "used_suggestion", original: "b" }];
    const result = mergeDecisions(local, remote);
    expect(result).toHaveLength(2);
    expect(result[0].original).toBe("b"); // newest first
  });

  it("deduplicates by timestamp+action", () => {
    const d = { timestamp: "2026-04-01T10:00:00Z", action: "sent_original", original: "same" };
    const result = mergeDecisions([d], [{ ...d }]);
    expect(result).toHaveLength(1);
  });

  it("trims to 100", () => {
    const local = Array.from({ length: 80 }, (_, i) => ({
      timestamp: "2026-01-01T" + String(i).padStart(2, "0") + ":00:00Z",
      action: "sent_original",
      original: "local-" + i
    }));
    const remote = Array.from({ length: 80 }, (_, i) => ({
      timestamp: "2026-02-01T" + String(i).padStart(2, "0") + ":00:00Z",
      action: "sent_original",
      original: "remote-" + i
    }));
    const result = mergeDecisions(local, remote);
    expect(result).toHaveLength(100);
  });

  it("handles empty arrays", () => {
    expect(mergeDecisions([], [])).toEqual([]);
    expect(mergeDecisions(null, [])).toEqual([]);
    expect(mergeDecisions([], null)).toEqual([]);
    expect(mergeDecisions(null, null)).toEqual([]);
  });

  it("handles one side empty", () => {
    const data = [{ timestamp: "2026-04-01T10:00:00Z", action: "sent_original", original: "a" }];
    expect(mergeDecisions(data, [])).toEqual(data);
    expect(mergeDecisions([], data)).toEqual(data);
  });

  it("sorts newest first", () => {
    const old = { timestamp: "2026-01-01T00:00:00Z", action: "sent_original", original: "old" };
    const recent = { timestamp: "2026-04-01T00:00:00Z", action: "sent_original", original: "new" };
    const result = mergeDecisions([old], [recent]);
    expect(result[0].original).toBe("new");
    expect(result[1].original).toBe("old");
  });
});

describe("mergeVoiceSamples", () => {
  it("merges disjoint samples", () => {
    const local = [{ text: "hello world", timestamp: "2026-04-01T10:00:00Z" }];
    const remote = [{ text: "goodbye world", timestamp: "2026-04-02T10:00:00Z" }];
    const result = mergeVoiceSamples(local, remote);
    expect(result).toHaveLength(2);
  });

  it("deduplicates by text content", () => {
    const s = { text: "same message", timestamp: "2026-04-01T10:00:00Z" };
    const result = mergeVoiceSamples([s], [{ ...s, timestamp: "2026-04-02T10:00:00Z" }]);
    expect(result).toHaveLength(1);
  });

  it("trims to 30", () => {
    const local = Array.from({ length: 20 }, (_, i) => ({
      text: "local-" + i,
      timestamp: "2026-01-01T" + String(i).padStart(2, "0") + ":00:00Z"
    }));
    const remote = Array.from({ length: 20 }, (_, i) => ({
      text: "remote-" + i,
      timestamp: "2026-02-01T" + String(i).padStart(2, "0") + ":00:00Z"
    }));
    const result = mergeVoiceSamples(local, remote);
    expect(result).toHaveLength(30);
  });

  it("handles empty/null", () => {
    expect(mergeVoiceSamples(null, null)).toEqual([]);
    expect(mergeVoiceSamples([], [])).toEqual([]);
  });
});

describe("mergeRelationships", () => {
  it("merges disjoint contacts", () => {
    const local = { alice: { messageCount: 5, lastSeen: "2026-04-01T10:00:00Z" } };
    const remote = { bob: { messageCount: 3, lastSeen: "2026-04-02T10:00:00Z" } };
    const result = mergeRelationships(local, remote);
    expect(Object.keys(result)).toEqual(["alice", "bob"]);
  });

  it("takes max messageCount for shared contacts", () => {
    const local = { alice: { messageCount: 5, lastSeen: "2026-04-01T10:00:00Z" } };
    const remote = { alice: { messageCount: 8, lastSeen: "2026-03-01T10:00:00Z" } };
    const result = mergeRelationships(local, remote);
    expect(result.alice.messageCount).toBe(8);
  });

  it("takes latest lastSeen for shared contacts", () => {
    const local = { alice: { messageCount: 5, lastSeen: "2026-04-01T10:00:00Z" } };
    const remote = { alice: { messageCount: 3, lastSeen: "2026-04-05T10:00:00Z" } };
    const result = mergeRelationships(local, remote);
    expect(result.alice.lastSeen).toBe("2026-04-05T10:00:00Z");
  });

  it("handles empty/null", () => {
    expect(mergeRelationships(null, null)).toEqual({});
    expect(mergeRelationships({}, {})).toEqual({});
  });

  it("handles one side missing a contact", () => {
    const local = { alice: { messageCount: 5, lastSeen: "2026-04-01T10:00:00Z" } };
    const result = mergeRelationships(local, {});
    expect(result.alice.messageCount).toBe(5);
  });
});

describe("mergeCustomRules", () => {
  it("takes remote when remote is newer", () => {
    const local = { rules: "old rules", updatedAt: "2026-04-01T10:00:00Z" };
    const remote = { rules: "new rules", updatedAt: "2026-04-02T10:00:00Z" };
    const result = mergeCustomRules(local, remote);
    expect(result.rules).toBe("new rules");
    expect(result.source).toBe("remote");
  });

  it("keeps local when local is newer", () => {
    const local = { rules: "local rules", updatedAt: "2026-04-03T10:00:00Z" };
    const remote = { rules: "remote rules", updatedAt: "2026-04-02T10:00:00Z" };
    const result = mergeCustomRules(local, remote);
    expect(result.rules).toBe("local rules");
    expect(result.source).toBe("local");
  });

  it("handles empty/null", () => {
    const result = mergeCustomRules(null, null);
    expect(result.rules).toBe("");
    expect(result.source).toBe("local");
  });

  it("handles one side null", () => {
    const local = { rules: "my rules", updatedAt: "2026-04-01T10:00:00Z" };
    const result = mergeCustomRules(local, null);
    expect(result.rules).toBe("my rules");
  });
});

describe("mergeStatsHistory", () => {
  it("merges disjoint weeks", () => {
    const local = [{ weekStart: "2026-03-24T00:00:00Z", checked: 10, flagged: 3 }];
    const remote = [{ weekStart: "2026-03-31T00:00:00Z", checked: 5, flagged: 1 }];
    const result = mergeStatsHistory(local, remote);
    expect(result).toHaveLength(2);
  });

  it("takes max counts for overlapping weeks", () => {
    const local = [{ weekStart: "2026-03-24T00:00:00Z", checked: 10, flagged: 3, accepted: 2, edited: 1, dismissed: 0 }];
    const remote = [{ weekStart: "2026-03-24T00:00:00Z", checked: 8, flagged: 5, accepted: 1, edited: 0, dismissed: 3 }];
    const result = mergeStatsHistory(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].checked).toBe(10);
    expect(result[0].flagged).toBe(5);
    expect(result[0].dismissed).toBe(3);
  });

  it("trims to 12 weeks", () => {
    const weeks = Array.from({ length: 15 }, (_, i) => ({
      weekStart: "2026-0" + (i < 9 ? i + 1 : "9") + "-01T00:00:00Z",
      checked: i,
      flagged: 0,
      accepted: 0,
      edited: 0,
      dismissed: 0
    }));
    const result = mergeStatsHistory(weeks, []);
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("merges byMode taking max per key", () => {
    const local = [{
      weekStart: "2026-03-24T00:00:00Z", checked: 10, flagged: 5,
      accepted: 0, edited: 0, dismissed: 0,
      byMode: { tone: 3, polish: 2 }
    }];
    const remote = [{
      weekStart: "2026-03-24T00:00:00Z", checked: 8, flagged: 4,
      accepted: 0, edited: 0, dismissed: 0,
      byMode: { tone: 1, both: 3 }
    }];
    const result = mergeStatsHistory(local, remote);
    expect(result[0].byMode).toEqual({ tone: 3, polish: 2, both: 3 });
  });

  it("handles empty/null", () => {
    expect(mergeStatsHistory(null, null)).toEqual([]);
    expect(mergeStatsHistory([], [])).toEqual([]);
  });
});
