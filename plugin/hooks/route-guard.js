#!/usr/bin/env node
// PreToolUse guard for the Agent/Task tool — enforces cost tiering.
//
// Why: a subagent resolves its model as
//   CLAUDE_CODE_SUBAGENT_MODEL env > per-call `model` > agent frontmatter > parent model.
// Generic spawns (no subagent_type, general-purpose, claude, fork) carry no
// frontmatter and no per-call model, so they silently run on the parent (Opus).
// This hook rewrites every spawn so it lands on the cheapest tier that fits.
//
// Standalone on purpose (no deps) so setup.sh can install it without the plugin.
// Pure routing is exported (decideRoute) for unit tests.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = path.join(os.homedir(), '.config', 'orchestrator-budget');
const LOG_FILE = path.join(LOG_DIR, 'routing-log.jsonl');
const STATE_FILE = path.join(LOG_DIR, 'route-guard-state.json');
const MAX_SPAWNS_PER_SESSION = 8;

const TIERS = {
  'haiku-reader': 'haiku',
  'sonnet-worker-lite': 'sonnet',
  'sonnet-worker': 'sonnet',
};
const GENERIC = new Set(['', 'general-purpose', 'claude', 'fork']);
const EXPENSIVE = new Set(['opus', 'inherit', 'fable']);

const READ_RE = /\b(find|locate|where( is|'s)?|who calls|callers?|usages?|list (all )?(uses|references)|map|summari[sz]e|read|inspect|what does|grep|search|look ?up|explore|trace)\b/i;
const LITE_RE = /\b(rename|typo|format|reformat|bump|mechanical|boilerplate|add (a )?(comment|import|field|flag)|one[- ]line|small tweak|update (the )?(docs?|readme|copy|text)|change (the )?(color|colour|label|string))\b/i;
const WRITE_RE = /\b(implement|write|edit|fix|refactor|add|create|change|update|migrate|build|patch|rename|bump|reformat|format|remove|delete)\b/i;

function classify(text) {
  const t = String(text || '');
  const writes = WRITE_RE.test(t);
  if (!writes && READ_RE.test(t)) return 'haiku-reader';
  if (writes && LITE_RE.test(t) && t.length < 1200) return 'sonnet-worker-lite';
  return writes ? 'sonnet-worker' : 'haiku-reader';
}

// Pure: tool_input + env + spawn count -> { updatedInput, note, changed }.
function decideRoute(input, env = {}, spawnCount = 0) {
  const inp = { ...(input || {}) };
  const type = inp.subagent_type || '';
  const before = { subagent_type: type, model: inp.model || null };
  const notes = [];

  if (env.CLAUDE_CODE_SUBAGENT_MODEL) {
    notes.push(
      `CLAUDE_CODE_SUBAGENT_MODEL=${env.CLAUDE_CODE_SUBAGENT_MODEL} is set and overrides every ` +
      `per-agent model — unset it or tiering cannot work.`
    );
  }

  if (TIERS[type]) {
    // Our own tier: force its model; never let a stray opus/inherit through.
    if (!inp.model || EXPENSIVE.has(String(inp.model).toLowerCase())) inp.model = TIERS[type];
  } else if (GENERIC.has(type)) {
    const tier = classify(`${inp.description || ''} ${inp.prompt || ''}`);
    inp.subagent_type = tier;
    inp.model = TIERS[tier];
    notes.push(`generic spawn re-routed to ${tier}/${inp.model}`);
  } else if (type === 'Explore') {
    if (!inp.model || EXPENSIVE.has(String(inp.model).toLowerCase())) inp.model = 'haiku';
  } else if (!inp.model) {
    // Unknown/custom agent without a per-call model: keep its own frontmatter.
  }

  if (spawnCount >= MAX_SPAWNS_PER_SESSION) {
    notes.push(
      `${spawnCount} subagents already spawned this session. Each pays a cold start; batch work ` +
      `into fewer, larger briefs or do the rest inline.`
    );
  }

  const changed = before.subagent_type !== (inp.subagent_type || '') || before.model !== (inp.model || null);
  return { updatedInput: inp, notes, changed, before };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let evt = {};
  try { evt = JSON.parse(raw); } catch { process.exit(0); }
  if (!/^(Agent|Task)$/.test(evt.tool_name || '')) process.exit(0);

  // No-subagents marker: block spawning entirely.
  const cwd = evt.cwd || process.cwd();
  if (fs.existsSync(path.join(cwd, '.claude', 'orchestrator-no-subagents'))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '/no-subagents is active — do this work inline.',
      },
    }));
    return;
  }

  const sid = evt.session_id || 'unknown';
  const state = readJson(STATE_FILE, {});
  const count = state.sid === sid ? state.count || 0 : 0;
  const { updatedInput, notes, changed, before } = decideRoute(evt.tool_input, process.env, count);

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ sid, count: count + 1 }));
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      ts: new Date().toISOString(), sid, from: before,
      to: { subagent_type: updatedInput.subagent_type || null, model: updatedInput.model || null },
      changed,
    }) + '\n');
  } catch { /* logging is best-effort */ }

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput,
    },
  };
  if (notes.length) out.hookSpecificOutput.additionalContext = 'route-guard: ' + notes.join(' ');
  process.stdout.write(JSON.stringify(out));
}

if (require.main === module) main();

module.exports = { decideRoute, classify, TIERS, MAX_SPAWNS_PER_SESSION };
