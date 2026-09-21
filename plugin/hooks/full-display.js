#!/usr/bin/env node
// Orchestrator spend panel — the /orchestrator-spending command renders the
// daily + monthly bars with limit markers, plus the task-budget cap line.
// Vendored from an upstream spending plugin, extended with the
// task cap.

const { fetchSpending } = require('./spending-core');
const { readBudgetConfig } = require('./task-budget');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREY = '\x1b[90m';

const BAR_W = 34;

function colorFor(pct) {
  if (pct >= 0.8) return RED;
  if (pct >= 0.5) return YELLOW;
  return GREEN;
}

function bar(pct, color) {
  const filled = Math.round(Math.min(pct, 1) * BAR_W);
  const mark50 = Math.round(0.5 * BAR_W);
  const mark80 = Math.round(0.8 * BAR_W);
  let out = '';
  for (let i = 0; i < BAR_W; i++) {
    const isTick = i === mark50 || i === mark80;
    if (i < filled) {
      out += color + '█' + RESET;
    } else if (isTick) {
      out += GREY + '|' + RESET;
    } else {
      out += DIM + '░' + RESET;
    }
  }
  return out;
}

function eur(n) {
  return n.toFixed(4) + '€';
}

function line(label, spent, limit) {
  const pct = limit ? spent / limit : 0;
  const c = colorFor(pct);
  const pctStr = (pct * 100).toFixed(1) + '%';
  const head = `${DIM}${label.padEnd(8)}${RESET}${BOLD}${eur(spent)}${RESET} ${DIM}/ ${eur(limit)}${RESET}`;
  const pctCol = `${c}${pctStr.padStart(7)}${RESET}`;
  return `${head}${pctCol}\n         ${bar(pct, c)}`;
}

async function main() {
  let s;
  try {
    s = await fetchSpending();
  } catch (e) {
    console.log(`\n${RED}Could not read provider spending:${RESET} ${e.message}\n`);
    process.exit(0);
  }

  const budget = readBudgetConfig();

  console.log('');
  console.log(`${BOLD}Spending Limits${RESET}  ${DIM}${s.plan ? '(' + s.plan + ' plan)' : ''}${RESET}`);
  console.log(`${DIM}${'─'.repeat(52)}${RESET}`);
  console.log(line('DAILY', s.dailyEur, s.dailyLimit));
  console.log('');
  console.log(line('MONTHLY', s.monthlyEur, s.monthlyLimit));
  if (s.monthlyHardLimit && s.monthlyHardLimit > s.monthlyLimit) {
    console.log(`${DIM}         hard cap ${eur(s.monthlyHardLimit)}${RESET}`);
  }
  console.log(`${DIM}${'─'.repeat(52)}${RESET}`);
  if (budget.taskDailyEur > 0) {
    const tc = colorFor(s.dailyLimit ? s.dailyEur / budget.taskDailyEur : 0);
    const hit = s.dailyEur >= budget.taskDailyEur ? `${RED} REACHED${RESET}` : '';
    console.log(`${DIM}Task cap (orchestrator soft-gate): ${RESET}${tc}${eur(budget.taskDailyEur)}/day${RESET}${hit}`);
  }
  console.log(`${DIM}Live from provider portal · task cap in ~/.config/orchestrator-budget/orchestrator-budget.json${RESET}`);
  console.log('');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
