import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TIERS,
  rollReward,
  grantOwed,
  countOwned,
  eligible,
  BONUS_FORM_CHANCE,
  bonusCandidates,
  rollBonusForm,
} from '../js/rewards.js';
import { BASE, indexForms, formsOf, variantsOf, findForm, formLabel, displayName, nextForm, NO_FORMS } from '../js/forms.js';
import {
  PRICES,
  COLLECTOR,
  coinsEarned,
  coinsSpent,
  balance,
  copiesOf,
  hasShiny,
  isCollector,
  activeFusions,
  fusedCopies,
  spareCopies,
  unlockedForms,
  copyOffer,
  buyCopy,
  upgradeOffer,
  buyUpgrade,
  fusionOffer,
  fuse,
  unfuseOffer,
  unfuse,
  trackCopies,
  starterCopy,
  activity,
} from '../js/shop.js';
import { defaultState, normalize, exportJSON, importJSON } from '../js/state.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dex = read('../data/pokedex.json').species;
const formsData = read('../data/forms.json');
const forms = indexForms(formsData);
const mon = (slug) => dex.find((s) => s.slug === slug);

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A save holding the given copies; each is one reward on the track, so also one coin. */
function saveWith(holdings = {}, extraCoins = 0) {
  const state = defaultState(Date.parse('2026-01-01T00:00:00Z'));
  const add = (species, form) => {
    const reward = { source: 'track', dexId: species.id, tier: species.tier, shiny: false, pity: false, at: '2026-01-01T00:00:00.000Z' };
    if (form) reward.form = form;
    state.pokemon.push(reward);
  };
  for (const [slug, count] of Object.entries(holdings)) {
    for (let i = 0; i < count; i++) add(mon(slug));
  }
  // Coins come from rewards, so pad with a species the tests do not look at.
  for (let i = 0; i < extraCoins; i++) add(mon('caterpie'));
  return state;
}

// ---------------------------------------------------------------- the data

test('forms.json is well formed', () => {
  const ids = new Set(dex.map((s) => s.id));
  for (const [speciesId, list] of forms.bySpecies) {
    assert.ok(ids.has(speciesId));
    assert.equal(new Set(list.map((f) => f.key)).size, list.length, `unique keys for #${speciesId}`);
    assert.equal(new Set(list.map((f) => f.label)).size, list.length, `unique labels for #${speciesId}`);
    for (const f of list) {
      assert.ok(['variant', 'upgrade', 'milestone'].includes(f.kind));
      assert.ok(f.pid >= 10000 && f.key && f.key !== BASE && f.label);
      if (f.requires && f.requires.form) {
        assert.ok(list.some((o) => o.key === f.requires.form), `${f.name} requires an existing form`);
      }
    }
  }
  assert.equal(formsData.counts.fusion, 6);
  assert.ok(formsData.counts.upgrade > 100 && formsData.counts.variant > 100);
});

test('the forms named in the design are classified as intended', () => {
  const kinds = (slug) => Object.fromEntries(formsOf(forms, mon(slug).id).map((f) => [f.label, f.kind]));
  assert.deepEqual(kinds('charizard'), { 'Mega X': 'upgrade', 'Mega Y': 'upgrade', Gigantamax: 'upgrade' });
  assert.deepEqual(kinds('gengar'), { Mega: 'upgrade', Gigantamax: 'upgrade' });
  assert.equal(kinds('kyogre').Primal, 'upgrade');
  assert.equal(kinds('zacian').Crowned, 'upgrade');
  assert.equal(kinds('wishiwashi').School, 'upgrade');
  assert.equal(kinds('palafin').Hero, 'upgrade');
  assert.equal(kinds('hoopa').Unbound, 'upgrade');
  assert.equal(kinds('eternatus').Eternamax, 'upgrade');
  assert.equal(kinds('vulpix').Alolan, 'variant');
  assert.equal(kinds('giratina').Origin, 'variant');
  assert.equal(kinds('tornadus').Therian, 'variant');
  assert.deepEqual(variantsOf(forms, mon('rotom').id).map((f) => f.label), ['Heat', 'Wash', 'Frost', 'Fan', 'Mow']);
  assert.deepEqual(variantsOf(forms, mon('deoxys').id).map((f) => f.label), ['Attack', 'Defense', 'Speed']);
  // Pikachu's caps and cosplay outfits are left out; only Gigantamax remains.
  assert.deepEqual(Object.keys(kinds('pikachu')), ['Gigantamax']);
  assert.deepEqual(kinds('zygarde'), { Complete: 'milestone', '10%': 'milestone', Mega: 'upgrade' });
});

test('fusion numbers are 1,000,000 * y + 1,000 * x, x alphabetically first', () => {
  const expected = {
    'White Kyurem': ['kyurem', 'reshiram'],
    'Black Kyurem': ['kyurem', 'zekrom'],
    'Dusk Mane Necrozma': ['necrozma', 'solgaleo'],
    'Dawn Wings Necrozma': ['necrozma', 'lunala'],
    'Ice Rider Calyrex': ['calyrex', 'glastrier'],
    'Shadow Rider Calyrex': ['calyrex', 'spectrier'],
  };
  assert.equal(forms.fusions.length, 6);
  for (const fusion of forms.fusions) {
    const [base, partner] = expected[fusion.label].map(mon);
    assert.equal(fusion.base, base.id);
    assert.equal(fusion.partner, partner.id);
    const [x, y] = [base, partner].sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(fusion.id, 1_000_000 * y.id + 1_000 * x.id, fusion.label);
  }
  // Kyurem (646) comes before Reshiram (643) alphabetically.
  assert.equal(forms.fusions.find((f) => f.label === 'White Kyurem').id, 643_646_000);
  // Lunala (792) comes before Necrozma (800).
  assert.equal(forms.fusions.find((f) => f.label === 'Dawn Wings Necrozma').id, 800_792_000);
});

test('display names read naturally', () => {
  const name = (slug, key) => displayName(mon(slug).name, findForm(forms, mon(slug).id, key));
  assert.equal(name('charizard', 'mega-x'), 'Mega Charizard X');
  assert.equal(name('gengar', 'mega'), 'Mega Gengar');
  assert.equal(name('gengar', 'gmax'), 'Gigantamax Gengar');
  assert.equal(name('vulpix', 'alola'), 'Alolan Vulpix');
  assert.equal(name('tatsugiri', 'droopy-mega'), 'Droopy Mega Tatsugiri');
  assert.equal(name('vulpix', BASE), 'Vulpix');
  assert.equal(formLabel(forms, mon('vulpix').id, undefined), 'Base');
  assert.equal(formLabel(forms, mon('charizard').id, 'mega-y'), 'Mega Y');
});

// ---------------------------------------------------------------- coins

test('one coin per reward on the track, starter included', () => {
  const state = saveWith({ pidgey: 3 });
  assert.equal(coinsEarned(state), 3);
  state.pokemon.push({ source: 'starter', dexId: 4, tier: 'common', shiny: false, at: '2026-01-01T00:00:00.000Z', sessionId: null });
  assert.equal(coinsEarned(state), 4);
  // A gift is held but earns nothing.
  state.pokemon.push({ source: 'gift', dexId: 25, tier: 'common', shiny: false, at: '2026-01-01T00:00:00.000Z' });
  assert.equal(coinsEarned(state), 4);
  assert.equal(coinsSpent(state), 0);
  assert.equal(balance(state), 4);
});

test('bought copies cost coins but earn none and do not move the track', () => {
  const state = saveWith({ pidgey: 1 }, 9);
  assert.equal(balance(state), 10);
  const copy = buyCopy(state, forms, mon('pidgey'));
  assert.equal(copy.source, 'shop');
  assert.equal(copy.cost, 5);
  assert.equal(state.pokemon.at(-1), copy);
  assert.equal(trackCopies(state).length, 10, 'no reward was added');
  assert.equal(coinsEarned(state), 10);
  assert.equal(balance(state), 5);
  assert.equal(copiesOf(state, mon('pidgey').id).length, 2);
});

// ---------------------------------------------------------------- copies

test('only Pokémon already found can be bought, at the tier price', () => {
  const state = saveWith({ pidgey: 1, mewtwo: 1, mew: 1 }, 200);
  assert.deepEqual(copyOffer(state, forms, mon('rattata')), { ok: false, price: 5, reason: 'NOT FOUND YET' });
  assert.deepEqual(copyOffer(state, forms, mon('pidgey')), { ok: true, price: 5, reason: '' });
  assert.equal(copyOffer(state, forms, mon('mewtwo')).price, 20);
  assert.equal(copyOffer(state, forms, mon('mew')).price, 120);
  assert.deepEqual(PRICES.copy, { common: 5, legendary: 20, mythical: 120 });
  assert.throws(() => buyCopy(state, forms, mon('rattata')), /NOT FOUND YET/);
});

test('a purchase is refused when it would overdraw', () => {
  const state = saveWith({ pidgey: 1 }, 3); // 4 coins
  assert.equal(copyOffer(state, forms, mon('pidgey')).reason, 'NOT ENOUGH COINS');
  assert.throws(() => buyCopy(state, forms, mon('pidgey')), /NOT ENOUGH COINS/);
  assert.equal(balance(state), 4);
});

test('the copy that reaches 7 / 5 / 2 is the shiny, bought or rolled', () => {
  const state = saveWith({ pidgey: 5, mewtwo: 3, mew: 1 }, 400);
  assert.equal(buyCopy(state, forms, mon('pidgey')).shiny, false); // 6th
  assert.equal(buyCopy(state, forms, mon('pidgey')).shiny, true); // 7th
  assert.equal(hasShiny(state, mon('pidgey').id), true);
  assert.equal(buyCopy(state, forms, mon('mewtwo')).shiny, false); // 4th
  assert.equal(buyCopy(state, forms, mon('mewtwo')).shiny, true); // 5th
  assert.equal(buyCopy(state, forms, mon('mew')).shiny, true); // 2nd
});

test('commons and legendaries can be bought past the limit; the extras are plain', () => {
  const state = saveWith({ pidgey: 7, mewtwo: 5 }, 400);
  for (let i = 0; i < 3; i++) {
    assert.equal(copyOffer(state, forms, mon('pidgey')).ok, true);
    assert.equal(buyCopy(state, forms, mon('pidgey')).shiny, false);
    assert.equal(buyCopy(state, forms, mon('mewtwo')).shiny, false);
  }
  assert.equal(copiesOf(state, mon('pidgey').id).length, 10);
  assert.equal(copiesOf(state, mon('mewtwo').id).length, 8);
});

test('rolls still stop at the limit, counting bought copies', () => {
  const state = saveWith({ pidgey: 5 }, 100);
  buyCopy(state, forms, mon('pidgey'));
  buyCopy(state, forms, mon('pidgey'));
  const counts = countOwned(state.pokemon);
  assert.equal(counts.get(mon('pidgey').id), 7);
  assert.ok(!eligible(dex, counts, 'common').some((s) => s.id === mon('pidgey').id));
  // With only Pidgey in the pool, nothing is left to roll.
  const only = [mon('pidgey')];
  assert.equal(rollReward({ species: only, state, forms, rng: seeded(1) }), null);
});

test('mythicals stop at 2, except while formes are still missing (Deoxys reaches 4)', () => {
  const state = saveWith({ mew: 2, deoxys: 1 }, 1000);
  assert.equal(copyOffer(state, forms, mon('mew')).reason, 'COPY LIMIT REACHED');
  const got = [];
  for (let i = 0; i < 3; i++) got.push(buyCopy(state, forms, mon('deoxys')));
  assert.deepEqual(got.map((e) => e.form), ['attack', 'defense', 'speed']);
  assert.deepEqual(got.map((e) => e.shiny), [true, false, false], 'the 2nd copy is the shiny');
  assert.equal(copiesOf(state, mon('deoxys').id).length, 4);
  assert.equal(copyOffer(state, forms, mon('deoxys')).reason, 'COPY LIMIT REACHED');
  // A mythical with one alternate form gets it on its 2nd copy and then stops.
  const shaymin = saveWith({ shaymin: 1 }, 500);
  assert.equal(buyCopy(shaymin, forms, mon('shaymin')).form, 'sky');
  assert.equal(copyOffer(shaymin, forms, mon('shaymin')).reason, 'COPY LIMIT REACHED');
});

// ---------------------------------------------------------------- form order

test('forms unlock one per copy in Pokédex order, then at random', () => {
  const rotom = mon('rotom');
  const state = saveWith({ rotom: 1 }, 400);
  const order = [];
  for (let i = 0; i < 5; i++) order.push(buyCopy(state, forms, rotom, { rng: seeded(i + 1) }).form);
  assert.deepEqual(order, ['heat', 'wash', 'frost', 'fan', 'mow']);
  assert.deepEqual([...unlockedForms(state, forms, rotom.id)].sort(), ['base', 'fan', 'frost', 'heat', 'mow', 'wash']);
  // Every form is now held: further copies are random across all six.
  const tally = {};
  const rng = seeded(7);
  for (let i = 0; i < 6000; i++) {
    const form = nextForm(forms, rotom.id, ['base', 'heat', 'wash', 'frost', 'fan', 'mow'], rng);
    tally[form] = (tally[form] || 0) + 1;
  }
  assert.deepEqual(Object.keys(tally).sort(), ['base', 'fan', 'frost', 'heat', 'mow', 'wash']);
  for (const count of Object.values(tally)) assert.ok(Math.abs(count - 1000) < 150, 'roughly equal shares');
});

test('rolled copies follow the same order as bought ones', () => {
  // Start past the early game (18 rewards), where Rotom (#479) can be rolled.
  const pool = [mon('rotom')];
  const state = saveWith({}, 18);
  for (let i = 0; i < 6; i++) {
    const roll = rollReward({ species: pool, state, forms, rng: seeded(i + 3) });
    state.pokemon.push({ source: 'track', dexId: roll.dexId, tier: roll.tier, shiny: roll.shiny, form: roll.form });
  }
  assert.deepEqual(state.pokemon.slice(18).map((r) => r.form), ['base', 'heat', 'wash', 'frost', 'fan', 'mow']);
  // grantOwed writes the form down only when it is not Base.
  const fresh = saveWith();
  fresh.score = { net: 300, highWater: 300 };
  const granted = grantOwed({ state: fresh, species: [mon('vulpix')], forms, rng: seeded(5) });
  assert.equal(granted[0].form, undefined);
  assert.equal(granted[1].form, 'alola');
  assert.ok([undefined, 'alola'].includes(granted[2].form));
});

test('a mix of rolled and bought copies shares one order', () => {
  const state = saveWith({ rotom: 1 }, 100);
  state.pokemon.push({ source: 'track', dexId: mon('rotom').id, tier: 'common', shiny: false, form: 'heat' });
  assert.equal(buyCopy(state, forms, mon('rotom')).form, 'wash');
  // A gift copy takes its place in the same order.
  state.pokemon.push({ source: 'gift', dexId: mon('rotom').id, tier: 'common', shiny: false, form: 'frost' });
  const roll = rollReward({ species: [mon('rotom')], state, forms, rng: seeded(2) });
  assert.equal(roll.form, 'fan');
});

test('a species with no alternate forms is always Base and uses no randomness', () => {
  const never = () => {
    throw new Error('rng should not be called');
  };
  assert.equal(nextForm(forms, mon('pidgey').id, ['base', 'base'], never), BASE);
  assert.equal(nextForm(forms, mon('rotom').id, [], never), BASE);
  assert.equal(nextForm(NO_FORMS, mon('rotom').id, ['base'], never), BASE);
  assert.equal(nextForm(forms, mon('vulpix').id, ['base'], never), 'alola');
});

// ---------------------------------------------------------------- upgrades

test('an upgrade costs 150, needs the Pokémon, and is bought once', () => {
  const charizard = mon('charizard');
  const megaX = findForm(forms, charizard.id, 'mega-x');
  const megaY = findForm(forms, charizard.id, 'mega-y');
  const none = saveWith({}, 400);
  assert.equal(upgradeOffer(none, forms, charizard, megaX).reason, 'NOT FOUND YET');

  const state = saveWith({ charizard: 1 }, 320);
  assert.deepEqual(upgradeOffer(state, forms, charizard, megaX), { ok: true, owned: false, price: 150, reason: '' });
  const bought = buyUpgrade(state, forms, charizard, megaX);
  assert.deepEqual(state.unlocks, [bought]);
  assert.deepEqual({ ...bought, at: null }, { dexId: charizard.id, form: 'mega-x', source: 'shop', cost: 150, at: null });
  assert.equal(balance(state), 321 - 150);
  assert.equal(upgradeOffer(state, forms, charizard, megaX).owned, true);
  assert.throws(() => buyUpgrade(state, forms, charizard, megaX), /ALREADY UNLOCKED/);
  // Several upgrades on one Pokémon are separate purchases.
  buyUpgrade(state, forms, charizard, megaY);
  assert.deepEqual([...unlockedForms(state, forms, charizard.id)].sort(), ['base', 'mega-x', 'mega-y']);
  const gmax = findForm(forms, charizard.id, 'gmax');
  assert.equal(upgradeOffer(state, forms, charizard, gmax).reason, 'NOT ENOUGH COINS');
});

test('an upgrade that belongs to an alternate form needs that form first', () => {
  const darmanitan = mon('darmanitan');
  const galarZen = findForm(forms, darmanitan.id, 'galar-zen');
  const zen = findForm(forms, darmanitan.id, 'zen');
  const state = saveWith({ darmanitan: 1 }, 400);
  assert.equal(upgradeOffer(state, forms, darmanitan, zen).ok, true);
  assert.equal(upgradeOffer(state, forms, darmanitan, galarZen).reason, 'NEEDS GALARIAN FIRST');
  assert.equal(buyCopy(state, forms, darmanitan).form, 'galar-standard');
  assert.equal(upgradeOffer(state, forms, darmanitan, galarZen).ok, true);
});

test('Ultra Necrozma needs a Necrozma fusion to exist', () => {
  const necrozma = mon('necrozma');
  const ultra = findForm(forms, necrozma.id, 'ultra');
  const state = saveWith({ necrozma: 2, solgaleo: 2 }, 400);
  assert.equal(upgradeOffer(state, forms, necrozma, ultra).reason, 'NEEDS A FUSION FIRST');
  fuse(state, forms, forms.fusions.find((f) => f.label === 'Dusk Mane Necrozma'));
  assert.equal(upgradeOffer(state, forms, necrozma, ultra).ok, true);
});

test('forms of a Pokémon are shiny as soon as its shiny is held, even afterwards', () => {
  const state = saveWith({ gengar: 6 }, 400);
  const gengar = mon('gengar');
  buyUpgrade(state, forms, gengar, findForm(forms, gengar.id, 'mega'));
  assert.equal(hasShiny(state, gengar.id), false);
  buyCopy(state, forms, gengar); // the 7th: shiny
  assert.equal(hasShiny(state, gengar.id), true);
  // Nothing is stored per form; an upgrade bought later is covered too.
  buyUpgrade(state, forms, gengar, findForm(forms, gengar.id, 'gmax'));
  assert.ok(unlockedForms(state, forms, gengar.id).has('gmax'));
  assert.equal(hasShiny(state, gengar.id), true);
});

// ---------------------------------------------------------------- fusions

test('a fusion needs both Pokémon with 2 spare copies each, and 150 coins', () => {
  const white = forms.fusions.find((f) => f.label === 'White Kyurem');
  assert.equal(fusionOffer(saveWith({ kyurem: 2 }, 400), forms, white).reason, 'FIND BOTH POKéMON FIRST');
  assert.equal(fusionOffer(saveWith({ kyurem: 2, reshiram: 1 }, 400), forms, white).reason, 'NEEDS 2 SPARE COPIES OF EACH');
  assert.equal(fusionOffer(saveWith({ kyurem: 2, reshiram: 2 }, 100), forms, white).reason, 'NOT ENOUGH COINS');
  const ready = fusionOffer(saveWith({ kyurem: 2, reshiram: 2 }, 400), forms, white);
  assert.equal(ready.ok, true);
  assert.equal(ready.price, 150);
  assert.deepEqual(ready.spare, { base: 2, partner: 2 });
});

test('fusing sets one copy of each aside; unfusing returns them but never the coins', () => {
  const white = forms.fusions.find((f) => f.label === 'White Kyurem');
  const black = forms.fusions.find((f) => f.label === 'Black Kyurem');
  const kyurem = mon('kyurem');
  const state = saveWith({ kyurem: 3, reshiram: 2, zekrom: 2 }, 500);
  const before = balance(state);

  fuse(state, forms, white);
  assert.equal(balance(state), before - 150);
  assert.ok(activeFusions(state).has(white.id));
  assert.equal(fusedCopies(state, forms, kyurem.id), 1);
  assert.equal(spareCopies(state, forms, kyurem.id), 2);
  assert.equal(copiesOf(state, kyurem.id).length, 3, 'the copy still counts towards the total');
  assert.equal(fusionOffer(state, forms, white).active, true);
  assert.throws(() => fuse(state, forms, white), /ALREADY FUSED/);

  // Kyurem still has 2 spare, so the other fusion is possible too...
  fuse(state, forms, black);
  assert.equal(spareCopies(state, forms, kyurem.id), 1);
  assert.equal(balance(state), before - 300);

  // ...and undoing one gives the copies back, with no refund.
  unfuse(state, white);
  assert.ok(!activeFusions(state).has(white.id));
  assert.equal(spareCopies(state, forms, kyurem.id), 2);
  assert.equal(spareCopies(state, forms, mon('reshiram').id), 2);
  assert.equal(balance(state), before - 300, 'coins are not returned');
  // The undone fusion keeps its entry and its cost; it is only stamped.
  assert.equal(state.fusions.length, 2);
  assert.equal(state.fusions[0].cost, 150);
  assert.ok(state.fusions[0].undoneAt);
  assert.equal(state.fusions[1].undoneAt, null);

  // Fusing again costs again, and is a new entry.
  fuse(state, forms, white);
  assert.equal(balance(state), before - 450);
  assert.equal(state.fusions.length, 3);
  assert.deepEqual([...activeFusions(state)].sort(), [white.id, black.id].sort());
});

test('a fusion cannot be undone while it is the buddy', () => {
  const ice = forms.fusions.find((f) => f.label === 'Ice Rider Calyrex');
  const state = saveWith({ calyrex: 2, glastrier: 2 }, 400);
  assert.deepEqual(unfuseOffer(state, ice), { ok: false, reason: 'NOT FUSED' });
  fuse(state, forms, ice);
  state.buddy = { fusion: ice.id, shiny: false };
  assert.deepEqual(unfuseOffer(state, ice), { ok: false, reason: 'CHOOSE ANOTHER BUDDY FIRST' });
  assert.throws(() => unfuse(state, ice), /CHOOSE ANOTHER BUDDY FIRST/);
  state.buddy = { dexId: mon('calyrex').id, shiny: false };
  assert.equal(unfuseOffer(state, ice).ok, true);
});

test('a fusion is shiny when both of its Pokémon have their shiny', () => {
  const dusk = forms.fusions.find((f) => f.label === 'Dusk Mane Necrozma');
  const state = saveWith({ necrozma: 4, solgaleo: 4 }, 400);
  assert.equal(fusionOffer(state, forms, dusk).shiny, false);
  buyCopy(state, forms, mon('necrozma')); // 5th: shiny
  assert.equal(fusionOffer(state, forms, dusk).shiny, false);
  buyCopy(state, forms, mon('solgaleo'));
  assert.equal(fusionOffer(state, forms, dusk).shiny, true);
});

// ---------------------------------------------------------------- Zygarde

test('Zygarde copies cost 1 coin, up to 100, with forms at 10 and 100', () => {
  const zygarde = mon('zygarde');
  assert.equal(isCollector(forms, zygarde.id), true);
  assert.equal(isCollector(forms, mon('mewtwo').id), false);
  assert.equal(copyOffer(saveWith({}, 50), forms, zygarde).reason, 'NOT FOUND YET');

  const state = saveWith({ zygarde: 1 }, 400);
  assert.deepEqual(copyOffer(state, forms, zygarde), { ok: true, price: COLLECTOR.copyCost, reason: '' });
  const start = balance(state);
  const shinyAt = [];
  for (let n = 2; n <= 100; n++) {
    const entry = buyCopy(state, forms, zygarde);
    assert.equal(entry.form, undefined, 'Zygarde copies are always Base');
    if (entry.shiny) shinyAt.push(n);
    const unlocked = unlockedForms(state, forms, zygarde.id);
    assert.equal(unlocked.has('10'), n >= 10, `10% at copy ${n}`);
    assert.equal(unlocked.has('complete'), n >= 100, `Complete at copy ${n}`);
  }
  assert.deepEqual(shinyAt, [TIERS.legendary.cap], 'the 5th copy is the shiny, as usual');
  assert.equal(balance(state), start - 99);
  assert.equal(copyOffer(state, forms, zygarde).reason, 'MAXIMUM REACHED');
});

test('Mega Zygarde costs 120 and only opens after Complete', () => {
  const zygarde = mon('zygarde');
  const mega = findForm(forms, zygarde.id, 'mega');
  // The real data has no sprite for it yet, so it is closed whatever you hold.
  const full = saveWith({ zygarde: 100 }, 400);
  if (mega.sprite === false) {
    assert.equal(upgradeOffer(full, forms, zygarde, mega).reason, 'ART NOT AVAILABLE YET');
  }
  // With artwork (as it will be once PokeAPI publishes it):
  const withArt = indexForms({
    forms: formsData.forms.map((f) => (f === mega ? { ...f, sprite: true, shiny: true } : f)),
    fusions: formsData.fusions,
  });
  const megaArt = findForm(withArt, zygarde.id, 'mega');
  const early = saveWith({ zygarde: 99 }, 400);
  assert.equal(upgradeOffer(early, withArt, zygarde, megaArt).reason, 'NEEDS COMPLETE FIRST');
  assert.deepEqual(upgradeOffer(full, withArt, zygarde, megaArt), { ok: true, owned: false, price: 120, reason: '' });
  buyUpgrade(full, withArt, zygarde, megaArt);
  assert.ok(unlockedForms(full, withArt, zygarde.id).has('mega'));
});

// ---------------------------------------------------------------- the save

test('the shop survives export and import unchanged', () => {
  const state = saveWith({ rotom: 1, charizard: 1, kyurem: 2, reshiram: 2 }, 400);
  buyCopy(state, forms, mon('rotom'));
  buyUpgrade(state, forms, mon('charizard'), findForm(forms, mon('charizard').id, 'mega-x'));
  const white = forms.fusions.find((f) => f.label === 'White Kyurem');
  fuse(state, forms, white);
  state.pokemon.push({ source: 'track', dexId: mon('vulpix').id, tier: 'common', shiny: false, pity: false, form: 'alola' });
  state.buddy = { fusion: white.id, shiny: false };

  const round = importJSON(exportJSON(normalize(JSON.parse(JSON.stringify(state)))));
  const bought = round.pokemon.filter((c) => c.source === 'shop');
  assert.equal(bought.length, 1);
  assert.equal(bought[0].form, 'heat');
  assert.equal(bought[0].cost, 5);
  assert.deepEqual(round.unlocks.map((u) => [u.dexId, u.form, u.source, u.cost]), [[6, 'mega-x', 'shop', 150]]);
  assert.deepEqual(round.fusions.map((f) => [f.fusion, f.cost, f.undoneAt]), [[white.id, 150, null]]);
  assert.equal(round.pokemon.at(-1).form, 'alola');
  assert.deepEqual(round.buddy, { fusion: white.id, shiny: false });
  assert.equal(balance(round), balance(state));
  assert.deepEqual(round.wallet, { earned: 407, spent: 305, balance: 102 });
  assert.deepEqual([...activeFusions(round)], [white.id]);
  assert.ok(unlockedForms(round, forms, mon('charizard').id).has('mega-x'));

  const formBuddy = normalize({ app: 'pokechad', schema: 2, buddy: { dexId: 6, shiny: true, form: 'mega-x' } });
  assert.deepEqual(formBuddy.buddy, { dexId: 6, shiny: true, form: 'mega-x' });
  assert.deepEqual(normalize({ app: 'pokechad', schema: 2, buddy: { dexId: 6, form: 'base' } }).buddy, { dexId: 6, shiny: false });
});

test('a grant hands out coins; the test saves hold every Pokémon as a gift and a million coins', () => {
  const state = normalize({ app: 'pokechad', schema: 2, pokemon: [{ source: 'track', dexId: 1 }], grants: [{ coins: 500 }] });
  assert.equal(coinsEarned(state), 501);
  assert.equal(balance(state), 501);
  assert.deepEqual(state.grants[0], { coins: 500, at: state.grants[0].at });
  for (const coins of [-1, 2.5, 'lots', undefined]) {
    assert.throws(() => normalize({ app: 'pokechad', schema: 2, grants: [{ coins }] }), /Grant 1: "coins"/);
  }

  const save = importJSON(readFileSync(new URL('./all-pokemon-save.json', import.meta.url), 'utf8'));
  assert.equal(save.schema, 2);
  const counts = countOwned(save.pokemon);
  for (const species of dex) {
    assert.equal(counts.get(species.id) || 0, species.slug === 'charmander' ? 0 : 1, species.name);
  }
  assert.equal(save.pokemon.length, dex.length - 1);
  assert.ok(save.pokemon.every((c) => c.source === 'gift' && !c.shiny && !c.form));
  assert.equal(save.sessions.length, 0);
  assert.equal(balance(save), 1_000_000);
  // Nothing in it was earned on the track: the track is untouched, the
  // starter is still to be chosen, and the luck gauge starts from zero.
  assert.equal(trackCopies(save).length, 0);
  assert.equal(starterCopy(save), null);
  assert.equal(save.pity.dry, 0);

  // The second test save: ten copies of each, following the game's rules.
  const ten = importJSON(readFileSync(new URL('./all-pokemon-x10-save.json', import.meta.url), 'utf8'));
  const tenCounts = countOwned(ten.pokemon);
  for (const species of dex) {
    assert.equal(tenCounts.get(species.id) || 0, species.slug === 'charmander' ? 0 : 10, species.name);
    if (species.slug === 'charmander') continue;
    assert.equal(ten.pokemon.filter((r) => r.dexId === species.id && r.shiny).length, 1, `one shiny ${species.name}`);
    const wanted = variantsOf(forms, species.id).map((v) => v.key);
    assert.deepEqual([...unlockedForms(ten, forms, species.id)].filter((k) => k !== BASE && wanted.includes(k)).sort(), wanted.slice().sort());
  }
  assert.deepEqual(copiesOf(ten, mon('rotom').id).map((c) => c.form || BASE).slice(0, 7), ['base', 'heat', 'wash', 'frost', 'fan', 'mow', 'base']);
  assert.ok(unlockedForms(ten, forms, mon('zygarde').id).has('10'));
  assert.ok(ten.pokemon.every((c) => c.source === 'gift'));
  assert.equal(trackCopies(ten).length, 0);
  assert.equal(balance(ten), 1_000_000);
});

test('with a test save loaded, the first reward earned is reward number 1', () => {
  const save = importJSON(readFileSync(new URL('./all-pokemon-x10-save.json', import.meta.url), 'utf8'));
  save.score = { net: 250, highWater: 250 };
  const granted = grantOwed({ state: save, species: dex, forms, rng: seeded(12) });
  // Every common is past its limit of 7, so only what is left can be rolled:
  // nothing at all, or Charmander's family once it has been started.
  assert.deepEqual(granted.map((c) => c.n), granted.map((_, i) => i + 1));
  for (const copy of granted) assert.equal(copy.source, 'track');
  assert.equal(trackCopies(save).length, granted.length);
  assert.equal(coinsEarned(save), 1_000_000 + granted.length);
});

test('a version 1 save with no shop converts with nothing in the shop lists', () => {
  const old = normalize({ app: 'pokechad', schema: 1, rewards: [{ dexId: 1 }, { dexId: 4 }] });
  assert.deepEqual([old.unlocks, old.fusions, old.grants], [[], [], []]);
  assert.deepEqual(old.pokemon.map((c) => c.source), ['track', 'track']);
  assert.equal(balance(old), 2, 'rewards already held count as coins');
});

test('editing the save by hand changes the balance; bad entries are rejected', () => {
  const state = saveWith({ pidgey: 1 }, 20);
  buyCopy(state, forms, mon('pidgey'));
  buyCopy(state, forms, mon('pidgey'));
  const file = JSON.parse(exportJSON(state));
  file.pokemon.pop(); // remove one purchase: its 5 coins come back
  file.wallet = { earned: 1, spent: 1, balance: 999999 }; // stale, must be ignored
  const edited = normalize(file);
  assert.equal(balance(edited), balance(state) + 5);
  assert.deepEqual(edited.wallet, { earned: 21, spent: 5, balance: 16 });
  assert.equal(copiesOf(edited, mon('pidgey').id).length, 2);

  // Turning a bought copy into a gift keeps the copy and returns its coins.
  const gifted = JSON.parse(exportJSON(state));
  gifted.pokemon.at(-1).source = 'gift';
  assert.equal(balance(normalize(gifted)), balance(state) + 5);
  assert.equal(normalize(gifted).pokemon.at(-1).cost, undefined);

  const bad = (patch, pattern) => assert.throws(() => normalize({ app: 'pokechad', schema: 2, ...patch }), pattern);
  bad({ pokemon: [{ source: 'found', dexId: 1 }] }, /Pokémon 1: "source"/);
  bad({ pokemon: [{ source: 'shop', dexId: 'x' }] }, /Pokémon 1: "dexId"/);
  bad({ pokemon: [{ source: 'shop', dexId: 1, cost: -5 }] }, /Pokémon 1: "cost"/);
  bad({ unlocks: [{ dexId: 6 }] }, /Unlock 1: "form"/);
  bad({ unlocks: [{ dexId: 6, form: 'mega-x', source: 'found' }] }, /Unlock 1: "source"/);
  bad({ fusions: [{ fusion: 'white' }] }, /Fusion 1: "fusion"/);
  // Only a bought form costs anything, whatever the file says.
  const free = normalize({ app: 'pokechad', schema: 2, unlocks: [{ dexId: 6, form: 'mega-x', source: 'bonus', cost: 99 }] });
  assert.equal(free.unlocks[0].cost, 0);
  // The same checks apply to a version 1 file on its way in.
  const badV1 = (entry, pattern) =>
    assert.throws(() => normalize({ app: 'pokechad', schema: 1, shop: { ledger: [entry] } }), pattern);
  badV1({ type: 'gift', dexId: 1 }, /Shop entry 1: "type"/);
  badV1({ type: 'copy', dexId: 'x' }, /"dexId"/);
  badV1({ type: 'upgrade', dexId: 6 }, /"form"/);
  badV1({ type: 'fuse', fusion: 'white' }, /"fusion"/);
});

test('the recent list covers purchases, bonus forms, fusions and grants, newest first', () => {
  const state = saveWith({ pidgey: 1, kyurem: 2, reshiram: 2, charizard: 1 }, 600);
  const white = forms.fusions.find((f) => f.label === 'White Kyurem');
  const at = (n) => ({ now: Date.parse('2026-02-01T00:00:00Z') + n * 1000 });
  state.grants.push({ coins: 50, at: new Date(at(0).now).toISOString() });
  buyCopy(state, forms, mon('pidgey'), at(1));
  buyUpgrade(state, forms, mon('charizard'), findForm(forms, mon('charizard').id, 'mega-x'), at(2));
  fuse(state, forms, white, at(3));
  unfuse(state, white, at(4));
  state.unlocks.push({ dexId: 6, form: 'gmax', source: 'bonus', cost: 0, at: new Date(at(5).now).toISOString() });
  assert.deepEqual(
    activity(state).map((e) => [e.type, e.cost]),
    [['bonus', 0], ['unfuse', 0], ['fuse', 150], ['upgrade', 150], ['copy', 5], ['grant', 0]],
  );
  // Rewards and gifts are not shop activity.
  assert.equal(activity(saveWith({ pidgey: 3 })).length, 0);
});

// ---------------------------------------------------------------- bonus forms

/** An rng that returns the given numbers in turn, and fails if asked for more. */
function scripted(...values) {
  const queue = values.slice();
  return () => {
    if (queue.length === 0) throw new Error('rng called more often than expected');
    return queue.shift();
  };
}

test('bonus forms are the paid forms still locked, with artwork and their needs met', () => {
  const keys = (state, slug) => bonusCandidates(state, forms, mon(slug).id).map((f) => f.key);
  const state = saveWith({ charizard: 1, vulpix: 1, pidgey: 1, darmanitan: 1, necrozma: 2, solgaleo: 2, zygarde: 100 }, 400);
  assert.deepEqual(keys(state, 'charizard'), ['mega-x', 'mega-y', 'gmax']);
  // Not held at all: nothing.
  assert.deepEqual(keys(state, 'gengar'), []);
  // Free alternate forms are not paid forms.
  assert.deepEqual(keys(state, 'vulpix'), []);
  assert.deepEqual(keys(state, 'pidgey'), []);
  // Never Zygarde, whatever it holds.
  assert.deepEqual(keys(state, 'zygarde'), []);

  // Already unlocked forms drop out, bought or bonus alike.
  buyUpgrade(state, forms, mon('charizard'), findForm(forms, mon('charizard').id, 'mega-y'));
  state.unlocks.push({ dexId: 6, form: 'gmax', source: 'bonus', cost: 0, at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(keys(state, 'charizard'), ['mega-x']);

  // A form's own requirement still holds: Galarian Zen needs Galarian first...
  assert.deepEqual(keys(state, 'darmanitan'), ['zen']);
  buyCopy(state, forms, mon('darmanitan'));
  assert.deepEqual(keys(state, 'darmanitan'), ['zen', 'galar-zen']);
  // ...and Ultra Necrozma needs a fusion to exist.
  assert.deepEqual(keys(state, 'necrozma'), []);
  fuse(state, forms, forms.fusions.find((f) => f.label === 'Dusk Mane Necrozma'));
  assert.deepEqual(keys(state, 'necrozma'), ['ultra']);
});

test('the bonus is a 1-in-12 chance whatever the number of forms, then an even pick', () => {
  assert.equal(BONUS_FORM_CHANCE, 1 / 12);
  const charizard = mon('charizard').id;
  const state = saveWith({ charizard: 1, kyogre: 1 });
  // Just under 1/12 hits, 1/12 itself misses.
  assert.equal(rollBonusForm(state, forms, charizard, scripted(1 / 12 - 1e-9, 0)), 'mega-x');
  assert.equal(rollBonusForm(state, forms, charizard, scripted(1 / 12)), null);
  // On a hit the pick is spread evenly over the forms left.
  assert.equal(rollBonusForm(state, forms, charizard, scripted(0, 0.34)), 'mega-y');
  assert.equal(rollBonusForm(state, forms, charizard, scripted(0, 0.99)), 'gmax');
  // Nothing left to unlock: no roll at all.
  assert.equal(rollBonusForm(state, forms, mon('pidgey').id, scripted()), null);

  // Three forms (Charizard) or one (Kyogre): the rate is the same.
  for (const slug of ['charizard', 'kyogre']) {
    const rng = seeded(31);
    let hits = 0;
    const tries = 24_000;
    const seen = new Set();
    for (let i = 0; i < tries; i++) {
      const form = rollBonusForm(state, forms, mon(slug).id, rng);
      if (form) {
        hits++;
        seen.add(form);
      }
    }
    assert.ok(Math.abs(hits / tries - 1 / 12) < 0.006, `${slug}: ${hits} hits`);
    assert.equal(seen.size, slug === 'charizard' ? 3 : 1);
  }
});

test('a track roll can bring a bonus form only for a Pokémon already held', () => {
  const pool = [mon('charizard')];
  // First copy ever: tier roll, species pick, and that is all.
  const first = rollReward({ species: pool, state: saveWith({}, 18), forms, rng: scripted(0.5, 0) });
  assert.equal(first.dexId, 6);
  assert.equal(first.bonusForm, null);
  // A later copy: one more number decides the bonus, and one more picks it.
  const state = saveWith({ charizard: 1 }, 18);
  assert.equal(rollReward({ species: pool, state, forms, rng: scripted(0.5, 0, 0.5) }).bonusForm, null);
  assert.equal(rollReward({ species: pool, state, forms, rng: scripted(0.5, 0, 0.01, 0.5) }).bonusForm, 'mega-y');
  // Without the forms data there are no forms to win.
  assert.equal(rollReward({ species: pool, state, rng: scripted(0.5, 0) }).bonusForm, null);
});

test('granting a reward with a bonus records the form, and never the same form twice', () => {
  const state = saveWith({ charizard: 1 }, 18);
  state.score = { net: 0, highWater: (19 + 5) * 100 };
  // Five more Charizard, every one hitting the bonus (first pick each time).
  const always = () => 0;
  const granted = grantOwed({ state, species: [mon('charizard')], forms, at: '2026-03-01T00:00:00.000Z', rng: always });
  assert.equal(granted.length, 5);
  assert.deepEqual(granted.map((c) => c.bonusForm), ['mega-x', 'mega-y', 'gmax', undefined, undefined]);
  assert.deepEqual(state.unlocks, [
    { dexId: 6, form: 'mega-x', source: 'bonus', cost: 0, at: '2026-03-01T00:00:00.000Z' },
    { dexId: 6, form: 'mega-y', source: 'bonus', cost: 0, at: '2026-03-01T00:00:00.000Z' },
    { dexId: 6, form: 'gmax', source: 'bonus', cost: 0, at: '2026-03-01T00:00:00.000Z' },
  ]);
  assert.deepEqual([...unlockedForms(state, forms, 6)].sort(), ['base', 'gmax', 'mega-x', 'mega-y']);
  // A bonus is free: the coins only went up, by one per reward.
  assert.equal(coinsSpent(state), 0);
  assert.equal(coinsEarned(state), 19 + 5);
  // The form is no longer for sale, and it survives a save and reload.
  assert.equal(upgradeOffer(state, forms, mon('charizard'), findForm(forms, 6, 'mega-x')).owned, true);
  const round = importJSON(exportJSON(state));
  assert.deepEqual(round.unlocks, state.unlocks);
  assert.equal(trackCopies(round).at(-5).bonusForm, 'mega-x');
});

test('bought copies never bring a bonus form', () => {
  const state = saveWith({ charizard: 1 }, 400);
  for (let i = 0; i < 20; i++) buyCopy(state, forms, mon('charizard'), { rng: () => 0 });
  assert.deepEqual(state.unlocks, []);
  assert.ok(state.pokemon.every((c) => c.bonusForm === undefined));
});

test('over a long game about 1 in 12 repeat rewards with a form to win brings one', () => {
  let chances = 0;
  let bonuses = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const state = saveWith();
    const rng = seeded(seed);
    for (let n = 0; n < 2500; n++) {
      const roll = rollReward({ species: dex, state, forms, rng });
      if (!roll) break;
      const repeat = state.pokemon.some((c) => c.dexId === roll.dexId);
      if (repeat && bonusCandidates(state, forms, roll.dexId).length > 0) chances++;
      const copy = { source: 'track', dexId: roll.dexId, tier: roll.tier, shiny: roll.shiny };
      if (roll.form !== BASE) copy.form = roll.form;
      if (roll.bonusForm) {
        bonuses++;
        assert.ok(repeat, 'never with a first copy');
        assert.ok(!isCollector(forms, roll.dexId), 'never Zygarde');
        assert.equal(findForm(forms, roll.dexId, roll.bonusForm).kind, 'upgrade');
        assert.ok(!unlockedForms(state, forms, roll.dexId).has(roll.bonusForm), 'never a form already held');
        state.unlocks.push({ dexId: roll.dexId, form: roll.bonusForm, source: 'bonus', cost: 0 });
      }
      state.pokemon.push(copy);
    }
  }
  assert.ok(chances > 300, `${chances} chances`);
  assert.ok(Math.abs(bonuses / chances - 1 / 12) < 0.035, `${bonuses} bonuses in ${chances} chances`);
});
