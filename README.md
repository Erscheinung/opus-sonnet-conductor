# Opus/Sonnet Adaptive Orchestrator

A Claude Code companion to the [Codex Astra/Luna orchestrator](https://github.com/Erscheinung/codex-astra-luna-orchestrator). Implements adaptive routing: Opus for hard planning and reasoning, Sonnet for bounded implementation and daily work.

## What this is

Claude Code does not have a built-in model-routing layer. Without guidance, sessions default to whatever model is configured globally — often Opus for everything, including tasks where Sonnet is faster, cheaper, and just as good.

This repository provides:

- A reusable **skill** (`adaptive-orchestrator`) that encodes routing decision rules
- An **AGENTS.md** that installs those rules as default context for any repository
- A **setup script** that wires both into the target project without clobbering existing configuration

## When to use each model

| Task type | Use |
|---|---|
| Hard planning: cross-file architecture, diagnosis, turning an ambiguous brief into a concrete plan | Opus |
| Daily implementation: bounded feature work, writing, editing, follow-a-plan tasks | Sonnet |
| Lightweight reading: file lookups, quick edits, context gathering, validation | Haiku (or Sonnet) |

**Default rule:** start with Sonnet. Escalate to Opus only when the task genuinely requires heavy reasoning. Prefer one fresh bounded Sonnet worker over a multi-stage pipeline.

## What this does NOT do

- Does not impose a fixed explorer → worker → tester → reviewer pipeline on routine tasks
- Does not encourage Opus for work that Sonnet handles cleanly
- Does not auto-spawn reviewers; reviews happen when the user asks for them
- Does not require any Claude Code features beyond what ships with the current release

## Supported model names

These match the environment variable names used by the configured provider Claude Code gateway, and map to the underlying Anthropic models shown:

| Alias | Underlying model |
|---|---|
| `claude-opus-4-8` | Opus 4.8 (heavy reasoning) |
| `claude-sonnet-4-6` | Sonnet 4.6 (daily driver) |
| `claude-haiku-4-5` | Haiku 4.5 (fast/cheap) |

If you are running standard Anthropic API (not a gateway), replace these with current model IDs from the [Anthropic model docs](https://docs.anthropic.com/en/docs/about-claude/models).

## Layout

```
.
├── skills/adaptive-orchestrator/
│   └── SKILL.md               # routing decision rules
├── AGENTS.md                  # repo-level instructions
├── setup.sh                   # installer
├── tests/
│   └── routing_decisions.md   # routing scenario validation table
├── README.md
└── LICENSE
```

## Installation

### Project-level (recommended)

```bash
./setup.sh
```

The script asks for the target project directory and copies `AGENTS.md` content and the skill into that project. It will not overwrite an existing `AGENTS.md` without confirmation.

### Global (applies to every session)

```bash
mkdir -p ~/.claude/skills/adaptive-orchestrator
cp skills/adaptive-orchestrator/SKILL.md ~/.claude/skills/adaptive-orchestrator/SKILL.md
```

Then merge the relevant sections of `AGENTS.md` into `~/.claude/CLAUDE.md`.

## Usage

Once installed, invoke the skill in any session:

```
/adaptive-orchestrator
```

Or add the routing rules to your project's `CLAUDE.md` / `AGENTS.md` so they apply automatically without invoking the skill each time.

## Token / cost intent

The routing rules exist to reduce cost and improve output quality simultaneously, not as a trade-off. Sonnet costs less than Opus and finishes bounded implementation tasks faster. Reserving Opus for tasks that actually need it keeps the hard-thinking budget available when it matters.

Context bloat multiplies cost. Bounded workers started with a fresh context (no full parent history) are cheaper and often produce cleaner output than a long conversation that carries accumulated context.

## Limitations

- Claude Code does not support per-agent model configuration in `settings.json` today. Model selection for subagents spawned via the `Agent` tool is set per call in the `model` parameter, not globally.
- The `--model` flag and `ANTHROPIC_MODEL` env var set the root session model only. There is no Claude Code equivalent of Codex's `default_subagent_model` config key.
- These rules are advisory: they guide the primary agent's delegation decisions, not the underlying runtime. The primary agent follows them because they are in its instructions.

## Related

- [Codex Astra/Luna orchestrator](https://github.com/Erscheinung/codex-astra-luna-orchestrator) — same routing principles for Codex + GPT-5.6 Sol/Luna
