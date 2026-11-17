/**
 * Choosing what PokéChad says when a stopwatch starts and every 45 minutes
 * after. Pure functions, no DOM. The lines themselves are in js/messages.js.
 *
 * A message is for a moment ("start" or "reminder"), a kind of session
 * ("chad" or "chud") and one Pokémon the player holds. Its line comes from
 * one of three pools:
 *
 *   own      lines written for that very Pokémon, if it has any
 *   type     lines for its type; a dual type draws from both
 *   general  lines that suit any Pokémon
 *
 * The pool is chosen first, then a line within it:
 *
 *   the Pokémon has its own lines   own 1/2, type 1/4, general 1/4
 *   it has none                     type 1/2, general 1/2
 *
 * so the easter eggs turn up often for the Pokémon that have them without
 * being all they ever say. A pool with nothing to offer hands its share to
 * the general pool. The line shown last time is never shown again straight
 * away.
 */

import { GENERAL, NO_POKEMON, BY_TYPE, BY_POKEMON } from './messages.js';

/** How often a Pokémon with lines of its own uses one of them. */
export const OWN_SHARE = 0.5;

/** Of the rest, how often a type line is used rather than a general one. */
export const TYPE_SHARE = 0.5;

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** "45M", "1H 30M", "3H". */
export function spokenTime(minutes) {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}M`;
  return rest === 0 ? `${hours}H` : `${hours}H ${rest}M`;
}

/**
 * The three pools for one Pokémon, already filled in with its name.
 *
 * @param {'chad'|'chud'} kind
 * @param {'start'|'reminder'} moment
 * @param {{name:string, slug?:string, types?:string[]}} mon
 * @returns {{own:string[], type:string[], general:string[]}}
 */
export function linePools(kind, moment, mon) {
  const named = (lines) => lines.map((line) => line.replaceAll('{name}', mon.name));
  const own = (BY_POKEMON[mon.slug] && BY_POKEMON[mon.slug][kind]) || [];
  const type = (mon.types || []).flatMap((t) => (BY_TYPE[t] && BY_TYPE[t][kind]) || []);
  return { own: own.slice(), type: named(type), general: named(GENERAL[kind][moment]) };
}

/**
 * Choose one line.
 *
 * @param {object} args
 * @param {'chad'|'chud'} args.kind
 * @param {'start'|'reminder'} args.moment
 * @param {{name:string, slug?:string, types?:string[]}|null} args.mon
 *   The Pokémon to speak for, or null when the player holds none.
 * @param {string|null} [args.last] The line shown last time, to avoid.
 * @param {() => number} [args.rng] Float in [0, 1).
 * @returns {string}
 */
export function pickLine({ kind, moment, mon, last = null, rng = Math.random }) {
  const fresh = (lines) => {
    const others = lines.filter((line) => line !== last);
    return others.length > 0 ? others : lines;
  };
  kind = kind === 'chud' ? 'chud' : 'chad';
  moment = moment === 'start' ? 'start' : 'reminder';
  if (!mon) return pick(fresh(NO_POKEMON[kind][moment]), rng);

  const pools = linePools(kind, moment, mon);
  const roll = rng();
  let chosen;
  if (pools.own.length > 0 && roll < OWN_SHARE) chosen = pools.own;
  else {
    // Where the roll falls within the share that is not the Pokémon's own.
    const rest = pools.own.length > 0 ? (roll - OWN_SHARE) / (1 - OWN_SHARE) : roll;
    chosen = pools.type.length > 0 && rest < TYPE_SHARE ? pools.type : pools.general;
  }
  // A pool whose only line was just shown gives way to the general pool.
  if (chosen.length === 1 && chosen[0] === last) chosen = pools.general;
  return pick(fresh(chosen), rng);
}

const kindWord = (kind) => (kind === 'chud' ? 'chud' : 'chad');

/**
 * The message shown when a stopwatch starts.
 *
 * @param {'chad'|'chud'} kind
 * @param {{name:string, slug?:string, types?:string[]}|null} mon
 * @param {{last?: string|null, rng?: () => number}} [options]
 * @returns {{title:string, body:string}}
 */
export function startText(kind, mon, { last = null, rng = Math.random } = {}) {
  const word = kindWord(kind);
  return {
    title: `${word[0].toUpperCase()}${word.slice(1)} time started`,
    body: pickLine({ kind, moment: 'start', mon, last, rng }),
  };
}

/**
 * The message shown every 45 minutes.
 *
 * @param {'chad'|'chud'} kind
 * @param {number} minutes Active time on the stopwatch.
 * @param {{name:string, slug?:string, types?:string[]}|null} mon
 * @param {{last?: string|null, rng?: () => number}} [options]
 * @returns {{title:string, body:string}}
 */
export function reminderText(kind, minutes, mon, { last = null, rng = Math.random } = {}) {
  return {
    title: `${spokenTime(minutes)} of ${kindWord(kind)} time`,
    body: pickLine({ kind, moment: 'reminder', mon, last, rng }),
  };
}

/**
 * A copy to appear in a message, from those the player holds.
 *
 * Every species held is equally likely, however many copies of it there
 * are (a hundred Zygarde do not crowd out everything else). Within the
 * species, any of its copies may be picked, so its alternate forms show up
 * too.
 *
 * @param {Array} copies       `state.pokemon`.
 * @param {() => number} [rng]
 * @returns {object|null} A copy, or null when none is held.
 */
export function pickReminderCopy(copies, rng = Math.random) {
  if (!Array.isArray(copies) || copies.length === 0) return null;
  const species = [...new Set(copies.map((copy) => copy.dexId))];
  const dexId = pick(species, rng);
  return pick(copies.filter((copy) => copy.dexId === dexId), rng);
}
