# Routing decision scenarios

Validation table for the adaptive-orchestrator routing rules.
Each row is a scenario; expected routing is in the last column.

## Format

| Scenario | Task type | Context | Expected |
|---|---|---|---|

## Scenarios

| # | Scenario | Task type | Context | Expected model |
|---|---|---|---|---|
| 1 | "Add a border-radius to this button component" | Bounded CSS edit | 1 file, clear spec | Sonnet or Haiku |
| 2 | "Why is this failing? I don't know where to start." | Ambiguous diagnosis | Error + large codebase, no clear entry point | Opus |
| 3 | "Implement the plan you just outlined" | Follow-a-plan implementation | Plan already concrete in session | Sonnet |
| 4 | "Design the architecture for a multi-tenant auth system" | Architecture design | Ambiguous requirements, multiple trade-offs | Opus |
| 5 | "Rename this function across the file" | Mechanical rename | 1 file, clear scope | Haiku or Sonnet |
| 6 | "We need to migrate this service to a new API — figure out what needs to change" | Cross-file planning | Large codebase, unknown scope | Opus (plan first) |
| 7 | "Write the copy for this error state" | Writing, bounded | Clear spec and context | Sonnet |
| 8 | "Read this config file and tell me what's set" | File read + summary | Read-only, no reasoning required | Haiku |
| 9 | "Fix the bug I described, then review it for edge cases" | Implement + auto-review | User asking for auto-review | Sonnet worker, no auto-reviewer — clarify or decline the review step |
| 10 | "Build this feature" (vague, no spec) | Ambiguous implementation | No clear scope | Clarify scope before routing; if forced: Opus to plan, then Sonnet |

## Anti-patterns to verify are NOT triggered

| Anti-pattern | Trigger test | Should NOT happen |
|---|---|---|
| Opus for routine edits | "Change this variable name" | Opus spawned |
| Auto-reviewer | Any completed Sonnet task | Reviewer agent spawned |
| Full parent history in worker | Routine delegation | Worker receives full conversation |
| Multi-stage pipeline on small task | "Add a field to this form" | Explorer + worker + tester + reviewer pipeline |

## Notes for manual review

These scenarios cannot be automatically tested without running Claude Code with instrumentation. Validate by reading a session transcript after invoking `/adaptive-orchestrator` and observing:

1. Which model the primary session selects for each delegation
2. Whether workers receive self-contained prompts
3. Whether a reviewer is spawned without being asked
