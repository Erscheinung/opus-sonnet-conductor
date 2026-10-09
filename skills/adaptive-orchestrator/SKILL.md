---
name: adaptive-orchestrator
description: >
  Route work adaptively across three model tiers — Haiku for reading, Sonnet for
  bounded implementation, Opus for hard planning and delegation — and record
  incremental checkpoints so a session can stop or resume within budget. Use when
  you want the primary session to make deliberate model choices and delegate real
  implementation to isolated workers instead of doing everything in one expensive
  Opus context. Installs routing, delegation, checkpoint, and budget rules.
---

# Adaptive orchestration for Claude Code

Route work by actual complexity, not habit. The primary Opus session owns scope, decisions, delegation, and synthesis — not routine reading or routine implementation. Push reads down to Haiku, push bounded implementation out to Sonnet workers in isolated context, and keep Opus's expensive context for the thinking that needs it.

## The three tiers

| Tier | Model | Use for |
|---|---|---|
| Read | `haiku-reader` (Haiku, low) | Locating symbols, mapping files, summarizing config, gathering context before planning |
| Implement | `sonnet-worker` (Sonnet, high) / `sonnet-worker-lite` (Sonnet, medium) | Bounded implementation with testable acceptance criteria |
| Plan | Opus (this session) | Hard planning, ambiguous diagnosis, architecture, turning a vague brief into a scoped plan, delegating, synthesizing worker reports |

Model and effort are pinned in each agent's definition (`agents/*.md`). The Agent call's `model` parameter can override the model per call, but effort is fixed per definition, so **the worker variant IS the effort lever**: pick `sonnet-worker-lite` (medium) for low-risk mechanical edits, `sonnet-worker` (high) for work with real implementation judgement. The fine control is the brief (see below).

## Spawning: always name the tier (this is what keeps subagents off Opus)

A subagent's model resolves as: `CLAUDE_CODE_SUBAGENT_MODEL` env > the Agent call's `model` > the agent file's `model:` > **the parent's model**. A spawn with no `subagent_type` (or `general-purpose` / `claude` / fork) has no frontmatter, so it runs on Opus and costs Opus rates. Every Agent call therefore sets both fields:

| Work | `subagent_type` | `model` |
|---|---|---|
| Read / locate / summarize | `haiku-reader` | `haiku` |
| Mechanical, low-risk edit | `sonnet-worker-lite` | `sonnet` |
| Bounded implementation | `sonnet-worker` | `sonnet` |

Never pass `model: opus` or `inherit` to a worker. A `route-guard` PreToolUse hook rewrites stray spawns to the right tier and logs them to `~/.config/orchestrator-budget/routing-log.jsonl`; do not rely on it — set the fields yourself.

## Cost-aware delegation (decide before you spawn)

Delegation is not free: every subagent starts cold (system prompt + tool schemas + brief, mostly uncached on the first call), and multi-agent runs use several times the tokens of a single thread. Delegate only when it wins:

1. **Delegate when** the work reads/produces a lot the parent would otherwise carry (many-file search, long implementation, test-fix loops), or independent pieces can run in parallel.
2. **Do it inline when** you already hold the context and the job is under ~3 tool calls or one small edit. A spawn costs more than the edit.
3. **Cheapest tier that passes the gate.** Try Haiku for anything read-only. Use `-lite` unless the change needs design judgement. Escalate one tier only after a worker reports a blocker — never start high "to be safe".
4. **Batch.** One worker with a 3-part brief beats three workers each re-paying cold start. Fan out in parallel only for truly independent scopes, max ~3 at a time.
5. **Cap the output.** Ask for a report under ~150 words and `file:line` findings; the report is what lands in the Opus context.
6. **Don't let the Opus context grow.** Cost compounds per turn with context size. Past ~50% full, checkpoint and continue in a fresh session/worker; run `/compact` between phases.
7. **Reasoning effort is spend.** Opus runs at medium effort unless the task is architecture or ambiguous diagnosis.
8. **Check the meter.** If the spend line is climbing faster than the work, stop spawning and inspect `routing-log.jsonl` for any `changed: true` rows — those are spawns you mis-specified.

## Routing rules

**Read with Haiku first.** Before planning anything that needs to know the codebase, delegate the read to `haiku-reader`: "where is X", "what calls Y", "map this directory", "what does this config set". Do not burn Opus context reading files to locate things. Read inline yourself only for a single known file you must reason over directly.

**Delegate implementation to Sonnet** when the task has a clear scope and testable acceptance criteria — implementing a scoped plan, a bounded feature, a refactor within a stated boundary. Fresh isolated context is cheaper and often cleaner than growing this conversation.

**Keep on Opus** the hard planning, ambiguous diagnosis (error + codebase + unknown cause), architecture with real trade-offs, and synthesis of what workers report back.

**Do it inline** (no delegation) when the work is trivial and delegation overhead would cost more than it saves — a one-line fix you already have the context for, or when `/no-subagents` is active (see override).

## Information diet (the core discipline)

This is what keeps the whole system cheap. Two directions:

- **Briefs going out stay minimal.** A worker cannot see this conversation and must not. Give it only its scoped brief — outcome, owned files, constraints, acceptance criteria. Never fork parent context (`/subtask`) for routine delegation; the worker starting from a full transcript overthinks and costs more. Inherited context is an exception only when the user explicitly asks for it.
- **Reports coming back stay minimal.** Read only the worker's report (what changed / files / validation / risks). Do not read the worker's transcript, do not re-derive or independently review its code. Accept the report and its validation evidence. Review worker code only after the user personally reports a bug and asks for diagnosis.

## Writing a delegation brief

Because Sonnet's effort is fixed per variant, remove ambiguity at the brief level — that is what lets a fixed-effort model deliver without overthinking or underdelivering. Write every brief as if briefing a capable teammate who cannot see this conversation. State, in plain complete sentences:

1. **Outcome** — what should be true when done, and why it matters.
2. **Scope and owned files** — exactly which files this worker may touch. Name them.
3. **Constraints and guardrails** — what not to change (arch, APIs, schemas, deps), patterns to follow, unrelated work to preserve.
4. **Context the worker needs** — concrete errors, commands, paths, definitions. No unexplained shorthand.
5. **Binary pass gate** — testable acceptance criteria and the focused validation to run. The worker reports done only when every criterion passes, else reports the blocker.
6. Ask for a terse report: what changed, files, validation result, open risks.

Give each worker a descriptive name so you can watch it live with `/agents`.

## Delegation limits

- One bounded worker owns one implementation scope end to end. For independent workstreams, give workers non-overlapping ownership.
- Do not impose a fixed explorer → worker → tester → reviewer pipeline on routine work. Add specialists only when real risk warrants them.
- Do not auto-spawn a reviewer.
- If a worker disconnects before reporting completion, send one `continue` follow-up. Do not loop.

## Checkpoints (incremental, automatic)

So you can stop whenever the budget runs out and resume cheaply, record a checkpoint after each delegated task completes. The store is chosen at setup and written to `.claude/orchestrator-checkpoints` (contains `beads` or `markdown`). Read that marker and use only that store — do not switch.

**If `beads`:** the `bd` issue tracker is the store. At delegation start, quick-capture the task: `bd q "<task summary>"` (returns an ID). On completion, close it with a note: `bd close <id> --reason "<what shipped, files>"`. Chain dependent tasks with `bd link`. To resume a session, `bd list --status open` and `bd show <id>` give you the state without re-reading any transcript.

**If `markdown`:** append one row per task to `CHECKPOINT.md` at the repo root — task, scope, files touched, status (done/blocked/in-progress), next step. To resume, read the tail of that file.

Keep checkpoints terse. They exist to make a fresh session resume cheaply, not to narrate.

## Budget awareness

A cost hook injects live provider spend into your context each turn (daily/monthly), and a task-budget layer warns when the day's spend crosses the task cap (default 45 EUR). This is warn + soft-gate: nothing kills the session mechanically.

When you see the task-cap warning:

1. Finish or safely stop the current worker.
2. Record a checkpoint for what is done and what is next.
3. Surface to the user: cap reached, work checkpointed, here is where it stands and how to resume. Then hold — do not start new delegations until the user says to continue.

Below the cap, just stay aware. Prefer `sonnet-worker-lite` and Haiku reads for cheap work; reserve `sonnet-worker` (high) and Opus thinking for what needs it.

## Output optimizer

Caveman ultra (the caveman plugin) compresses your visible output — dropped articles and filler, no wasted tokens — across all tiers. Keep it on. It compresses the style, never the technical substance: code, commands, API names, and error strings stay verbatim.

## Override: /no-subagents

When the user runs `/no-subagents`, it writes a marker (`.claude/orchestrator-no-subagents`). While that marker exists, do all work inline in this session — no `haiku-reader`, no Sonnet workers. Running `/no-subagents` again removes the marker and restores delegation. Check for the marker before delegating.

## Context hygiene

- Disable MCP plugins not needed for the current task; each loaded plugin costs context every message.
- Watch the context meter. Past ~50% full, checkpoint and hand the next scope to a fresh worker rather than growing this one.
- Keep CLAUDE.md / AGENTS.md concise; they load every turn.

## What not to do

- Do not use Opus to implement what a Sonnet worker can execute.
- Do not read files inline to locate things when `haiku-reader` can.
- Do not auto-review worker output or spawn a reviewer.
- Do not fork full parent context into a routine worker.
- Do not switch checkpoint stores mid-project.
- Do not keep a long-running task alive in one bloated context when a fresh bounded worker is cheaper.

User instructions always take precedence.
