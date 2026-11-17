/**
 * What the player holds, read from the save. Pure functions, no DOM and no
 * storage. The save's shape is described in documentation/storage.json.md.
 *
 * Four lists in the save say everything about what is held:
 *
 *   pokemon   every copy of every Pokémon, each with a `source`:
 *               starter  the one chosen at 1 point
 *               track    rolled at a 100-point mark on the reward track
 *               shop     bought with Pokécoins
 *               gift     simply given (test saves, hand-edited files)
 *   unlocks   paid forms (Mega, Gigantamax ...) the player can use, whether
 *             bought in the shop or won as a bonus on the track
 *   fusions   fusions made; one that was undone keeps its entry, with the
 *             time it was undone
 *   grants    Pokécoins handed out directly (test saves, hand-edited files)
 *
 * Only `track` copies are stations on the reward track. Everything else here
 * counts every copy alike, wherever it came from.
 */

import { BASE, formsOf } from './forms.js';

/** Where a copy can come from. */
export const SOURCES = ['starter', 'track', 'shop', 'gift'];

/** Where an unlocked form can come from. */
export const UNLOCK_SOURCES = ['shop', 'bonus', 'gift'];

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

const listOf = (state, key) => (state && Array.isArray(state[key]) ? state[key] : []);

// ------------------------------------------------------------------ copies

/** The copies rolled on the reward track, in the order of their stations. */
export function trackCopies(state) {
  return listOf(state, 'pokemon').filter((copy) => copy.source === 'track');
}

/** The starter copy, or null when it has not been chosen yet. */
export function starterCopy(state) {
  return listOf(state, 'pokemon').find((copy) => copy.source === 'starter') || null;
}

/** Every copy held of one species, whatever its source. */
export function copiesOf(state, speciesId) {
  return listOf(state, 'pokemon').filter((copy) => copy.dexId === speciesId);
}

/** Whether the shiny of a species has been obtained. */
export function hasShiny(state, speciesId) {
  return copiesOf(state, speciesId).some((copy) => copy.shiny);
}

/** Is this a collector species (Zygarde)? */
export function isCollector(index, speciesId) {
  return formsOf(index, speciesId).some((form) => form.kind === 'milestone');
}

// ------------------------------------------------------------------ fusions

/**
 * The ids of the fusions that exist right now: made and not since undone.
 * @returns {Set<number>}
 */
export function activeFusions(state) {
  const active = new Set();
  for (const entry of listOf(state, 'fusions')) {
    if (!entry.undoneAt) active.add(entry.fusion);
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

// ------------------------------------------------------------------ forms

/**
 * The forms of a species the player can use, as a set of form keys.
 *   base       as soon as one copy is held
 *   variant    once a copy has arrived in that form
 *   upgrade    once it is in `unlocks` (bought, or won as a bonus)
 *   milestone  once enough copies are held
 */
export function unlockedForms(state, index, speciesId) {
  const copies = copiesOf(state, speciesId);
  const unlocked = new Set();
  if (copies.length === 0) return unlocked;
  unlocked.add(BASE);
  const held = new Set(copies.map((copy) => copy.form || BASE));
  const paid = new Set(
    listOf(state, 'unlocks')
      .filter((entry) => entry.dexId === speciesId)
      .map((entry) => entry.form),
  );
  for (const form of formsOf(index, speciesId)) {
    if (form.kind === 'variant' && held.has(form.key)) unlocked.add(form.key);
    else if (form.kind === 'upgrade' && paid.has(form.key)) unlocked.add(form.key);
    else if (form.kind === 'milestone' && copies.length >= (COLLECTOR.milestones[form.key] || Infinity)) {
      unlocked.add(form.key);
    }
  }
  return unlocked;
}

/**
 * What still stands between the player and a paid form, coins aside.
 *
 * A paid form needs a copy of the Pokémon, artwork, and anything the form
 * itself requires: another form unlocked first (`requires.form`), or a
 * fusion of the Pokémon in existence (`requires.fusionOf`).
 *
 * @returns {string} The reason, in capitals, or '' when nothing is missing.
 */
export function formNeeds(state, index, speciesId, form) {
  const unlocked = unlockedForms(state, index, speciesId);
  if (!unlocked.has(BASE)) return 'NOT FOUND YET';
  if (form.sprite === false) return 'ART NOT AVAILABLE YET';
  const needs = form.requires || {};
  if (needs.form && !unlocked.has(needs.form)) {
    const needed = formsOf(index, speciesId).find((f) => f.key === needs.form);
    return `NEEDS ${(needed ? needed.label : needs.form).toUpperCase()} FIRST`;
  }
  if (needs.fusionOf) {
    const fused = [...activeFusions(state)].some((id) => {
      const fusion = index.fusionById.get(id);
      return fusion && fusion.base === needs.fusionOf;
    });
    if (!fused) return 'NEEDS A FUSION FIRST';
  }
  return '';
}

// ------------------------------------------------------------------ coins

/**
 * One coin per reward on the track: every 100-point reward, and the starter.
 * Plus the coins in `grants`. The site never writes a grant; they exist for
 * test saves and hand-edited files.
 */
export function coinsEarned(state) {
  const granted = listOf(state, 'grants').reduce((sum, entry) => sum + (Number(entry.coins) || 0), 0);
  return trackCopies(state).length + (starterCopy(state) ? 1 : 0) + granted;
}

/**
 * Everything ever spent: the cost of every bought copy, every bought form
 * and every fusion made. A fusion that was undone keeps its cost, which is
 * how "no refund" is recorded.
 */
export function coinsSpent(state) {
  const cost = (sum, entry) => sum + (Number(entry.cost) || 0);
  return (
    listOf(state, 'pokemon').filter((copy) => copy.source === 'shop').reduce(cost, 0) +
    listOf(state, 'unlocks').reduce(cost, 0) +
    listOf(state, 'fusions').reduce(cost, 0)
  );
}

/** Coins available to spend. */
export function balance(state) {
  return coinsEarned(state) - coinsSpent(state);
}

/** The three coin totals, as written into the save for reading. */
export function wallet(state) {
  const earned = coinsEarned(state);
  const spent = coinsSpent(state);
  return { earned, spent, balance: earned - spent };
}
