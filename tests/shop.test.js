import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TIERS, rollReward, grantOwed, collection, countOwned, eligible } from '../js/rewards.js';
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

/** A save holding the given copies; each is one reward, so also one coin. */
function saveWith(holdings = {}, extraCoins = 0) {
  const state = defaultState(Date.parse('2026-01-01T00:00:00Z'));
  const add = (species, form) => {
    const reward = { dexId: species.id, tier: species.tier, shiny: false, pity: false };
    if (form) reward.form = form;
    state.rewards.push(reward);
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
  state.starter = { dexId: 4, at: '2026-01-01T00:00:00.000Z', sessionId: null };
  assert.equal(coinsEarned(state), 4);
  assert.equal(coinsSpent(state), 0);
  assert.equal(balance(state), 4);
});

test('bought copies cost coins but earn none and do not move the track', () => {
  const state = saveWith({ pidgey: 1 }, 9);
  assert.equal(balance(state), 10);
  buyCopy(state, forms, mon('pidgey'));
  assert.equal(state.rewards.length, 10, 'no reward was added');
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
  const counts = countOwned(collection(state));
  assert.equal(counts.get(mon('pidgey').id), 7);
  assert.ok(!eligible(dex, counts, 'common').some((s) => s.id === mon('pidgey').id));
  // With only Pidgey in the pool, nothing is left to roll.
  const only = [mon('pidgey')];
  assert.equal(rollReward({ species: only, rewards: state.rewards, shop: state.shop, forms, rng: seeded(1) }), null);
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
  const rewards = saveWith({}, 18).rewards;
  for (let i = 0; i < 6; i++) {
    const roll = rollReward({ species: pool, rewards, forms, rng: seeded(i + 3) });
    rewards.push({ dexId: roll.dexId, tier: roll.tier, shiny: roll.shiny, form: roll.form });
  }
  assert.deepEqual(rewards.slice(18).map((r) => r.form), ['base', 'heat', 'wash', 'frost', 'fan', 'mow']);
  // grantOwed writes the form down only when it is not Base.
  const granted = [];
  grantOwed({ highWater: 300, rewards: granted, species: [mon('vulpix')], forms, rng: seeded(5) });
  assert.equal(granted[0].form, undefined);
  assert.equal(granted[1].form, 'alola');
  assert.ok([undefined, 'alola'].includes(granted[2].form));
});

test('a mix of rolled and bought copies shares one order', () => {
  const state = saveWith({ rotom: 1 }, 100);
  state.rewards.push({ dexId: mon('rotom').id, tier: 'common', shiny: false, form: 'heat' });
  assert.equal(buyCopy(state, forms, mon('rotom')).form, 'wash');
  const roll = rollReward({ species: [mon('rotom')], rewards: state.rewards, shop: state.shop, forms, rng: seeded(2) });
  assert.equal(roll.form, 'frost');
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
  buyUpgrade(state, forms, charizard, megaX);
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
  assert.equal(state.shop.ledger.at(-1).cost, 0);

  // Fusing again costs again.
  fuse(state, forms, white);
  assert.equal(balance(state), before - 450);
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
  state.rewards.push({ dexId: mon('vulpix').id, tier: 'common', shiny: false, pity: false, form: 'alola' });
  state.buddy = { fusion: white.id, shiny: false };

  const round = importJSON(exportJSON(normalize(JSON.parse(JSON.stringify(state)))));
  assert.equal(round.shop.ledger.length, 3);
  assert.deepEqual(round.shop.ledger.map((e) => e.type), ['copy', 'upgrade', 'fuse']);
  assert.equal(round.shop.ledger[0].form, 'heat');
  assert.equal(round.rewards.at(-1).form, 'alola');
  assert.deepEqual(round.buddy, { fusion: white.id, shiny: false });
  assert.equal(balance(round), balance(state));
  assert.deepEqual([...activeFusions(round)], [white.id]);
  assert.ok(unlockedForms(round, forms, mon('charizard').id).has('mega-x'));

  const formBuddy = normalize({ app: 'pokechad', schema: 1, buddy: { dexId: 6, shiny: true, form: 'mega-x' } });
  assert.deepEqual(formBuddy.buddy, { dexId: 6, shiny: true, form: 'mega-x' });
  assert.deepEqual(normalize({ app: 'pokechad', schema: 1, buddy: { dexId: 6, form: 'base' } }).buddy, { dexId: 6, shiny: false });
});

test('an old save with no shop loads with an empty ledger', () => {
  const old = normalize({ app: 'pokechad', schema: 1, rewards: [{ dexId: 1 }, { dexId: 4 }] });
  assert.deepEqual(old.shop, { ledger: [] });
  assert.equal(balance(old), 2, 'rewards already held count as coins');
});

test('editing the ledger by hand changes the balance; bad entries are rejected', () => {
  const state = saveWith({ pidgey: 1 }, 20);
  buyCopy(state, forms, mon('pidgey'));
  buyCopy(state, forms, mon('pidgey'));
  const file = JSON.parse(exportJSON(state));
  file.shop.ledger.pop(); // remove one purchase: its 5 coins come back
  const edited = normalize(file);
  assert.equal(balance(edited), balance(state) + 5);
  assert.equal(copiesOf(edited, mon('pidgey').id).length, 2);

  const bad = (entry, pattern) =>
    assert.throws(() => normalize({ app: 'pokechad', schema: 1, shop: { ledger: [entry] } }), pattern);
  bad({ type: 'gift', dexId: 1 }, /Shop entry 1: "type"/);
  bad({ type: 'copy', dexId: 'x' }, /Shop entry 1: "dexId"/);
  bad({ type: 'copy', dexId: 1, cost: -5 }, /Shop entry 1: "cost"/);
  bad({ type: 'upgrade', dexId: 6 }, /Shop entry 1: "form"/);
  bad({ type: 'fuse', fusion: 'white' }, /Shop entry 1: "fusion"/);
  // An unfuse never carries a cost, whatever the file says.
  const free = normalize({ app: 'pokechad', schema: 1, shop: { ledger: [{ type: 'unfuse', fusion: 5, cost: 99 }] } });
  assert.equal(free.shop.ledger[0].cost, 0);
});
