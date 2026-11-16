/**
 * Stopwatch logic. Pure functions over a plain "active session" object; the
 * current time is always passed in, so nothing here reads the clock or the DOM.
 * Documented in documentation/stopwatch.md.
 *
 * Shape of an active session (stored as `state.active`):
 *   {
 *     kind:      'chad' | 'chud',
 *     startedAt: ISO string,
 *     pauses:    [{ from: ISO, to: ISO }],   finished breaks
 *     pausedAt:  ISO string | null           start of the break in progress
 *   }
 */

const MINUTE = 60_000;

/** A break longer than this ends the session automatically. */
export const BREAK_LIMIT_MS = 35 * MINUTE;

/** The red "continue or lose multiplier" countdown covers this final stretch. */
export const BREAK_WARNING_MS = 5 * MINUTE;

const ms = (iso) => Date.parse(iso);
const iso = (time) => new Date(time).toISOString();

/**
 * Begin a session.
 * @param {'chad'|'chud'} kind
 * @param {number} now Epoch milliseconds.
 */
export function start(kind, now) {
  return { kind, startedAt: iso(now), pauses: [], pausedAt: null };
}

/** Start a break. No effect if already paused. */
export function pause(active, now) {
  if (active.pausedAt) return active;
  return { ...active, pausedAt: iso(now) };
}

/** End the break in progress and record it. No effect if not paused. */
export function resume(active, now) {
  if (!active.pausedAt) return active;
  return {
    ...active,
    pauses: [...active.pauses, { from: active.pausedAt, to: iso(now) }],
    pausedAt: null,
  };
}

/**
 * Active time so far: wall-clock time since the start, minus every break.
 * While paused the value stops growing.
 * @returns {number} Milliseconds, never negative.
 */
export function elapsedMs(active, now) {
  const end = active.pausedAt ? ms(active.pausedAt) : now;
  const paused = active.pauses.reduce((sum, p) => sum + (ms(p.to) - ms(p.from)), 0);
  return Math.max(0, end - ms(active.startedAt) - paused);
}

/** Length of the break in progress, or 0 when running. */
export function breakMs(active, now) {
  return active.pausedAt ? Math.max(0, now - ms(active.pausedAt)) : 0;
}

/**
 * Where the current break stands against the 35-minute limit.
 *
 * @returns {{phase:'running'|'break'|'warning'|'expired', remainingMs:number}}
 *   running  not paused
 *   break    paused, more than 5 minutes left
 *   warning  paused, inside the final 5 minutes (show the red countdown)
 *   expired  the limit has passed; the session must be ended
 */
export function breakStatus(active, now) {
  if (!active.pausedAt) return { phase: 'running', remainingMs: BREAK_LIMIT_MS };
  const remainingMs = BREAK_LIMIT_MS - breakMs(active, now);
  if (remainingMs <= 0) return { phase: 'expired', remainingMs: 0 };
  if (remainingMs <= BREAK_WARNING_MS) return { phase: 'warning', remainingMs };
  return { phase: 'break', remainingMs };
}

/**
 * End a session and return the unrated record that waits for stars and a
 * description (stored as `state.pendingRating`).
 *
 * A session stopped during a break ends at the moment the break began, so
 * the trailing break is neither counted nor listed.
 *
 * @param {object} active
 * @param {number} now
 * @param {{autoEnded?: boolean}} [options] autoEnded marks a 35-minute timeout.
 */
export function finish(active, now, { autoEnded = false } = {}) {
  const endedAt = active.pausedAt ? active.pausedAt : iso(now);
  return {
    kind: active.kind,
    method: 'stopwatch',
    startedAt: active.startedAt,
    endedAt,
    activeMinutes: roundMinutes(elapsedMs(active, now) / MINUTE),
    pauses: active.pauses,
    autoEnded,
  };
}

/** Minutes are stored to three decimals (about 60 ms), enough to be exact. */
export function roundMinutes(minutes) {
  return Math.round(minutes * 1000) / 1000;
}
