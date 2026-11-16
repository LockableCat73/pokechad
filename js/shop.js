/**
 * Pokécoins and the shop. Pure functions over the save, no DOM and no
 * storage. Documented in documentation/shop.md.
 *
 * Everything bought is one entry in `state.shop.ledger`:
 *
 *   { type: 'copy',    dexId, tier, form?, shiny, cost, at }   a bought copy
 *   { type: 'upgrade', dexId, form, cost, at }                 an upgrade form
 *   { type: 'fuse',    fusion, cost, at }                      a fusion made
 *   { type: 'unfuse',  fusion, cost: 0, at }                   a fusion undone
 *   { type: 'grant',   coins, cost: 0, at }                    coins handed out (test saves only)
 *
 * Nothing else about the shop is stored. The coin balance, the copies you
 * hold, the forms you have unlocked and the fusions that are active are all
 * worked out from the ledger and the rewards, so they can never disagree.
 */

import { TIERS, collection } from './rewards.js';
import { BASE, formsOf, variantsOf, nextForm } from './forms.js';

/** Shop prices, in Pokécoins. */
export const PRICES = {
  copy: { common: 5, legendary: 20, mythical: 120 },
  upgrade: 150,
  fusion: 150,
};

/** Spare copies of each source Pokémon needed before a fusion can be made. */
export const FUSION_SPARE_NEEDED = 2;

/**
 * Rules for a "collector" species: one whose forms unlock by copy count
 * rather than by coins or chance. Today that is Zygarde alone. A species is
 * a collector when data/forms.json gives it a form of kind "milestone".
 */
export const COLLECTOR = {
  copyCost: 1,
  maxCopies: 100,
  /** Form key -> copies needed. */
  milestones: { 10: 10, complete: 100 },
  /** Price of its upgrade form (Mega Zygarde), which needs Complete first. */
  upgradeCost: 120,
};

// ------------------------------------------------------------------ coins

const ledgerOf = (state) => (state.shop && Array.isArray(state.shop.ledger) ? state.shop.ledger : []);

/**
 * One coin per reward on the track: every 100-point reward, and the starter.
 * Plus any coins handed out by "grant" entries in the ledger. The site never
 * writes a grant; they exist for test saves and hand-edited files.
 */
export function coinsEarned(state) {
  const granted = ledgerOf(state)
    .filter((entry) => entry.type === 'grant')
    .reduce((sum, entry) => sum + (Number(entry.coins) || 0), 0);
  return state.rewards.length + (state.starter ? 1 : 0) + granted;
}

/** Everything ever spent. Unfusing costs nothing and refunds nothing. */
export function coinsSpent(state) {
  return ledgerOf(state).reduce((sum, entry) => sum + (Number(entry.cost) || 0), 0);
}

/** Coins available to spend. */
export function balance(state) {
  return coinsEarned(state) - coinsSpent(state);
}

// ------------------------------------------------------------------ holdings

/** Every copy held of one species (starter, rolled and bought). */
export function copiesOf(state, speciesId) {
  return collection(state).filter((copy) => copy.dexId === speciesId);
}

/** Whether the shiny of a species has been obtained. */
export function hasShiny(state, speciesId) {
  return copiesOf(state, speciesId).some((copy) => copy.shiny);
}

/** Is this a collector species (Zygarde)? */
export function isCollector(index, speciesId) {
  return formsOf(index, speciesId).some((form) => form.kind === 'milestone');
}

/**
 * The ids of the fusions that currently exist: fused and not since unfused.
 * @returns {Set<number>}
 */
export function activeFusions(state) {
  const active = new Set();
  for (const entry of ledgerOf(state)) {
    if (entry.type === 'fuse') active.add(entry.fusion);
    else if (entry.type === 'unfuse') active.delete(entry.fusion);
  }
  return active;
}

/**
 * Copies of a species that are tied up in a fusion right now. They still
 * count towards the species' copy total; they are just not spare.
 */
export function fusedCopies(state, index, speciesId) {
  let n = 0;
  for (const id of activeFusions(state)) {
    const fusion = index.fusionById.get(id);
    if (fusion && (fusion.base === speciesId || fusion.partner === speciesId)) n++;
  }
  return n;
}

/** Copies of a species that are free to be put into a fusion. */
export function spareCopies(state, index, speciesId) {
  return copiesOf(state, speciesId).length - fusedCopies(state, index, speciesId);
}

/**
 * The forms of a species the player can use, as a set of form keys.
 *   base       as soon as one copy is held
 *   variant    once a copy has arrived in that form
 *   upgrade    once bought
 *   milestone  once enough copies are held
 */
export function unlockedForms(state, index, speciesId) {
  const copies = copiesOf(state, speciesId);
  const unlocked = new Set();
  if (copies.length === 0) return unlocked;
  unlocked.add(BASE);
  const held = new Set(copies.map((copy) => copy.form || BASE));
  const bought = new Set(
    ledgerOf(state)
      .filter((entry) => entry.type === 'upgrade' && entry.dexId === speciesId)
      .map((entry) => entry.form),
  );
  for (const form of formsOf(index, speciesId)) {
    if (form.kind === 'variant' && held.has(form.key)) unlocked.add(form.key);
    else if (form.kind === 'upgrade' && bought.has(form.key)) unlocked.add(form.key);
    else if (form.kind === 'milestone' && copies.length >= (COLLECTOR.milestones[form.key] || Infinity)) {
      unlocked.add(form.key);
    }
  }
  return unlocked;
}

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
 * @param {object} state  Mutated: an entry is added to state.shop.ledger.
 * @param {object} index  From indexForms().
 * @param {object} species Pokédex entry.
 * @param {{rng?: () => number, now?: number}} [options]
 * @returns {object} The ledger entry that was added.
 */
export function buyCopy(state, index, species, { rng = Math.random, now = Date.now() } = {}) {
  const offer = copyOffer(state, index, species);
  if (!offer.ok) throw new Error(offer.reason);
  const copies = copiesOf(state, species.id);
  const form = nextForm(index, species.id, copies.map((copy) => copy.form || BASE), rng);
  const entry = {
    type: 'copy',
    dexId: species.id,
    tier: species.tier,
    shiny: copies.length + 1 === TIERS[species.tier].cap,
    cost: offer.price,
    at: new Date(now).toISOString(),
  };
  if (form !== BASE) entry.form = form;
  addEntry(state, entry);
  return entry;
}

// ------------------------------------------------------------------ upgrades

/**
 * Can an upgrade form be bought?
 *
 * Needs a copy of the Pokémon, artwork for the form, and anything the form
 * itself requires: another form unlocked first (`requires.form`), or a fusion
 * of the Pokémon in existence (`requires.fusionOf`).
 *
 * @returns {{ok:boolean, owned:boolean, price:number, reason:string}}
 */
export function upgradeOffer(state, index, species, form) {
  const price = isCollector(index, species.id) ? COLLECTOR.upgradeCost : PRICES.upgrade;
  const unlocked = unlockedForms(state, index, species.id);
  if (unlocked.has(form.key)) return { ok: false, owned: true, price, reason: '' };
  const no = (reason) => ({ ok: false, owned: false, price, reason });
  if (!unlocked.has(BASE)) return no('NOT FOUND YET');
  if (form.sprite === false) return no('ART NOT AVAILABLE YET');
  const needs = form.requires || {};
  if (needs.form && !unlocked.has(needs.form)) {
    const needed = formsOf(index, species.id).find((f) => f.key === needs.form);
    return no(`NEEDS ${(needed ? needed.label : needs.form).toUpperCase()} FIRST`);
  }
  if (needs.fusionOf) {
    const fused = [...activeFusions(state)].some((id) => {
      const fusion = index.fusionById.get(id);
      return fusion && fusion.base === needs.fusionOf;
    });
    if (!fused) return no('NEEDS A FUSION FIRST');
  }
  if (balance(state) < price) return no('NOT ENOUGH COINS');
  return { ok: true, owned: false, price, reason: '' };
}

/** Buy an upgrade form. It belongs to the species from then on. */
export function buyUpgrade(state, index, species, form, { now = Date.now() } = {}) {
  const offer = upgradeOffer(state, index, species, form);
  if (!offer.ok) throw new Error(offer.reason || 'ALREADY UNLOCKED');
  const entry = {
    type: 'upgrade',
    dexId: species.id,
    form: form.key,
    cost: offer.price,
    at: new Date(now).toISOString(),
  };
  addEntry(state, entry);
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
  const entry = { type: 'fuse', fusion: fusion.id, cost: offer.price, at: new Date(now).toISOString() };
  addEntry(state, entry);
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
 * fusion are NOT returned.
 */
export function unfuse(state, fusion, { now = Date.now() } = {}) {
  const offer = unfuseOffer(state, fusion);
  if (!offer.ok) throw new Error(offer.reason);
  const entry = { type: 'unfuse', fusion: fusion.id, cost: 0, at: new Date(now).toISOString() };
  addEntry(state, entry);
  return entry;
}

function addEntry(state, entry) {
  if (!state.shop || !Array.isArray(state.shop.ledger)) state.shop = { ledger: [] };
  state.shop.ledger.push(entry);
}
