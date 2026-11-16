/**
 * Small DOM and formatting helpers shared by every view.
 * Everything that reaches the page goes through h(), which only ever sets
 * text nodes and attributes, so user-typed descriptions cannot inject markup.
 */

/**
 * Create an element.
 *
 * @param {string} tag
 * @param {object} [attrs] `class`, `style` (object), `dataset` (object),
 *   `on<event>` handlers, boolean attributes, anything else via setAttribute.
 * @param {...(Node|string|number|null|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(...textParts(String(child)));
  }
}

/**
 * The page shows all text in capitals, but "é" stays small, as in POKéMON
 * and POKéDEX (the font's capital É is a squat letter that looks wrong in
 * those words). Any é in a string is wrapped in a span that opts out of the
 * capitals; everything else is returned as plain text.
 *
 * @param {string} text
 * @returns {Array<string|HTMLElement>}
 */
function textParts(text) {
  if (!text.includes('é')) return [text];
  return text.split(/(é)/).filter(Boolean).map((part) => {
    if (part !== 'é') return part;
    const span = document.createElement('span');
    span.className = 'lc';
    span.textContent = part;
    return span;
  });
}

/**
 * Replace an element's text, keeping any "é" small. Use this instead of
 * `el.textContent = ...` wherever the text might contain one.
 */
export function setText(el, text) {
  el.replaceChildren(...textParts(String(text)));
}

/** Remove every child of an element and return it. */
export function clear(el) {
  el.replaceChildren();
  return el;
}

const pad = (n) => String(n).padStart(2, '0');

/** Stopwatch face: "07:05" under an hour, "1:07:05" from an hour up. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** A length of time in words: "45s", "12m", "1h 05m". */
export function fmtMinutes(minutes) {
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds}s`;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  return `${Math.floor(whole / 60)}h ${pad(whole % 60)}m`;
}

/** Signed points: "+148", "-36", "0". */
export function fmtPoints(points) {
  return points > 0 ? `+${fmtNumber(points)}` : fmtNumber(points);
}

/** Thousands separators with a plain hyphen for negatives (the pixel font has no minus sign). */
export function fmtNumber(n) {
  const text = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n < 0 ? `-${text}` : text;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Local date: "16 NOV 2026". */
export function fmtDate(value) {
  const d = new Date(value);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Local date and time: "16 NOV 2026 14:05". */
export function fmtDateTime(value) {
  const d = new Date(value);
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local calendar day as a sortable key: "2026-11-16". */
export function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A Pokémon sprite. Sprites are 96x96 pixel art and are only ever shown at
 * whole-number multiples of that size with nearest-neighbour scaling (the
 * `sprite` class sets `image-rendering: pixelated`).
 *
 * @param {{id:number, name:string, shiny?:boolean}|undefined} species Pokédex entry.
 * @param {object} [options]
 * @param {boolean} [options.shiny]      Show the shiny sprite when one exists.
 * @param {number}  [options.scale]      1, 2 or 3.
 * @param {boolean} [options.silhouette] Black out (not yet owned).
 * @param {boolean} [options.eager]      Load immediately instead of lazily.
 */
export function sprite(species, { shiny = false, scale = 1, silhouette = false, eager = false } = {}) {
  if (!species) {
    return h('span', { class: 'sprite sprite-missing', style: { width: `${96 * scale}px`, height: `${96 * scale}px` } }, '?');
  }
  const folder = shiny && species.shiny !== false ? 'shiny' : 'normal';
  return h('img', {
    class: `sprite${silhouette ? ' silhouette' : ''}`,
    src: `assets/sprites/${folder}/${species.id}.png`,
    width: 96 * scale,
    height: 96 * scale,
    alt: silhouette ? 'Unknown Pokémon' : `${shiny ? 'Shiny ' : ''}${species.name}`,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    draggable: 'false',
  });
}
