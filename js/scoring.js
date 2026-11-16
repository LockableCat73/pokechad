/**
 * Scoring rules. Pure functions, no DOM and no storage.
 * Documented in documentation/scoring.md.
 */

/** Highest self-rating a session can get (0–4, classic IV-judge style). */
export const STAR_MAX = 4;

/** A Pokémon is awarded each time the high-water mark passes a multiple of this. */
export const POINTS_PER_REWARD = 100;

/**
 * Points a session is worth, before the chad/chud sign is applied.
 *
 *   floor(t / 60 + t^1.05 * stars / 2)      t = active minutes
 *
 * @param {number} minutes Active minutes (paused time excluded). May be fractional.
 * @param {number} stars   Self-rating, 0 to STAR_MAX.
 * @returns {number} A non-negative integer.
 */
export function sessionPoints(minutes, stars) {
  const t = Math.max(0, Number(minutes) || 0);
  const s = clampStars(stars);
  return Math.floor(t / 60 + Math.pow(t, 1.05) * (s / 2));
}

/**
 * Points with the sign applied: chad sessions add, chud sessions subtract
 * exactly the same amount.
 *
 * @param {'chad'|'chud'} kind
 * @param {number} minutes
 * @param {number} stars
 * @returns {number}
 */
export function signedPoints(kind, minutes, stars) {
  const points = sessionPoints(minutes, stars);
  return kind === 'chud' && points !== 0 ? -points : points;
}

/**
 * The multiplier shown next to the running stopwatch.
 *
 *   1.05 * t^0.05 - 0.05                    t = active minutes
 *
 * This is display only. It is roughly the slope of the t^1.05 term and exists
 * to show that staying in a session pays off; sessionPoints() never uses it.
 *
 * @param {number} minutes
 * @returns {number} Never below 0.
 */
export function displayMultiplier(minutes) {
  const t = Math.max(0, Number(minutes) || 0);
  return Math.max(0, 1.05 * Math.pow(t, 0.05) - 0.05);
}

/**
 * Force a rating into the valid whole-star range.
 * @param {number} stars
 * @returns {number} Integer from 0 to STAR_MAX.
 */
export function clampStars(stars) {
  const n = Math.round(Number(stars) || 0);
  return Math.min(STAR_MAX, Math.max(0, n));
}

/**
 * Recompute every derived number from the list of sessions, in list order.
 * Sets `points` and `netAfter` on each session (mutating them) and returns
 * the totals.
 *
 * `highWater` is the best net score ever reached. Rewards are owed against
 * it, not against the current net, which is why chud time can never take a
 * Pokémon away.
 *
 * @param {Array<{kind:string, activeMinutes:number, stars:number}>} sessions
 * @returns {{net:number, highWater:number}}
 */
export function recalculate(sessions) {
  let net = 0;
  let highWater = 0;
  for (const session of sessions) {
    session.points = signedPoints(session.kind, session.activeMinutes, session.stars);
    net += session.points;
    session.netAfter = net;
    if (net > highWater) highWater = net;
  }
  return { net, highWater };
}
