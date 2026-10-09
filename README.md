# Opus/Sonnet Adaptive Orchestrator

A Claude Code companion to the [Codex Astra/Luna orchestrator](https://github.com/Erscheinung/codex-astra-luna-orchestrator). Same cost discipline — cheap models for cheap work, expensive reasoning only where it earns its keep — built on Claude Code's actual primitives.

## What this is

Without guidance, a Claude Code session runs everything on whatever model is configured globally — often Opus for reading files, mechanical edits, and bounded implementation that Sonnet or Haiku would do faster and cheaper. This repo makes the primary Opus session a deliberate router.

- **Haiku** reads and locates (via the `haiku-reader` subagent).
- **Sonnet** does bounded implementation in isolated fresh context (`sonnet-worker` at high effort, `sonnet-worker-lite` at medium).
- **Opus** plans, scopes, delegates, and synthesizes — and never re-reads a worker's full transcript.
- **Incremental checkpoints** (beads or markdown) let any session stop and resume cheaply.
- **A bundled cost hook** injects live provider spend and a daily task-budget soft-gate.
- **`/no-subagents`** turns delegation off when you want everything inline.

## The three tiers

| Task | Agent | Model / effort |
|---|---|---|
| Read, locate, map, summarize | `haiku-reader` | Haiku / low |
| Low-risk bounded edit | `sonnet-worker-lite` | Sonnet / medium |
| Real bounded implementation | `sonnet-worker` | Sonnet / high |
| Plan, diagnose, architect, synthesize | primary session | Opus |

Model and effort are pinned in each subagent's `.claude/agents/*.md` frontmatter (`model:`, `effort:`, `tools:`). Resolution order is `CLAUDE_CODE_SUBAGENT_MODEL` env > Agent-call `model` > agent frontmatter > parent model. A spawn that names no tier (general-purpose, fork) inherits the parent, which is how Opus sessions end up with all-Opus subagents. Because effort is fixed per definition, the **worker variant is the effort lever**, and the fine control is the delegation brief.

## The information diet (why it stays cheap)

The lesson from the Codex Sol/Luna setup is not about resumability — it is an information diet. The worker never reads the orchestrator's full context (only its scoped brief, so it does not overthink). The orchestrator never reads the worker's full transcript (only its report: what changed, files, validation, open risks). Claude Code isolates subagent context by default, so this repo's rules reinforce that default rather than fighting it: minimal briefs out, minimal reports in, no forking parent context into routine workers, no auto-review.

## Delegation briefs and the binary pass gate

Every delegation is written as a brief to a capable teammate who cannot see the conversation: outcome, owned files, guardrails, the context they need, and **testable acceptance criteria with a binary pass gate**. The worker self-checks against those criteria and reports "done" only when every one passes, else reports the blocker. Removing ambiguity at the brief level is what lets a fixed-effort Sonnet deliver without overthinking or underdelivering.

## Checkpoints

Choose at setup: **beads** (`bd`, a lightweight dependency-aware issue tracker — structured, git-friendly, resumable) or a **markdown** `CHECKPOINT.md` ledger (zero dependency). The choice is written to `.claude/orchestrator-checkpoints`; the orchestrator sticks to it. One checkpoint per delegated task means you can stop whenever the budget runs out and resume without re-reading anything.

## Why subagents were all Opus, and the fix

1. **Generic spawns inherit the parent.** With no `subagent_type`/`model` on the call, the subagent has no frontmatter and runs on Opus. The skill now requires both fields on every spawn.
2. **`route-guard` hook** (`plugin/hooks/route-guard.js`, PreToolUse on Agent/Task) rewrites any spawn to the cheapest fitting tier, blocks `opus`/`inherit` on our workers, honours `/no-subagents`, warns on `CLAUDE_CODE_SUBAGENT_MODEL` and on >8 spawns per session, and logs every decision.
3. **Pins match your gateway.** `setup.sh` now pins the newest `sonnet`/`haiku` key in `modelOverrides` (previously only `claude-sonnet-4-6`/`claude-haiku-4-5`, which never matched 5.x gateways). Without a gateway, plain `sonnet`/`haiku` aliases are used.
4. **Cost-aware delegation rules** (see the skill): skip delegation for tiny jobs, batch briefs, cap fan-out, cheapest-tier-first, short reports, keep the Opus context from growing.

## Cost awareness

The bundled `plugin/` (`orchestrator-budget`) provides `spending plugin` functionality with two additions:


- **Lag fix.** The original only refreshed spend when a hook fired and throttled to 60s, so the number went stale between prompts. A detached background refresher (`refresher.js`) rewrites the snapshot on an interval independent of your turns, so the status line and injected context track live spend. It self-locks (one per machine), self-expires, and stays within the shared keychain refresh cadence.
- **Task-budget soft-gate.** A daily task cap (default 45 EUR, in `~/.config/orchestrator-budget/orchestrator-budget.json`) injects a STOP-strength instruction when crossed: checkpoint, surface where things stand, and hold. It warns and lets Opus decide — it never mechanically kills the session.

Run this plugin **or** the standalone `spending plugin` plugin, not both (they share hooks and a snapshot).

## Layout

```
.
├── agents/
│   ├── haiku-reader.md          # read-only locator, Haiku/low
│   ├── sonnet-worker.md         # bounded implementation, Sonnet/high
│   └── sonnet-worker-lite.md    # low-risk edits, Sonnet/medium
├── skills/
│   ├── adaptive-orchestrator/   # routing, delegation, checkpoint, budget rules
│   └── no-subagents/            # /no-subagents toggle
├── plugin/                      # vendored cost hook + lag fix + task budget
│   ├── hooks/                   # route-guard, spending-core, alarms, refresher, task-budget, statusline, full-display
│   ├── commands/orchestrator-spending.md
│   └── .claude-plugin/          # plugin.json, marketplace.json
├── AGENTS.md                    # concise repo-level routing rules
├── setup.sh                     # installer
├── tests/
│   ├── routing_decisions.md     # routing scenario table
│   ├── test_route_guard.js      # tier-enforcement unit test
│   └── test_task_budget.js      # budget soft-gate unit test
└── README.md
```

## Installation

### Project-level (recommended)

```bash
./setup.sh
```

Prompts for the target project, then installs the skills, the `/no-subagents` toggle, and the three subagent definitions; asks which checkpoint store to use (beads if `bd` is detected, else markdown); optionally appends the routing rules to `AGENTS.md` and installs the cost plugin. It will not overwrite existing files without confirmation. Non-interactive: `./setup.sh --target <path> --checkpoints beads`.

### Global

```bash
./setup.sh --global
```

Installs the skills and agents into `~/.claude/`. Merge `AGENTS.md` routing rules into `~/.claude/CLAUDE.md` if you want them everywhere.

### Cost plugin

After setup copies it into `<project>/.claude/plugins/orchestrator-budget`:

```
/plugin marketplace add <project>/.claude/plugins/orchestrator-budget
/plugin install orchestrator-budget
```

## Mock play (GitHub Pages)

The installer GUI is also hosted as a static page at https://erscheinung.github.io/opus-sonnet-conductor/ . On `*.github.io` (or with `?mock`) it swaps the Python backend for an in-memory mock, so you can click through scopes, plugins, MCP toggles, CLAUDE.md view, context usage, and a simulated install. **Nothing is read or written** — a red MOCK PLAY ribbon says so. For the real thing run `launch-installer.command`.

```bash
npm install
npm run deploy     # builds dist/ and publishes it to the gh-pages branch
npm run preview    # local check at http://localhost:8080
```

## Usage

Invoke the skill in a session:

```
/adaptive-orchestrator
```

Or rely on the `AGENTS.md` / `CLAUDE.md` rules so routing applies automatically. Toggle delegation with `/no-subagents`. Check spend with `/orchestrator-spending`.

## Supported model aliases

| Alias | Underlying model |
|---|---|
| `claude-opus-4-8` | Opus 4.8 (heavy reasoning) |
| `claude-sonnet-4-6` | Sonnet 4.6 (daily driver) |
| `claude-haiku-4-5` | Haiku 4.5 (fast/cheap) |

The subagent frontmatter uses the generic `sonnet` / `haiku` aliases, which resolve to whatever the gateway maps them to. On the standard Anthropic API, substitute current model IDs from the [model docs](https://docs.anthropic.com/en/docs/about-claude/models).

## Limitations

- Effort is per subagent definition (model can be set per call). Effort is controlled by choosing the worker variant.
- If `CLAUDE_CODE_SUBAGENT_MODEL` is set anywhere, it overrides every agent — `setup.sh` warns, `route-guard` flags it.
- The budget gate is advisory (warn + soft-gate). Claude Code has no native "stop at X euros" that kills a session; the hook injects context and the orchestrator is instructed to checkpoint and hold.
- The cost hook is macOS-specific (reads the provider refresh token from the macOS keychain).
- `setup.ps1` (Windows) is not yet ported.

## Related

- [Codex Astra/Luna orchestrator](https://github.com/Erscheinung/codex-astra-luna-orchestrator)
