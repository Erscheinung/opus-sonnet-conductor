#!/usr/bin/env node
// spending plugin core (vendored into the orchestrator plugin) — fetch provider
// provider daily/monthly spend + caps.
//
// Vendored from an upstream spending plugin so this
// orchestrator plugin is self-contained. Run this plugin OR the standalone
// spending plugin plugin, not both, to avoid duplicate SessionStart/UserPromptSubmit
// hooks writing the same snapshot.
//
// Auth model (provider IAS / Cloud Identity, single-use rotating refresh tokens):
//   1. Cache the short-lived access_token (JWT, ~1h) in a local file. Reuse it
//      until close to expiry — avoids touching the shared keychain refresh_token
//      on every call.
//   2. Only when the access_token is missing/expired do we exchange the keychain
//      refresh_token. IAS rotates it on use, so we IMMEDIATELY write the new one
//      back to the keychain, keeping the desktop app and this plugin in sync.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const OIDC_HOST = process.env.ORCHESTRATOR_OIDC_HOST || "";
const TENANT = process.env.ORCHESTRATOR_CLIENT_ID || "";
const KC_SERVICE = 'orchestrator-budget';
const KC_ACCOUNT = OIDC_HOST && TENANT ? `https://${OIDC_HOST}/${TENANT}` : "";
const API_HOST = process.env.ORCHESTRATOR_API_HOST || "";
const COSTS_PATH = '/llm-proxy/client-api/v1/me/costs';
const CAPS_PATH = '/llm-proxy/client-api/v1/me/caps';

// Shared config dir with the standalone plugin: the snapshot format is identical,
// so a status line reading either plugin's snapshot keeps working.
const CACHE_DIR = path.join(os.homedir(), '.config', 'orchestrator-budget');
const TOKEN_CACHE = path.join(CACHE_DIR, 'spending-plugin-token.json');
const ALARM_STATE = path.join(CACHE_DIR, 'spending-plugin-alarms.json');
const SNAPSHOT = path.join(CACHE_DIR, 'spending-plugin-snapshot.json');

// --- keychain helpers -------------------------------------------------------

function readRefreshToken() {
  try {
    const raw = execFileSync('security', [
      'find-generic-password', '-s', KC_SERVICE, '-a', KC_ACCOUNT, '-w',
    ], { encoding: 'utf8' }).trim();
    if (raw.startsWith('go-keyring-base64:')) {
      return Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8');
    }
    return raw;
  } catch {
    return null;
  }
}

function writeRefreshToken(rt) {
  try {
    const enc = 'go-keyring-base64:' + Buffer.from(rt, 'utf8').toString('base64');
    execFileSync('security', [
      'add-generic-password', '-U', '-s', KC_SERVICE, '-a', KC_ACCOUNT, '-w', enc,
    ], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// --- token cache ------------------------------------------------------------

function readCachedAccess() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    // refresh 60s before expiry
    if (c.access_token && c.exp && Date.now() / 1000 < c.exp - 60) {
      return c.access_token;
    }
  } catch {}
  return null;
}

function writeCachedAccess(token, exp) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify({ access_token: token, exp }), { mode: 0o600 });
  } catch {}
}

function jwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.exp || (Date.now() / 1000 + 3000);
  } catch {
    return Date.now() / 1000 + 3000;
  }
}

// --- OIDC refresh (rotate + writeback) --------------------------------------

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function refreshAccessToken() {
  const rt = readRefreshToken();
  if (!OIDC_HOST || !TENANT) throw new Error("provider authentication is not configured");
  if (!rt) throw new Error('no refresh token in keychain — open the provider app and sign in');

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: TENANT,
  }).toString();

  const { status, body } = await httpsRequest({
    hostname: OIDC_HOST,
    path: '/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form),
    },
  }, form);

  if (status !== 200) {
    throw new Error(`token refresh failed (${status}) — the provider app may need re-login`);
  }
  const json = JSON.parse(body);
  // Rotate: persist the NEW refresh token so the app stays in sync.
  if (json.refresh_token && json.refresh_token !== rt) {
    writeRefreshToken(json.refresh_token);
  }
  const access = json.access_token;
  writeCachedAccess(access, jwtExp(access));
  return access;
}

async function getAccessToken() {
  return readCachedAccess() || (await refreshAccessToken());
}

// --- portal API -------------------------------------------------------------

async function apiGet(apiPath, token) {
  if (!API_HOST) throw new Error("provider API endpoint is not configured");
  const { status, body } = await httpsRequest({
    hostname: API_HOST,
    path: apiPath,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200) throw new Error(`API ${apiPath} -> ${status}`);
  return JSON.parse(body);
}

async function fetchSpending() {
  let token = await getAccessToken();
  let costs, caps;
  try {
    [costs, caps] = await Promise.all([apiGet(COSTS_PATH, token), apiGet(CAPS_PATH, token)]);
  } catch (e) {
    // token might have just expired — one forced refresh + retry
    token = await refreshAccessToken();
    [costs, caps] = await Promise.all([apiGet(COSTS_PATH, token), apiGet(CAPS_PATH, token)]);
  }
  return {
    dailyEur: costs.current_day_eur ?? 0,
    monthlyEur: costs.current_month_eur ?? 0,
    dailyLimit: caps.daily_limit_eur ?? 50,
    monthlyLimit: caps.monthly_limit_eur ?? 500,
    monthlyHardLimit: caps.monthly_hard_limit_eur ?? null,
    plan: caps.plan_display ?? caps.plan ?? '',
    fetchedAt: Date.now(),
  };
}

function writeSnapshot(s) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT, JSON.stringify(s));
  } catch {}
}

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  fetchSpending,
  writeSnapshot,
  readSnapshot,
  CACHE_DIR,
  ALARM_STATE,
  SNAPSHOT,
};

// CLI: `node spending-core.js` prints JSON (used for debugging)
if (require.main === module) {
  fetchSpending()
    .then((s) => { console.log(JSON.stringify(s, null, 2)); })
    .catch((e) => { console.error('error:', e.message); process.exit(1); });
}
