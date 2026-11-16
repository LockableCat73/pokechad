/**
 * Reward rolls. Pure functions, no DOM and no storage.
 * Documented in documentation/rewards.md.
 */

import { POINTS_PER_REWARD } from './scoring.js';

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
 * @param {object|null} starter `state.starter`.
 */
export function starterOwed(highWater, starter) {
  return !starter && highWater >= STARTER_POINTS;
}

/**
 * Every Pokémon copy the player holds, oldest first: the starter (if chosen)
 * followed by the rolled rewards. The starter is presented in the same shape
 * as a reward, with `n: 0` and `starter: true`, so views can treat all copies
 * alike. It counts as one copy of its species towards that species' cap.
 *
 * @param {{starter: object|null, rewards: Array}} state
 * @returns {Array}
 */
export function collection({ starter, rewards }) {
  if (!starter) return rewards;
  return [
    {
      n: 0,
      trackPoints: STARTER_POINTS,
      dexId: starter.dexId,
      tier: 'common',
      shiny: false,
      pity: false,
      at: starter.at,
      sessionId: starter.sessionId,
      starter: true,
    },
    ...rewards,
  ];
}

/**
 * Copies owned per species.
 * @param {Array<{dexId:number}>} rewards
 * @returns {Map<number, number>} dexId -> count
 */
export function countOwned(rewards) {
  const counts = new Map();
  for (const reward of rewards) {
    counts.set(reward.dexId, (counts.get(reward.dexId) || 0) + 1);
  }
  return counts;
}

/**
 * The pity counter: how many of the most recent rewards, counting back from
 * the newest, were not legendary. Commons and mythicals both count up; only a
 * legendary resets it.
 *
 * @param {Array<{tier:string}>} rewards
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
 * @param {Array} rewards    Rewards already awarded.
 * @returns {number}
 */
export function owedRewards(highWater, rewards) {
  const earned = Math.floor(Math.max(0, highWater) / POINTS_PER_REWARD);
  return Math.max(0, earned - rewards.length);
}

/**
 * Species in a tier that can still be awarded: they have a sprite and are
 * below the tier's cap.
 *
 * @param {Array<{id:number, tier:string, sprite:boolean}>} species
 * @param {Map<number, number>} counts From countOwned().
 * @param {string} tier
 */
export function eligible(species, counts, tier) {
  const cap = TIERS[tier].cap;
  return species.filter(
    (s) => s.tier === tier && s.sprite !== false && (counts.get(s.id) || 0) < cap,
  );
}

/**
 * Roll one reward.
 *
 * 1. If the pity counter has reached PITY_LIMIT and a legendary is still
 *    available, the tier is forced to legendary. Pity never gives a mythical.
 * 2. Otherwise the tier is rolled by weight (94 / 5 / 1). A tier with nothing
 *    left to give is skipped and its weight is shared among the others.
 * 3. A species is picked uniformly from that tier's eligible pool.
 * 4. The reward is shiny when this copy reaches the tier's cap.
 *
 * @param {object} args
 * @param {Array} args.species           The Pokédex (data/pokedex.json `species`).
 * @param {Array} args.rewards           Rewards already awarded.
 * @param {object|null} [args.starter]   The chosen starter; counts as a copy of its species.
 * @param {() => number} [args.rng]      Returns a float in [0, 1). Defaults to crypto.
 * @returns {{dexId:number, tier:string, shiny:boolean, pity:boolean}|null}
 *          null when every species is at its cap.
 */
export function rollReward({ species, rewards, starter = null, rng = cryptoRandom }) {
  const counts = countOwned(collection({ starter, rewards }));
  const pools = {
    common: eligible(species, counts, 'common'),
    legendary: eligible(species, counts, 'legendary'),
    mythical: eligible(species, counts, 'mythical'),
  };

  let tier = null;
  let pity = false;
  if (pityDry(rewards) >= PITY_LIMIT && pools.legendary.length > 0) {
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
  const copies = (counts.get(chosen.id) || 0) + 1;
  return { dexId: chosen.id, tier, shiny: copies >= TIERS[tier].cap, pity };
}

/**
 * Hand out every reward that is owed and append them to `rewards`.
 *
 * @param {object} args
 * @param {number} args.highWater
 * @param {Array}  args.rewards    Mutated: new rewards are pushed onto it.
 * @param {Array}  args.species
 * @param {object|null} [args.starter]   The chosen starter, if any.
 * @param {string|null} [args.sessionId] The session that triggered the rewards.
 * @param {string} [args.at]       ISO timestamp to stamp on the rewards.
 * @param {() => number} [args.rng]
 * @returns {Array} The newly created reward records (may be empty).
 */
export function grantOwed({ highWater, rewards, species, starter = null, sessionId = null, at, rng }) {
  const granted = [];
  let owed = owedRewards(highWater, rewards);
  while (owed-- > 0) {
    const roll = rollReward({ species, rewards, starter, rng });
    if (!roll) break;
    const n = rewards.length + 1;
    const reward = {
      n,
      trackPoints: n * POINTS_PER_REWARD,
      dexId: roll.dexId,
      tier: roll.tier,
      shiny: roll.shiny,
      pity: roll.pity,
      at: at || new Date().toISOString(),
      sessionId,
    };
    rewards.push(reward);
    granted.push(reward);
  }
  return granted;
}

/** Uniform float in [0, 1) from the platform's cryptographic generator. */
function cryptoRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}
