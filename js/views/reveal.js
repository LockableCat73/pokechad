/**
 * The reward encounter.
 *
 * By the time this opens the Pokémon has already been rolled at random and
 * saved (see rewards.js and app.js); the roll happens the moment a new mark
 * on the track is reached, never earlier. What plays here is the reveal:
 *
 *   1. encounter  a black silhouette appears: "WHO'S THAT POKéMON?"
 *   2. throw      the player presses THROW POKé BALL; the ball arcs in, hits,
 *                 drops, wobbles three times and clicks shut with three stars
 *   3. reveal     the ball opens and the Pokémon is shown in colour with its
 *                 name, tier, copy number and a shiny sparkle if it is one
 *
 * Several rewards play one after another; "SKIP ALL" jumps to a summary.
 * The starter was chosen by the player, so it skips straight to step 3.
 * Animations use stepped timing so motion stays pixel-like, and the throw is
 * skipped for people who ask their system for reduced motion.
 */

import { h, sprite } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS, countOwned, collection } from '../rewards.js';

/** Timeline of the throw, in milliseconds after the button is pressed. */
const T_HIT = 600;
const T_WOBBLE = 900;
const T_CAUGHT = 2400;
const T_OPEN = 3200;

/**
 * @param {object} ctx     App context.
 * @param {Array}  granted The copies just added to the collection, in order.
 *                         May start with the starter (a record with `starter: true`).
 */
export function showReveal(ctx, granted) {
  const reduced = globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = h('div', { class: 'reveal' });
  let index = 0;
  let timers = [];

  // Copies owned *as of each reward*, so "COPY 3 OF 7" is right mid-sequence.
  const before = countOwned(collection(ctx.state));
  for (const reward of granted) before.set(reward.dexId, before.get(reward.dexId) - 1);
  const copyNumber = granted.map((reward) => {
    const n = (before.get(reward.dexId) || 0) + 1;
    before.set(reward.dexId, n);
    return n;
  });

  const later = (ms, fn) => timers.push(setTimeout(() => root.isConnected && fn(), ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const heading = (reward) => (reward.starter ? 'YOUR STARTER' : `REWARD AT ${reward.trackPoints} POINTS`);
  const remaining = () => granted.length - index - 1;
  const skipButton = (count) =>
    count > 1 ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: summary }, `SKIP ALL (${count})`) : null;

  function begin() {
    if (granted[index].starter) reveal();
    else encounter();
  }

  /** Step 1: the silhouette. */
  function encounter() {
    stop();
    const reward = granted[index];
    const species = ctx.dex.byId.get(reward.dexId);
    const throwButton = h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: throwBall }, 'THROW POKé BALL');
    root.className = 'reveal';
    root.replaceChildren(
      h('div', { class: 'label' }, heading(reward)),
      h('div', { class: 'stage' },
        h('div', { class: 'stage-mon appear' }, sprite(species, { scale: 2, silhouette: true, eager: true }))),
      h('div', { class: 'reveal-name' }, "WHO'S THAT POKéMON?"),
      h('div', { class: 'reveal-footer' }, throwButton, skipButton(remaining() + 1)),
    );
    ctx.sfx.play('appear');
    throwButton.focus();
  }

  /** Step 2: the throw. */
  function throwBall() {
    if (reduced) {
      reveal();
      return;
    }
    const stage = root.querySelector('.stage');
    const mon = root.querySelector('.stage-mon');
    const name = root.querySelector('.reveal-name');
    root.querySelector('.reveal-footer').replaceChildren(
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: reveal }, 'SKIP'));

    const ball = h('div', { class: 'stage-ball throw-x' },
      h('span', { class: 'stage-ball-y' },
        h('span', { class: 'stage-ball-spin' }, icon('pokeball', { scale: 3, label: 'Poké Ball' }))));
    stage.append(ball);
    name.textContent = '. . .';
    ctx.sfx.play('throw');

    later(T_HIT, () => {
      mon.className = 'stage-mon hit';
      stage.append(h('span', { class: 'flash' }));
      ball.className = 'stage-ball drop';
      ctx.sfx.play('hit');
    });
    later(T_WOBBLE, () => {
      ball.className = 'stage-ball wobble';
      ctx.sfx.play('wobble');
    });
    later(T_WOBBLE + 500, () => ctx.sfx.play('wobble'));
    later(T_WOBBLE + 1000, () => ctx.sfx.play('wobble'));
    later(T_CAUGHT, () => {
      ball.className = 'stage-ball caught';
      name.textContent = 'GOTCHA!';
      // The classic catch: three stars pop out of the ball as it locks.
      stage.append(...[0, 1, 2].map((i) => h('span', { class: `catch-star c${i}` }, icon('star', { scale: 2 }))));
      ctx.sfx.play('caught');
    });
    later(T_OPEN, reveal);
  }

  /** Step 3: the Pokémon in colour. */
  function reveal() {
    stop();
    const reward = granted[index];
    const species = ctx.dex.byId.get(reward.dexId);
    const cap = TIERS[reward.tier].cap;
    const copy = copyNumber[index];
    ctx.sfx.play(reward.shiny ? 'shiny' : reward.tier === 'common' ? 'reward' : 'legendary');

    const sparkles = reward.shiny
      ? [0, 1, 2, 3, 4, 5].map((i) => h('span', { class: `sparkle s${i}` }, icon('sparkle', { scale: 3 })))
      : null;

    root.className = `reveal opened tier-${reward.tier}${reward.shiny ? ' is-shiny' : ''}`;
    root.replaceChildren(
      h('div', { class: 'label' }, heading(reward)),
      h('div', { class: 'stage' },
        h('span', { class: 'flash' }),
        h('div', { class: 'stage-mon pop' }, sprite(species, { shiny: reward.shiny, scale: 2, eager: true })),
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
      h('div', { class: 'reveal-footer' },
        h('button', {
          class: 'btn btn-primary btn-big',
          type: 'button',
          onclick: () => {
            index++;
            if (index < granted.length) begin();
            else done();
          },
        }, remaining() > 0 ? 'NEXT' : 'OK'),
        skipButton(remaining())),
    );
    root.querySelector('.btn-primary').focus();
  }

  function summary() {
    stop();
    index = granted.length;
    root.className = 'reveal opened';
    root.replaceChildren(
      h('div', { class: 'label' }, `${granted.length} NEW POKéMON`),
      h('div', { class: 'reveal-grid' },
        granted.map((reward) => {
          const species = ctx.dex.byId.get(reward.dexId);
          return h('div', { class: `cell owned tier-${reward.tier}${reward.shiny ? ' shiny' : ''}` },
            sprite(species, { shiny: reward.shiny, eager: true }),
            h('span', { class: 'cell-name' }, species ? species.name : `#${reward.dexId}`));
        })),
      h('div', { class: 'reveal-footer' }, h('button', { class: 'btn btn-primary btn-big', type: 'button', autofocus: true, onclick: done }, 'OK')),
    );
  }

  function done() {
    stop();
    ctx.closeModal();
    ctx.render();
  }

  ctx.openModal(root, { locked: true, label: 'New Pokémon', kind: 'modal-reveal' });
  begin();
}
