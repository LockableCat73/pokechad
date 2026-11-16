import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  sessionPoints,
  signedPoints,
  displayMultiplier,
  recalculate,
  clampStars,
} from '../js/scoring.js';
import {
  TIERS,
  PITY_LIMIT,
  rollReward,
  grantOwed,
  owedRewards,
  pityDry,
  countOwned,
  collection,
  starterOwed,
  STARTERS,
} from '../js/rewards.js';
import * as sw from '../js/stopwatch.js';
import {
  defaultState,
  normalize,
  exportJSON,
  importJSON,
  load,
  save,
  STORAGE_KEY,
} from '../js/state.js';

const dex = JSON.parse(
  readFileSync(new URL('../data/pokedex.json', import.meta.url), 'utf8'),
).species;

/** Deterministic generator so the roll tests are repeatable. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MIN = 60_000;
const T0 = Date.parse('2026-01-01T10:00:00.000Z');

// ---------------------------------------------------------------- scoring

test('session points follow floor(t/60 + t^1.05 * stars/2)', () => {
  assert.equal(sessionPoints(60, 4), 148);
  assert.equal(sessionPoints(60, 0), 1);
  assert.equal(sessionPoints(59, 0), 0);
  assert.equal(sessionPoints(1, 4), 2);
  assert.equal(sessionPoints(0, 4), 0);
  assert.equal(sessionPoints(25, 2), Math.floor(25 / 60 + 25 ** 1.05));
});

test('chud loses exactly what chad would gain', () => {
  assert.equal(signedPoints('chad', 90, 3), -signedPoints('chud', 90, 3));
  assert.ok(signedPoints('chud', 90, 3) < 0);
  assert.ok(Object.is(signedPoints('chud', 0, 0), 0), 'no negative zero');
});

test('stars are clamped to whole numbers 0 to 4', () => {
  assert.equal(clampStars(9), 4);
  assert.equal(clampStars(-2), 0);
  assert.equal(clampStars('3'), 3);
  assert.equal(clampStars(undefined), 0);
});

test('display multiplier is 1.05 * t^0.05 - 0.05 and grows with time', () => {
  assert.ok(Math.abs(displayMultiplier(1) - 1) < 1e-12);
  assert.ok(Math.abs(displayMultiplier(60) - (1.05 * 60 ** 0.05 - 0.05)) < 1e-12);
  assert.ok(displayMultiplier(120) > displayMultiplier(60));
  assert.equal(displayMultiplier(0), 0);
});

test('recalculate tracks net and the high-water mark', () => {
  const sessions = [
    { kind: 'chad', activeMinutes: 60, stars: 4 },
    { kind: 'chud', activeMinutes: 60, stars: 4 },
    { kind: 'chad', activeMinutes: 30, stars: 2 },
  ];
  const score = recalculate(sessions);
  assert.deepEqual(sessions.map((s) => s.points), [148, -148, 36]);
  assert.deepEqual(sessions.map((s) => s.netAfter), [148, 0, 36]);
  assert.deepEqual(score, { net: 36, highWater: 148 });
});

// ---------------------------------------------------------------- rewards

test('the Pokédex data is complete and well formed', () => {
  assert.ok(dex.length >= 1025);
  assert.deepEqual(dex.map((s) => s.id), dex.map((_, i) => i + 1));
  for (const s of dex) {
    assert.ok(TIERS[s.tier], `tier of #${s.id}`);
    assert.ok(s.name && s.slug);
  }
  assert.equal(dex.find((s) => s.slug === 'mew').tier, 'mythical');
  assert.equal(dex.find((s) => s.slug === 'mewtwo').tier, 'legendary');
  assert.equal(dex.find((s) => s.slug === 'pikachu').tier, 'common');
});

test('rewards owed come from the high-water mark, never below zero', () => {
  assert.equal(owedRewards(0, []), 0);
  assert.equal(owedRewards(99, []), 0);
  assert.equal(owedRewards(100, []), 1);
  assert.equal(owedRewards(350, [{}, {}]), 1);
  assert.equal(owedRewards(100, [{}, {}, {}]), 0);
  assert.equal(owedRewards(-500, []), 0);
});

test('roll odds are close to 94 / 5 / 1', () => {
  const rng = seeded(42);
  const tally = { common: 0, legendary: 0, mythical: 0 };
  const rolls = 40_000;
  for (let i = 0; i < rolls; i++) {
    // An empty reward list each time, so caps and pity do not interfere.
    tally[rollReward({ species: dex, rewards: [], rng }).tier]++;
  }
  assert.ok(Math.abs(tally.common / rolls - 0.94) < 0.01);
  assert.ok(Math.abs(tally.legendary / rolls - 0.05) < 0.01);
  assert.ok(Math.abs(tally.mythical / rolls - 0.01) < 0.005);
});

test('caps are 7 / 5 / 2 and only the last copy is shiny', () => {
  const tiny = [
    { id: 1, tier: 'common', sprite: true },
    { id: 2, tier: 'legendary', sprite: true },
    { id: 3, tier: 'mythical', sprite: true },
  ];
  const rewards = [];
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const roll = rollReward({ species: tiny, rewards, rng });
    if (!roll) break;
    rewards.push(roll);
  }
  const counts = countOwned(rewards);
  assert.equal(counts.get(1), 7);
  assert.equal(counts.get(2), 5);
  assert.equal(counts.get(3), 2);
  assert.equal(rewards.length, 14);
  assert.equal(rollReward({ species: tiny, rewards, rng }), null);
  for (const id of [1, 2, 3]) {
    const copies = rewards.filter((r) => r.dexId === id);
    assert.deepEqual(
      copies.map((r) => r.shiny),
      copies.map((_, i) => i === copies.length - 1),
      `shiny pattern for #${id}`,
    );
  }
});

test('species without a sprite are never awarded', () => {
  const pool = [
    { id: 1, tier: 'common', sprite: false },
    { id: 2, tier: 'common', sprite: true },
  ];
  const rng = seeded(3);
  for (let i = 0; i < 50; i++) {
    assert.equal(rollReward({ species: pool, rewards: [], rng }).dexId, 2);
  }
});

test('pity forces a legendary after 20 dry rolls and never a mythical', () => {
  const dry = Array.from({ length: PITY_LIMIT }, () => ({ dexId: 1, tier: 'common' }));
  assert.equal(pityDry(dry), PITY_LIMIT);
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollReward({ species: dex, rewards: dry, rng: seeded(seed) });
    assert.equal(roll.tier, 'legendary');
    assert.equal(roll.pity, true);
  }
  const almost = dry.slice(1);
  const tiers = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollReward({ species: dex, rewards: almost, rng: seeded(seed) });
    tiers.add(roll.tier);
    assert.equal(roll.pity, false);
  }
  assert.ok(tiers.has('common'));
});

test('pity counter: mythicals count up, only a legendary resets it', () => {
  assert.equal(pityDry([]), 0);
  assert.equal(pityDry([{ tier: 'legendary' }, { tier: 'common' }, { tier: 'mythical' }]), 2);
  assert.equal(pityDry([{ tier: 'common' }, { tier: 'legendary' }]), 0);
});

test('a long run never goes more than 20 rewards without a legendary', () => {
  const rewards = [];
  grantOwed({ highWater: 300_000, rewards, species: dex, rng: seeded(99) });
  assert.equal(rewards.length, 3000);
  let dry = 0;
  for (const r of rewards) {
    dry = r.tier === 'legendary' ? 0 : dry + 1;
    assert.ok(dry <= PITY_LIMIT, `dry streak of ${dry} at reward ${r.n}`);
    if (r.pity) assert.equal(r.tier, 'legendary');
  }
  assert.deepEqual(rewards.map((r) => r.n), rewards.map((_, i) => i + 1));
  assert.equal(rewards[9].trackPoints, 1000);
});

test('with legendaries exhausted, pity falls back to a normal roll', () => {
  const pool = [
    { id: 1, tier: 'common', sprite: true },
    { id: 2, tier: 'mythical', sprite: true },
  ];
  const dry = Array.from({ length: 3 }, () => ({ dexId: 9, tier: 'common' }));
  while (dry.length < PITY_LIMIT) dry.push({ dexId: 9, tier: 'common' });
  const roll = rollReward({ species: pool, rewards: dry, rng: seeded(5) });
  assert.notEqual(roll, null);
  assert.equal(roll.pity, false);
});

// ---------------------------------------------------------------- starter

test('the starter unlocks at 1 point and only once', () => {
  assert.equal(starterOwed(0, null), false);
  assert.equal(starterOwed(-50, null), false);
  assert.equal(starterOwed(1, null), true);
  assert.equal(starterOwed(500, null), true);
  assert.equal(starterOwed(500, { dexId: 4 }), false);
  assert.deepEqual(
    STARTERS.map((id) => dex[id - 1].slug),
    ['bulbasaur', 'charmander', 'squirtle', 'pikachu'],
  );
});

test('the starter is an extra reward and does not shift the 100-point rewards', () => {
  const starter = { dexId: 4, at: '2026-01-01T10:00:00.000Z', sessionId: 's-a' };
  const rewards = [];
  const granted = grantOwed({ highWater: 250, rewards, species: dex, starter, rng: seeded(8) });
  assert.deepEqual(granted.map((r) => r.trackPoints), [100, 200]);
  assert.equal(owedRewards(250, rewards), 0);
  const all = collection({ starter, rewards });
  assert.equal(all.length, 3);
  assert.deepEqual(
    { n: all[0].n, dexId: all[0].dexId, starter: all[0].starter, shiny: all[0].shiny, trackPoints: all[0].trackPoints },
    { n: 0, dexId: 4, starter: true, shiny: false, trackPoints: 1 },
  );
  assert.equal(collection({ starter: null, rewards }).length, 2);
  // The starter is not a roll, so it never touches the pity counter.
  assert.equal(pityDry(rewards), rewards.filter((r) => r.tier !== 'legendary').length);
});

test('the starter counts as one copy towards its species cap', () => {
  const tiny = [{ id: 4, tier: 'common', sprite: true }];
  const starter = { dexId: 4, at: '2026-01-01T10:00:00.000Z', sessionId: null };
  const rewards = [];
  const rng = seeded(21);
  for (;;) {
    const roll = rollReward({ species: tiny, rewards, starter, rng });
    if (!roll) break;
    rewards.push(roll);
  }
  assert.equal(rewards.length, 6, 'six rolled copies plus the starter make seven');
  assert.deepEqual(rewards.map((r) => r.shiny), [false, false, false, false, false, true]);
});

// ---------------------------------------------------------------- stopwatch

test('stopwatch counts only active time', () => {
  let a = sw.start('chad', T0);
  assert.equal(sw.elapsedMs(a, T0 + 10 * MIN), 10 * MIN);
  a = sw.pause(a, T0 + 10 * MIN);
  assert.equal(sw.elapsedMs(a, T0 + 25 * MIN), 10 * MIN);
  assert.equal(sw.breakMs(a, T0 + 25 * MIN), 15 * MIN);
  a = sw.resume(a, T0 + 25 * MIN);
  assert.equal(sw.elapsedMs(a, T0 + 45 * MIN), 30 * MIN);
  const done = sw.finish(a, T0 + 45 * MIN);
  assert.equal(done.activeMinutes, 30);
  assert.equal(done.autoEnded, false);
  assert.equal(done.pauses.length, 1);
  assert.equal(done.endedAt, new Date(T0 + 45 * MIN).toISOString());
});

test('break warning starts at 30 minutes and the session expires at 35', () => {
  const a = sw.pause(sw.start('chud', T0), T0 + 20 * MIN);
  const at = (m) => sw.breakStatus(a, T0 + 20 * MIN + m * MIN);
  assert.equal(sw.breakStatus(sw.start('chud', T0), T0 + MIN).phase, 'running');
  assert.equal(at(29.9).phase, 'break');
  assert.equal(at(30).phase, 'warning');
  assert.equal(at(30).remainingMs, 5 * MIN);
  assert.equal(at(34.99).phase, 'warning');
  assert.equal(at(35).phase, 'expired');
  assert.equal(at(600).phase, 'expired');
});

test('an auto-ended session keeps the time earned before the break', () => {
  const a = sw.pause(sw.start('chad', T0), T0 + 42 * MIN);
  const done = sw.finish(a, T0 + 500 * MIN, { autoEnded: true });
  assert.equal(done.activeMinutes, 42);
  assert.equal(done.autoEnded, true);
  assert.equal(done.endedAt, new Date(T0 + 42 * MIN).toISOString());
});

// ---------------------------------------------------------------- state

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

function sampleState() {
  const state = defaultState(T0);
  state.sessions = [
    {
      id: 's-a',
      kind: 'chad',
      method: 'stopwatch',
      startedAt: '2026-01-01T10:00:00.000Z',
      endedAt: '2026-01-01T11:10:00.000Z',
      activeMinutes: 60,
      pauses: [{ from: '2026-01-01T10:20:00.000Z', to: '2026-01-01T10:30:00.000Z' }],
      autoEnded: false,
      stars: 4,
      note: 'Deep work',
    },
    {
      id: 's-b',
      kind: 'chud',
      method: 'manual',
      startedAt: '2026-01-01T20:00:00.000Z',
      endedAt: '2026-01-01T20:30:00.000Z',
      activeMinutes: 30,
      pauses: [],
      autoEnded: false,
      stars: 2,
      note: 'Scrolling',
    },
  ];
  state.score = recalculate(state.sessions);
  grantOwed({
    highWater: state.score.highWater,
    rewards: state.rewards,
    species: dex,
    sessionId: 's-a',
    at: '2026-01-01T11:10:00.000Z',
    rng: seeded(11),
  });
  state.pity = { dry: pityDry(state.rewards) };
  state.starter = { dexId: 7, at: '2026-01-01T11:10:00.000Z', sessionId: 's-a' };
  state.buddy = { dexId: state.rewards[0].dexId, shiny: false };
  return state;
}

test('export then import gives back the same state', () => {
  const state = sampleState();
  const text = exportJSON(state, T0 + 1000);
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, 'pokechad');
  assert.equal(parsed.exportedAt, new Date(T0 + 1000).toISOString());
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[1].method, 'manual');
  assert.equal(parsed.rewards.length, 1);
  assert.deepEqual(parsed.starter, { dexId: 7, at: '2026-01-01T11:10:00.000Z', sessionId: 's-a' });
  assert.deepEqual(importJSON(text), state);
});

test('save and load round-trip through storage', () => {
  const storage = memoryStorage();
  const state = sampleState();
  assert.equal(save(state, storage), true);
  const loaded = load(storage);
  assert.equal(loaded.problem, null);
  assert.deepEqual(loaded.state, state);
});

test('an unreadable save is set aside, not destroyed', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const loaded = load(storage);
  assert.ok(loaded.problem);
  assert.equal(loaded.state.sessions.length, 0);
  assert.equal(storage.map.get(`${STORAGE_KEY}.corrupt`), '{not json');
});

test('importing a hand-edited file recalculates every derived number', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.sessions[0].stars = 1; // was 4
  edited.sessions[0].points = 9999; // stale, must be ignored
  edited.score = { net: 123456, highWater: 123456 };
  edited.pity = { dry: 77 };
  edited.sessions.push({
    kind: 'chad',
    startedAt: '2026-01-02T09:00:00Z',
    activeMinutes: 120,
    stars: 3,
  });
  const state = normalize(edited);
  assert.equal(state.sessions[0].points, sessionPoints(60, 1));
  assert.equal(state.sessions[2].points, sessionPoints(120, 3));
  assert.equal(state.sessions[2].method, 'stopwatch');
  assert.ok(state.sessions[2].id);
  const net = sessionPoints(60, 1) - sessionPoints(30, 2) + sessionPoints(120, 3);
  assert.equal(state.score.net, net);
  assert.equal(state.sessions[2].netAfter, net);
  assert.equal(state.pity.dry, pityDry(state.rewards));
  // Pokémon already held are kept even though the old high-water mark is gone.
  assert.equal(state.rewards.length, 1);
});

test('removing a session lowers the score but keeps the Pokémon', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.sessions.shift();
  const state = normalize(edited);
  assert.equal(state.score.net, -sessionPoints(30, 2));
  assert.equal(state.score.highWater, 0);
  assert.equal(state.rewards.length, 1);
  assert.equal(owedRewards(state.score.highWater, state.rewards), 0);
});

test('import drops a running stopwatch and an invalid starter', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.active = { kind: 'chad', startedAt: '2026-01-03T09:00:00Z', pauses: [], pausedAt: null };
  edited.starter = { dexId: 'pikachu' };
  const state = importJSON(JSON.stringify(edited));
  assert.equal(state.active, null);
  assert.equal(state.starter, null);
});

test('import rejects files that are not usable', () => {
  assert.throws(() => importJSON('nope'), /not valid JSON/);
  assert.throws(() => importJSON('[]'), /not a PokéChad save/);
  assert.throws(() => importJSON('{"schema":1}'), /not a PokéChad save/);
  assert.throws(() => importJSON('{"app":"pokechad","schema":99}'), /Update the site/);
  assert.throws(
    () => importJSON('{"app":"pokechad","schema":1,"sessions":[{"kind":"nap"}]}'),
    /Session 1/,
  );
  assert.throws(
    () => importJSON('{"app":"pokechad","schema":1,"rewards":[{"dexId":"x"}]}'),
    /Reward 1/,
  );
});
