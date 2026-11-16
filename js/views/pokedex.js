/**
 * Pokédex: totals at the top, then two tabs.
 *   POKéDEX  every species by number; unowned ones are silhouettes, owned
 *            ones show the sprite and copies held out of the cap.
 *   SHINIES  only the shiny Pokémon you hold.
 */

import { h, sprite, fmtDateTime, fmtDate, fmtNumber } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS, countOwned, collection } from '../rewards.js';

const FILTERS = [
  ['all', 'ALL'],
  ['owned', 'FOUND'],
  ['missing', 'MISSING'],
  ['legendary', 'LEGENDARY'],
  ['mythical', 'MYTHICAL'],
];

/** Remembered while the page is open so going back and forth keeps your place. */
let tab = 'dex';
let filter = 'all';
let query = '';

const dexNo = (id) => `#${String(id).padStart(4, '0')}`;

/** Total recorded time as hours and minutes; this is clock time, with no multiplier or rating applied. */
function fmtTotal(minutes) {
  const whole = Math.round(minutes);
  return `${fmtNumber(Math.floor(whole / 60))}h ${String(whole % 60).padStart(2, '0')}m`;
}

export function render(ctx, root) {
  const { state, dex } = ctx;
  const copies = collection(state);
  const counts = countOwned(copies);
  const shinyCopies = copies.filter((r) => r.shiny);
  const shinyAt = new Map(shinyCopies.map((r) => [r.dexId, r.at]));

  const chadMinutes = state.sessions.filter((s) => s.kind === 'chad').reduce((sum, s) => sum + s.activeMinutes, 0);
  const chudMinutes = state.sessions.filter((s) => s.kind === 'chud').reduce((sum, s) => sum + s.activeMinutes, 0);

  // ---- tab: full Pokédex
  const cells = dex.species.map((species) => {
    const count = counts.get(species.id) || 0;
    const owned = count > 0;
    const shiny = shinyAt.has(species.id);
    const el = h('button', {
      class: `cell tier-${species.tier}${owned ? ' owned' : ''}${shiny ? ' shiny' : ''}`,
      type: 'button',
      'aria-label': owned ? `${species.name}, ${count} of ${TIERS[species.tier].cap}${shiny ? ', shiny' : ''}` : `Number ${species.id}, not found yet`,
      onclick: () => openDetail(ctx, species),
    },
      sprite(species, { shiny, silhouette: !owned }),
      shiny ? h('span', { class: 'cell-shiny' }, icon('sparkle', { scale: 2 })) : null,
      h('span', { class: 'cell-no' }, dexNo(species.id)),
      h('span', { class: 'cell-name' }, owned ? species.name : '?????'),
      owned ? h('span', { class: 'cell-count' }, `${count}/${TIERS[species.tier].cap}`) : null);
    return { el, species, owned };
  });

  const empty = h('p', { class: 'box pad muted', hidden: true }, 'NOTHING MATCHES.');
  const shown = h('span', { class: 'label muted' }, '');

  function apply() {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    let visible = 0;
    for (const cell of cells) {
      const { species, owned } = cell;
      let ok =
        filter === 'all' ||
        (filter === 'owned' && owned) ||
        (filter === 'missing' && !owned) ||
        filter === species.tier;
      if (ok && q) {
        // Names of Pokémon you have not found stay secret, so only numbers match those.
        ok = String(species.id) === String(Number(q)) || (owned && species.name.toLowerCase().includes(q));
      }
      cell.el.hidden = !ok;
      if (ok) visible++;
    }
    empty.hidden = visible > 0;
    shown.textContent = `SHOWING ${visible}`;
  }

  const filterButtons = FILTERS.map(([key, label]) =>
    h('button', {
      class: `btn btn-small${filter === key ? ' selected' : ''}`,
      type: 'button',
      'aria-pressed': String(filter === key),
      onclick: (event) => {
        filter = key;
        ctx.sfx.play('click');
        for (const b of filterButtons) {
          b.classList.toggle('selected', b === event.currentTarget);
          b.setAttribute('aria-pressed', String(b === event.currentTarget));
        }
        apply();
      },
    }, label));

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'NAME OR NUMBER',
    'aria-label': 'Search by name or number',
    value: query,
    oninput: () => {
      query = search.value;
      apply();
    },
  });

  const dexPanel = h('div', { class: 'stack', role: 'tabpanel', 'aria-label': 'Pokédex' },
    h('div', { class: 'filters' }, h('div', { class: 'row wrap' }, filterButtons), search, shown),
    empty,
    h('div', { class: 'dex-grid' }, cells.map((c) => c.el)));

  // ---- tab: shinies
  const shinyPanel = h('div', { class: 'stack', role: 'tabpanel', 'aria-label': 'Shinies' },
    shinyCopies.length === 0
      ? h('p', { class: 'box pad muted' },
          'NO SHINIES YET. THE LAST COPY OF A POKéMON IS THE SHINY ONE: THE 7TH OF A COMMON, THE 5TH OF A LEGENDARY, THE 2ND OF A MYTHICAL.')
      : h('div', { class: 'dex-grid' },
          dex.species.filter((s) => shinyAt.has(s.id)).map((species) =>
            h('button', {
              class: `cell owned shiny tier-${species.tier}`,
              type: 'button',
              'aria-label': `Shiny ${species.name}, found ${fmtDate(shinyAt.get(species.id))}`,
              onclick: () => openDetail(ctx, species),
            },
              sprite(species, { shiny: true }),
              h('span', { class: 'cell-shiny' }, icon('sparkle', { scale: 2 })),
              h('span', { class: 'cell-no' }, dexNo(species.id)),
              h('span', { class: 'cell-name' }, species.name),
              h('span', { class: 'cell-count' }, fmtDate(shinyAt.get(species.id)))))));

  // ---- tabs
  const tabs = [
    ['dex', `POKéDEX ${counts.size}/${dex.species.length}`, dexPanel],
    ['shiny', `SHINIES ${shinyCopies.length}`, shinyPanel],
  ];
  const tabButtons = tabs.map(([key, label]) =>
    h('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      onclick: () => {
        tab = key;
        ctx.sfx.play('click');
        paintTabs();
      },
    }, label));

  function paintTabs() {
    tabs.forEach(([key, , panel], i) => {
      const on = key === tab;
      panel.hidden = !on;
      tabButtons[i].classList.toggle('selected', on);
      tabButtons[i].setAttribute('aria-selected', String(on));
    });
  }

  root.append(
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'POKéDEX')),
    h('section', { class: 'box pad tiles', 'aria-label': 'Totals' },
      tile('POKéMON FOUND', `${counts.size}/${dex.species.length}`, 'UNIQUE SPECIES'),
      tile('POKéMON COLLECTED', fmtNumber(copies.length), 'INCLUDING DUPLICATES'),
      tile('SHINIES', fmtNumber(shinyCopies.length), null),
      tile('TIME SPENT', fmtTotal(chadMinutes + chudMinutes),
        `CHAD ${fmtTotal(chadMinutes)} · CHUD ${fmtTotal(chudMinutes)}`)),
    h('div', { class: 'tabs', role: 'tablist' }, tabButtons),
    dexPanel,
    shinyPanel,
  );
  paintTabs();
  apply();
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'label muted' }, label),
    h('div', { class: 'tile-value' }, value),
    sub ? h('div', { class: 'label muted' }, sub) : null);
}

function openDetail(ctx, species) {
  const { state } = ctx;
  ctx.sfx.play('click');
  const copies = collection(state).filter((r) => r.dexId === species.id);
  const owned = copies.length > 0;
  const hasShiny = copies.some((r) => r.shiny);
  const cap = TIERS[species.tier].cap;
  let showShiny = hasShiny;

  const art = h('div', { class: 'detail-art' });
  const buddyButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'SET AS BUDDY');
  const toggle = hasShiny ? h('button', { class: 'btn btn-small', type: 'button' }, '') : null;

  function paint() {
    art.replaceChildren(sprite(species, { shiny: showShiny, scale: 2, silhouette: !owned, eager: true }));
    if (toggle) toggle.textContent = showShiny ? 'SHOW NORMAL' : 'SHOW SHINY';
    const isBuddy = state.buddy && state.buddy.dexId === species.id && state.buddy.shiny === showShiny;
    buddyButton.textContent = isBuddy ? 'YOUR BUDDY' : 'SET AS BUDDY';
    buddyButton.disabled = Boolean(isBuddy);
  }
  if (toggle) {
    toggle.addEventListener('click', () => {
      showShiny = !showShiny;
      paint();
    });
  }
  buddyButton.addEventListener('click', () => {
    ctx.setBuddy(species.id, showShiny);
    paint();
  });
  paint();

  ctx.openModal(
    h('div', { class: 'stack' },
      h('div', { class: 'row between' },
        h('span', { class: 'label muted' }, dexNo(species.id)),
        owned ? h('span', { class: `badge badge-${species.tier}` }, TIERS[species.tier].label.toUpperCase()) : null),
      art,
      h('h2', { class: 'center' }, owned ? species.name.toUpperCase() : '?????'),
      owned
        ? [
            h('dl', { class: 'facts' },
              h('dt', {}, 'COPIES'), h('dd', {}, `${copies.length} OF ${cap}`),
              h('dt', {}, 'GENERATION'), h('dd', {}, String(species.gen)),
              h('dt', {}, 'SHINY'), h('dd', {}, hasShiny ? 'YES' : `ON COPY ${cap}`)),
            h('ol', { class: 'copies' },
              copies.map((r) => h('li', {},
                `${fmtDateTime(r.at)} · ${r.starter ? 'STARTER' : `${fmtNumber(r.trackPoints)} PTS`}${r.shiny ? ' · SHINY' : ''}${r.pity ? ' · PITY' : ''}`))),
          ]
        : h('p', { class: 'muted center' }, 'NOT FOUND YET. KEEP EARNING POINTS.'),
      h('div', { class: 'row end wrap' },
        toggle,
        owned ? buddyButton : null,
        h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => ctx.closeModal() }, 'CLOSE'))),
    { label: owned ? species.name : `Pokémon number ${species.id}`, kind: 'modal-small' },
  );
}
