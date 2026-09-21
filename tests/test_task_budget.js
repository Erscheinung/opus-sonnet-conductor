#!/usr/bin/env node
// Smoke test for the task-budget soft-gate. No network, no real filesystem
// state — exercises the pure evaluator. Run: node tests/test_task_budget.js

const assert = require('assert');
const { evaluateTaskBudget, todayKey } = require('../plugin/hooks/task-budget');

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

// 1. Below cap: no alert.
{
  const spend = { dailyEur: 20 };
  const budget = { taskDailyEur: 45 };
  const state = { day: todayKey(), firedTaskBudget: [] };
  const { alert } = evaluateTaskBudget(spend, budget, state);
  assert.strictEqual(alert, null, 'below cap should not alert');
  ok('below cap -> no alert');
}

// 2. At/over cap: alert fires and mentions checkpoint + hold.
{
  const spend = { dailyEur: 47.5 };
  const budget = { taskDailyEur: 45 };
  const state = { day: todayKey(), firedTaskBudget: [] };
  const { alert, state: s2 } = evaluateTaskBudget(spend, budget, state);
  assert.ok(alert, 'over cap should alert');
  assert.ok(/checkpoint/i.test(alert), 'alert should mention checkpoint');
  assert.ok(/HOLD/i.test(alert), 'alert should tell the orchestrator to hold');
  assert.ok(s2.firedTaskBudget.length === 1, 'fired list should record the alert');
  ok('over cap -> alert with checkpoint + hold');
}

// 3. Once per day: second evaluation same day does not re-alert.
{
  const budget = { taskDailyEur: 45 };
  const state = { day: todayKey(), firedTaskBudget: [] };
  evaluateTaskBudget({ dailyEur: 50 }, budget, state); // first crossing
  const { alert } = evaluateTaskBudget({ dailyEur: 55 }, budget, state); // still over
  assert.strictEqual(alert, null, 'should not re-alert the same day');
  ok('over cap twice same day -> single alert');
}

// 4. Day rollover resets the fired list.
{
  const budget = { taskDailyEur: 45 };
  const state = { day: '2000-01-01', firedTaskBudget: ['task-daily-45'] };
  const { alert } = evaluateTaskBudget({ dailyEur: 60 }, budget, state);
  assert.ok(alert, 'new day should alert again');
  assert.strictEqual(state.day, todayKey(), 'state day should roll to today');
  ok('day rollover -> alert resets');
}

// 5. Cap of 0 (disabled): never alerts.
{
  const state = { day: todayKey(), firedTaskBudget: [] };
  const { alert } = evaluateTaskBudget({ dailyEur: 999 }, { taskDailyEur: 0 }, state);
  assert.strictEqual(alert, null, 'zero cap disables the gate');
  ok('cap 0 -> disabled');
}

console.log(`\n${passed} checks passed.`);
