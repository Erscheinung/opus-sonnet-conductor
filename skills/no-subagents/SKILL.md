---
name: no-subagents
description: >
  Toggle orchestrator delegation off/on for this project. When off, the primary
  session does all reading and implementation inline instead of delegating to
  Haiku readers and Sonnet workers. Run again to turn delegation back on.
---

# Toggle subagent delegation

Run this exact command to flip the marker, then report the resulting state:

```bash
M=".claude/orchestrator-no-subagents"
if [ -f "$M" ]; then rm -f "$M" && echo "DELEGATION ON — marker removed"; else mkdir -p .claude && touch "$M" && echo "DELEGATION OFF — marker created"; fi
```

Then tell the user the new state in one line and act on it for the rest of the session:

- **DELEGATION OFF:** Do all reading and implementation inline in this session. Do not spawn `haiku-reader`, `sonnet-worker`, or `sonnet-worker-lite`. Ignore the adaptive-orchestrator routing rules that delegate.
- **DELEGATION ON:** Resume normal adaptive routing per the adaptive-orchestrator skill — reads to Haiku, bounded implementation to Sonnet workers.

The marker is a file in the project, so it persists across sessions in this repo until toggled back.
