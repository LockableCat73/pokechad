/**
 * Reward rolls. Pure functions, no DOM and no storage.
 * Documented in documentation/rewards.md.
 */

import { POINTS_PER_REWARD } from './scoring.js';
import { BASE, formsOf, nextForm } from './forms.js';
import { trackCopies, isCollector, unlockedForms, formNeeds } from './holdings.js';

/**
 * The three tiers. `weight` is the chance out of 100 that a roll lands in the
 * tier; `cap` is how many copies of one species can ever be awarded. The copy
 * that reaches the cap is the shiny one.
 */
export const TIERS = {
  common: { weight: 94, cap: 7, label: 'Common' },
  legendary: { weight: 5, cap: 5, label: 'Legendary' },
  mythical: { weight: 1, cap: 2, label: 'Mythical' },
};

/** After this many rolls in a row without a legendary, the next roll is one. */
export const PITY_LIMIT = 20;

/**
 * The early game is kept to the older generations. Each entry says: rolled
 * rewards up to and including number `upTo` may only be species with a
 * Pokédex number of `maxDex` or lower. After the last entry, any species can
 * appear. The starter is chosen, not rolled, so it is not counted here.
 *
 *   rewards  1-6    Pokédex 1-151  (generation 1)
 *   rewards  7-12   Pokédex 1-251  (generations 1-2)
 *   rewards 13-18   Pokédex 1-493  (generations 1-4)
 *   rewards 19+     everything
 */
export const EARLY_RANGES = [
  { upTo: 6, maxDex: 151 },
  { upTo: 12, maxDex: 251 },
  { upTo: 18, maxDex: 493 },
];

/**
 * Highest Pokédex number allowed for a given rolled reward.
 * @param {number} rewardNumber 1 for the first rolled reward, 2 for the second, ...
 * @returns {number} A Pokédex number, or Infinity when there is no limit.
 */
export function dexLimit(rewardNumber) {
  const range = EARLY_RANGES.find((r) => rewardNumber <= r.upTo);
  return range ? range.maxDex : Infinity;
}

/**
 * Evolution families unlock in Pokédex order.
 *
 * Every species in data/pokedex.json carries `family`, the id of its
 * evolution chain on PokeAPI (written by tools/update_pokedex.py; nothing
 * about families is listed by hand). Within a family the members are put in
 * Pokédex-number order, and a species you have never held can only be rolled
 * once you hold the member before it:
 *
 *   Weedle (#13) -> Kakuna (#14) -> Beedrill (#15)
 *   Pikachu (#25) -> Raichu (#26) -> Pichu (#172)     Pokédex order, not evolution order
 *
 * This only gates the FIRST copy of a species. Once you hold one Beedrill,
 * further Beedrill (including the shiny) roll freely, whatever happens to
 * Weedle and Kakuna.
 *
 * @param {Array<{id:number, family?:number|null, sprite?:boolean}>} species
 * @returns {Map<number, number>} species id -> id of the family member that
 *   must be held first. Species that open their family, or have no family
 *   recorded, are absent from the map.
 */
export function familyGates(species) {
  let gates = gateCache.get(species);
  if (gates) return gates;
  const families = new Map();
  for (const s of species) {
    // A species that cannot be rolled (no sprite yet) must not block the rest.
    if (s.family === undefined || s.family === null || s.sprite === false) continue;
    if (!families.has(s.family)) families.set(s.family, []);
    families.get(s.family).push(s.id);
  }
  gates = new Map();
  for (const members of families.values()) {
    members.sort((a, b) => a - b);
    for (let i = 1; i < members.length; i++) gates.set(members[i], members[i - 1]);
  }
  gateCache.set(species, gates);
  return gates;
}

/** The Pokédex list never changes while the page is open, so compute once. */
const gateCache = new WeakMap();

/**
 * The starter: a one-off extra reward, chosen by the player rather than
 * rolled, that sits at 1 point on the track (in practice, right after the
 * first session that leaves the score positive). It is in addition to the
 * rolled rewards at 100, 200, 300 ... and does not shift them.
 * Bulbasaur, Charmander, Squirtle, Pikachu.
 */
export const STARTERS = [1, 4, 7, 25];

/** High-water mark at which the starter choice unlocks. */
export const STARTER_POINTS = 1;

/**
 * Is the starter choice due?
 * @param {number} highWater Best net score ever reached.
 * @param {object|null} starter The starter copy (starterCopy() in holdings.js), if any.
 */
export function starterOwed(highWater, starter) {
  return !starter && highWater >= STARTER_POINTS;
}

/**
 * Copies owned per species.
 * @param {Array<{dexId:number}>} copies Usually `state.pokemon`.
 * @returns {Map<number, number>} dexId -> count
 */
export function countOwned(copies) {
  const counts = new Map();
  for (const copy of copies) {
    counts.set(copy.dexId, (counts.get(copy.dexId) || 0) + 1);
  }
  return counts;
}

/**
 * The pity counter: how many of the most recent rewards on the track, counting
 * back from the newest, were not legendary. Commons and mythicals both count
 * up; only a legendary resets it. Copies from anywhere else (the starter, the
 * shop, gifts) are not rewards and must not be passed in.
 *
 * @param {Array<{tier:string}>} rewards The track copies, oldest first.
 * @returns {number}
 */
export function pityDry(rewards) {
  let dry = 0;
  for (let i = rewards.length - 1; i >= 0; i--) {
    if (rewards[i].tier === 'legendary') break;
    dry++;
  }
  return dry;
}

/**
 * How many rewards are still owed. One reward per POINTS_PER_REWARD of the
 * high-water mark, minus those already handed out. Never negative.
 *
 * @param {number} highWater Best net score ever reached.
 * @param {number} claimed   Rewards already handed out (the number of track copies).
 * @returns {number}
 */
export function owedRewards(highWater, claimed) {
  const earned = Math.floor(Math.max(0, highWater) / POINTS_PER_REWARD);
  return Math.max(0, earned - claimed);
}

/**
 * Species in a tier that can still be awarded. A species qualifies when it
 *   - has a sprite,
 *   - is below the tier's cap,
 *   - is within the Pokédex range currently allowed (see dexLimit), and
 *   - is either already held, or next in line in its family (see familyGates).
 *
 * @param {Array<{id:number, tier:string, sprite:boolean}>} species
 * @param {Map<number, number>} counts From countOwned().
 * @param {string} tier
 * @param {number} [maxDex] Highest Pokédex number allowed.
 */
export function eligible(species, counts, tier, maxDex = Infinity) {
  const cap = TIERS[tier].cap;
  const gates = familyGates(species);
  const held = (id) => (counts.get(id) || 0) > 0;
  return species.filter(
    (s) =>
      s.tier === tier &&
      s.id <= maxDex &&
      s.sprite !== false &&
      (counts.get(s.id) || 0) < cap &&
      (held(s.id) || !gates.has(s.id) || held(gates.get(s.id))),
  );
}

/**
 * Chance that a track reward for a Pokémon you already hold also unlocks one
 * of its paid forms.
 */
export const BONUS_FORM_CHANCE = 1 / 12;

/**
 * The paid forms of a species that a bonus could unlock right now: forms of
 * kind "upgrade" (Mega, Gigantamax, Primal ...) that are not unlocked yet,
 * have artwork, and whose own requirement is met (Galarian Zen still needs
 * Galarian Darmanitan first). Never Zygarde, whose forms go by copy count,
 * and never fusions, which are not forms of one species.
 *
 * @returns {Array<object>} Form entries from data/forms.json.
 */
export function bonusCandidates(state, index, speciesId) {
  if (!index || isCollector(index, speciesId)) return [];
  const unlocked = unlockedForms(state, index, speciesId);
  if (!unlocked.has(BASE)) return [];
  return formsOf(index, speciesId).filter(
    (form) => form.kind === 'upgrade' && !unlocked.has(form.key) && formNeeds(state, index, speciesId, form) === '',
  );
}

/**
 * Roll for a bonus form. Call it only for a species that was already held
 * before the copy being rolled.
 *
 * The chance is BONUS_FORM_CHANCE however many forms the species has. On a
 * hit, one of the forms not yet unlocked is picked, each equally likely.
 * With nothing left to unlock there is no roll at all.
 *
 * @returns {string|null} A form key, or null.
 */
export function rollBonusForm(state, index, speciesId, rng) {
  const candidates = bonusCandidates(state, index, speciesId);
  if (candidates.length === 0) return null;
  if (rng() >= BONUS_FORM_CHANCE) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))].key;
}

/**
 * Roll one reward.
 *
 * 0. The Pokédex range for this reward is looked up (dexLimit): the first 18
 *    rolled rewards are limited to the older generations. New species must
 *    also be next in line in their evolution family (familyGates). Both only
 *    narrow which species can appear; neither changes the tier odds.
 * 1. If the pity counter has reached PITY_LIMIT and a legendary is still
 *    available, the tier is forced to legendary. Pity never gives a mythical.
 * 2. Otherwise the tier is rolled by weight (94 / 5 / 1). A tier with nothing
 *    left to give is skipped and its weight is shared among the others.
 * 3. A species is picked uniformly from that tier's eligible pool.
 * 4. The reward is shiny when this copy reaches the tier's cap.
 * 5. Its form is chosen (see nextForm in forms.js): Base for a first copy,
 *    otherwise the next alternate form not yet held, or a random form once
 *    all are held.
 * 6. If the species was already held, there is a BONUS_FORM_CHANCE that one
 *    of its paid forms is unlocked as well (see rollBonusForm).
 *
 * Every copy held counts towards the 7 / 5 / 2 limit, wherever it came from;
 * rolls never pass it. Only the shop can take a species beyond it. The
 * reward's number on the track, and with it the early-game range and the
 * pity counter, look at track copies alone.
 *
 * @param {object} args
 * @param {Array} args.species           The Pokédex (data/pokedex.json `species`).
 * @param {object} args.state            The save; `pokemon`, `unlocks` and `fusions` are read.
 * @param {object|null} [args.forms]     Index from indexForms(); omit for "no alternate forms".
 * @param {() => number} [args.rng]      Returns a float in [0, 1). Defaults to crypto.
 * @returns {{dexId:number, tier:string, shiny:boolean, pity:boolean, form:string, bonusForm:string|null}|null}
 *          null when every species is at its cap.
 */
export function rollReward({ species, state, forms = null, rng = cryptoRandom }) {
  const copies = state.pokemon || [];
  const track = trackCopies(state);
  const counts = countOwned(copies);
  const maxDex = dexLimit(track.length + 1);
  const pools = {
    common: eligible(species, counts, 'common', maxDex),
    legendary: eligible(species, counts, 'legendary', maxDex),
    mythical: eligible(species, counts, 'mythical', maxDex),
  };

  let tier = null;
  let pity = false;
  if (pityDry(track) >= PITY_LIMIT && pools.legendary.length > 0) {
    tier = 'legendary';
    pity = true;
  } else {
    const open = Object.keys(TIERS).filter((t) => pools[t].length > 0);
    if (open.length === 0) return null;
    const total = open.reduce((sum, t) => sum + TIERS[t].weight, 0);
    let pick = rng() * total;
    tier = open[open.length - 1];
    for (const t of open) {
      pick -= TIERS[t].weight;
      if (pick < 0) {
        tier = t;
        break;
      }
    }
  }

  const pool = pools[tier];
  const chosen = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const before = counts.get(chosen.id) || 0;
  const heldForms = copies.filter((c) => c.dexId === chosen.id).map((c) => c.form || BASE);
  const form = forms ? nextForm(forms, chosen.id, heldForms, rng) : BASE;
  const bonusForm = before > 0 && forms ? rollBonusForm(state, forms, chosen.id, rng) : null;
  return { dexId: chosen.id, tier, shiny: before + 1 >= TIERS[tier].cap, pity, form, bonusForm };
}

/**
 * Hand out every reward that is owed.
 *
 * Each one is added to `state.pokemon` as a copy with `source: "track"`. A
 * bonus form is added to `state.unlocks` with `source: "bonus"` and noted on
 * the copy as `bonusForm`.
 *
 * @param {object} args
 * @param {object} args.state      Mutated: `pokemon` and `unlocks` grow.
 * @param {Array}  args.species
 * @param {object|null} [args.forms]     Index from indexForms().
 * @param {string|null} [args.sessionId] The session that triggered the rewards.
 * @param {string} [args.at]       ISO timestamp to stamp on the rewards.
 * @param {() => number} [args.rng]
 * @returns {Array} The newly added copies (may be empty).
 */
export function grantOwed({ state, species, forms = null, sessionId = null, at, rng }) {
  const granted = [];
  if (!Array.isArray(state.pokemon)) state.pokemon = [];
  if (!Array.isArray(state.unlocks)) state.unlocks = [];
  const stamp = at || new Date().toISOString();
  let claimed = trackCopies(state).length;
  let owed = owedRewards(state.score.highWater, claimed);
  while (owed-- > 0) {
    const roll = rollReward({ species, state, forms, rng });
    if (!roll) break;
    const n = ++claimed;
    const copy = {
      source: 'track',
      n,
      trackPoints: n * POINTS_PER_REWARD,
      dexId: roll.dexId,
      tier: roll.tier,
      shiny: roll.shiny,
      pity: roll.pity,
      at: stamp,
      sessionId,
    };
    // Only alternate forms are written down; no `form` means Base.
    if (roll.form && roll.form !== BASE) copy.form = roll.form;
    if (roll.bonusForm) {
      copy.bonusForm = roll.bonusForm;
      state.unlocks.push({ dexId: roll.dexId, form: roll.bonusForm, source: 'bonus', cost: 0, at: stamp });
    }
    state.pokemon.push(copy);
    granted.push(copy);
  }
  return granted;
}

/** Uniform float in [0, 1) from the platform's cryptographic generator. */
function cryptoRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}
