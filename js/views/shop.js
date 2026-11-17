/**
 * The Shop: everything Pokécoins can buy, in one place.
 *
 *   1. Balance, and how coins are earned.
 *   2. Zygarde's progress (only once it has been found).
 *   3. Fusions.
 *   4. Upgrade forms (Mega, Gigantamax ...) for Pokémon you hold.
 *   5. Copies of Pokémon you have found, nearest to their shiny first.
 *   6. Recent activity: purchases, bonus forms, coins granted.
 *
 * Buying always goes through a confirmation dialog (see the shop actions in
 * app.js). The rules themselves live in js/shop.js.
 */

import { h, sprite, fmtDateTime, fmtNumber } from '../dom.js';
import { coins } from '../pixelart.js';
import { TIERS, countOwned } from '../rewards.js';
import { formsOf, findForm, displayName, formLabel } from '../forms.js';
import { resolveMon } from '../mon.js';
import {
  COLLECTOR,
  coinsEarned,
  coinsSpent,
  balance,
  copiesOf,
  hasShiny,
  isCollector,
  unlockedForms,
  copyOffer,
  upgradeOffer,
  activity,
} from '../shop.js';
import { buyButton, fusionCard } from './cards.js';

/** Items shown in a list before "SHOW MORE". */
const PAGE = 8;

/** How far each list has been expanded; kept while the page is open. */
const shown = { upgrades: PAGE, copies: PAGE };

export function render(ctx, root) {
  const { state, dex, forms } = ctx;
  const counts = countOwned(state.pokemon);
  const found = dex.species.filter((s) => (counts.get(s.id) || 0) > 0);
  const owned = balance(state);

  const parts = [
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'SHOP')),
    h('section', { class: 'box pad wallet', 'aria-label': 'Pokécoins' },
      h('div', { class: 'wallet-amount' }, coins(fmtNumber(owned), 2)),
      h('div', { class: 'stack tight' },
        h('p', {}, 'YOU EARN 1 POKéCOIN FOR EVERY REWARD ON THE TRACK.'),
        h('p', { class: 'label muted' }, `EARNED ${fmtNumber(coinsEarned(state))} · SPENT ${fmtNumber(coinsSpent(state))}`))),
    ...found.filter((s) => isCollector(forms, s.id)).map((s) => collectorPanel(ctx, s)),
    fusionSection(ctx),
    upgradeSection(ctx, found),
    copySection(ctx, found, counts),
    recentSection(ctx),
  ];
  root.append(...parts.filter(Boolean));
}

/** Zygarde: cheap copies, and forms that unlock at copy counts. */
function collectorPanel(ctx, species) {
  const { state, forms } = ctx;
  const copies = copiesOf(state, species.id).length;
  const unlocked = unlockedForms(state, forms, species.id);
  const offer = copyOffer(state, forms, species);
  const left = COLLECTOR.maxCopies - copies;
  const ten = Math.min(10, left);

  const segments = [];
  for (let i = 0; i < 20; i++) segments.push(h('i', { class: i < Math.floor((copies / COLLECTOR.maxCopies) * 20) ? 'on' : '' }));

  const steps = formsOf(forms, species.id)
    .slice()
    .sort((a, b) => (COLLECTOR.milestones[a.key] || 1e9) - (COLLECTOR.milestones[b.key] || 1e9))
    .map((form) => {
      const has = unlocked.has(form.key);
      let right;
      if (has) right = h('span', { class: 'label' }, 'UNLOCKED');
      else if (form.kind === 'milestone') right = h('span', { class: 'label muted' }, `AT ${COLLECTOR.milestones[form.key]} COPIES`);
      else right = buyButton({ label: 'UNLOCK', offer: upgradeOffer(state, forms, species, form), onBuy: () => ctx.buyUpgrade(species, form) });
      return h('div', { class: 'form-row' }, h('span', {}, form.label), right);
    });

  return h('section', { class: 'box pad stack', 'aria-label': species.name },
    h('h2', {}, species.name),
    h('div', { class: 'collector' },
      sprite(species, { shiny: hasShiny(state, species.id), eager: true }),
      h('div', { class: 'stack tight grow' },
        h('div', { class: 'row between' },
          h('span', { class: 'label' }, 'COPIES'),
          h('span', { class: 'label' }, `${copies} / ${COLLECTOR.maxCopies}`)),
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(COLLECTOR.maxCopies), 'aria-valuenow': String(copies) }, segments),
        h('div', { class: 'row wrap' },
          buyButton({ label: 'BUY 1', offer, onBuy: () => ctx.buyCopy(species) }),
          offer.ok && ten > 1 && balance(state) >= ten * offer.price
            ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.buyCopies(species, ten) }, `BUY ${ten}`, coins(ten * offer.price))
            : null))),
    h('div', { class: 'form-rows' }, steps));
}

function fusionSection(ctx) {
  return h('section', { class: 'stack', 'aria-label': 'Fusions' },
    h('h2', { class: 'section-title' }, 'FUSIONS'),
    h('p', { class: 'box pad' },
      'NEEDS 2 SPARE COPIES OF EACH POKéMON. FUSING SETS ONE OF EACH ASIDE. UNFUSING RETURNS THE TWO COPIES BUT NEVER THE COINS.'),
    h('div', { class: 'fusion-grid' }, ctx.forms.fusions.map((fusion) => fusionCard(ctx, fusion))));
}

/** Upgrade forms not yet unlocked, for Pokémon the player holds. */
function upgradeSection(ctx, found) {
  const { state, forms } = ctx;
  const items = [];
  for (const species of found) {
    if (isCollector(forms, species.id)) continue; // shown in its own panel
    for (const form of formsOf(forms, species.id)) {
      if (form.kind !== 'upgrade') continue;
      const offer = upgradeOffer(state, forms, species, form);
      if (!offer.owned) items.push({ species, form, offer });
    }
  }
  // What can be bought now comes first, then by Pokédex number.
  items.sort((a, b) => Number(b.offer.ok) - Number(a.offer.ok) || a.species.id - b.species.id);

  const grid = h('div', { class: 'shop-grid' });
  const more = h('button', { class: 'btn', type: 'button' }, 'SHOW MORE');
  function paint() {
    grid.replaceChildren(...items.slice(0, shown.upgrades).map(({ species, form, offer }) => {
      const mon = resolveMon(ctx, { dexId: species.id, form: form.key });
      return h('div', { class: `box shop-item${offer.ok ? '' : ' dim'}` },
        sprite(mon, {}),
        h('span', { class: 'cell-name' }, displayName(species.name, form)),
        buyButton({ label: 'UNLOCK', offer, onBuy: () => ctx.buyUpgrade(species, form) }));
    }));
    more.hidden = items.length <= shown.upgrades;
  }
  more.addEventListener('click', () => {
    shown.upgrades += PAGE;
    paint();
  });
  paint();

  return h('section', { class: 'stack', 'aria-label': 'Upgrade forms' },
    h('h2', { class: 'section-title' }, 'UPGRADE FORMS'),
    items.length === 0
      ? h('p', { class: 'box pad muted' }, 'NOTHING TO UNLOCK YET. MEGA, GIGANTAMAX AND SIMILAR FORMS APPEAR HERE ONCE YOU HOLD A POKéMON THAT HAS ONE.')
      : [grid, h('div', { class: 'center' }, more)]);
}

/** Copies of Pokémon already found, the ones closest to their shiny first. */
function copySection(ctx, found, counts) {
  const { state, forms } = ctx;
  const items = found
    .filter((species) => !isCollector(forms, species.id))
    .map((species) => ({ species, offer: copyOffer(state, forms, species), count: counts.get(species.id), shiny: hasShiny(state, species.id) }))
    .filter((item) => item.offer.reason !== 'COPY LIMIT REACHED')
    .sort((a, b) =>
      Number(a.shiny) - Number(b.shiny) ||
      (TIERS[a.species.tier].cap - a.count) - (TIERS[b.species.tier].cap - b.count) ||
      a.species.id - b.species.id);

  const grid = h('div', { class: 'shop-grid' });
  const more = h('button', { class: 'btn', type: 'button' }, 'SHOW MORE');
  function paint() {
    grid.replaceChildren(...items.slice(0, shown.copies).map(({ species, offer, count, shiny }) => {
      const cap = TIERS[species.tier].cap;
      return h('div', { class: `box shop-item${offer.ok ? '' : ' dim'}` },
        sprite(species, { shiny }),
        h('span', { class: 'cell-name' }, species.name),
        h('span', { class: 'label muted' }, count < cap ? `${count}/${cap}${count + 1 === cap ? ' · NEXT IS SHINY' : ''}` : `${count} HELD`),
        buyButton({ label: 'BUY', offer, onBuy: () => ctx.buyCopy(species) }));
    }));
    more.hidden = items.length <= shown.copies;
  }
  more.addEventListener('click', () => {
    shown.copies += PAGE;
    paint();
  });
  paint();

  return h('section', { class: 'stack', 'aria-label': 'Copies' },
    h('h2', { class: 'section-title' }, 'COPIES'),
    items.length === 0
      ? h('p', { class: 'box pad muted' }, 'FIND A POKéMON ON THE TRACK FIRST. THE SHOP ONLY SELLS COPIES OF POKéMON YOU HAVE ALREADY FOUND.')
      : [grid, h('div', { class: 'center' }, more)]);
}

/** The last few things that happened to the coins, newest first. */
function recentSection(ctx) {
  const { state, dex, forms } = ctx;
  const recent = activity(state).slice(0, 8);
  if (recent.length === 0) return null;
  const line = (entry) => {
    if (entry.type === 'grant') return `GRANTED ${fmtNumber(entry.coins)} COINS`;
    if (entry.type === 'fuse' || entry.type === 'unfuse') {
      const fusion = forms.fusionById.get(entry.fusion);
      return `${entry.type === 'fuse' ? 'FUSED' : 'UNFUSED'} ${fusion ? fusion.label : `#${entry.fusion}`}`;
    }
    const species = dex.byId.get(entry.dexId);
    const name = species ? species.name : `#${entry.dexId}`;
    if (entry.type === 'upgrade' || entry.type === 'bonus') {
      const form = findForm(forms, entry.dexId, entry.form);
      const full = form && species ? displayName(name, form) : `${name} ${entry.form}`;
      return entry.type === 'bonus' ? `BONUS FORM: ${full}` : `UNLOCKED ${full}`;
    }
    const form = entry.form ? ` (${formLabel(forms, entry.dexId, entry.form)})` : '';
    return `BOUGHT ${name}${form}${entry.shiny ? ' · SHINY' : ''}`;
  };
  return h('section', { class: 'box pad stack', 'aria-label': 'Recent activity' },
    h('h2', {}, 'RECENT'),
    h('ol', { class: 'ledger' },
      recent.map((entry) =>
        h('li', {},
          h('span', {}, line(entry)),
          h('span', { class: 'label muted' }, fmtDateTime(entry.at)),
          entry.cost > 0 ? coins(entry.cost) : h('span', { class: 'label muted' }, entry.type === 'grant' ? '' : 'FREE')))));
}
