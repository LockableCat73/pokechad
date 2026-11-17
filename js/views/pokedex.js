/**
 * Pokédex.
 *
 *   - A compact bar of totals: species found, copies collected, shinies,
 *     and time spent (plain clock time, no multiplier or rating applied).
 *   - A three-way switch: ALL POKéMON, SHINIES, FUSED.
 *   - ALL POKéMON: search, tier filters, and a grid of every species by
 *     number. Unfound species are silhouettes with only their number. Every
 *     Pokémon is drawn in its normal colours here; one whose shiny you hold
 *     has a gold border and a sparkle.
 *   - SHINIES: just the shiny Pokémon you hold, in their shiny colours.
 *   - FUSED: the fusions, made or not.
 *
 * Tapping a Pokémon opens its entry (see openDetail): a full page with a
 * BACK button. It is a dialog in code, not a route, so it has no address of
 * its own and the Pokédex underneath keeps its place.
 */

import { h, sprite, fmtDateTime, fmtDate, fmtNumber } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS, countOwned } from '../rewards.js';
import { BASE, formsOf, variantsOf, formLabel, findForm, displayName } from '../forms.js';
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
import { coins } from '../pixelart.js';
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
  const copies = state.pokemon;
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
      'aria-label': owned ? `${species.name}, ${count} copies${shiny ? ', shiny held' : ''}` : `Number ${species.id}, not found yet`,
      onclick: () => openDetail(ctx, species),
    },
      // Always the normal colours here. The gold border and the sparkle say
      // the shiny is held; the SHINIES tab shows what it looks like.
      sprite(species, { silhouette: !owned }),
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

/** Copies and unlocks listed in an entry's history before "SHOW ALL". */
const HISTORY_PAGE = 12;

/**
 * One Pokémon's entry, as a full page.
 *
 *   BACK, number, tier
 *   the Pokémon:  a large picture of the form on show, its name, a switch
 *                 between normal and shiny (once the shiny is held), and the
 *                 buddy button, which sets exactly what is on show
 *   facts:        copies, spare copies, shiny, generation
 *   forms:        one tile per form, with its picture. An unlocked form can
 *                 be put on show; a locked one says what it needs, or
 *                 offers to unlock it
 *   another copy: the price, or why it cannot be bought
 *   history:      every copy and every form unlocked, newest first
 *
 * It is opened as a full-page dialog (ctx.openModal with `page`), and is
 * redrawn in place whenever the state changes, for example after buying a
 * copy from it.
 */
function openDetail(ctx, species) {
  ctx.sfx.play('click');
  const { forms } = ctx;
  const extra = formsOf(forms, species.id);
  const cap = TIERS[species.tier].cap;
  const collector = isCollector(forms, species.id);

  // What is on show. Kept while the entry is open, across redraws.
  // Opens on the buddy's form when this Pokémon is the buddy, else on Base
  // and in normal colours.
  const buddy = ctx.state.buddy;
  const buddyHere = Boolean(buddy && buddy.dexId === species.id);
  let selected = buddyHere && buddy.form ? buddy.form : BASE;
  let showShiny = buddyHere && Boolean(buddy.shiny);
  let showAll = false;

  const root = h('div', { class: 'stack' });

  function build() {
    const { state } = ctx;
    const copies = copiesOf(state, species.id);
    const owned = copies.length > 0;
    const shinyHeld = hasShiny(state, species.id);
    const unlocked = unlockedForms(state, forms, species.id);
    const fused = fusedCopies(state, forms, species.id);
    if (!unlocked.has(selected)) selected = BASE;
    if (!shinyHeld) showShiny = false;

    const mon = resolveMon(ctx, { dexId: species.id, form: selected });
    const b = state.buddy;
    const isBuddy = Boolean(b && b.dexId === species.id && (b.form || BASE) === selected && Boolean(b.shiny) === showShiny);
    const redraw = () => {
      ctx.sfx.play('click');
      build();
    };

    // ---- the Pokémon on show
    const hero = h('section', { class: `box entry-hero tier-${species.tier}${owned ? ' owned' : ''}`, 'aria-label': 'On show' },
      h('div', { class: `entry-art${showShiny ? ' shiny' : ''}` },
        sprite(mon, { shiny: showShiny, scale: 2, silhouette: !owned, eager: true }),
        showShiny ? h('span', { class: 'cell-shiny' }, icon('sparkle', { scale: 3 })) : null),
      h('div', { class: 'entry-id stack tight' },
        h('h1', { class: 'entry-name' }, owned ? mon.name : '?????'),
        owned
          ? h('div', { class: 'label muted' }, [
              selected === BASE ? (extra.length > 0 ? 'BASE FORM' : null) : `${formLabel(forms, species.id, selected)} FORM`,
              showShiny ? 'SHINY' : null,
            ].filter(Boolean).join(' · '))
          : h('p', { class: 'muted' }, 'NOT FOUND YET. KEEP EARNING POINTS.'),
        shinyHeld
          ? h('div', { class: 'segmented entry-switch', role: 'group', 'aria-label': 'Colours' },
              [[false, 'NORMAL'], [true, 'SHINY']].map(([value, text]) =>
                h('button', {
                  class: `segment${showShiny === value ? ' selected' : ''}`,
                  type: 'button',
                  'aria-pressed': String(showShiny === value),
                  onclick: () => {
                    showShiny = value;
                    redraw();
                  },
                }, text)))
          : null,
        owned
          ? h('button', {
              class: 'btn btn-primary',
              type: 'button',
              disabled: isBuddy,
              onclick: () => {
                ctx.setBuddy({ dexId: species.id, form: selected, shiny: showShiny });
                ctx.render();
              },
            }, isBuddy ? 'YOUR BUDDY' : 'SET AS BUDDY')
          : null));

    // ---- facts
    const limit = collector ? COLLECTOR.maxCopies : cap;
    const fact = (label, value, note) =>
      h('div', { class: 'box fact' },
        h('span', { class: 'label muted' }, label),
        h('span', { class: 'fact-value' }, value),
        note ? h('span', { class: 'label muted' }, note) : null);
    const facts = owned
      ? h('section', { class: 'entry-facts', 'aria-label': 'Facts' },
          fact('COPIES', copies.length <= limit ? `${copies.length}/${limit}` : String(copies.length), copies.length > limit ? `SET OF ${limit} COMPLETE` : null),
          fact('SPARE', String(copies.length - fused), fused > 0 ? `${fused} IN FUSIONS` : null),
          fact('SHINY', shinyHeld ? 'YES' : 'NO', shinyHeld ? null : `ON COPY ${cap}`),
          fact('GENERATION', String(species.gen)))
      : null;

    // ---- forms
    const held = new Set(copies.map((c) => c.form || BASE));
    const nextVariant = variantsOf(forms, species.id).find((v) => !held.has(v.key));
    /** What a locked form's tile says or offers. */
    function locked(form) {
      if (form.kind === 'upgrade') {
        return buyButton({ label: 'UNLOCK', offer: upgradeOffer(state, forms, species, form), onBuy: () => ctx.buyUpgrade(species, form) });
      }
      let text;
      if (form.kind === 'milestone') {
        const needed = COLLECTOR.milestones[form.key];
        text = needed ? `AT ${needed} COPIES (${copies.length}/${needed})` : 'LOCKED';
      } else if (form.sprite === false) text = 'ART NOT AVAILABLE YET';
      else if (!owned) text = 'NOT FOUND YET';
      // Alternate forms arrive one per copy, in order: say which is next.
      else text = nextVariant && nextVariant.key === form.key ? 'WITH YOUR NEXT COPY' : 'WITH A LATER COPY';
      return h('span', { class: 'label muted' }, text);
    }
    const formTile = (form) => {
      const key = form ? form.key : BASE;
      const open = owned && unlocked.has(key);
      const on = open && key === selected;
      const picture = resolveMon(ctx, { dexId: species.id, form: key });
      return h('div', { class: `box form-tile${open ? ' open' : ''}${on ? ' selected' : ''}` },
        h('button', {
          class: 'form-pick',
          type: 'button',
          disabled: !open,
          'aria-pressed': String(on),
          'aria-label': `${formLabel(forms, species.id, key)}${open ? '' : ', locked'}`,
          onclick: () => {
            selected = key;
            redraw();
          },
        },
          sprite(picture, { shiny: open && showShiny, silhouette: !open }),
          h('span', { class: 'form-name' }, formLabel(forms, species.id, key))),
        open
          ? h('span', { class: `label${on ? '' : ' muted'}` }, on ? 'ON SHOW' : 'UNLOCKED')
          : form ? locked(form) : h('span', { class: 'label muted' }, 'NOT FOUND YET'));
    };
    const total = extra.length + 1;
    const formsSection = extra.length > 0
      ? h('section', { class: 'stack tight', 'aria-label': 'Forms' },
          h('div', { class: 'row between' },
            h('h2', {}, 'FORMS'),
            h('span', { class: 'label muted' }, `${unlocked.size}/${total} UNLOCKED`)),
          h('div', { class: 'form-grid' }, [null, ...extra].map(formTile)))
      : null;

    // ---- another copy
    const copyRow = owned
      ? h('section', { class: 'box pad row between wrap', 'aria-label': 'Another copy' },
          h('div', { class: 'stack tight' },
            h('h2', {}, 'ANOTHER COPY'),
            h('span', { class: 'label muted' },
              collector ? `EVERY COPY COUNTS TOWARDS ${species.name}'S FORMS`
                : shinyHeld ? 'EXTRA COPIES ARE SPARES FOR FUSIONS AND FORMS'
                  : copies.length + 1 === cap ? 'THE NEXT COPY IS THE SHINY ONE'
                    : `THE SHINY IS COPY ${cap}`)),
          buyButton({ label: 'BUY', offer: copyOffer(state, forms, species), onBuy: () => ctx.buyCopy(species) }))
      : null;

    // ---- history: copies and unlocked forms, newest first
    const events = [];
    copies.forEach((copy, i) => events.push({ at: copy.at, order: events.length, copy, number: i + 1 }));
    for (const entry of state.unlocks || []) {
      if (entry.dexId === species.id) events.push({ at: entry.at, order: events.length, unlock: entry });
    }
    events.sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || y.order - x.order);
    const eventRow = ({ copy, number, unlock, at }) => {
      if (unlock) {
        const form = findForm(forms, species.id, unlock.form);
        return h('li', { class: 'history-row' },
          h('span', { class: 'history-what' }, `FORM: ${form ? displayName(species.name, form) : unlock.form}`),
          h('span', { class: 'label muted' }, [
            fmtDateTime(at),
            unlock.source === 'bonus' ? 'BONUS WITH A REWARD' : unlock.source === 'gift' ? 'GIFT' : 'UNLOCKED IN THE SHOP',
          ].join(' · ')),
          unlock.cost > 0 ? coins(unlock.cost) : null);
      }
      const where =
        copy.source === 'starter' ? 'STARTER'
          : copy.source === 'shop' ? 'BOUGHT IN THE SHOP'
            : copy.source === 'gift' ? 'GIFT'
              : `REWARD AT ${fmtNumber(copy.trackPoints)} PTS`;
      return h('li', { class: `history-row${copy.shiny ? ' shiny' : ''}` },
        h('span', { class: 'history-what' }, [
          `COPY ${number}`,
          copy.form && copy.form !== BASE ? formLabel(forms, species.id, copy.form) : null,
          copy.shiny ? 'SHINY' : null,
          copy.pity ? 'PITY' : null,
        ].filter(Boolean).join(' · ')),
        h('span', { class: 'label muted' }, `${fmtDateTime(at)} · ${where}`),
        copy.source === 'shop' && copy.cost > 0 ? coins(copy.cost) : null);
    };
    const shownEvents = showAll ? events : events.slice(0, HISTORY_PAGE);
    const history = owned
      ? h('section', { class: 'stack tight', 'aria-label': 'History' },
          h('div', { class: 'row between' },
            h('h2', {}, 'HISTORY'),
            h('span', { class: 'label muted' }, 'NEWEST FIRST')),
          h('ol', { class: 'box history-rows' }, shownEvents.map(eventRow)),
          events.length > shownEvents.length
            ? h('div', { class: 'center' },
                h('button', {
                  class: 'btn',
                  type: 'button',
                  onclick: () => {
                    showAll = true;
                    redraw();
                  },
                }, `SHOW ALL ${events.length}`))
            : null)
      : null;

    root.replaceChildren(...[
      h('div', { class: 'page-head' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.closeModal() }, '◀ BACK'),
        h('span', { class: 'entry-no' }, dexNo(species.id)),
        h('span', { class: 'grow' }),
        owned ? h('span', { class: `badge badge-${species.tier}` }, TIERS[species.tier].label.toUpperCase()) : null),
      hero,
      facts,
      formsSection,
      copyRow,
      history,
    ].filter(Boolean));
  }

  build();
  const owned = copiesOf(ctx.state, species.id).length > 0;
  ctx.openModal(root, {
    page: true,
    label: owned ? species.name : `Pokémon number ${species.id}`,
    refresh: build,
  });
}
