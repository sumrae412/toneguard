# Swarm Intelligence Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add layered emergence (swarm intelligence) to code-creation-workflow with tiered complexity, Bayesian agent registry, inter-agent communication, and persistent telemetry.

**Architecture:** Extend existing skill files (SKILL.md + references/) with tiered protocols. Add Python helper scripts for registry operations (Bayesian updates, concurrency, retention). Add new reference files for schemas, protocols, and templates. Modify smart-exploration for registry integration.

**Tech Stack:** Markdown (skill files), Python 3.11+ (registry scripts), JSON (state files)

**Design doc:** `docs/plans/2026-04-06-swarm-intelligence-workflow-design.md`

---

## Component Dependency Graph

```
Task 1: Registry schemas (reference file)
Task 2: Registry helper scripts (Python)
  └── depends on: Task 1
Task 3: Complexity classifier (SKILL.md Phase 1 update)
  └── depends on: Task 2
Task 4: Scratchpad protocol (reference file)
Task 5: Phase 2 SKILL.md update (tiered exploration)
  └── depends on: Task 2, Task 3, Task 4
Task 6: Smart-exploration registry integration
  └── depends on: Task 2, Task 5
Task 7: Phase 4 SKILL.md update (tiered architecture)
  └── depends on: Task 5
Task 8: Build-state protocol (reference file)
Task 9: Agent signal protocol (reference file)
Task 10: Phase 5 SKILL.md update (tiered implementation)
  └── depends on: Task 7, Task 8, Task 9
Task 11: Phase 6 SKILL.md update (tiered review)
  └── depends on: Task 10
Task 12: Missed-context audit protocol (reference file)
  └── depends on: Task 2
Task 13: Periodic review protocol (reference file)
  └── depends on: Task 12
Task 14: Update error-recovery.md and common-mistakes.md
  └── depends on: Task 11
Task 15: Integration validation
  └── depends on: all
```

Independent task groups (can parallelize):
- Group A: Tasks 1 → 2
- Group B: Tasks 4, 8, 9, 12 (all reference files, no dependencies on each other)
- Sequential spine: Tasks 3 → 5 → 6 → 7 → 10 → 11 → 14 → 15

---

## Task 1: Registry Schemas Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/registry-schemas.md`

**Step 1: Write the registry schemas reference**

This file defines the JSON schemas for all persistent swarm state files. It is the source of truth that all other tasks reference.

```markdown
# Registry Schemas

> Source of truth for all swarm state file schemas. Referenced by registry
> helper scripts, SKILL.md protocols, and the periodic review process.

## Schema Version: 2

### Global Agent Registry (`~/.claude/swarm/agent-registry.json`)

\`\`\`json
{
  "schema_version": 2,
  "agents": {
    "<agent_type>:<prompt_variant>": {
      "prior": { "alpha": 1, "beta": 1 },
      "dispatches": 0,
      "findings_produced": 0,
      "findings_used": 0,
      "findings_used_rate": 0.0,
      "findings_accepted": 0,
      "findings_dismissed": 0,
      "finding_rate": 0.0,
      "acceptance_rate": 0.0,
      "missed_context_count": 0,
      "last_dispatched": null,
      "last_updated": null
    }
  },
  "complexity_calibration": {
    "weights": {
      "reasoning_depth": 1.0,
      "ambiguity": 1.0,
      "context_dependency": 1.0,
      "novelty": 1.0
    },
    "history": []
  },
  "global_patterns": {
    "architecture_preferences": {
      "simplicity": 0.33,
      "separation": 0.33,
      "contrarian": 0.33
    }
  },
  "project_fingerprints": {}
}
\`\`\`

**Agent entry fields:**

| Field | Type | Description |
|-------|------|-------------|
| prior.alpha | float | Beta distribution success count |
| prior.beta | float | Beta distribution failure count |
| dispatches | int | Total times dispatched |
| findings_produced | int | Total findings/files returned |
| findings_used | int | Findings that were used downstream |
| findings_used_rate | float | findings_used / findings_produced |
| findings_accepted | int | Findings user accepted (reviewers) |
| findings_dismissed | int | Findings user dismissed (reviewers) |
| finding_rate | float | findings_produced / dispatches |
| acceptance_rate | float | findings_accepted / (accepted + dismissed) |
| missed_context_count | int | Times agent missed available info |
| last_dispatched | string|null | ISO timestamp |
| last_updated | string|null | ISO timestamp |

**Effectiveness score:** `alpha / (alpha + beta)`
**Confidence:** `alpha + beta` (higher = more data)

### Project Overlay (`.claude/swarm/agent-registry.json`)

Same structure as global, plus:

\`\`\`json
{
  "schema_version": 2,
  "project_fingerprint": {
    "languages": [],
    "frameworks": [],
    "has_migrations": false,
    "has_external_apis": false,
    "layer_count": 0
  },
  "agents": {},
  "complexity_calibration": {}
}
\`\`\`

### Exploration Log (`.claude/swarm/exploration-log/SESSION_ID.json`)

\`\`\`json
{
  "schema_version": 2,
  "session_id": "",
  "timestamp": "",
  "task": "",
  "tier": "moderate|complex",
  "degradation_probe": {
    "reduced_context_result": "",
    "quality_assessment": "",
    "tier_adjustment": "none|downgrade|upgrade"
  },
  "explorers": [
    {
      "agent": "",
      "prompt_variant": "",
      "dispatch_order": 0,
      "received_scratchpad": false,
      "files_found": [],
      "files_hydrated": [],
      "patterns_found": [],
      "gaps_identified": [],
      "gaps_filled": [],
      "gaps_filled_by_later": false,
      "gaps_remaining": [],
      "duration_ms": 0
    }
  ],
  "architecture": {
    "proposals": [
      {
        "architect": "",
        "summary": "",
        "ideas_adopted": 0,
        "ideas_rejected": 0
      }
    ],
    "gap_fill_triggered": false,
    "gap_fill_query": "",
    "gap_fill_resolved": false,
    "critique_round": {
      "changed_synthesis_outcome": false,
      "key_impact": ""
    },
    "user_choice": ""
  },
  "implementation": {
    "steps": [
      {
        "step": 0,
        "domain": "",
        "thinking_budget": "",
        "pass_first_attempt": false,
        "retry_count": 0,
        "failed_approaches": [],
        "deviations": [],
        "discoveries": [],
        "signals": [],
        "rescue_dispatched": false,
        "rescue_agent_type": null,
        "rescue_succeeded": null,
        "build_state_written": false
      }
    ],
    "architecture_deviation_checks": []
  },
  "review": {
    "waves": [],
    "meta_reviewer": {
      "patterns_escalated": 0,
      "gaps_detected": [],
      "contradictions_resolved": 0,
      "dedup_merges": 0
    },
    "review_to_exploration_feedback": []
  }
}
\`\`\`

### Missed-Context Log (`.claude/swarm/missed-context-log/SESSION_ID.json`)

\`\`\`json
{
  "schema_version": 2,
  "session_id": "",
  "timestamp": "",
  "task": "",
  "tier": "",
  "misses": [
    {
      "phase": 0,
      "agent": "",
      "miss_type": "available_in_prompt|available_in_project|available_in_memory|not_available",
      "what_was_missed": "",
      "where_it_existed": "",
      "impact": "",
      "severity": "low|medium|high"
    }
  ],
  "summary": {
    "total_misses": 0,
    "by_type": {},
    "by_phase": {},
    "by_severity": {}
  }
}
\`\`\`

### Exploration Scratchpad (`.claude/swarm/exploration-scratchpad.json`)

Ephemeral — created at Phase 2 start, deleted at session end.

\`\`\`json
{
  "explorers": {
    "<explorer_name>": {
      "key_files": [],
      "patterns_found": [],
      "gaps": [],
      "timestamp": ""
    }
  }
}
\`\`\`

### Build State (`.claude/swarm/build-state.json`)

Ephemeral — created at Phase 5 start, archived into exploration log at session end.

\`\`\`json
{
  "steps_completed": [
    {
      "step": 0,
      "files_created": [],
      "files_modified": [],
      "interfaces_exposed": [],
      "patterns_used": [],
      "decisions_made": [],
      "gotchas_encountered": [],
      "failed_approaches": [],
      "test_files": []
    }
  ]
}
\`\`\`

### Review Findings (`.claude/swarm/review-findings.json`)

Ephemeral — created at Phase 6 start, archived into exploration log at session end.

\`\`\`json
{
  "waves": {
    "wave_1": {
      "<reviewer_name>": {
        "findings": [],
        "areas_reviewed": [],
        "patterns_noticed": []
      }
    },
    "wave_2": {},
    "wave_3_meta": {}
  }
}
\`\`\`

### Registry Events (append-only, `~/.claude/swarm/registry-events.jsonl`)

One JSON object per line. Compacted into agent-registry.json on session start.

\`\`\`
{"ts":"...","agent":"...","event":"finding_accepted","project":"...","data":{}}
{"ts":"...","agent":"...","event":"file_hydrated","project":"...","data":{}}
\`\`\`

**Event types:**

| Event | Phase | Data |
|-------|-------|------|
| `dispatched` | 2,4,5,6 | `{prompt_variant, tier}` |
| `file_found` | 2 | `{file_path}` |
| `file_hydrated` | 2 | `{file_path}` |
| `finding_produced` | 6 | `{severity, category}` |
| `finding_accepted` | 6 | `{finding_id}` |
| `finding_dismissed` | 6 | `{finding_id}` |
| `idea_adopted` | 4 | `{architect, idea_summary}` |
| `idea_rejected` | 4 | `{architect, idea_summary}` |
| `step_passed` | 5 | `{step, domain, first_attempt}` |
| `step_failed` | 5 | `{step, domain, error_class}` |
| `rescue_dispatched` | 5 | `{original_agent, rescue_agent}` |
| `rescue_resolved` | 5 | `{rescue_agent}` |
| `missed_context` | 2,4,5,6 | `{miss_type, agent, severity}` |
| `critique_impactful` | 4 | `{critic, impact_summary}` |
| `pattern_escalated` | 6 | `{pattern, files_affected}` |
| `tier_assigned` | 1 | `{static_score, probe_result, final_tier}` |

### Complexity Calibration History Entry

\`\`\`json
{
  "timestamp": "",
  "static_score": 0,
  "axis_scores": {
    "reasoning_depth": 0,
    "ambiguity": 0,
    "context_dependency": 0,
    "novelty": 0
  },
  "probe_result": "good|poor|skipped",
  "assigned_tier": "",
  "actual_outcome": "appropriate|under_tiered|over_tiered",
  "evidence": ""
}
\`\`\`
```

**Step 2: Verify the file was created and is well-formed**

Run: `cat ~/.claude/skills/code-creation-workflow/references/registry-schemas.md | head -5`
Expected: Shows the title and opening description.

**Step 3: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/registry-schemas.md
git commit -m "feat(swarm): add registry schema definitions"
```

---

## Task 2: Registry Helper Scripts

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/scripts/registry.py`
- Test: `~/.claude/skills/code-creation-workflow/scripts/test_registry.py`

This is a Python module providing registry operations: init, read, update (Bayesian), compact events, apply decay, compute effectiveness, blend priors, fingerprint similarity, retention cleanup, schema migration.

**Step 1: Write the failing tests**

```python
"""Tests for swarm registry operations."""

import json
import os
import tempfile
import time
from pathlib import Path

import pytest

from registry import (
    Registry,
    bayesian_update,
    compute_effectiveness,
    blend_priors,
    fingerprint_similarity,
    compact_events,
    apply_decay,
    dispatch_decision,
)


@pytest.fixture
def tmp_dir(tmp_path):
    """Create temp dirs mimicking global + project swarm layout."""
    global_dir = tmp_path / "global" / "swarm"
    project_dir = tmp_path / "project" / ".claude" / "swarm"
    global_dir.mkdir(parents=True)
    project_dir.mkdir(parents=True)
    return {"global": str(global_dir), "project": str(project_dir)}


class TestBayesianUpdate:
    def test_success_increments_alpha(self):
        prior = {"alpha": 1, "beta": 1}
        updated = bayesian_update(prior, success=True)
        assert updated["alpha"] == 2
        assert updated["beta"] == 1

    def test_failure_increments_beta(self):
        prior = {"alpha": 1, "beta": 1}
        updated = bayesian_update(prior, success=False)
        assert updated["alpha"] == 1
        assert updated["beta"] == 2

    def test_preserves_existing_counts(self):
        prior = {"alpha": 8, "beta": 3}
        updated = bayesian_update(prior, success=True)
        assert updated["alpha"] == 9
        assert updated["beta"] == 3


class TestComputeEffectiveness:
    def test_uniform_prior(self):
        assert compute_effectiveness({"alpha": 1, "beta": 1}) == 0.5

    def test_strong_positive(self):
        score = compute_effectiveness({"alpha": 9, "beta": 1})
        assert score == 0.9

    def test_strong_negative(self):
        score = compute_effectiveness({"alpha": 1, "beta": 9})
        assert score == 0.1


class TestBlendPriors:
    def test_sparse_project_blends_with_global(self):
        global_agent = {"prior": {"alpha": 10, "beta": 2}, "dispatches": 50}
        project_agent = {"prior": {"alpha": 2, "beta": 1}, "dispatches": 3}
        blended = blend_priors(project_agent, global_agent)
        # With 3 dispatches: 0.7 * project + 0.3 * global
        project_eff = 2 / 3  # 0.667
        global_eff = 10 / 12  # 0.833
        expected = 0.7 * project_eff + 0.3 * global_eff
        assert abs(blended - expected) < 0.001

    def test_mature_project_ignores_global(self):
        global_agent = {"prior": {"alpha": 10, "beta": 2}, "dispatches": 50}
        project_agent = {"prior": {"alpha": 5, "beta": 5}, "dispatches": 20}
        blended = blend_priors(project_agent, global_agent)
        assert blended == 0.5  # Pure project score

    def test_no_project_data_uses_global(self):
        global_agent = {"prior": {"alpha": 8, "beta": 2}, "dispatches": 30}
        blended = blend_priors(None, global_agent)
        assert blended == 0.8


class TestFingerprintSimilarity:
    def test_identical(self):
        a = {"languages": ["python"], "frameworks": ["fastapi"]}
        b = {"languages": ["python"], "frameworks": ["fastapi"]}
        assert fingerprint_similarity(a, b) == 1.0

    def test_no_overlap(self):
        a = {"languages": ["python"], "frameworks": ["django"]}
        b = {"languages": ["javascript"], "frameworks": ["react"]}
        assert fingerprint_similarity(a, b) == 0.0

    def test_partial_overlap(self):
        a = {"languages": ["python"], "frameworks": ["fastapi", "sqlalchemy"]}
        b = {"languages": ["python"], "frameworks": ["fastapi", "django"]}
        sim = fingerprint_similarity(a, b)
        # intersection: python, fastapi = 2, union: python, fastapi, sqlalchemy, django = 4
        assert sim == 0.5

    def test_boolean_fields_count(self):
        a = {"languages": ["python"], "has_migrations": True, "has_external_apis": True}
        b = {"languages": ["python"], "has_migrations": True, "has_external_apis": False}
        sim = fingerprint_similarity(a, b)
        # Tags: python, migrations=true, external_apis=true vs python, migrations=true, external_apis=false
        # intersection: python, migrations=true = 2, union: all 3 unique tags = 3
        assert abs(sim - 2 / 3) < 0.01


class TestApplyDecay:
    def test_decays_alpha_and_beta(self):
        agent = {"prior": {"alpha": 10.0, "beta": 5.0}}
        decayed = apply_decay(agent, factor=0.85)
        assert decayed["prior"]["alpha"] == 8.5
        assert decayed["prior"]["beta"] == 4.25

    def test_floor_at_one(self):
        agent = {"prior": {"alpha": 1.1, "beta": 1.0}}
        decayed = apply_decay(agent, factor=0.85)
        assert decayed["prior"]["alpha"] == 1.0  # max(1, 1.1*0.85=0.935) = 1.0
        assert decayed["prior"]["beta"] == 1.0


class TestDispatchDecision:
    def test_high_effectiveness_dispatches(self):
        result = dispatch_decision(effectiveness=0.8, confidence=20)
        assert result["action"] == "dispatch"
        assert result["budget"] == "full"

    def test_low_effectiveness_high_confidence_skips(self):
        result = dispatch_decision(effectiveness=0.05, confidence=20)
        assert result["action"] == "skip"

    def test_low_effectiveness_low_confidence_dispatches(self):
        result = dispatch_decision(effectiveness=0.15, confidence=5)
        assert result["action"] == "dispatch"
        assert result["budget"] == "full"

    def test_moderate_effectiveness_high_confidence_reduces(self):
        result = dispatch_decision(effectiveness=0.2, confidence=20)
        assert result["action"] == "dispatch"
        assert result["budget"] == "reduced"


class TestCompactEvents:
    def test_applies_events_to_registry(self, tmp_dir):
        # Write initial registry
        registry = {
            "schema_version": 2,
            "agents": {
                "security-reviewer": {
                    "prior": {"alpha": 1, "beta": 1},
                    "dispatches": 0,
                    "findings_produced": 0,
                    "findings_used": 0,
                    "findings_accepted": 0,
                    "findings_dismissed": 0,
                    "missed_context_count": 0,
                }
            },
            "complexity_calibration": {"weights": {}, "history": []},
            "global_patterns": {},
            "project_fingerprints": {},
        }
        reg_path = os.path.join(tmp_dir["global"], "agent-registry.json")
        with open(reg_path, "w") as f:
            json.dump(registry, f)

        # Write events
        events_path = os.path.join(tmp_dir["global"], "registry-events.jsonl")
        events = [
            {"ts": "2026-04-05T14:00:00Z", "agent": "security-reviewer", "event": "dispatched", "data": {}},
            {"ts": "2026-04-05T14:01:00Z", "agent": "security-reviewer", "event": "finding_produced", "data": {}},
            {"ts": "2026-04-05T14:02:00Z", "agent": "security-reviewer", "event": "finding_accepted", "data": {}},
        ]
        with open(events_path, "w") as f:
            for e in events:
                f.write(json.dumps(e) + "\n")

        result = compact_events(reg_path, events_path)
        assert result["agents"]["security-reviewer"]["dispatches"] == 1
        assert result["agents"]["security-reviewer"]["findings_produced"] == 1
        assert result["agents"]["security-reviewer"]["findings_accepted"] == 1
        assert result["agents"]["security-reviewer"]["prior"]["alpha"] == 2  # one success

    def test_truncates_events_file(self, tmp_dir):
        reg_path = os.path.join(tmp_dir["global"], "agent-registry.json")
        events_path = os.path.join(tmp_dir["global"], "registry-events.jsonl")
        with open(reg_path, "w") as f:
            json.dump({"schema_version": 2, "agents": {}}, f)
        with open(events_path, "w") as f:
            f.write('{"ts":"...","agent":"x","event":"dispatched","data":{}}\n')

        compact_events(reg_path, events_path)
        assert os.path.getsize(events_path) == 0

    def test_creates_new_agent_entry_from_events(self, tmp_dir):
        reg_path = os.path.join(tmp_dir["global"], "agent-registry.json")
        events_path = os.path.join(tmp_dir["global"], "registry-events.jsonl")
        with open(reg_path, "w") as f:
            json.dump({"schema_version": 2, "agents": {}}, f)
        with open(events_path, "w") as f:
            f.write('{"ts":"2026-04-05","agent":"new-agent","event":"dispatched","data":{}}\n')

        result = compact_events(reg_path, events_path)
        assert "new-agent" in result["agents"]
        assert result["agents"]["new-agent"]["dispatches"] == 1


class TestRegistry:
    def test_init_creates_files(self, tmp_dir):
        reg = Registry(global_dir=tmp_dir["global"], project_dir=tmp_dir["project"])
        reg.init()
        assert os.path.exists(os.path.join(tmp_dir["global"], "agent-registry.json"))
        assert os.path.exists(os.path.join(tmp_dir["project"], "agent-registry.json"))

    def test_record_event_appends(self, tmp_dir):
        reg = Registry(global_dir=tmp_dir["global"])
        reg.init()
        reg.record_event("security-reviewer", "finding_accepted", {"finding_id": "1"})
        events_path = os.path.join(tmp_dir["global"], "registry-events.jsonl")
        with open(events_path) as f:
            lines = f.readlines()
        assert len(lines) == 1
        event = json.loads(lines[0])
        assert event["agent"] == "security-reviewer"
        assert event["event"] == "finding_accepted"

    def test_get_effectiveness_blends(self, tmp_dir):
        reg = Registry(global_dir=tmp_dir["global"], project_dir=tmp_dir["project"])
        reg.init()
        # Set global data
        reg._global["agents"]["test-agent"] = {
            "prior": {"alpha": 10, "beta": 2},
            "dispatches": 30,
        }
        # No project data — should use global
        eff = reg.get_effectiveness("test-agent")
        assert abs(eff - (10 / 12)) < 0.001
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/skills/code-creation-workflow/scripts && python -m pytest test_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'registry'`

**Step 3: Implement registry.py**

Write `~/.claude/skills/code-creation-workflow/scripts/registry.py` implementing all functions and the `Registry` class to make tests pass. Key implementation details:

- `bayesian_update(prior, success)` — increment alpha or beta, return new dict
- `compute_effectiveness(prior)` — alpha / (alpha + beta)
- `blend_priors(project_agent, global_agent)` — weight by project dispatches (0.7/0.3 below 5, pure project at 15+, linear interpolation between)
- `fingerprint_similarity(a, b)` — flatten tags from both fingerprints, Jaccard similarity (intersection / union). Boolean fields become tags like `migrations=true`
- `apply_decay(agent, factor)` — multiply alpha/beta by factor, floor at 1.0
- `dispatch_decision(effectiveness, confidence)` — threshold logic from design doc
- `compact_events(registry_path, events_path)` — read registry + events, apply each event to the registry (increment counters, update priors), write updated registry, truncate events file. Create new agent entries for unknown agents.
- `Registry` class — manages global + project overlay. `init()` creates files if missing. `record_event()` appends to JSONL. `get_effectiveness(agent)` blends project + global. `compact()` runs compaction. `should_dispatch(agent)` returns dispatch decision.

**Step 4: Run tests to verify they pass**

Run: `cd ~/.claude/skills/code-creation-workflow/scripts && python -m pytest test_registry.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/scripts/registry.py
git add ~/.claude/skills/code-creation-workflow/scripts/test_registry.py
git commit -m "feat(swarm): add registry helper scripts with Bayesian updates"
```

---

## Task 3: Complexity Classifier (SKILL.md Phase 1 Update)

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/SKILL.md` (Phase 1 Discovery section)
- Create: `~/.claude/skills/code-creation-workflow/references/complexity-classifier.md`

**Step 1: Write the complexity classifier reference file**

Create `references/complexity-classifier.md` with the full classifier protocol:
- Static scoring table (4 axes, 3 levels each)
- Scoring examples for common task types
- Degradation probe protocol
- Registry feedback loop (how outcomes calibrate weights)
- User override mechanism

Content directly from design doc Section 1.

**Step 2: Update SKILL.md Phase 1**

In the Phase 1 Discovery section, after the existing fast-path decision tree, add:

```markdown
### Complexity Classification (after fast-path check)

For tasks that aren't fast-path or plan-path, classify complexity to determine the swarm tier.

See `references/complexity-classifier.md` for the full protocol.

**Quick reference:**

| Tier | Score | Agent behavior |
|------|-------|---------------|
| moderate | 4-6 | Registry-informed dispatch, agents independent |
| complex | 7+ | Shared scratchpad, adversarial debate, staged review |

**Step 1: Static scoring** — Score the task on 4 cognitive axes (reasoning depth, ambiguity, context dependency, novelty). Each axis 1-3. Sum determines tier.

**Step 2: Degradation probe** — At Phase 2 boundary, dispatch single fast explorer with minimal context. If it produces good results, downgrade tier. If poor, confirm.

**User override:** User can force any tier by saying "use moderate/complex tier."

Record tier assignment to registry for calibration.
```

**Step 3: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/complexity-classifier.md
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): add complexity classifier to Phase 1"
```

---

## Task 4: Scratchpad Protocol Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/scratchpad-protocol.md`

**Step 1: Write the scratchpad protocol**

Content:
- Scratchpad file location and schema (from registry-schemas.md)
- Staggered dispatch protocol: Explorer A writes → Explorer B reads + writes → optional C
- Prompt templates for Explorer B/C showing how to reference scratchpad contents
- Lifecycle: created at Phase 2 start, carried to Phase 4, archived at session end
- How scratchpad data flows into architect prompts (gap chain, disagreements)
- Example scratchpad content showing a 2-explorer interaction

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/scratchpad-protocol.md
git commit -m "feat(swarm): add exploration scratchpad protocol"
```

---

## Task 5: Phase 2 SKILL.md Update (Tiered Exploration)

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/SKILL.md` (Phase 2 section)

**Step 1: Update Phase 2 with tiered behavior**

Replace the current "Launch Explorers" section with the tiered protocol:

**Moderate tier subsection:**
- Registry-informed prompt variant selection
- Query registry before dispatching
- Parallel dispatch (as today, but registry-selected variants)
- Post-exploration: record files found/hydrated per explorer

**Complex tier subsection:**
- Staggered dispatch with scratchpad (reference `scratchpad-protocol.md`)
- Explorer A dispatches immediately
- Explorer B dispatches with scratchpad in prompt
- Optional Explorer C for remaining gaps

**Both tiers:**
- Context hydration (existing, unchanged)
- Missed-context audit after each explorer (reference `missed-context-audit.md`)
- Memory injection (existing, unchanged)
- Persist all exploration data to exploration-log

**Step 2: Verify SKILL.md is well-formed**

Run: `wc -l ~/.claude/skills/code-creation-workflow/SKILL.md`
Expected: Line count increased. Visually verify section structure is coherent.

**Step 3: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): add tiered exploration to Phase 2"
```

---

## Task 6: Smart-Exploration Registry Integration

**Files:**
- Modify: `~/.claude/skills/smart-exploration/SKILL.md`
- Modify: `~/.claude/skills/smart-exploration/prompt-library.md`

**Step 1: Update smart-exploration SKILL.md**

Add a section after "How Phase 2 Uses This Skill":

```markdown
### Registry-Informed Variant Selection

When the swarm registry exists (`~/.claude/swarm/agent-registry.json`), Phase 2 queries it
before selecting prompt variants:

1. For each available prompt variant in the matching category, check `findings_used_rate`
2. Rank variants by effectiveness score (Bayesian prior)
3. Dispatch top 2 variants instead of the default pair
4. If no registry data exists, fall back to default variant selection (as today)

The registry is read-only during exploration. Updates happen post-exploration via
`registry-events.jsonl`.
```

**Step 2: Add registry metadata to prompt-library.md**

Add a `variant_id` tag to each explorer prompt so the registry can track them:

```markdown
**Explorer A — Route/service/model chain:** `variant_id: endpoint:route-chain`
```

Do this for all prompt variants across all categories.

**Step 3: Commit**

```bash
git add ~/.claude/skills/smart-exploration/SKILL.md
git add ~/.claude/skills/smart-exploration/prompt-library.md
git commit -m "feat(swarm): integrate registry into smart-exploration"
```

---

## Task 7: Phase 4 SKILL.md Update (Tiered Architecture)

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/SKILL.md` (Phase 4 section)

**Step 1: Update Phase 4 with tiered behavior**

**Moderate tier:**
- Registry-weighted optimization targets
- All architects receive full scratchpad + gap chain + explorer disagreements
- Synthesis weighted toward historically preferred style
- Contrarian sharpened by registry

**Complex tier:**
- Round 1: 3 architects with scratchpad (as moderate)
- Gap detection: scan proposals for references outside scratchpad, dispatch gap-fill explorer if needed
- Round 2: 3 critics with rebuttals + gap-fill findings
- Round 3: synthesis judge with all proposals + rebuttals + gap-fill

**Both tiers:**
- Persist all proposals, critiques, synthesis reasoning
- Registry updates (ideas adopted/rejected per architect)
- Missed-context audit for architects
- Feedback to Phase 2 (gap detections as exploration misses)

Include prompt templates for:
- Gap detection scan instruction
- Gap-fill explorer dispatch
- Critic rebuttal prompt
- Synthesis judge prompt

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): add tiered architecture with adversarial debate to Phase 4"
```

---

## Task 8: Build-State Protocol Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/build-state-protocol.md`

**Step 1: Write the build-state protocol**

Content:
- Build-state file location and schema (from registry-schemas.md)
- Per-step write protocol (what each agent writes after completing)
- Failed-approach propagation (pheromone trails)
- Parallel dispatch merge protocol (conflict detection)
- Full context chain: plan step + architecture + scratchpad + build-state + failed approaches + gap-fill + registry priors + missed-context flags
- Example build-state showing 3 completed steps with a failed approach

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/build-state-protocol.md
git commit -m "feat(swarm): add build-state protocol for implementation agents"
```

---

## Task 9: Agent Signal Protocol Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/agent-signals.md`

**Step 1: Write the agent signal protocol**

Content:
- Four signal types: `completed`, `completed_with_deviation`, `completed_with_discovery`, `blocked`
- Schema for each signal type (deviation includes impact on downstream steps, discovery includes recommendation)
- How the orchestrator processes each signal
- Architecture deviation detection protocol (comparison logic, >50% threshold, critical assumption immediate pause)
- Collaborative rescue protocol (registry query, alternate agent dispatch, fallback to retry loop)
- Example of a `completed_with_discovery` signal triggering plan adaptation

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/agent-signals.md
git commit -m "feat(swarm): add agent signal and rescue protocols"
```

---

## Task 10: Phase 5 SKILL.md Update (Tiered Implementation)

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/SKILL.md` (Phase 5 section)

**Step 1: Update Phase 5 with tiered behavior**

**Moderate tier:**
- Registry-informed thinking budgets per step domain
- Registry-informed specialist skip/dispatch
- TDD per step (unchanged)
- Record per-step metrics

**Complex tier:**
- Build-state awareness (reference `build-state-protocol.md`)
- Full context chain per agent (8 items from design)
- Agent-initiated signals (reference `agent-signals.md`)
- Architecture deviation detection every 3 steps
- Collaborative rescue on failure
- Failed-approach propagation
- Parallel dispatch with build-state snapshot + conflict detection

**Both tiers:**
- Persist build-state, step metrics, failed approaches, deviations, discoveries, rescue outcomes
- Registry event recording per step

Update the existing retry loop section to incorporate:
- Registry check before diagnosis subagent
- Collaborative rescue path
- Build-state context in diagnosis prompts

Update the "Parallel Subagent Dispatch" section with build-state merge protocol.

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): add tiered implementation with build-state and agent signals to Phase 5"
```

---

## Task 11: Phase 6 SKILL.md Update (Tiered Review)

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/SKILL.md` (Phase 6 section)

**Step 1: Update Phase 6 with tiered behavior**

**Moderate tier:**
- Registry-selective dispatch (HIGH/MODERATE/LOW/UNKNOWN classification)
- Priority ordering by registry value tier
- Record findings per reviewer

**Complex tier:**
- Wave 1: highest-value reviewers, write to review-findings.json
- Wave 2: receive Wave 1 findings, cross-reference instructions in prompts
- Wave 3: meta-reviewer with pattern escalation, dedup, priority synthesis, gap detection, contradiction resolution
- Prompt templates for Wave 2 cross-reference and Wave 3 meta-review

**Both tiers:**
- Missed-context audit for reviewers (could implementation have caught this?)
- Review → exploration feedback (what review found that exploration missed)
- Registry updates per reviewer
- Persist all findings, meta-reviewer results, feedback entries

Update the existing "4-Tier Parallel Review" section. The existing tiers (Core, Conditional, Domain, Design) become the pool from which the registry selects. Add the wave protocol on top.

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): add tiered review with staged findings and meta-reviewer to Phase 6"
```

---

## Task 12: Missed-Context Audit Protocol Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/missed-context-audit.md`

**Step 1: Write the missed-context audit protocol**

Content:
- When to run (after each agent completes, any phase)
- Audit steps: extract claims/searches → cross-reference against available context → classify miss type
- Miss types: `available_in_prompt`, `available_in_project`, `available_in_memory`, `not_available`
- Sources to check: CLAUDE.md, MEMORY.md, docs/, README, agent's own prompt, build-state, scratchpad
- Log schema (from registry-schemas.md)
- Severity classification (high: caused rework, medium: delayed progress, low: minor inefficiency)
- How misses feed back into each phase:
  - `available_in_prompt` → prompt quality issue → session-learnings proposes revision
  - `available_in_project` → Phase 0 gap → CLAUDE.md update suggestion
  - `available_in_memory` → memory-injection gap → memory-injection mapping update

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/missed-context-audit.md
git commit -m "feat(swarm): add missed-context audit protocol"
```

---

## Task 13: Periodic Review Protocol Reference File

**Files:**
- Create: `~/.claude/skills/code-creation-workflow/references/periodic-review.md`

**Step 1: Write the periodic review protocol**

Content:
- When to trigger (user request, scheduled task, or after N sessions)
- Input files: exploration logs, missed-context logs, registry, build-state archives, review findings
- 5 analysis dimensions (from design doc Section 6):
  1. Agent effectiveness
  2. Missed-context trends
  3. Complexity calibration
  4. Cross-phase feedback health
  5. Swarm effectiveness (complex tier)
- Output → action mapping (from design doc):
  - Data-driven adjustments: automatic
  - Prompt/skill changes: human approval
- Retention policy enforcement (prune per schedule)
- Report format template

**Step 2: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/periodic-review.md
git commit -m "feat(swarm): add periodic review protocol"
```

---

## Task 14: Update Error Recovery and Common Mistakes

**Files:**
- Modify: `~/.claude/skills/code-creation-workflow/references/error-recovery.md`
- Modify: `~/.claude/skills/code-creation-workflow/references/common-mistakes.md`
- Modify: `~/.claude/skills/code-creation-workflow/references/red-flags.md`

**Step 1: Add swarm-specific entries to error-recovery.md**

Add rows:

| Situation | Resolution | Action |
|-----------|------------|--------|
| Scratchpad not created before Explorer B | RETRY | Create scratchpad, re-dispatch Explorer B |
| Gap-fill explorer returns nothing | DEGRADE | Synthesis judge told area is unverified |
| Registry has no data for agent type | DEGRADE | Dispatch with default budget, building priors |
| Build-state conflict from parallel agents | PAUSE | Resolve conflict before dispatching next step |
| Meta-reviewer finds systematic pattern | RETRY | Fix systemically, not point-by-point |
| Collaborative rescue fails | PAUSE | Surface to user with full failure context |
| Complexity tier seems wrong mid-session | RETRY | User can override tier at any point |
| Missed-context audit finds `available_in_prompt` miss | RETRY | Log for prompt improvement, continue |

**Step 2: Add swarm-specific entries to common-mistakes.md**

| Mistake | Fix |
|---------|-----|
| Dispatching Explorer B before A writes scratchpad | Stagger — A must complete before B dispatches |
| Skipping gap detection between architecture rounds | Always scan proposals for unverified references |
| Not recording events to registry | Every dispatch, finding, and outcome must be an event |
| Ignoring agent-initiated signals | Process deviation/discovery/blocked signals before next step |
| Running full swarm on moderate-tier tasks | Respect the classifier — moderate tasks don't need debate rounds |
| Skipping missed-context audit | Audit runs after every agent, every phase — no exceptions |

**Step 3: Add swarm-specific entries to red-flags.md**

| Thought | Reality |
|---------|---------|
| "Registry doesn't have enough data yet, skip it" | That's exactly when you need to collect data. Dispatch with defaults. |
| "The scratchpad is overkill for this exploration" | If classifier said complex, trust it. Use the scratchpad. |
| "I'll merge the review findings manually" | Use the wave protocol. Meta-reviewer catches patterns you won't. |

**Step 4: Commit**

```bash
git add ~/.claude/skills/code-creation-workflow/references/error-recovery.md
git add ~/.claude/skills/code-creation-workflow/references/common-mistakes.md
git add ~/.claude/skills/code-creation-workflow/references/red-flags.md
git commit -m "feat(swarm): update error recovery, mistakes, and red flags for swarm patterns"
```

---

## Task 15: Integration Validation

**Files:**
- All modified files from Tasks 1-14

**Step 1: Structural validation**

Verify all cross-references resolve:
- SKILL.md references to `references/*.md` files all exist
- Schema references in protocols match `registry-schemas.md`
- Prompt templates in SKILL.md reference correct protocols
- `smart-exploration/prompt-library.md` variant IDs are consistent with registry event types

Run: `grep -r 'references/' ~/.claude/skills/code-creation-workflow/SKILL.md | grep -v '^#'`
Verify: each referenced file exists.

**Step 2: Schema consistency check**

Verify the schemas in `registry-schemas.md` match what `registry.py` produces:
- Init a test registry, dump to JSON, compare structure against schema
- Create test events, compact, verify output matches schema

Run: `cd ~/.claude/skills/code-creation-workflow/scripts && python -c "from registry import Registry; import tempfile, os; d=tempfile.mkdtemp(); r=Registry(global_dir=d); r.init(); print('OK')"`
Expected: OK

**Step 3: Full test suite**

Run: `cd ~/.claude/skills/code-creation-workflow/scripts && python -m pytest test_registry.py -v`
Expected: All PASS

**Step 4: Read-through validation**

Read SKILL.md end-to-end and verify:
- Phase flow is coherent (each phase references correct tier behavior)
- Moderate and complex tiers are clearly distinguished in each phase
- All persistence points are documented (what gets written, where, when)
- Registry event recording is specified at every dispatch point
- Missed-context audit is called after every agent completion

**Step 5: Commit any fixes from validation**

```bash
git add -A
git commit -m "fix(swarm): address integration validation findings"
```

**Step 6: Final commit — update Quick Reference table**

Update the "Quick Reference: All Phases" table at the end of SKILL.md to include tier behavior and new agents (meta-reviewer, gap-fill explorer, rescue agents).

Update the "Agents Used Within This Workflow" table with new agent entries.

Update the "Skills Invoked Within This Workflow" table if any new skill references were added.

```bash
git add ~/.claude/skills/code-creation-workflow/SKILL.md
git commit -m "feat(swarm): update quick reference tables for swarm workflow"
```
