/**
 * Pokédex.
 *
 *   - A compact bar of totals: species found, copies collected, shinies,
 *     and time spent (plain clock time, no multiplier or rating applied).
 *   - A three-way switch: ALL POKéMON, SHINIES, FUSED.
 *   - ALL POKéMON: search, tier filters, and a grid of every species by
 *     number. Unfound species are silhouettes with only their number.
 *   - SHINIES: just the shiny Pokémon you hold.
 *   - FUSED: the fusions, made or not.
 *
 * Tapping a Pokémon opens its entry: every form it has (Base, Alolan, Mega
 * ...), which are unlocked, what the others need, and buttons to buy a copy,
 * unlock an upgrade, or set the form on show as the buddy.
 */

import { h, sprite, fmtDateTime, fmtDate, fmtNumber } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS, countOwned, collection } from '../rewards.js';
import { BASE, formsOf, variantsOf, formLabel } from '../forms.js';
import { resolveMon } from '../mon.js';
import {
  COLLECTOR,
  copiesOf,
  hasShiny,
  isCollector,
  fusedCopies,
  unlockedForms,
  copyOffer,
  upgradeOffer,
  activeFusions,
} from '../shop.js';
import { buyButton, fusionCard } from './cards.js';

const FILTERS = [
  ['all', 'ALL'],
  ['owned', 'FOUND'],
  ['missing', 'MISSING'],
  ['legendary', 'LEGEND'],
  ['mythical', 'MYTHIC'],
];

/** Remembered while the page is open so going back and forth keeps your place. */
let tab = 'dex';
let filter = 'all';
let query = '';

const dexNo = (id) => `#${String(id).padStart(4, '0')}`;

/** Total recorded time as hours and minutes. */
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
  const minutes = state.sessions.reduce((sum, s) => sum + s.activeMinutes, 0);

  // ---- all Pokémon
  const cells = dex.species.map((species) => {
    const count = counts.get(species.id) || 0;
    const owned = count > 0;
    const shiny = shinyAt.has(species.id);
    const cap = TIERS[species.tier].cap;
    const el = h('button', {
      class: `cell tier-${species.tier}${owned ? ' owned' : ''}${shiny ? ' shiny' : ''}`,
      type: 'button',
      'aria-label': owned ? `${species.name}, ${count} copies${shiny ? ', shiny' : ''}` : `Number ${species.id}, not found yet`,
      onclick: () => openDetail(ctx, species),
    },
      sprite(species, { shiny, silhouette: !owned }),
      owned ? h('span', { class: 'cell-count' }, count <= cap ? `${count}/${cap}` : `${count}`) : null,
      shiny ? h('span', { class: 'cell-shiny' }, icon('sparkle', { scale: 2 })) : null,
      h('span', { class: 'cell-no' }, dexNo(species.id)),
      owned ? h('span', { class: 'cell-name' }, species.name) : null);
    return { el, species, owned };
  });

  const empty = h('p', { class: 'box pad muted', hidden: true }, 'NOTHING MATCHES.');

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
    placeholder: 'SEARCH NAME OR NUMBER',
    'aria-label': 'Search by name or number',
    value: query,
    oninput: () => {
      query = search.value;
      apply();
    },
  });

  const dexPanel = h('div', { class: 'stack', role: 'tabpanel', 'aria-label': 'All Pokémon' },
    h('div', { class: 'filters' }, search, h('div', { class: 'chips' }, filterButtons)),
    empty,
    h('div', { class: 'dex-grid' }, cells.map((c) => c.el)));

  // ---- shinies
  const shinyPanel = h('div', { class: 'stack', role: 'tabpanel', 'aria-label': 'Shinies' },
    shinyCopies.length === 0
      ? h('p', { class: 'box pad muted' },
          'NO SHINIES YET. THE COPY THAT COMPLETES A SET IS THE SHINY ONE: THE 7TH OF A COMMON, THE 5TH OF A LEGENDARY, THE 2ND OF A MYTHICAL.')
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
              h('span', { class: 'cell-name' }, species.name)))));

  // ---- fused
  const fusedCount = activeFusions(state).size;
  const fusedPanel = h('div', { class: 'stack', role: 'tabpanel', 'aria-label': 'Fused' },
    h('p', { class: 'box pad' },
      'A FUSION JOINS TWO POKéMON INTO A NEW ONE. IT NEEDS 2 SPARE COPIES OF EACH AND COSTS POKéCOINS. UNFUSING RETURNS THE TWO COPIES BUT NEVER THE COINS.'),
    h('div', { class: 'fusion-grid' }, ctx.forms.fusions.map((fusion) => fusionCard(ctx, fusion))));

  // ---- switch
  const tabs = [
    ['dex', 'ALL', dexPanel],
    ['shiny', `SHINIES ${shinyCopies.length}`, shinyPanel],
    ['fused', `FUSED ${fusedCount}`, fusedPanel],
  ];
  if (!tabs.some(([key]) => key === tab)) tab = 'dex';
  const tabButtons = tabs.map(([key, label]) =>
    h('button', {
      class: 'segment',
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

  const stat = (label, value) =>
    h('div', { class: 'stat' }, h('span', { class: 'label muted' }, label), h('span', { class: 'stat-value' }, value));

  root.append(
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'POKéDEX')),
    h('section', { class: 'box statbar', 'aria-label': 'Totals' },
      stat('FOUND', `${counts.size}/${dex.species.length}`),
      stat('COLLECTED', fmtNumber(copies.length)),
      stat('SHINIES', fmtNumber(shinyCopies.length)),
      stat('TIME', fmtTotal(minutes))),
    h('div', { class: 'segmented', role: 'tablist' }, tabButtons),
    dexPanel,
    shinyPanel,
    fusedPanel,
  );
  paintTabs();
  apply();
}

/**
 * One Pokémon's entry. The picture shows whichever form is selected in the
 * list below it; the buddy button sets exactly what is on show.
 */
function openDetail(ctx, species) {
  const { state, forms } = ctx;
  ctx.sfx.play('click');
  const copies = copiesOf(state, species.id);
  const owned = copies.length > 0;
  const shinyHeld = hasShiny(state, species.id);
  const cap = TIERS[species.tier].cap;
  const collector = isCollector(forms, species.id);
  const unlocked = unlockedForms(state, forms, species.id);
  const extra = formsOf(forms, species.id);
  const fused = fusedCopies(state, forms, species.id);

  // Open on the buddy's form when this Pokémon is the buddy, else on Base.
  const buddyHere = state.buddy && state.buddy.dexId === species.id;
  let selected = buddyHere && state.buddy.form && unlocked.has(state.buddy.form) ? state.buddy.form : BASE;
  let showShiny = buddyHere ? Boolean(state.buddy.shiny) && shinyHeld : shinyHeld;

  const art = h('div', { class: 'detail-art' });
  const title = h('h2', { class: 'center' });
  const toggle = shinyHeld ? h('button', { class: 'btn btn-small', type: 'button' }, '') : null;
  const buddyButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'SET AS BUDDY');
  const rows = h('div', { class: 'form-rows' });

  /** What the right-hand side of a form's row says or offers. */
  function status(form) {
    if (!form) return h('span', { class: 'label' }, owned ? 'UNLOCKED' : 'NOT FOUND YET');
    if (unlocked.has(form.key)) return h('span', { class: 'label' }, 'UNLOCKED');
    if (form.kind === 'upgrade') {
      const offer = upgradeOffer(state, forms, species, form);
      return buyButton({ label: 'UNLOCK', offer, onBuy: () => ctx.buyUpgrade(species, form) });
    }
    if (form.kind === 'milestone') {
      const needed = COLLECTOR.milestones[form.key];
      return h('span', { class: 'label muted' }, needed ? `AT ${needed} COPIES (${copies.length}/${needed})` : 'LOCKED');
    }
    if (form.sprite === false) return h('span', { class: 'label muted' }, 'ART NOT AVAILABLE YET');
    if (!owned) return h('span', { class: 'label muted' }, 'NOT FOUND YET');
    // Alternate forms arrive one per copy, in order: say which is next.
    const held = new Set(copies.map((c) => c.form || BASE));
    const next = variantsOf(forms, species.id).find((v) => !held.has(v.key));
    return h('span', { class: 'label muted' }, next && next.key === form.key ? 'WITH YOUR NEXT COPY' : 'WITH A LATER COPY');
  }

  function paint() {
    const mon = resolveMon(ctx, { dexId: species.id, form: selected });
    art.replaceChildren(sprite(mon, { shiny: showShiny, scale: 2, silhouette: !owned, eager: true }));
    title.replaceChildren(h('span', {}, owned ? mon.name : '?????'));
    if (toggle) toggle.textContent = showShiny ? 'SHOW NORMAL' : 'SHOW SHINY';
    const b = state.buddy;
    const isBuddy = Boolean(b && b.dexId === species.id && (b.form || BASE) === selected && Boolean(b.shiny) === showShiny);
    buddyButton.textContent = isBuddy ? 'YOUR BUDDY' : 'SET AS BUDDY';
    buddyButton.disabled = isBuddy;

    rows.replaceChildren(...[null, ...extra].map((form) => {
      const key = form ? form.key : BASE;
      const open = owned && unlocked.has(key);
      return h('div', { class: `form-row${key === selected ? ' selected' : ''}` },
        h('button', {
          class: 'form-pick',
          type: 'button',
          disabled: !open,
          'aria-pressed': String(key === selected),
          onclick: () => {
            selected = key;
            ctx.sfx.play('click');
            paint();
          },
        }, formLabel(forms, species.id, key)),
        status(form));
    }));
  }
  if (toggle) {
    toggle.addEventListener('click', () => {
      showShiny = !showShiny;
      paint();
    });
  }
  buddyButton.addEventListener('click', () => {
    ctx.setBuddy({ dexId: species.id, form: selected, shiny: showShiny });
    paint();
  });
  paint();

  const offer = copyOffer(state, forms, species);
  const limit = collector ? COLLECTOR.maxCopies : cap;

  ctx.openModal(
    h('div', { class: 'stack' },
      h('div', { class: 'row between' },
        h('span', { class: 'label muted' }, dexNo(species.id)),
        owned ? h('span', { class: `badge badge-${species.tier}` }, TIERS[species.tier].label.toUpperCase()) : null),
      art,
      title,
      extra.length > 0 || owned
        ? h('div', { class: 'stack tight' },
            extra.length > 0 ? h('div', { class: 'label muted' }, 'FORMS') : null,
            extra.length > 0 ? rows : null)
        : null,
      owned
        ? [
            h('dl', { class: 'facts' },
              h('dt', {}, 'COPIES'), h('dd', {}, copies.length <= limit ? `${copies.length} OF ${limit}` : `${copies.length} (SET OF ${limit} COMPLETE)`),
              fused > 0 ? [h('dt', {}, 'IN FUSIONS'), h('dd', {}, `${fused} (${copies.length - fused} SPARE)`)] : null,
              h('dt', {}, 'GENERATION'), h('dd', {}, String(species.gen)),
              h('dt', {}, 'SHINY'), h('dd', {}, shinyHeld ? 'YES' : `ON COPY ${cap}`)),
            h('div', { class: 'row between wrap' },
              h('span', { class: 'label' }, 'ANOTHER COPY'),
              buyButton({ label: 'BUY', offer, onBuy: () => ctx.buyCopy(species) })),
            h('ol', { class: 'copies' },
              copies.map((r) => h('li', {},
                [
                  fmtDateTime(r.at),
                  r.starter ? 'STARTER' : r.bought ? 'BOUGHT' : `${fmtNumber(r.trackPoints)} PTS`,
                  r.form && r.form !== BASE ? formLabel(forms, species.id, r.form) : null,
                  r.shiny ? 'SHINY' : null,
                  r.pity ? 'PITY' : null,
                ].filter(Boolean).join(' · ')))),
          ]
        : h('p', { class: 'muted center' }, 'NOT FOUND YET. KEEP EARNING POINTS.'),
      h('div', { class: 'row end wrap' },
        toggle,
        owned ? buddyButton : null,
        h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => { ctx.closeModal(); ctx.render(); } }, 'CLOSE'))),
    { label: owned ? species.name : `Pokémon number ${species.id}`, kind: 'modal-small' },
  );
}
