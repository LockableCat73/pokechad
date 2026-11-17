/**
 * The words of the 45-minute reminders. Pure functions, no DOM.
 *
 * A reminder names one Pokémon the player holds, picked at random, and says
 * how long the stopwatch has been running. During chad time it cheers the
 * player on; during chud time it suggests wrapping up.
 *
 * In each line, {name} is replaced by the Pokémon's name.
 */

export const CHAD_LINES = [
  '{name} is cheering you on. Keep going!',
  '{name} believes in you. Stay locked in.',
  '{name} is proud of you. One more push!',
  'Still going strong. {name} is impressed.',
  '{name} says the multiplier is only getting better.',
  'Great focus. {name} is right beside you.',
  '{name} used Helping Hand! Keep it up.',
  'You are on a roll. {name} is watching.',
];

export const CHUD_LINES = [
  '{name} thinks that is enough for now. Wrap it up?',
  '{name} is waiting for you to get back to it.',
  'These points are coming off your score. {name} is worried.',
  '{name} wants to see some chad time next.',
  'Time to stop and stretch? {name} thinks so.',
];

/** Used when the player holds no Pokémon yet. */
const NO_NAME = { chad: 'Still going strong. Keep it up!', chud: 'That is a while. Time to wrap it up?' };

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
 * The text of one reminder.
 *
 * @param {'chad'|'chud'} kind
 * @param {number} minutes       Active time on the stopwatch.
 * @param {string|null} name     The Pokémon to mention, or null for none.
 * @param {() => number} [rng]   Float in [0, 1).
 * @returns {{title:string, body:string}}
 */
export function reminderText(kind, minutes, name, rng = Math.random) {
  const chud = kind === 'chud';
  const title = `${spokenTime(minutes)} of ${chud ? 'chud' : 'chad'} time`;
  if (!name) return { title, body: NO_NAME[chud ? 'chud' : 'chad'] };
  return { title, body: pick(chud ? CHUD_LINES : CHAD_LINES, rng).replace('{name}', name) };
}

/**
 * A random copy from those the player holds, to appear in a reminder.
 * Each copy is equally likely, so a Pokémon held many times shows up more.
 *
 * @param {Array} copies       `state.pokemon`.
 * @param {() => number} [rng]
 * @returns {object|null} A copy, or null when none is held.
 */
export function pickReminderCopy(copies, rng = Math.random) {
  if (!Array.isArray(copies) || copies.length === 0) return null;
  return pick(copies, rng);
}
