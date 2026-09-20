---
name: adaptive-orchestrator
description: >
  Route work adaptively between Opus (hard planning/reasoning) and Sonnet
  (bounded implementation/daily work). Use when you want the primary session
  to make deliberate model choices instead of using Opus for everything.
  Installs routing rules for the current session.
---

# Adaptive orchestration for Claude Code

Route work by actual complexity, not habit. Default to Sonnet; escalate to Opus only when the task genuinely needs it.

## Decision rules

### Use Opus when the task requires:
- Cross-file architecture design from ambiguous requirements
- Diagnosing a bug with no clear starting point (error + codebase + unknown cause)
- Synthesizing a large body of context into a concrete plan
- Evaluating trade-offs with real design consequences
- Turning a vague brief into a scoped, executable implementation plan

### Use Sonnet when the task is:
- Implementing a plan that is already scoped and concrete
- Writing, editing, or refactoring within a bounded scope
- Following explicit instructions with clear acceptance criteria
- Any task where you could write a self-contained, unambiguous prompt to a capable human

### Use Haiku (or let Sonnet do it) when the task is:
- Reading files to locate something
- Quick, isolated edits (typo fix, rename, format change)
- Generating or checking a small piece of standalone output
- Gathering context before a planning step

## Delegation rules (when spawning subagents)

- Spawn one bounded Sonnet worker for a single implementation scope. Fresh context helps; do not share full parent history unless the user explicitly asks.
- Give the worker a self-contained prompt: concrete outcome, exact scope, constraints, acceptance criteria. Write it as a brief to a capable teammate who cannot see this conversation.
- Do not impose a fixed pipeline (explorer → worker → tester → reviewer) on routine work. Add specialists only when actual risk warrants them.
- Do not auto-spawn a reviewer. Accept the worker's test evidence. Review only when the user reports a bug and asks for diagnosis.
- If a subagent disconnects before reporting completion, send one `continue` follow-up. Do not loop.

## Model names (provider gateway)

| Role | Model |
|---|---|
| Hard planning | `claude-opus-4-8` |
| Daily implementation | `claude-sonnet-4-6` |
| Fast reads / small edits | `claude-haiku-4-5` |

If using the standard Anthropic API directly, substitute current model IDs from the Anthropic model documentation.

## What not to do

- Do not use Opus to implement a plan that Sonnet could execute.
- Do not create an automatic review stage after every Sonnet worker.
- Do not share full parent conversation history with a worker unless explicitly asked.
- Do not keep a long-running task alive in one bloated context when a fresh bounded worker would be faster and cheaper.

## Context hygiene

- Watch the context meter. Past ~50% full, start wrapping the task or hand off to a fresh worker.
- Disable MCP plugins you are not actively using for this task. Each loaded plugin occupies context on every message.
- Keep project instructions (CLAUDE.md, AGENTS.md) concise. They load on every turn.

## Recurring pattern

```
Hard problem or ambiguous brief  →  Opus: plan and scope
Concrete scoped task             →  Sonnet (fresh context): implement and validate
File lookup / small edit         →  Haiku or inline Sonnet
```

This is not a rigid pipeline. It is a default to override when the task warrants it.
