# Routing decision scenarios

Validation table for the adaptive-orchestrator routing rules.
Each row is a scenario; expected routing is in the last column.

## Format

| Scenario | Task type | Context | Expected |
|---|---|---|---|

## Scenarios

| # | Scenario | Task type | Context | Expected model |
|---|---|---|---|---|
| 1 | "Add a border-radius to this button component" | Bounded CSS edit | 1 file, clear spec | `sonnet-worker-lite` (or inline) |
| 2 | "Why is this failing? I don't know where to start." | Ambiguous diagnosis | Error + large codebase, no clear entry point | Opus |
| 3 | "Implement the plan you just outlined" | Follow-a-plan implementation | Plan already concrete in session | `sonnet-worker` |
| 4 | "Design the architecture for a multi-tenant auth system" | Architecture design | Ambiguous requirements, multiple trade-offs | Opus |
| 5 | "Rename this function across the file" | Mechanical rename | 1 file, clear scope | `sonnet-worker-lite` (or inline) |
| 6 | "We need to migrate this service to a new API — figure out what needs to change" | Cross-file planning | Large codebase, unknown scope | `haiku-reader` to map, then Opus to plan |
| 7 | "Write the copy for this error state" | Writing, bounded | Clear spec and context | `sonnet-worker-lite` |
| 8 | "Read this config file and tell me what's set" | File read + summary | Read-only, no reasoning required | `haiku-reader` |
| 9 | "Fix the bug I described, then review it for edge cases" | Implement + auto-review | User asking for auto-review | `sonnet-worker`, no auto-reviewer — clarify or decline the review step |
| 10 | "Build this feature" (vague, no spec) | Ambiguous implementation | No clear scope | Clarify scope; if forced: Opus to plan, then `sonnet-worker` |
| 11 | "Where is `parseConfig` defined and what calls it?" | Locate + callers | Read-only | `haiku-reader` |
| 12 | "Refactor the payment flow to use the new gateway" (judgement-heavy, bounded) | Bounded refactor with design calls | Files known, real decisions | `sonnet-worker` (high, not lite) |
| 13 | Task-cap warning fires mid-session | Budget soft-gate | Daily spend crossed 45 EUR | Checkpoint current work, surface state, HOLD — no new delegations |
| 14 | `/no-subagents` is active | Override | Marker present | Do all work inline; no readers or workers spawned |
| 15 | Delegated task completes | Checkpoint | Store = beads or markdown per marker | Record one checkpoint (bd close / CHECKPOINT.md row); do not switch stores |

## Anti-patterns to verify are NOT triggered

| Anti-pattern | Trigger test | Should NOT happen |
|---|---|---|
| Opus for routine edits | "Change this variable name" | Opus does the edit itself instead of `sonnet-worker-lite` |
| Opus reads to locate | "Where is X used?" | Opus greps inline instead of `haiku-reader` |
| Auto-reviewer | Any completed Sonnet task | Reviewer agent spawned unprompted |
| Full parent history in worker | Routine delegation | Worker forked with parent conversation (`/subtask`) |
| Multi-stage pipeline on small task | "Add a field to this form" | Explorer + worker + tester + reviewer pipeline |
| Reading worker transcript | After a worker reports done | Orchestrator re-reads the worker's full transcript instead of its report |
| Switching checkpoint stores | Mid-project | Orchestrator uses a store other than `.claude/orchestrator-checkpoints` |

## Notes for manual review

These scenarios cannot be automatically tested without running Claude Code with instrumentation. The budget soft-gate logic is unit-tested in `test_task_budget.js`. Validate the rest by reading a session transcript after invoking `/adaptive-orchestrator` and observing:

1. Reads routed to `haiku-reader`; bounded implementation to the correct Sonnet variant by risk/judgement.
2. Workers receive self-contained briefs with a binary pass gate, not forked parent context.
3. No reviewer spawned without being asked; orchestrator consumes only worker reports.
4. A checkpoint recorded per delegated task in the chosen store.
5. On the task-cap warning, the orchestrator checkpoints and holds rather than pressing on.
6. `/no-subagents` makes the session work inline.
