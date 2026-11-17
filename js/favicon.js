/**
 * The browser tab icon.
 *
 *   chad session running   Crowned Zacian
 *   chud session running   Gigantamax Snorlax
 *   no session             the ordinary PokéChad icon
 *
 * The two Pokémon are 96x96 sprites with a wide transparent margin, which
 * would leave them tiny in a tab. Each is trimmed to the pixels it actually
 * uses and enlarged by a whole number (nearest-neighbour, so it stays
 * pixel-sharp) before being handed to the browser. If that cannot be done
 * the untrimmed sprite is used as it is.
 */

const DEFAULT_ICON = 'assets/icons/icon-192.png';

const SESSION_ICONS = {
  chad: 'assets/icons/zacian-crowned.png',
  chud: 'assets/icons/snorlax-gmax.png',
};

let current = 'default';
const trimmed = {};

/**
 * @param {'chad'|'chud'|null} kind The running session's kind, or null for none.
 */
export function setFavicon(kind) {
  const key = SESSION_ICONS[kind] ? kind : 'default';
  if (key === current) return;
  current = key;
  if (key === 'default') {
    apply(DEFAULT_ICON);
    return;
  }
  apply(trimmed[key] || SESSION_ICONS[key]);
  if (trimmed[key]) return;
  trim(SESSION_ICONS[key])
    .then((url) => {
      trimmed[key] = url;
      if (current === key) apply(url);
    })
    .catch(() => {
      /* keep the untrimmed sprite */
    });
}

/** Swap the <link rel="icon">. A fresh element is the most reliable way to make browsers notice. */
function apply(href) {
  const old = document.querySelector('link[rel="icon"]');
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = href;
  link.dataset.icon = current;
  if (old) old.replaceWith(link);
  else document.head.append(link);
}

/** Crop a sprite to its visible pixels, centre it in a square, and enlarge it. */
async function trim(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const probeContext = probe.getContext('2d');
  probeContext.drawImage(image, 0, 0);
  const { data } = probeContext.getImageData(0, 0, w, h);

  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) throw new Error('empty sprite');

  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const side = Math.max(boxW, boxH);
  const scale = Math.max(1, Math.floor(192 / side));
  const out = document.createElement('canvas');
  out.width = side * scale;
  out.height = side * scale;
  const context = out.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    left, top, boxW, boxH,
    Math.floor((side - boxW) / 2) * scale, Math.floor((side - boxH) / 2) * scale, boxW * scale, boxH * scale,
  );
  return out.toDataURL('image/png');
}
