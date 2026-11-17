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
  starterOwed,
  STARTERS,
  dexLimit,
  familyGates,
  eligible,
} from '../js/rewards.js';
import { trackCopies, starterCopy } from '../js/holdings.js';
import {
  reminderText,
  startText,
  pickLine,
  linePools,
  pickReminderCopy,
  spokenTime,
  OWN_SHARE,
  TYPE_SHARE,
} from '../js/encourage.js';
import { GENERAL, NO_POKEMON, BY_TYPE, BY_POKEMON } from '../js/messages.js';
import { indexForms } from '../js/forms.js';
import { resolveMon } from '../js/mon.js';
import * as sw from '../js/stopwatch.js';
import {
  defaultState,
  normalize,
  upgradeFromV1,
  exportJSON,
  importJSON,
  load,
  save,
  STORAGE_KEY,
  BEFORE_V2_KEY,
  SCHEMA,
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

/**
 * A save holding the given copies. `track` are rewards rolled on the track
 * (their `source` is filled in); `others` are copies from anywhere else and
 * must say their own `source`.
 */
function held(track = [], others = [], highWater = 0) {
  return {
    score: { net: highWater, highWater },
    pokemon: [...others, ...track.map((copy) => ({ source: 'track', ...copy }))],
    unlocks: [],
    fusions: [],
    grants: [],
  };
}

/** A starter copy, as the app adds it. */
const starterOf = (dexId, sessionId = null) => ({
  source: 'starter', dexId, tier: 'common', shiny: false, at: '2026-01-01T10:00:00.000Z', sessionId,
});

/** Hand out every reward a high-water mark covers; returns the save. */
function granted(highWater, { others = [], seed = 1 } = {}) {
  const state = held([], others, highWater);
  grantOwed({ state, species: dex, rng: seeded(seed) });
  return state;
}

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
  // Display only, so it never shows less than 1: the first minute reads x1.00.
  assert.equal(displayMultiplier(0), 1);
  assert.equal(displayMultiplier(0.5), 1);
  assert.ok(displayMultiplier(1.01) > 1);
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
  assert.equal(owedRewards(0, 0), 0);
  assert.equal(owedRewards(99, 0), 0);
  assert.equal(owedRewards(100, 0), 1);
  assert.equal(owedRewards(350, 2), 1);
  assert.equal(owedRewards(100, 3), 0);
  assert.equal(owedRewards(-500, 0), 0);
});

test('roll odds are close to 94 / 5 / 1', () => {
  const rng = seeded(42);
  const tally = { common: 0, legendary: 0, mythical: 0 };
  const rolls = 40_000;
  for (let i = 0; i < rolls; i++) {
    // An empty reward list each time, so caps and pity do not interfere.
    tally[rollReward({ species: dex, state: held(), rng }).tier]++;
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
    const roll = rollReward({ species: tiny, state: held(rewards), rng });
    if (!roll) break;
    rewards.push(roll);
  }
  const counts = countOwned(rewards);
  assert.equal(counts.get(1), 7);
  assert.equal(counts.get(2), 5);
  assert.equal(counts.get(3), 2);
  assert.equal(rewards.length, 14);
  assert.equal(rollReward({ species: tiny, state: held(rewards), rng }), null);
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
    assert.equal(rollReward({ species: pool, state: held(), rng }).dexId, 2);
  }
});

test('pity forces a legendary after 20 dry rolls and never a mythical', () => {
  const dry = Array.from({ length: PITY_LIMIT }, () => ({ dexId: 1, tier: 'common' }));
  assert.equal(pityDry(dry), PITY_LIMIT);
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollReward({ species: dex, state: held(dry), rng: seeded(seed) });
    assert.equal(roll.tier, 'legendary');
    assert.equal(roll.pity, true);
  }
  const almost = dry.slice(1);
  const tiers = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollReward({ species: dex, state: held(almost), rng: seeded(seed) });
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
  const rewards = trackCopies(granted(300_000, { seed: 99 }));
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
  const roll = rollReward({ species: pool, state: held(dry), rng: seeded(5) });
  assert.notEqual(roll, null);
  assert.equal(roll.pity, false);
});

// ---------------------------------------------------------------- early game

test('early rewards are limited to the older generations', () => {
  assert.deepEqual([1, 6].map(dexLimit), [151, 151]);
  assert.deepEqual([7, 12].map(dexLimit), [251, 251]);
  assert.deepEqual([13, 18].map(dexLimit), [493, 493]);
  assert.equal(dexLimit(19), Infinity);

  // Many independent runs of 60 rewards each: every reward obeys its range,
  // and each range really is used (not everything stays in generation 1).
  const top = { early: 0, mid: 0, late: 0, open: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const rewards = trackCopies(granted(6000, { seed }));
    assert.equal(rewards.length, 60);
    for (const r of rewards) {
      assert.ok(r.dexId <= dexLimit(r.n), `reward ${r.n} was #${r.dexId}`);
      const band = r.n <= 6 ? 'early' : r.n <= 12 ? 'mid' : r.n <= 18 ? 'late' : 'open';
      top[band] = Math.max(top[band], r.dexId);
    }
  }
  assert.ok(top.early <= 151);
  assert.ok(top.mid > 151 && top.mid <= 251);
  assert.ok(top.late > 251 && top.late <= 493);
  assert.ok(top.open > 493);
});

test('the early-game limit leaves the tier odds alone', () => {
  // With no rewards yet, every roll is "reward 1" and so generation 1 only.
  const rng = seeded(2024);
  const tally = { common: 0, legendary: 0, mythical: 0 };
  const rolls = 40_000;
  for (let i = 0; i < rolls; i++) {
    const roll = rollReward({ species: dex, state: held(), rng });
    assert.ok(roll.dexId <= 151);
    tally[roll.tier]++;
  }
  assert.ok(Math.abs(tally.common / rolls - 0.94) < 0.01);
  assert.ok(Math.abs(tally.legendary / rolls - 0.05) < 0.01);
  assert.ok(Math.abs(tally.mythical / rolls - 0.01) < 0.005);
});

test('pity inside the early game still gives a legendary from the allowed range', () => {
  // 20 dry commons would not normally fit in the first 6 rewards, but a
  // hand-edited save can produce it; the forced legendary must obey the range.
  const dry = Array.from({ length: 5 }, () => ({ dexId: 16, tier: 'common' }));
  const padded = [...dry];
  while (pityDry(padded) < PITY_LIMIT) padded.unshift({ dexId: 19, tier: 'common' });
  const roll = rollReward({ species: dex, state: held(padded.slice(-5)), rng: seeded(9) });
  assert.ok(roll.dexId <= 151);
  const forced = rollReward({ species: dex, state: held(padded), rng: seeded(9) });
  assert.equal(forced.tier, 'legendary');
  assert.ok(forced.dexId <= dexLimit(padded.length + 1));
});

// ---------------------------------------------------------------- families

const bySlug = (slug) => dex.find((s) => s.slug === slug);

test('every species has an evolution family from the data, in Pokédex order', () => {
  for (const s of dex) assert.ok(Number.isInteger(s.family), `family of #${s.id}`);
  const gates = familyGates(dex);
  const gate = (slug) => (gates.has(bySlug(slug).id) ? dex[gates.get(bySlug(slug).id) - 1].slug : null);
  assert.equal(gate('weedle'), null);
  assert.equal(gate('kakuna'), 'weedle');
  assert.equal(gate('beedrill'), 'kakuna');
  // Pokédex order, not evolution order: Pikachu, then Raichu, then Pichu.
  assert.equal(gate('pikachu'), null);
  assert.equal(gate('raichu'), 'pikachu');
  assert.equal(gate('pichu'), 'raichu');
  assert.equal(gate('vaporeon'), 'eevee');
  assert.equal(gate('sylveon'), 'glaceon');
  assert.equal(gate('mewtwo'), null); // a family of one
  // Members of one family never straddle tiers, so a gate cannot strand a tier.
  for (const [id, before] of gates) assert.equal(dex[id - 1].tier, dex[before - 1].tier);
});

test('a new species can only be rolled after the family member before it', () => {
  const ids = (list) => new Set(list.map((s) => s.id));
  const pool = (owned) => ids(eligible(dex, new Map(owned.map((slug) => [bySlug(slug).id, 1])), 'common'));
  const has = (set, slug) => set.has(bySlug(slug).id);

  const fresh = pool([]);
  assert.ok(has(fresh, 'weedle') && has(fresh, 'pikachu'));
  assert.ok(!has(fresh, 'kakuna') && !has(fresh, 'beedrill'));
  assert.ok(!has(fresh, 'raichu') && !has(fresh, 'pichu'));

  const one = pool(['weedle']);
  assert.ok(has(one, 'weedle') && has(one, 'kakuna') && !has(one, 'beedrill'));

  const two = pool(['weedle', 'kakuna']);
  assert.ok(has(two, 'beedrill'));

  // Copies of a species already held are never gated: with only Beedrill
  // (from an old or hand-edited save) more Beedrill can come, and Kakuna
  // still waits for Weedle.
  const odd = pool(['beedrill']);
  assert.ok(has(odd, 'beedrill') && has(odd, 'weedle') && !has(odd, 'kakuna'));

  assert.ok(has(pool(['pikachu']), 'raichu') && !has(pool(['pikachu']), 'pichu'));
  assert.ok(has(pool(['pikachu', 'raichu']), 'pichu'));
});

test('over long runs, first copies always arrive in family order', () => {
  const gates = familyGates(dex);
  let gatedFirsts = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const starter = starterOf(STARTERS[seed % 4]);
    const rewards = trackCopies(granted(60_000, { others: [starter], seed }));
    assert.equal(rewards.length, 600);
    const have = new Set([starter.dexId]);
    for (const r of rewards) {
      if (!have.has(r.dexId) && gates.has(r.dexId)) {
        assert.ok(have.has(gates.get(r.dexId)), `#${r.dexId} arrived before #${gates.get(r.dexId)} (seed ${seed})`);
        gatedFirsts++;
      }
      have.add(r.dexId);
    }
  }
  assert.ok(gatedFirsts > 500, 'later family members do get unlocked');
});

test('shiny copies are not held back by the family rule', () => {
  // Beedrill held six times, Weedle and Kakuna never: the seventh is still rollable and shiny.
  const tiny = [13, 14, 15].map((id) => ({ ...dex[id - 1] }));
  const rewards = Array.from({ length: 6 }, () => ({ dexId: 15, tier: 'common' }));
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const roll = rollReward({ species: tiny, state: held(rewards), rng: seeded(seed) });
    seen.add(roll.dexId);
    if (roll.dexId === 15) assert.equal(roll.shiny, true);
    assert.notEqual(roll.dexId, 14);
  }
  assert.deepEqual([...seen].sort(), [13, 15]);
});

test('a species without a sprite does not block the rest of its family', () => {
  const pool = [
    { id: 13, tier: 'common', family: 5, sprite: false },
    { id: 14, tier: 'common', family: 5, sprite: true },
    { id: 15, tier: 'common', family: 5, sprite: true },
  ];
  const open = eligible(pool, new Map(), 'common').map((s) => s.id);
  assert.deepEqual(open, [14]);
});

// ---------------------------------------------------------------- starter

test('the starter unlocks at 1 point and only once', () => {
  assert.equal(starterOwed(0, null), false);
  assert.equal(starterOwed(-50, null), false);
  assert.equal(starterOwed(1, null), true);
  assert.equal(starterOwed(500, null), true);
  assert.equal(starterOwed(500, starterOf(4)), false);
  assert.deepEqual(
    STARTERS.map((id) => dex[id - 1].slug),
    ['bulbasaur', 'charmander', 'squirtle', 'pikachu'],
  );
});

test('the starter is an extra reward and does not shift the 100-point rewards', () => {
  const state = held([], [starterOf(4, 's-a')], 250);
  const added = grantOwed({ state, species: dex, rng: seeded(8) });
  assert.deepEqual(added.map((r) => r.trackPoints), [100, 200]);
  assert.deepEqual(added.map((r) => r.source), ['track', 'track']);
  const rewards = trackCopies(state);
  assert.equal(owedRewards(250, rewards.length), 0);
  assert.equal(state.pokemon.length, 3);
  assert.equal(starterCopy(state).dexId, 4);
  assert.equal(starterCopy(held()), null);
  // The starter is not a roll: it has no number on the track and never
  // touches the pity counter.
  assert.equal(starterCopy(state).n, undefined);
  assert.deepEqual(rewards.map((r) => r.n), [1, 2]);
  assert.equal(pityDry(rewards), rewards.filter((r) => r.tier !== 'legendary').length);
});

test('the starter counts as one copy towards its species cap', () => {
  const tiny = [{ id: 4, tier: 'common', sprite: true }];
  const starter = starterOf(4);
  const rewards = [];
  const rng = seeded(21);
  for (;;) {
    const roll = rollReward({ species: tiny, state: held(rewards, [starter]), rng });
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
  state.pokemon.push({ source: 'starter', dexId: 7, tier: 'common', shiny: false, at: '2026-01-01T11:10:00.000Z', sessionId: 's-a' });
  grantOwed({ state, species: dex, sessionId: 's-a', at: '2026-01-01T11:10:00.000Z', rng: seeded(11) });
  state.buddy = { dexId: trackCopies(state)[0].dexId, shiny: false };
  // What the app does on every save: bring pity and the coin totals up to date.
  return normalize(state);
}

test('export then import gives back the same state', () => {
  const state = sampleState();
  const text = exportJSON(state, T0 + 1000);
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, 'pokechad');
  assert.equal(parsed.exportedAt, new Date(T0 + 1000).toISOString());
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[1].method, 'manual');
  assert.equal(parsed.schema, SCHEMA);
  assert.deepEqual(parsed.pokemon.map((c) => c.source), ['starter', 'track']);
  assert.deepEqual(parsed.pokemon[0], { source: 'starter', dexId: 7, tier: 'common', shiny: false, at: '2026-01-01T11:10:00.000Z', sessionId: 's-a' });
  assert.deepEqual(parsed.wallet, { earned: 2, spent: 0, balance: 2 });
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
  assert.equal(state.pity.dry, pityDry(trackCopies(state)));
  // Pokémon already held are kept even though the old high-water mark is gone.
  assert.equal(state.pokemon.length, 2);
});

test('removing a session lowers the score but keeps the Pokémon', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.sessions.shift();
  const state = normalize(edited);
  assert.equal(state.score.net, -sessionPoints(30, 2));
  assert.equal(state.score.highWater, 0);
  assert.equal(state.pokemon.length, 2);
  assert.equal(owedRewards(state.score.highWater, trackCopies(state).length), 0);
});

test('import drops a running stopwatch', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.active = { kind: 'chad', startedAt: '2026-01-03T09:00:00Z', pauses: [], pausedAt: null };
  const state = importJSON(JSON.stringify(edited));
  assert.equal(state.active, null);
});

test('there is one starter: a second "starter" copy is kept as a gift', () => {
  const edited = JSON.parse(exportJSON(sampleState(), T0));
  edited.pokemon.push({ source: 'starter', dexId: 25 });
  const state = normalize(edited);
  assert.equal(starterCopy(state).dexId, 7);
  assert.equal(state.pokemon.at(-1).source, 'gift');
  assert.equal(state.wallet.earned, 2, 'the extra copy earns no coin');
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
    /Pokémon 1: "dexId"/,
  );
  assert.throws(
    () => importJSON('{"app":"pokechad","schema":2,"pokemon":[{"dexId":4}]}'),
    /Pokémon 1: "source" must be one of starter, track, shop, gift/,
  );
  assert.throws(
    () => importJSON('{"app":"pokechad","schema":2,"unlocks":[{"dexId":6}]}'),
    /Unlock 1: "form"/,
  );
  assert.throws(
    () => importJSON('{"app":"pokechad","schema":2,"grants":[{"coins":-5}]}'),
    /Grant 1: "coins"/,
  );
});

// ---------------------------------------------------------------- save format 2

test('only track copies are stations: gifts, bought copies and the starter are not', () => {
  const state = normalize({
    app: 'pokechad',
    schema: 2,
    pokemon: [
      { source: 'gift', dexId: 150, tier: 'legendary' },
      { source: 'starter', dexId: 1 },
      { source: 'track', dexId: 16, tier: 'common' },
      { source: 'shop', dexId: 16, tier: 'common', cost: 5 },
      { source: 'gift', dexId: 151, tier: 'mythical' },
      { source: 'track', dexId: 19, tier: 'common' },
    ],
    grants: [{ coins: 40 }],
  });
  const track = trackCopies(state);
  assert.deepEqual(track.map((c) => [c.n, c.trackPoints, c.dexId]), [[1, 100, 16], [2, 200, 19]]);
  for (const copy of state.pokemon) {
    if (copy.source !== 'track') assert.equal(copy.n, undefined, `${copy.source} copy has no station`);
  }
  // The gift legendary is held, but it is not a reward, so pity ignores it.
  assert.equal(state.pity.dry, 2);
  // Coins: two rewards + the starter + the grant, less the bought copy.
  assert.deepEqual(state.wallet, { earned: 43, spent: 5, balance: 38 });
  // Every copy counts towards its species, wherever it came from.
  assert.equal(countOwned(state.pokemon).get(16), 2);
});

test('gift copies leave the track where it was, and the next reward is still number 1', () => {
  const gifts = dex.slice(0, 200).map((s) => ({ source: 'gift', dexId: s.id, tier: s.tier }));
  const state = normalize({ app: 'pokechad', schema: 2, pokemon: gifts });
  assert.equal(trackCopies(state).length, 0);
  assert.equal(owedRewards(0, 0), 0);
  state.score = { net: 100, highWater: 100 };
  const [first] = grantOwed({ state, species: dex, rng: seeded(4) });
  assert.equal(first.n, 1);
  assert.equal(first.trackPoints, 100);
  assert.ok(first.dexId <= 151, 'reward 1 is still an early-game reward');
});

const V1_SAVE = {
  app: 'pokechad',
  schema: 1,
  createdAt: '2026-01-01T10:00:00.000Z',
  sessions: [
    { id: 's-a', kind: 'chad', startedAt: '2026-01-01T10:00:00.000Z', activeMinutes: 200, stars: 4 },
  ],
  starter: { dexId: 4, at: '2026-01-01T13:20:00.000Z', sessionId: 's-a' },
  rewards: [
    { n: 1, trackPoints: 100, dexId: 646, tier: 'legendary', shiny: false, pity: false, at: '2026-01-01T13:20:00.000Z', sessionId: 's-a' },
    { dexId: 37, tier: 'common', shiny: false, pity: false, form: 'alola', at: '2026-01-01T13:20:01.000Z', sessionId: 's-a' },
    { dexId: 6, tier: 'common', shiny: true, pity: true, at: '2026-01-01T13:20:02.000Z', sessionId: null },
  ],
  shop: {
    ledger: [
      { type: 'grant', coins: 1000, at: '2026-01-02T00:00:00.000Z' },
      { type: 'copy', dexId: 646, tier: 'legendary', shiny: false, cost: 20, at: '2026-01-02T00:01:00.000Z' },
      { type: 'copy', dexId: 37, tier: 'common', form: 'alola', shiny: true, cost: 5, at: '2026-01-02T00:02:00.000Z' },
      { type: 'upgrade', dexId: 6, form: 'mega-x', cost: 150, at: '2026-01-02T00:03:00.000Z' },
      { type: 'fuse', fusion: 643646000, cost: 150, at: '2026-01-02T00:04:00.000Z' },
      { type: 'unfuse', fusion: 643646000, cost: 0, at: '2026-01-02T00:05:00.000Z' },
      { type: 'fuse', fusion: 643646000, cost: 150, at: '2026-01-02T00:06:00.000Z' },
      { type: 'fuse', fusion: 644646000, cost: 150, at: '2026-01-02T00:07:00.000Z' },
    ],
  },
  buddy: { dexId: 6, shiny: true, form: 'mega-x' },
  settings: { muted: true },
};

test('a version 1 save converts with nothing lost', () => {
  const state = normalize(structuredClone(V1_SAVE));
  assert.equal(state.schema, 2);
  assert.equal(state.starter, undefined);
  assert.equal(state.rewards, undefined);
  assert.equal(state.shop, undefined);

  // The same copies, each saying where it came from.
  assert.deepEqual(
    state.pokemon.map((c) => [c.source, c.dexId, c.form || 'base', c.shiny]),
    [
      ['starter', 4, 'base', false],
      ['track', 646, 'base', false],
      ['track', 37, 'alola', false],
      ['track', 6, 'base', true],
      ['shop', 646, 'base', false],
      ['shop', 37, 'alola', true],
    ],
  );
  // The same stations on the track, in the same order.
  const track = trackCopies(state);
  assert.deepEqual(track.map((c) => [c.n, c.trackPoints]), [[1, 100], [2, 200], [3, 300]]);
  assert.deepEqual(track.map((c) => c.pity), [false, false, true]);
  assert.equal(track[0].sessionId, 's-a');
  assert.equal(state.pity.dry, 2);
  assert.deepEqual(starterCopy(state), { source: 'starter', dexId: 4, tier: 'common', shiny: false, at: '2026-01-01T13:20:00.000Z', sessionId: 's-a' });

  // Purchases keep what they cost.
  assert.deepEqual(state.pokemon.filter((c) => c.source === 'shop').map((c) => c.cost), [20, 5]);
  assert.deepEqual(state.unlocks, [{ dexId: 6, form: 'mega-x', source: 'shop', cost: 150, at: '2026-01-02T00:03:00.000Z' }]);
  assert.deepEqual(state.fusions, [
    { fusion: 643646000, cost: 150, at: '2026-01-02T00:04:00.000Z', undoneAt: '2026-01-02T00:05:00.000Z' },
    { fusion: 643646000, cost: 150, at: '2026-01-02T00:06:00.000Z', undoneAt: null },
    { fusion: 644646000, cost: 150, at: '2026-01-02T00:07:00.000Z', undoneAt: null },
  ]);
  assert.deepEqual(state.grants, [{ coins: 1000, at: '2026-01-02T00:00:00.000Z' }]);

  // The same coin balance as version 1 worked out: 3 rewards + starter +
  // grant, less 20 + 5 + 150 + 150 + 150 + 150.
  assert.deepEqual(state.wallet, { earned: 1004, spent: 625, balance: 379 });

  // Everything else is carried over untouched.
  assert.deepEqual(state.buddy, { dexId: 6, shiny: true, form: 'mega-x' });
  assert.equal(state.settings.muted, true);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.score.net, sessionPoints(200, 4));

  // Converting is stable: the converted save reads back as itself.
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))), state);
  assert.equal(upgradeFromV1(structuredClone(V1_SAVE)).schema, 2);
});

test('a version 1 save with no starter, shop or rewards converts to an empty collection', () => {
  const state = normalize({ app: 'pokechad', schema: 1 });
  assert.deepEqual([state.pokemon, state.unlocks, state.fusions, state.grants], [[], [], [], []]);
  assert.deepEqual(state.wallet, { earned: 0, spent: 0, balance: 0 });
  // An unusable starter was dropped in version 1, and still is.
  assert.equal(starterCopy(normalize({ app: 'pokechad', schema: 1, starter: { dexId: 'pikachu' } })), null);
});

test('loading a version 1 save keeps its original text, once', () => {
  const storage = memoryStorage();
  const original = JSON.stringify(V1_SAVE);
  storage.setItem(STORAGE_KEY, original);
  const loaded = load(storage);
  assert.equal(loaded.problem, null);
  assert.equal(loaded.state.schema, 2);
  assert.equal(storage.map.get(BEFORE_V2_KEY), original);

  // Saving writes version 2 under the same key; the spare copy is not touched again.
  save(loaded.state, storage);
  assert.equal(JSON.parse(storage.map.get(STORAGE_KEY)).schema, 2);
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...V1_SAVE, rewards: [] }));
  load(storage);
  assert.equal(storage.map.get(BEFORE_V2_KEY), original);

  // A version 2 save leaves no spare copy behind.
  const fresh = memoryStorage();
  save(defaultState(T0), fresh);
  load(fresh);
  assert.equal(fresh.map.has(BEFORE_V2_KEY), false);
});

test('saving brings the stored coin totals up to date', () => {
  const storage = memoryStorage();
  const state = sampleState();
  state.grants.push({ coins: 10, at: '2026-01-03T00:00:00.000Z' });
  save(state, storage);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).wallet, { earned: 12, spent: 0, balance: 12 });
});

// ---------------------------------------------------------------- reminders

test('a reminder is due every 45 minutes of active time', () => {
  let a = sw.start('chad', T0);
  assert.equal(a.remindersSent, 0);
  assert.equal(sw.reminderStatus(a, T0 + 44.9 * MIN).due, false);
  const first = sw.reminderStatus(a, T0 + 45 * MIN);
  assert.deepEqual(first, { due: true, count: 1, minutes: 45 });
  a = { ...a, remindersSent: first.count };
  assert.equal(sw.reminderStatus(a, T0 + 60 * MIN).due, false);
  assert.deepEqual(sw.reminderStatus(a, T0 + 90 * MIN), { due: true, count: 2, minutes: 90 });
});

test('breaks do not count towards a reminder, and none arrives during one', () => {
  let a = sw.pause(sw.start('chad', T0), T0 + 40 * MIN);
  // 30 minutes into a break: still only 40 active minutes.
  assert.equal(sw.reminderStatus(a, T0 + 70 * MIN).due, false);
  a = sw.resume(a, T0 + 70 * MIN);
  assert.equal(sw.reminderStatus(a, T0 + 74 * MIN).due, false);
  assert.equal(sw.reminderStatus(a, T0 + 75 * MIN).due, true);
  // Paused exactly on the mark: it waits until the stopwatch runs again.
  const onMark = sw.pause(sw.start('chud', T0), T0 + 45 * MIN);
  assert.equal(sw.reminderStatus(onMark, T0 + 50 * MIN).due, false);
  assert.equal(sw.reminderStatus(sw.resume(onMark, T0 + 50 * MIN), T0 + 50 * MIN).due, true);
});

test('after a long sleep there is one reminder, not one per missed mark', () => {
  const a = sw.start('chad', T0);
  const late = sw.reminderStatus(a, T0 + 200 * MIN); // marks at 45, 90, 135, 180
  assert.deepEqual(late, { due: true, count: 4, minutes: 180 });
  assert.equal(sw.reminderStatus({ ...a, remindersSent: late.count }, T0 + 201 * MIN).due, false);
});

test('the reminder count survives a save and a reload', () => {
  const state = defaultState(T0);
  state.active = { ...sw.start('chad', T0), remindersSent: 2 };
  assert.equal(normalize(JSON.parse(JSON.stringify(state))).active.remindersSent, 2);
  // An older save has no count: it starts from none.
  delete state.active.remindersSent;
  assert.equal(normalize(JSON.parse(JSON.stringify(state))).active.remindersSent, 0);
});

// ---------------------------------------------------------------- messages

const formsData = JSON.parse(readFileSync(new URL('../data/forms.json', import.meta.url), 'utf8'));
const TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];
const speaker = (slug) => {
  const s = dex.find((x) => x.slug === slug);
  return { name: s.name, slug: s.slug, types: s.types };
};

test('every species and every form carries its types', () => {
  for (const s of dex) {
    assert.ok(Array.isArray(s.types) && s.types.length >= 1 && s.types.length <= 2, `types of #${s.id}`);
    for (const t of s.types) assert.ok(TYPES.includes(t), `#${s.id} has unknown type ${t}`);
  }
  assert.deepEqual(dex.find((s) => s.slug === 'charizard').types, ['fire', 'flying']);
  assert.deepEqual(dex.find((s) => s.slug === 'pikachu').types, ['electric']);
  for (const entry of [...formsData.forms, ...formsData.fusions]) {
    assert.ok(Array.isArray(entry.types) && entry.types.length >= 1, `types of ${entry.name}`);
  }
  // A form's types are its own.
  assert.deepEqual(formsData.forms.find((f) => f.name === 'vulpix-alola').types, ['ice']);
  assert.deepEqual(formsData.forms.find((f) => f.name === 'charizard-mega-x').types, ['fire', 'dragon']);
});

test('a copy in an alternate form speaks with the form\'s types', () => {
  const ctx = { dex: { byId: new Map(dex.map((s) => [s.id, s])) }, forms: indexForms(formsData) };
  const vulpix = dex.find((s) => s.slug === 'vulpix');
  assert.deepEqual(resolveMon(ctx, { dexId: vulpix.id }).types, ['fire']);
  const alolan = resolveMon(ctx, { dexId: vulpix.id, form: 'alola' });
  assert.deepEqual(alolan.types, ['ice']);
  assert.equal(alolan.name, 'Alolan Vulpix');
  assert.deepEqual(resolveMon(ctx, { fusion: 643646000 }).types, ['dragon', 'ice']);
  const pools = linePools('chad', 'reminder', { name: alolan.name, slug: alolan.species.slug, types: alolan.types });
  assert.ok(pools.type.includes('Ice cold focus. Alolan Vulpix respects it.'));
  assert.ok(!pools.type.some((line) => line.includes('on fire')));
});

test('the message pools are complete and refer only to things that exist', () => {
  // Every type in the data has lines for both kinds, and no type is made up.
  assert.deepEqual(Object.keys(BY_TYPE).sort(), TYPES.slice().sort());
  for (const [type, pool] of Object.entries(BY_TYPE)) {
    assert.ok(pool.chad.length >= 3, `${type} chad lines`);
    assert.ok(pool.chud.length >= 2, `${type} chud lines`);
    for (const line of [...pool.chad, ...pool.chud]) assert.ok(line.includes('{name}'), `${type}: ${line}`);
  }
  // Easter eggs are keyed by a real species.
  const bySlug = new Map(dex.map((s) => [s.slug, s]));
  assert.ok(Object.keys(BY_POKEMON).length >= 40);
  for (const [slug, pool] of Object.entries(BY_POKEMON)) {
    assert.ok(bySlug.has(slug), `${slug} is not a species in data/pokedex.json`);
    assert.deepEqual(Object.keys(pool).filter((k) => k !== 'chad' && k !== 'chud'), []);
    const lines = [...(pool.chad || []), ...(pool.chud || [])];
    assert.ok(lines.length >= 1, `${slug} has no lines`);
    // They speak in the Pokémon's own voice, so there is no name to fill in.
    for (const line of lines) assert.ok(!line.includes('{name}'), `${slug}: ${line}`);
  }
  for (const kind of ['chad', 'chud']) {
    for (const moment of ['start', 'reminder']) {
      assert.ok(GENERAL[kind][moment].length >= 8, `general ${kind} ${moment}`);
      assert.ok(NO_POKEMON[kind][moment].length >= 2);
      for (const line of NO_POKEMON[kind][moment]) assert.ok(!line.includes('{name}'));
    }
  }
  // No line is in two places, and none is too long for a notification.
  const all = [
    ...Object.values(GENERAL).flatMap((k) => [...k.start, ...k.reminder]),
    ...Object.values(NO_POKEMON).flatMap((k) => [...k.start, ...k.reminder]),
    ...Object.values(BY_TYPE).flatMap((k) => [...k.chad, ...k.chud]),
    ...Object.values(BY_POKEMON).flatMap((k) => [...(k.chad || []), ...(k.chud || [])]),
  ];
  assert.equal(new Set(all).size, all.length, 'a line is repeated');
  for (const line of all) assert.ok(line.length <= 90, `too long: ${line}`);
  assert.ok(GENERAL.chad.start.some((line) => line.startsWith("Let's do this!")));
});

test('a Pokémon with its own lines uses them half the time; the rest is type and general', () => {
  assert.equal(OWN_SHARE, 0.5);
  assert.equal(TYPE_SHARE, 0.5);
  const charizard = speaker('charizard');
  const pools = linePools('chad', 'reminder', charizard);
  assert.equal(pools.own.length, 2);
  assert.equal(pools.type.length, BY_TYPE.fire.chad.length + BY_TYPE.flying.chad.length, 'a dual type draws from both');
  assert.ok(pools.general.every((line) => !line.includes('{name}')));

  const rng = seeded(77);
  const tally = { own: 0, type: 0, general: 0 };
  const seen = new Set();
  const tries = 20_000;
  for (let i = 0; i < tries; i++) {
    const line = pickLine({ kind: 'chad', moment: 'reminder', mon: charizard, rng });
    seen.add(line);
    tally[pools.own.includes(line) ? 'own' : pools.type.includes(line) ? 'type' : 'general']++;
  }
  assert.ok(Math.abs(tally.own / tries - 0.5) < 0.02, JSON.stringify(tally));
  assert.ok(Math.abs(tally.type / tries - 0.25) < 0.02, JSON.stringify(tally));
  assert.ok(Math.abs(tally.general / tries - 0.25) < 0.02, JSON.stringify(tally));
  // Everything on offer does come up, fire and flying alike.
  assert.equal(seen.size, pools.own.length + pools.type.length + pools.general.length);
  assert.ok(seen.has('You are on fire! Charizard approves.'));
  assert.ok(seen.has('Charizard used Tailwind! Everything is faster.'));
  assert.ok(seen.has('Charizard only listens to trainers this focused.'));

  // A Pokémon with no lines of its own: type and general, half each.
  const pidgey = speaker('pidgey');
  const plain = linePools('chud', 'start', pidgey);
  assert.deepEqual(plain.own, []);
  let typed = 0;
  for (let i = 0; i < tries; i++) {
    if (plain.type.includes(pickLine({ kind: 'chud', moment: 'start', mon: pidgey, rng }))) typed++;
  }
  assert.ok(Math.abs(typed / tries - 0.5) < 0.02, `${typed} type lines`);
});

test('where a roll lands decides the pool', () => {
  const pikachu = speaker('pikachu');
  const pools = linePools('chad', 'start', pikachu);
  const line = (roll) => pickLine({ kind: 'chad', moment: 'start', mon: pikachu, rng: scriptedRng(roll, 0) });
  assert.equal(line(0), pools.own[0]);
  assert.equal(line(0.49), pools.own[0]);
  assert.equal(line(0.5), pools.type[0]);
  assert.equal(line(0.74), pools.type[0]);
  assert.equal(line(0.75), pools.general[0]);
  assert.equal(pools.general[0], "Let's do this! Pikachu is with you.");
  // A chud-only Pokémon has nothing of its own to say during chad time.
  const shuckle = speaker('shuckle');
  assert.deepEqual(linePools('chad', 'reminder', shuckle).own, []);
  assert.equal(linePools('chud', 'reminder', shuckle).own.length, 1);
  // A type nobody has written lines for yet falls back to the general pool.
  const future = { name: 'Newmon', slug: 'newmon', types: ['sound'] };
  assert.equal(
    pickLine({ kind: 'chad', moment: 'reminder', mon: future, rng: scriptedRng(0, 0) }),
    GENERAL.chad.reminder[0].replace('{name}', 'Newmon'),
  );
});

/** An rng that returns the given numbers in turn, then keeps returning the last. */
function scriptedRng(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('the same line is never shown twice in a row', () => {
  for (const slug of ['charizard', 'pidgey', 'shuckle', 'snorlax']) {
    for (const kind of ['chad', 'chud']) {
      const rng = seeded(5);
      let last = null;
      for (let i = 0; i < 3000; i++) {
        const line = pickLine({ kind, moment: 'reminder', mon: speaker(slug), last, rng });
        assert.notEqual(line, last, `${slug} ${kind}`);
        last = line;
      }
    }
  }
  // Shuckle has a single chud line of its own: asked to repeat it, it
  // says something general instead.
  const own = linePools('chud', 'reminder', speaker('shuckle')).own[0];
  const next = pickLine({ kind: 'chud', moment: 'reminder', mon: speaker('shuckle'), last: own, rng: scriptedRng(0, 0) });
  assert.equal(next, GENERAL.chud.reminder[0].replace('{name}', 'Shuckle'));
  // With no Pokémon there are still two lines to alternate between.
  const none = pickLine({ kind: 'chud', moment: 'start', mon: null, rng: () => 0 });
  assert.notEqual(pickLine({ kind: 'chud', moment: 'start', mon: null, last: none, rng: () => 0 }), none);
});

test('start and reminder messages: titles, tone, and no Pokémon yet', () => {
  assert.deepEqual([45, 60, 90, 135, 180].map(spokenTime), ['45M', '1H', '1H 30M', '2H 15M', '3H']);
  const pidgey = speaker('pidgey');
  const start = startText('chad', pidgey, { rng: scriptedRng(0.9, 0) });
  assert.deepEqual(start, { title: 'Chad time started', body: "Let's do this! Pidgey is with you." });
  const chudStart = startText('chud', pidgey, { rng: scriptedRng(0.9, 0) });
  assert.deepEqual(chudStart, { title: 'Chud time started', body: 'Really? Pidgey expected better.' });
  const chad = reminderText('chad', 90, pidgey, { rng: scriptedRng(0.9, 0) });
  assert.deepEqual(chad, { title: '1H 30M of chad time', body: 'Pidgey is cheering you on. Keep going!' });
  const chud = reminderText('chud', 45, pidgey, { rng: scriptedRng(0.9, 0) });
  assert.deepEqual(chud, { title: '45M of chud time', body: 'Pidgey is disappointed. Still here?' });
  // The name is filled in everywhere; nothing is left as a placeholder.
  for (const slug of ['charizard', 'snorlax', 'pidgey', 'zacian']) {
    for (const kind of ['chad', 'chud']) {
      for (const moment of ['start', 'reminder']) {
        const pools = linePools(kind, moment, speaker(slug));
        for (const line of [...pools.own, ...pools.type, ...pools.general]) assert.ok(!line.includes('{'), line);
      }
    }
  }
  // With no Pokémon yet there is still something to say, at both moments.
  for (const kind of ['chad', 'chud']) {
    assert.ok(NO_POKEMON[kind].start.includes(startText(kind, null).body));
    assert.ok(NO_POKEMON[kind].reminder.includes(reminderText(kind, 45, null).body));
  }
});

test('the Pokémon in a message is picked by species, not by copy', () => {
  assert.equal(pickReminderCopy([], seeded(1)), null);
  const copies = [{ dexId: 1 }, { dexId: 4 }, { dexId: 7 }];
  assert.equal(pickReminderCopy(copies, () => 0).dexId, 1);
  assert.equal(pickReminderCopy(copies, () => 0.999).dexId, 7);
  // 100 Zygarde and one Pidgey: each species half the time.
  const crowd = [...Array.from({ length: 100 }, () => ({ dexId: 718 })), { dexId: 16 }];
  const rng = seeded(9);
  let pidgey = 0;
  for (let i = 0; i < 4000; i++) if (pickReminderCopy(crowd, rng).dexId === 16) pidgey++;
  assert.ok(Math.abs(pidgey / 4000 - 0.5) < 0.04, `${pidgey} of 4000`);
  // Within a species any copy can come up, so its forms are seen too.
  const rotom = [{ dexId: 479 }, { dexId: 479, form: 'heat' }, { dexId: 479, form: 'wash' }];
  const forms = new Set();
  for (let i = 0; i < 200; i++) forms.add(pickReminderCopy(rotom, rng).form || 'base');
  assert.deepEqual([...forms].sort(), ['base', 'heat', 'wash']);
});
