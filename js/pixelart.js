/**
 * Hand-drawn pixel icons, stored as text bitmaps and drawn as crisp SVG.
 * One character is one pixel; the palette below maps characters to colours.
 * Because they are SVG rectangles they stay sharp at any whole-number scale.
 */

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Character -> colour. "." is transparent. Values may be CSS custom
 * properties, so outlines follow the light or dark theme.
 */
export const PALETTE = {
  k: 'var(--art-ink)', // outline
  a: 'var(--text)', // thin lines that must stay readable on any panel
  w: '#ffffff',
  r: '#d83030', // red
  y: '#f8c820', // star yellow
  o: '#b07808', // dark gold
  b: '#2868c0', // blue
  n: '#38a048', // green
  g: '#a8a098', // grey
  l: '#d8d0c0', // light grey
};

export const BITMAPS = {
  pokeball: [
    '.....kkkkkk.....',
    '...kkrrrrrrkk...',
    '..krrrrrrrrrrk..',
    '.krrwwrrrrrrrrk.',
    '.krwwrrrrrrrrrk.',
    'krrwrrrrrrrrrrrk',
    'krrrrrkkkkrrrrrk',
    'kkkkkkwwwwkkkkkk',
    'kkkkkkwwwwkkkkkk',
    'kwwwwwkkkkwwwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
  ],
  star: [
    '.....k.....',
    '....kyk....',
    '....kyk....',
    'kkkkyyykkkk',
    'kyyyyyyyyyk',
    '.kyyyyyyyk.',
    '..kyyyyyk..',
    '..kyyyyyk..',
    '.kyyykyyyk.',
    '.kyyk.kyyk.',
    '.kkk...kkk.',
  ],
  pokedex: [
    '................',
    '.kkkkkkkkkkkkkk.',
    'krrrrrrrrrrrrrrk',
    'krbbrrrrrrryrnrk',
    'krbbrrrrrrrrrrrk',
    'kkkkkkkkkkkkkkkk',
    'krrrrrrrrrrrrrrk',
    'krkkkkkkkkkkrrrk',
    'krkwwwwwwwwkrrrk',
    'krkwwwwwwwwkrrrk',
    'krkwwwwwwwwkrrrk',
    'krkwwwwwwwwkrrrk',
    'krkkkkkkkkkkrkrk',
    'krrrrrrrrrrrrrrk',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  history: [
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwkwwwwwwk.',
    '.kwwwwwkwwwwwwk.',
    'kwwwwwwkwwwwwwwk',
    'kwwwwwwkwwwwwwwk',
    'kwwwwwwkkkkwwwwk',
    'kwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
  ],
  stats: [
    '................',
    'a...............',
    'a..........kkk..',
    'a..........kbk..',
    'a..........kbk..',
    'a......kkk.kbk..',
    'a......krk.kbk..',
    'a......krk.kbk..',
    'a..kkk.krk.kbk..',
    'a..kyk.krk.kbk..',
    'a..kyk.krk.kbk..',
    'a..kyk.krk.kbk..',
    'a..kyk.krk.kbk..',
    'aaaaaaaaaaaaaaaa',
    '................',
    '................',
  ],
  // The luck gauge. "f" cells are the inside of the circle; luckGauge()
  // turns them gold from the bottom up.
  gauge: [
    '....kkkk....',
    '..kkffffkk..',
    '.kffffffffk.',
    '.kffffffffk.',
    'kffffffffffk',
    'kffffffffffk',
    'kffffffffffk',
    'kffffffffffk',
    '.kffffffffk.',
    '.kffffffffk.',
    '..kkffffkk..',
    '....kkkk....',
  ],
  backup: [
    'kkkkkkkkkkkkkk..',
    'kbkwwwwwwwkbbkk.',
    'kbkwwwwwkwkbbbkk',
    'kbkwwwwwkwkbbbbk',
    'kbkwwwwwwwkbbbbk',
    'kbbkkkkkkkbbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kbbkkkkkkkkkkbbk',
    'kbbkwwwwwwwwkbbk',
    'kbbkwwwwwwwwkbbk',
    'kbbkwkkkkkkwkbbk',
    'kbbkwwwwwwwwkbbk',
    'kbbkwwwwwwwwkbbk',
    'kkkkkkkkkkkkkkkk',
    '................',
  ],
  coin: [
    '.....kkkkkk.....',
    '...kkyyyyyykk...',
    '..kyyyyyyyyyyk..',
    '.kyyoooooyyyyyk.',
    '.kyyoyyyyoyyyyk.',
    'kyyyoyyyyoyyyyyk',
    'kyyyoyyyyoyyyyyk',
    'kyyyoooooyyyyyyk',
    'kyyyoyyyyyyyyyyk',
    'kyyyoyyyyyyyyyyk',
    'kyyyoyyyyyyyyyyk',
    '.kyyoyyyyyyyyyk.',
    '.kyyyyyyyyyyyyk.',
    '..kyyyyyyyyyyk..',
    '...kkyyyyyykk...',
    '.....kkkkkk.....',
  ],
  sparkle: [
    '...k...',
    '..kyk..',
    '.kywyk.',
    'kywwwyk',
    '.kywyk.',
    '..kyk..',
    '...k...',
  ],
};

/**
 * Draw a bitmap as an inline SVG.
 *
 * @param {string} name   Key of BITMAPS.
 * @param {object} [options]
 * @param {number} [options.scale] Screen pixels per bitmap pixel (whole number).
 * @param {object} [options.swap]  Palette overrides, e.g. { y: '#d83030' }.
 * @param {string} [options.label] Accessible name; omitted icons are decorative.
 * @returns {SVGSVGElement}
 */
export function icon(name, options = {}) {
  return draw(BITMAPS[name], name, options);
}

/**
 * The luck gauge: a small circle that fills with gold from the bottom as the
 * pity counter climbs towards the guaranteed legendary. It keeps one fixed
 * palette in both themes, like a sprite.
 *
 * @param {number} fraction 0 (empty) to 1 (full).
 * @param {number} [scale]
 */
export function luckGauge(fraction, scale = 3) {
  const rows = BITMAPS.gauge;
  const inside = rows.length - 2;
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * inside);
  const painted = rows.map((row, y) => {
    const fromBottom = rows.length - 1 - y; // 1..inside for interior rows
    return row.replace(/f/g, fromBottom <= filled ? 'y' : 'e');
  });
  return draw(painted, 'gauge', { scale, swap: { k: '#282030', e: '#f0e8d8' } });
}

function draw(rows, name, { scale = 2, swap = {}, label = '' } = {}) {
  const width = rows[0].length;
  const height = rows.length;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width * scale);
  svg.setAttribute('height', height * scale);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', `px px-${name}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const colours = { ...PALETTE, ...swap };
  rows.forEach((row, y) => {
    // Merge horizontal runs of one colour into a single rectangle.
    let x = 0;
    while (x < width) {
      const ch = row[x];
      let end = x + 1;
      while (end < width && row[end] === ch) end++;
      if (ch !== '.' && colours[ch]) {
        const rect = document.createElementNS(SVG, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', end - x);
        rect.setAttribute('height', 1);
        rect.style.fill = colours[ch];
        svg.append(rect);
      }
      x = end;
    }
  });
  return svg;
}

/**
 * A coin amount: the coin icon followed by a number, e.g. for prices and the
 * balance. The coin keeps a fixed dark outline so it reads on any panel.
 *
 * @param {number|string} amount
 * @param {number} [scale] Icon scale; 1 is 16px.
 */
export function coins(amount, scale = 1) {
  const tag = document.createElement('span');
  tag.className = 'coins';
  tag.setAttribute('role', 'img');
  tag.setAttribute('aria-label', `${amount} Pokécoins`);
  const text = document.createElement('span');
  text.textContent = String(amount);
  tag.append(icon('coin', { scale, swap: { k: '#282030' } }), text);
  return tag;
}

/** Fill colours for the rating stars, following the classic IV-judge look. */
const STAR_YELLOW = { y: '#f8c820' };
const STAR_RED = { y: '#e02828' };
const STAR_EMPTY = { y: 'var(--star-empty)', k: 'var(--star-empty-edge)' };

/**
 * A row of four rating stars. 0–3 stars are drawn in yellow; a full 4 turns
 * all of them red. The colour is purely decorative.
 *
 * @param {number} stars 0 to 4.
 * @param {number} [scale]
 * @returns {HTMLSpanElement}
 */
export function starRow(stars, scale = 2) {
  const row = document.createElement('span');
  row.className = 'stars';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${stars} of 4 stars`);
  for (let i = 1; i <= 4; i++) {
    const swap = i > stars ? STAR_EMPTY : stars >= 4 ? STAR_RED : STAR_YELLOW;
    row.append(icon('star', { scale, swap }));
  }
  return row;
}

/** One star for the picker; `state` is 'empty', 'yellow' or 'red'. */
export function starIcon(state, scale = 3) {
  const swap = state === 'red' ? STAR_RED : state === 'yellow' ? STAR_YELLOW : STAR_EMPTY;
  return icon('star', { scale, swap });
}
