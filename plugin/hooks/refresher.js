#!/usr/bin/env node
// Background snapshot refresher — the lag fix.
//
// The original design only refreshed the spend snapshot when a hook fired
// (SessionStart / UserPromptSubmit) and throttled to 60s, so between prompts the
// number went stale and rapid turns never updated. This process is spawned
// detached on SessionStart and rewrites the snapshot on a fixed interval,
// independent of user turns, so the status line and injected context track live
// spend without waiting for the next prompt.
//
// Guardrails:
//   • Single instance: a pidfile lock stops multiple sessions each spawning one.
//   • Self-expiring: exits after MAX_LIFETIME so an abandoned session does not
//     leave a poller running forever.
//   • Keychain-friendly: interval >= MIN_INTERVAL so we never hammer the shared
//     rotating refresh token faster than the app's own cadence.
//   • Silent: never throws into the session; failures just skip a tick.

const fs = require('fs');
const path = require('path');
const { fetchSpending, writeSnapshot, CACHE_DIR } = require('./spending-core');

const PIDFILE = path.join(CACHE_DIR, 'orchestrator-refresher.pid');
const INTERVAL_MS = 60 * 1000;            // one refresh per minute
const MIN_INTERVAL_MS = 45 * 1000;        // floor: never faster than this
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000; // stop after 4h idle-safety

function alreadyRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0); // throws if the pid is gone
    return true;
  } catch {
    return false;
  }
}

function claimLock() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(PIDFILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10);
    if (pid === process.pid) fs.unlinkSync(PIDFILE);
  } catch {}
}

async function tick() {
  try {
    const s = await fetchSpending();
    writeSnapshot(s);
  } catch {
    // skip this tick; try again next interval
  }
}

async function main() {
  if (alreadyRunning()) return; // another session owns the refresher
  if (!claimLock()) return;

  process.on('exit', releaseLock);
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });

  const interval = Math.max(INTERVAL_MS, MIN_INTERVAL_MS);
  const started = Date.now();

  await tick(); // refresh immediately on start
  const timer = setInterval(async () => {
    if (Date.now() - started > MAX_LIFETIME_MS) {
      clearInterval(timer);
      releaseLock();
      process.exit(0);
    }
    await tick();
  }, interval);
  timer.unref?.();
}

main().catch(() => { releaseLock(); process.exit(0); });
