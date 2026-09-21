#!/usr/bin/env node
// Task-budget layer — warn + soft-gate on daily task spend.
//
// Reads a per-day task cap (default 45 EUR) from
// ~/.config/orchestrator-budget/orchestrator-budget.json and, when the day's provider spend
// crosses it, produces a STOP-strength instruction for the orchestrator to
// checkpoint and hold. This never mechanically kills the session — it injects
// context and lets Opus decide. Fires once per day (de-duped via alarm state).
//
// Pure evaluation is exported (evaluateTaskBudget) so it can be unit-tested
// without any network or filesystem.

const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./spending-core');

const BUDGET_CONFIG = path.join(CACHE_DIR, 'orchestrator-budget.json');

const DEFAULT_BUDGET = {
  taskDailyEur: 45,
};

function readBudgetConfig() {
  try {
    return { ...DEFAULT_BUDGET, ...JSON.parse(fs.readFileSync(BUDGET_CONFIG, 'utf8')) };
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Pure: given spend, budget, and prior fired-alarm state, return the alert (or
// null) and the mutated fired list. state is { day, firedTaskBudget: [] }.
function evaluateTaskBudget(spend, budget, state) {
  const day = todayKey();
  if (state.day !== day) { state.day = day; state.firedTaskBudget = []; }
  if (!Array.isArray(state.firedTaskBudget)) state.firedTaskBudget = [];

  const cap = budget.taskDailyEur;
  if (!cap || cap <= 0) return { alert: null, state };

  const key = `task-daily-${cap}`;
  if (spend.dailyEur >= cap && !state.firedTaskBudget.includes(key)) {
    state.firedTaskBudget.push(key);
    return {
      alert:
        `TASK BUDGET REACHED: daily spend ${spend.dailyEur.toFixed(2)}€ crossed your ` +
        `${cap}€ task cap. Finish or safely stop the current worker, record a ` +
        `checkpoint, surface where the work stands and how to resume, then HOLD — ` +
        `do not start new delegations until the user says continue.`,
      state,
    };
  }
  return { alert: null, state };
}

module.exports = {
  evaluateTaskBudget,
  readBudgetConfig,
  BUDGET_CONFIG,
  DEFAULT_BUDGET,
  todayKey,
};
