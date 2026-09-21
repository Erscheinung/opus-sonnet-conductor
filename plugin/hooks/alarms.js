#!/usr/bin/env node
// Orchestrator spend hook — refresh the snapshot, emit budget alerts (including
// the task-budget soft-gate), and on SessionStart spawn the background refresher
// that keeps the snapshot live between prompts (the lag fix).
//
// Vendored and extended from an upstream spending plugin.
// Alarms:
//   • provider parity: daily spend >= 10% of the MONTHLY limit.
//   • User daily % thresholds (of daily cap).
//   • User daily absolute EUR triggers.
//   • Monthly % thresholds.
//   • Task budget: daily spend >= the orchestrator task cap (default 45 EUR),
//     injected as a STOP-strength instruction. See task-budget.js.
// Each fires once per period, de-duped in spending-plugin-alarms.json.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchSpending, writeSnapshot, readSnapshot, CACHE_DIR } = require('./spending-core');
const { evaluateTaskBudget, readBudgetConfig } = require('./task-budget');

const SNAPSHOT = path.join(CACHE_DIR, 'spending-plugin-snapshot.json');
const ALARM_STATE = path.join(CACHE_DIR, 'spending-plugin-alarms.json');
const CONFIG = path.join(CACHE_DIR, 'spending-plugin-config.json');

// If the snapshot is younger than this, reuse it instead of a live fetch. The
// background refresher (refresher.js) keeps it fresh between prompts, so this
// throttle no longer causes lag — it just avoids a redundant synchronous fetch
// on a turn that the refresher already covered.
const REFRESH_THROTTLE_MS = 45 * 1000;

function snapshotFresh() {
  try {
    return Date.now() - fs.statSync(SNAPSHOT).mtimeMs < REFRESH_THROTTLE_MS;
  } catch {
    return false;
  }
}

const DEFAULT_CONFIG = {
  dailyThresholdsPct: [50, 80, 100],
  monthlyThresholdsPct: [50, 80, 100],
  dailyAbsoluteEur: [],
  enableProviderDaily: true,
};

function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function readAlarmState() {
  try {
    return JSON.parse(fs.readFileSync(ALARM_STATE, 'utf8'));
  } catch {
    return { day: null, month: null, firedDaily: [], firedMonthly: [], firedTaskBudget: [] };
  }
}

function writeAlarmState(st) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(ALARM_STATE, JSON.stringify(st));
  } catch {}
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function evaluate(spend, config, state) {
  const alerts = [];
  const day = todayKey();
  const month = monthKey();

  if (state.day !== day) { state.day = day; state.firedDaily = []; state.firedTaskBudget = []; }
  if (state.month !== month) { state.month = month; state.firedMonthly = []; }

  const dPctNow = spend.dailyLimit ? (spend.dailyEur / spend.dailyLimit) * 100 : 0;
  const mPctNow = spend.monthlyLimit ? (spend.monthlyEur / spend.monthlyLimit) * 100 : 0;

  if (config.enableProviderDaily && spend.monthlyLimit) {
    const key = 'provider-daily-10pct-monthly';
    const trigger = spend.monthlyLimit * 0.10;
    if (spend.dailyEur >= trigger && !state.firedDaily.includes(key)) {
      state.firedDaily.push(key);
      alerts.push(`Daily spend ${spend.dailyEur.toFixed(2)}€ reached 10% of your monthly limit (${trigger.toFixed(2)}€) — provider daily-pace warning.`);
    }
  }

  for (const pct of config.dailyThresholdsPct) {
    const key = `daily-pct-${pct}`;
    if (dPctNow >= pct && !state.firedDaily.includes(key)) {
      state.firedDaily.push(key);
      alerts.push(`Daily spend ${spend.dailyEur.toFixed(2)}€ crossed ${pct}% of your ${spend.dailyLimit}€ daily cap (${dPctNow.toFixed(1)}%).`);
    }
  }

  for (const amt of config.dailyAbsoluteEur) {
    const key = `daily-abs-${amt}`;
    if (spend.dailyEur >= amt && !state.firedDaily.includes(key)) {
      state.firedDaily.push(key);
      alerts.push(`Daily spend ${spend.dailyEur.toFixed(2)}€ passed your ${amt}€ alert.`);
    }
  }

  for (const pct of config.monthlyThresholdsPct) {
    const key = `monthly-pct-${pct}`;
    if (mPctNow >= pct && !state.firedMonthly.includes(key)) {
      state.firedMonthly.push(key);
      alerts.push(`Monthly spend ${spend.monthlyEur.toFixed(2)}€ crossed ${pct}% of your ${spend.monthlyLimit}€ monthly cap (${mPctNow.toFixed(1)}%).`);
    }
  }

  // Task-budget soft-gate (default 45 EUR/day). Injected last so it reads as the
  // actionable line after any threshold notices.
  const { alert: taskAlert } = evaluateTaskBudget(spend, readBudgetConfig(), state);
  if (taskAlert) alerts.push(taskAlert);

  return alerts;
}

function emitContext(alerts, spend, mode) {
  const eventName = mode === 'UserPromptSubmit' ? 'UserPromptSubmit' : 'SessionStart';

  if (eventName === 'UserPromptSubmit' && alerts.length === 0) {
    process.stdout.write('{}');
    return;
  }

  const dPct = spend.dailyLimit ? ((spend.dailyEur / spend.dailyLimit) * 100).toFixed(1) : '?';
  const mPct = spend.monthlyLimit ? ((spend.monthlyEur / spend.monthlyLimit) * 100).toFixed(1) : '?';
  let context = `provider spend — daily ${spend.dailyEur.toFixed(2)}€/${spend.dailyLimit}€ (${dPct}%), monthly ${spend.monthlyEur.toFixed(2)}€/${spend.monthlyLimit}€ (${mPct}%).`;
  if (alerts.length) {
    context += '\n⚠️  BUDGET ALERTS:\n' + alerts.map((a) => '  • ' + a).join('\n');
  }
  const out = { hookSpecificOutput: { hookEventName: eventName, additionalContext: context } };
  process.stdout.write(JSON.stringify(out));
}

function readHookEvent() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw).hook_event_name || null;
  } catch {
    return null;
  }
}

// Spawn the detached background refresher once, on SessionStart. It self-locks,
// so extra spawns are harmless no-ops.
function spawnRefresher() {
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'refresher.js')], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {}
}

async function main() {
  const mode = readHookEvent();

  if (mode === 'SessionStart' || mode === null) spawnRefresher();

  let spend;
  if (snapshotFresh()) {
    spend = readSnapshot();
  }
  if (!spend) {
    try {
      spend = await fetchSpending();
      writeSnapshot(spend);
    } catch (e) {
      process.stdout.write('{}');
      return;
    }
  }

  const config = readConfig();
  const state = readAlarmState();
  const alerts = evaluate(spend, config, state);
  writeAlarmState(state);

  emitContext(alerts, spend, mode);
}

main().catch(() => process.stdout.write('{}'));
