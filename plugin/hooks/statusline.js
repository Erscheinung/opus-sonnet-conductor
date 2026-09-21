#!/usr/bin/env node
// Orchestrator statusline — compact daily/monthly spend fragment. Reads the
// cached snapshot (kept live by refresher.js) so the render is instant and never
// blocks on network. Falls back to a live fetch if no snapshot exists yet.
// Vendored from a standalone spending plugin.

const fs = require('fs');
const { fetchSpending, writeSnapshot, SNAPSHOT } = require('./spending-core');

const SNAPSHOT_MAX_AGE_MS = 90 * 1000; // 90s — refresher.js rewrites every ~60s

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function colorFor(pct) {
  if (pct >= 0.8) return RED;
  if (pct >= 0.5) return YELLOW;
  return GREEN;
}

function eur(n) {
  return n.toFixed(4) + '€';
}

function readFreshSnapshot() {
  try {
    const st = fs.statSync(SNAPSHOT);
    if (Date.now() - st.mtimeMs > SNAPSHOT_MAX_AGE_MS) return null;
    return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return null;
  }
}

function render(s) {
  const dPct = s.dailyLimit ? s.dailyEur / s.dailyLimit : 0;
  const mPct = s.monthlyLimit ? s.monthlyEur / s.monthlyLimit : 0;
  const dC = colorFor(dPct);
  const mC = colorFor(mPct);
  return `${DIM}\u{1F4B6}${RESET} ${dC}D ${eur(s.dailyEur)}/${eur(s.dailyLimit)}${RESET} ${DIM}·${RESET} ${mC}M ${eur(s.monthlyEur)}/${eur(s.monthlyLimit)}${RESET}`;
}

async function main() {
  let snap = readFreshSnapshot();
  if (!snap) {
    try {
      snap = await fetchSpending();
      writeSnapshot(snap);
    } catch {
      process.stdout.write(`${DIM}\u{1F4B6} spend n/a${RESET}`);
      return;
    }
  }
  process.stdout.write(render(snap));
}

main().catch(() => process.stdout.write(''));
