# Adaptive orchestration

Route work by actual complexity. Default to Sonnet. Use Opus only when the task genuinely requires hard planning, cross-file architecture, or diagnosis without a clear starting point.

## Model routing

**Opus** — hard planning, ambiguous diagnosis, synthesizing large context into a concrete plan, architecture decisions with real consequences.

**Sonnet** — bounded implementation, writing, editing, follow-a-plan tasks, anything with concrete and unambiguous acceptance criteria.

**Haiku** — file reading, locating symbols, quick isolated edits, context gathering.

## Delegation

For non-trivial implementation that benefits from a fresh context, spawn one bounded Sonnet worker. Start it with `fork_turns="none"` equivalent: a complete self-contained prompt, not the parent conversation.

Every delegation prompt states: concrete outcome, exact scope, constraints, acceptance criteria, and any commands or paths the worker needs. Write it as a brief to a capable teammate who cannot see this conversation.

Do not impose a fixed pipeline. Do not auto-spawn a reviewer. Review worker output only when the user reports a bug and asks for diagnosis.

If a subagent disconnects before completion, send one `continue` follow-up. Do not loop.

## What not to do

Do not use Opus for work Sonnet can handle. Do not create an automatic review stage. Do not share full parent history with a worker unless explicitly asked.

## Context hygiene

Disable MCP plugins not actively needed. Watch the context meter — past ~50% full, wrap the task or hand off to a fresh worker. Keep CLAUDE.md and AGENTS.md instructions concise; they load on every turn.

User instructions always take precedence.
