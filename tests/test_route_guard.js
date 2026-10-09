#!/usr/bin/env node
// Unit test for route-guard's pure routing. Run: node tests/test_route_guard.js
const assert = require('assert');
const { decideRoute, classify } = require('../plugin/hooks/route-guard');

let n = 0;
const ok = (m) => { n++; console.log('  ok  ' + m); };

// Generic spawn must never stay on the parent model.
let r = decideRoute({ prompt: 'Find where parseConfig is defined and list callers' });
assert.strictEqual(r.updatedInput.subagent_type, 'haiku-reader');
assert.strictEqual(r.updatedInput.model, 'haiku'); ok('generic read -> haiku-reader/haiku');

r = decideRoute({ subagent_type: 'general-purpose', prompt: 'Implement the retry logic in client.ts with tests' });
assert.strictEqual(r.updatedInput.subagent_type, 'sonnet-worker');
assert.strictEqual(r.updatedInput.model, 'sonnet'); ok('generic implement -> sonnet-worker/sonnet');

r = decideRoute({ subagent_type: 'claude', prompt: 'Rename foo to bar in utils.ts' });
assert.strictEqual(r.updatedInput.subagent_type, 'sonnet-worker-lite'); ok('mechanical -> lite');

// Our tiers cannot be upgraded to opus/inherit by a stray call.
r = decideRoute({ subagent_type: 'sonnet-worker', model: 'opus', prompt: 'x' });
assert.strictEqual(r.updatedInput.model, 'sonnet'); ok('opus on sonnet-worker -> sonnet');
r = decideRoute({ subagent_type: 'haiku-reader', prompt: 'x' });
assert.strictEqual(r.updatedInput.model, 'haiku'); ok('haiku-reader gets haiku');

// Explore downgraded; Plan untouched.
r = decideRoute({ subagent_type: 'Explore', prompt: 'x' });
assert.strictEqual(r.updatedInput.model, 'haiku'); ok('Explore -> haiku');
r = decideRoute({ subagent_type: 'Plan', prompt: 'x' });
assert.strictEqual(r.changed, false); ok('Plan untouched');

// Env override warning + fan-out warning.
r = decideRoute({ subagent_type: 'sonnet-worker', prompt: 'x' }, { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit' }, 9);
assert.ok(r.notes.some((s) => /CLAUDE_CODE_SUBAGENT_MODEL/.test(s)));
assert.ok(r.notes.some((s) => /already spawned/.test(s))); ok('env + fan-out warnings');

assert.strictEqual(classify('explain how auth works'), 'haiku-reader'); ok('non-write defaults to reader');
console.log(`\n${n} passed`);
