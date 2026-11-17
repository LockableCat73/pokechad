/**
 * The shop: what Pokécoins can buy, and the rules for buying it. Pure
 * functions over the save, no DOM and no storage. Documented in
 * documentation/shop.md.
 *
 * Buying changes the save in one place each:
 *
 *   a copy      a new entry in `pokemon` with `source: "shop"` and its `cost`
 *   a form      a new entry in `unlocks` with `source: "shop"` and its `cost`
 *   a fusion    a new entry in `fusions` with its `cost`
 *   unfusing    stamps `undoneAt` on that fusion's entry; the cost stays
 *
 * Reading the save (how many copies, which forms, how many coins) lives in
 * holdings.js and is re-exported here, so the views can take everything
 * about coins and purchases from this one module.
 */

import { TIERS } from './rewards.js';
import { BASE, variantsOf, nextForm } from './forms.js';
import {
  COLLECTOR,
  copiesOf,
  hasShiny,
  isCollector,
  activeFusions,
  spareCopies,
  unlockedForms,
  formNeeds,
  balance,
} from './holdings.js';

export {
  COLLECTOR,
  trackCopies,
  starterCopy,
  copiesOf,
  hasShiny,
  isCollector,
  activeFusions,
  fusedCopies,
  spareCopies,
  unlockedForms,
  coinsEarned,
  coinsSpent,
  balance,
  wallet,
} from './holdings.js';

/** Shop prices, in Pokécoins. */
export const PRICES = {
  copy: { common: 5, legendary: 20, mythical: 120 },
  upgrade: 150,
  fusion: 150,
};

/** Spare copies of each source Pokémon needed before a fusion can be made. */
export const FUSION_SPARE_NEEDED = 2;

// ------------------------------------------------------------------ copies

/**
 * Can a copy of this species be bought, and for how much?
 *
 * - Only Pokémon already found can be bought.
 * - Common and legendary: no upper limit; the shop may pass 7 / 5.
 * - Mythical: stops at 2, unless the species still has alternate forms left
 *   to unlock (Deoxys: three formes, so it can reach 4 copies).
 * - A collector species (Zygarde) costs 1 coin and stops at 100.
 *
 * @returns {{ok:boolean, price:number, reason:string}} `reason` is empty when ok.
 */
export function copyOffer(state, index, species) {
  const copies = copiesOf(state, species.id);
  const collector = isCollector(index, species.id);
  const price = collector ? COLLECTOR.copyCost : PRICES.copy[species.tier];
  const no = (reason) => ({ ok: false, price, reason });
  if (copies.length === 0) return no('NOT FOUND YET');
  if (collector) {
    if (copies.length >= COLLECTOR.maxCopies) return no('MAXIMUM REACHED');
  } else if (species.tier === 'mythical' && copies.length >= TIERS.mythical.cap) {
    const held = new Set(copies.map((copy) => copy.form || BASE));
    const missing = variantsOf(index, species.id).some((v) => !held.has(v.key));
    if (!missing) return no('COPY LIMIT REACHED');
  }
  if (balance(state) < price) return no('NOT ENOUGH COINS');
  return { ok: true, price, reason: '' };
}

/**
 * Buy one copy. It behaves like a rolled copy: it counts towards the copy
 * total, the copy that brings the total to 7 / 5 / 2 is the shiny, and its
 * form follows the same order as a roll (see nextForm). It does not move the
 * track, the luck gauge or the coin count.
 *
 * @param {object} state  Mutated: a copy is added to state.pokemon.
 * @param {object} index  From indexForms().
 * @param {object} species Pokédex entry.
 * @param {{rng?: () => number, now?: number}} [options]
 * @returns {object} The copy that was added.
 */
export function buyCopy(state, index, species, { rng = Math.random, now = Date.now() } = {}) {
  const offer = copyOffer(state, index, species);
  if (!offer.ok) throw new Error(offer.reason);
  const copies = copiesOf(state, species.id);
  const form = nextForm(index, species.id, copies.map((copy) => copy.form || BASE), rng);
  const copy = {
    source: 'shop',
    dexId: species.id,
    tier: species.tier,
    shiny: copies.length + 1 === TIERS[species.tier].cap,
    cost: offer.price,
    at: new Date(now).toISOString(),
  };
  if (form !== BASE) copy.form = form;
  push(state, 'pokemon', copy);
  return copy;
}

// ------------------------------------------------------------------ upgrades

/**
 * Can an upgrade form be bought?
 *
 * Needs a copy of the Pokémon, artwork for the form, anything the form
 * itself requires (see formNeeds in holdings.js), and the coins.
 *
 * @returns {{ok:boolean, owned:boolean, price:number, reason:string}}
 */
export function upgradeOffer(state, index, species, form) {
  const price = isCollector(index, species.id) ? COLLECTOR.upgradeCost : PRICES.upgrade;
  if (unlockedForms(state, index, species.id).has(form.key)) return { ok: false, owned: true, price, reason: '' };
  const no = (reason) => ({ ok: false, owned: false, price, reason });
  const missing = formNeeds(state, index, species.id, form);
  if (missing) return no(missing);
  if (balance(state) < price) return no('NOT ENOUGH COINS');
  return { ok: true, owned: false, price, reason: '' };
}

/** Buy an upgrade form. It belongs to the species from then on. */
export function buyUpgrade(state, index, species, form, { now = Date.now() } = {}) {
  const offer = upgradeOffer(state, index, species, form);
  if (!offer.ok) throw new Error(offer.reason || 'ALREADY UNLOCKED');
  const entry = {
    dexId: species.id,
    form: form.key,
    source: 'shop',
    cost: offer.price,
    at: new Date(now).toISOString(),
  };
  push(state, 'unlocks', entry);
  return entry;
}

// ------------------------------------------------------------------ fusions

/**
 * Where a fusion stands.
 *
 * To fuse you need both Pokémon with at least FUSION_SPARE_NEEDED spare
 * copies each, and the coins. Fusing sets one copy of each aside.
 *
 * @returns {{ok:boolean, active:boolean, price:number, reason:string,
 *            spare:{base:number, partner:number}, shiny:boolean}}
 */
export function fusionOffer(state, index, fusion) {
  const spare = {
    base: spareCopies(state, index, fusion.base),
    partner: spareCopies(state, index, fusion.partner),
  };
  const shiny = hasShiny(state, fusion.base) && hasShiny(state, fusion.partner);
  const common = { price: PRICES.fusion, spare, shiny };
  if (activeFusions(state).has(fusion.id)) return { ok: false, active: true, reason: '', ...common };
  const no = (reason) => ({ ok: false, active: false, reason, ...common });
  if (fusion.sprite === false) return no('ART NOT AVAILABLE YET');
  if (copiesOf(state, fusion.base).length === 0 || copiesOf(state, fusion.partner).length === 0) {
    return no('FIND BOTH POKéMON FIRST');
  }
  if (spare.base < FUSION_SPARE_NEEDED || spare.partner < FUSION_SPARE_NEEDED) {
    return no(`NEEDS ${FUSION_SPARE_NEEDED} SPARE COPIES OF EACH`);
  }
  if (balance(state) < PRICES.fusion) return no('NOT ENOUGH COINS');
  return { ok: true, active: false, reason: '', ...common };
}

/** Make a fusion: pay the coins and set one copy of each Pokémon aside. */
export function fuse(state, index, fusion, { now = Date.now() } = {}) {
  const offer = fusionOffer(state, index, fusion);
  if (!offer.ok) throw new Error(offer.reason || 'ALREADY FUSED');
  const entry = { fusion: fusion.id, cost: offer.price, at: new Date(now).toISOString(), undoneAt: null };
  push(state, 'fusions', entry);
  return entry;
}

/**
 * Can a fusion be undone? Not while it is the buddy.
 * @returns {{ok:boolean, reason:string}}
 */
export function unfuseOffer(state, fusion) {
  if (!activeFusions(state).has(fusion.id)) return { ok: false, reason: 'NOT FUSED' };
  if (state.buddy && state.buddy.fusion === fusion.id) {
    return { ok: false, reason: 'CHOOSE ANOTHER BUDDY FIRST' };
  }
  return { ok: true, reason: '' };
}

/**
 * Undo a fusion. The two copies become spare again. The coins paid for the
 * fusion are NOT returned: its entry stays in the save with its cost, and is
 * only stamped with the time it was undone.
 */
export function unfuse(state, fusion, { now = Date.now() } = {}) {
  const offer = unfuseOffer(state, fusion);
  if (!offer.ok) throw new Error(offer.reason);
  const entry = state.fusions.find((f) => f.fusion === fusion.id && !f.undoneAt);
  entry.undoneAt = new Date(now).toISOString();
  return entry;
}

// ------------------------------------------------------------------ activity

/**
 * Everything that has happened to the coins, newest first: copies bought,
 * forms unlocked (bought or bonus), fusions made and undone, coins granted.
 * Used for the "Recent" list in the Shop.
 *
 * @returns {Array<{type:string, at:string, cost:number, dexId?:number,
 *   form?:string, shiny?:boolean, fusion?:number, coins?:number}>}
 *   `type` is one of copy, upgrade, bonus, fuse, unfuse, grant.
 */
export function activity(state) {
  const items = [];
  for (const copy of state.pokemon || []) {
    if (copy.source === 'shop') items.push({ type: 'copy', at: copy.at, cost: copy.cost || 0, dexId: copy.dexId, form: copy.form, shiny: copy.shiny });
  }
  for (const entry of state.unlocks || []) {
    items.push({ type: entry.source === 'shop' ? 'upgrade' : 'bonus', at: entry.at, cost: entry.cost || 0, dexId: entry.dexId, form: entry.form });
  }
  for (const entry of state.fusions || []) {
    items.push({ type: 'fuse', at: entry.at, cost: entry.cost || 0, fusion: entry.fusion });
    if (entry.undoneAt) items.push({ type: 'unfuse', at: entry.undoneAt, cost: 0, fusion: entry.fusion });
  }
  for (const entry of state.grants || []) {
    items.push({ type: 'grant', at: entry.at, cost: 0, coins: entry.coins });
  }
  // Newest first; entries with the same time keep the order they were listed in.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => Date.parse(b.item.at) - Date.parse(a.item.at) || b.i - a.i)
    .map(({ item }) => item);
}

function push(state, key, entry) {
  if (!Array.isArray(state[key])) state[key] = [];
  state[key].push(entry);
}
