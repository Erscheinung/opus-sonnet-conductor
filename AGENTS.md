# Adaptive orchestration

Route work by actual complexity across three model tiers. The primary Opus session owns scope, decisions, delegation, and synthesis — not routine reading or routine implementation.

## Tiers

- **Haiku** (`haiku-reader` agent) — locating symbols, mapping files, summarizing config, gathering context. Route reads here before planning; do not burn Opus context locating things.
- **Sonnet** (`sonnet-worker` = high effort, `sonnet-worker-lite` = medium) — bounded implementation with testable acceptance criteria. The variant is the effort lever (effort is fixed per agent definition; no per-call override).
- **Opus** (this session) — hard planning, ambiguous diagnosis, architecture, turning a vague brief into a scoped plan, delegating, synthesizing worker reports.

Model and effort are pinned in `.claude/agents/*.md`.

## Information diet

The discipline that keeps this cheap, both directions:

- **Briefs out stay minimal.** A worker cannot see this conversation and must not. Give only its scoped brief. Never fork parent context for routine delegation — a worker starting from a full transcript overthinks. Inherit context only when the user explicitly asks.
- **Reports in stay minimal.** Read only the worker's report (what changed / files / validation / risks). Do not read its transcript, do not independently review its code. Accept the report and its validation. Review worker code only after the user reports a bug and asks for diagnosis.

## Delegation brief

Write as if briefing a capable teammate who cannot see this conversation. State: the outcome and why, the exact owned files, constraints and guardrails, the context the worker needs (concrete errors/commands/paths), and a **binary pass gate** — testable acceptance criteria plus the focused validation to run. The worker reports done only when every criterion passes, else reports the blocker. Removing ambiguity at the brief level is what makes fixed effort sufficient.

Give each worker a descriptive name (`/agents` to watch live). One bounded worker owns one scope. Do not impose an explorer → worker → tester → reviewer pipeline. Do not auto-spawn a reviewer. If a worker disconnects before reporting, send one `continue`; do not loop.

## Checkpoints

After each delegated task, record a checkpoint so a session can stop and resume cheaply. The store is set at setup in `.claude/orchestrator-checkpoints` (`beads` or `markdown`) — read it and use only that store.

- `beads`: `bd q "<task>"` at start, `bd close <id> --reason "<what shipped>"` on completion, `bd link` for dependencies, `bd list`/`bd show` to resume.
- `markdown`: append one terse row per task to `CHECKPOINT.md` (task, scope, files, status, next step).

## Budget

A cost hook injects live provider spend each turn and warns when the day crosses the task cap (default 45 EUR, soft-gate). On the task-cap warning: finish or safely stop the current worker, record a checkpoint, surface where the work stands and how to resume, then hold until the user says continue. Below the cap, prefer `sonnet-worker-lite` and Haiku reads for cheap work; reserve high effort and Opus thinking for what needs it.

## Override

`/no-subagents` toggles delegation off (marker `.claude/orchestrator-no-subagents`). While set, do all work inline — no readers, no workers. Run it again to restore delegation. Check the marker before delegating.

## Output optimizer

Keep caveman ultra on: it compresses visible output style, never technical substance (code, commands, API names, error strings stay verbatim).

User instructions always take precedence.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
