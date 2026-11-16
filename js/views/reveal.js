/**
 * The reward reveal: a Poké Ball wobbles, opens with a flash, and shows the
 * Pokémon. Several rewards play one after another; "SKIP ALL" jumps to a
 * summary. Animations use stepped timing so motion stays pixel-like, and are
 * skipped for people who ask their system for reduced motion.
 */

import { h, sprite } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS, countOwned, collection } from '../rewards.js';

const WOBBLE_MS = 1500;

/**
 * @param {object} ctx     App context.
 * @param {Array}  granted The copies just added to the collection, in order.
 *                         May start with the starter (a record with `starter: true`).
 */
export function showReveal(ctx, granted) {
  const reduced = globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = h('div', { class: 'reveal' });
  let index = 0;
  let timer = 0;

  // Copies owned *as of each reward*, so "COPY 3 OF 7" is right mid-sequence.
  const before = countOwned(collection(ctx.state));
  for (const reward of granted) before.set(reward.dexId, before.get(reward.dexId) - 1);
  const copyNumber = granted.map((reward) => {
    const n = (before.get(reward.dexId) || 0) + 1;
    before.set(reward.dexId, n);
    return n;
  });

  function showBall() {
    clearTimeout(timer);
    const reward = granted[index];
    stage.className = 'reveal';
    stage.replaceChildren(
      h('div', { class: 'label' }, heading(reward)),
      h('div', { class: 'reveal-art' }, h('span', { class: 'ball wobble' }, icon('pokeball', { scale: 6, label: 'Poké Ball' }))),
      h('div', { class: 'reveal-name' }, '. . .'),
      footer(false),
    );
    if (reduced) {
      showPokemon();
      return;
    }
    [0, 500, 1000].forEach((at) => setTimeout(() => stage.isConnected && index < granted.length && ctx.sfx.play('wobble'), at));
    timer = setTimeout(showPokemon, WOBBLE_MS);
  }

  function showPokemon() {
    clearTimeout(timer);
    const reward = granted[index];
    const species = ctx.dex.byId.get(reward.dexId);
    const cap = TIERS[reward.tier].cap;
    const copy = copyNumber[index];
    ctx.sfx.play(reward.shiny ? 'shiny' : reward.tier === 'common' ? 'reward' : 'legendary');

    const sparkles = reward.shiny
      ? [0, 1, 2, 3, 4, 5].map((i) => h('span', { class: `sparkle s${i}` }, icon('sparkle', { scale: 3 })))
      : null;

    stage.className = `reveal opened tier-${reward.tier}${reward.shiny ? ' is-shiny' : ''}`;
    stage.replaceChildren(
      h('div', { class: 'label' }, heading(reward)),
      h('div', { class: 'reveal-art' },
        h('span', { class: 'flash' }),
        h('span', { class: 'pop' }, sprite(species, { shiny: reward.shiny, scale: 2, eager: true })),
        sparkles),
      h('div', { class: 'reveal-name' }, species ? species.name.toUpperCase() : `#${reward.dexId}`),
      h('div', { class: 'badges' },
        reward.starter
          ? h('span', { class: 'badge badge-new' }, 'STARTER')
          : h('span', { class: `badge badge-${reward.tier}` }, TIERS[reward.tier].label.toUpperCase()),
        reward.shiny ? h('span', { class: 'badge badge-shiny' }, 'SHINY') : null,
        copy === 1 && !reward.starter ? h('span', { class: 'badge badge-new' }, 'NEW') : null,
        reward.pity ? h('span', { class: 'badge' }, 'PITY') : null),
      h('div', { class: 'label muted' }, `#${String(reward.dexId).padStart(4, '0')} · COPY ${copy} OF ${cap}`),
      footer(true),
    );
    const next = stage.querySelector('.btn-primary');
    if (next) next.focus();
  }

  function heading(reward) {
    return reward.starter ? 'YOUR STARTER' : `REWARD AT ${reward.trackPoints} POINTS`;
  }

  function footer(opened) {
    const remaining = granted.length - index - 1;
    return h('div', { class: 'row end reveal-footer' },
      remaining > 0
        ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: summary }, `SKIP ALL (${remaining + (opened ? 0 : 1)})`)
        : null,
      opened
        ? h('button', {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => {
              index++;
              if (index < granted.length) showBall();
              else done();
            },
          }, remaining > 0 ? 'NEXT' : 'OK')
        : h('button', { class: 'btn', type: 'button', onclick: showPokemon }, 'OPEN'));
  }

  function summary() {
    clearTimeout(timer);
    index = granted.length;
    stage.className = 'reveal opened';
    stage.replaceChildren(
      h('div', { class: 'label' }, `${granted.length} NEW POKéMON`),
      h('div', { class: 'reveal-grid' },
        granted.map((reward) => {
          const species = ctx.dex.byId.get(reward.dexId);
          return h('div', { class: `cell owned tier-${reward.tier}${reward.shiny ? ' shiny' : ''}` },
            sprite(species, { shiny: reward.shiny, eager: true }),
            h('span', { class: 'cell-name' }, species ? species.name : `#${reward.dexId}`));
        })),
      h('div', { class: 'row end' }, h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: done }, 'OK')),
    );
  }

  function done() {
    clearTimeout(timer);
    ctx.closeModal();
    ctx.render();
  }

  ctx.openModal(stage, { locked: true, label: 'New Pokémon', kind: 'modal-reveal' });
  showBall();
}
