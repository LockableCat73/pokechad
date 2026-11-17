/**
 * The reward encounter.
 *
 * By the time this opens the Pokémon has already been rolled at random and
 * saved (see rewards.js and app.js); the roll happens the moment a new mark
 * on the track is reached, never earlier. What plays here is the reveal:
 *
 *   1. encounter  a black silhouette appears: "WHO'S THAT POKéMON?"
 *   2. throw      the player presses THROW POKé BALL; the ball arcs in, hits,
 *                 drops, wobbles three times with its centre button blinking
 *                 red on each shake, and clicks shut with three stars
 *   3. reveal     the ball opens and the Pokémon is shown in colour with its
 *                 name, tier, copy number and a shiny sparkle if it is one
 *
 * Several rewards play one after another; "SKIP ALL" jumps to a summary.
 * Animations use stepped timing so motion stays pixel-like, and the throw is
 * skipped for people who ask their system for reduced motion.
 *
 * Only a reward rolled on the track gets steps 1 and 2. Everything else goes
 * straight to step 3: the starter, a copy bought in the shop, a form that
 * has just been unlocked (bought, or as a bonus with a reward), and a fusion.
 */

import { h, sprite } from '../dom.js';
import { icon } from '../pixelart.js';
import { TIERS } from '../rewards.js';
import { BASE } from '../forms.js';
import { resolveMon } from '../mon.js';

/** Timeline of the throw, in milliseconds after the button is pressed. */
const T_HIT = 600;
const T_WOBBLE = 900;
const T_CAUGHT = 2400;
const T_OPEN = 3200;

/**
 * @param {object} ctx   App context.
 * @param {Array}  items What to show, in order. Each is one of:
 *   - a copy just added to state.pokemon: a track reward (`source: "track"`),
 *     the starter (`source: "starter"`) or a bought copy (`source: "shop"`;
 *     `copyNumber` may say which copy it was);
 *   - a form or fusion just unlocked (`unlockedForm: true`, with `dexId` and
 *     `form`, or with `fusion`). This is not a copy and has no copy number.
 *     `bonus: true` marks a form that came free with a track reward.
 */
export function showReveal(ctx, items) {
  const reduced = globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = h('div', { class: 'reveal' });
  let index = 0;
  let timers = [];

  // For each copy shown: which copy of its species it is, and whether it is
  // the first to arrive in its form. Worked out as of that copy, so the
  // numbers are right in the middle of a sequence. Start from everything
  // held now, take the new copies back out, then add them one at a time.
  const isCopy = (item) => !item.unlockedForm;
  const formOf = (item) => item.form || BASE;
  const held = new Map(); // dexId -> Map(form -> count)
  const bump = (item, by) => {
    if (!held.has(item.dexId)) held.set(item.dexId, new Map());
    const forms = held.get(item.dexId);
    forms.set(formOf(item), (forms.get(formOf(item)) || 0) + by);
  };
  for (const copy of ctx.state.pokemon) bump(copy, 1);
  for (const item of items) if (isCopy(item)) bump(item, -1);
  const info = items.map((item) => {
    if (!isCopy(item)) return { copy: 0, newForm: false };
    const forms = held.get(item.dexId);
    const total = [...forms.values()].reduce((sum, n) => sum + n, 0);
    const newForm = formOf(item) !== BASE && !(forms.get(formOf(item)) > 0);
    bump(item, 1);
    // A bulk purchase shows only some of its copies and says which each was.
    return { copy: item.copyNumber || total + 1, newForm };
  });

  const later = (ms, fn) => timers.push(setTimeout(() => root.isConnected && fn(), ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const heading = (item) => {
    if (item.source === 'starter') return 'YOUR STARTER';
    if (item.fusion) return 'FUSION COMPLETE';
    if (item.bonus) return 'BONUS FORM';
    if (item.unlockedForm) return 'FORM UNLOCKED';
    if (item.source === 'shop') return 'BOUGHT COPY';
    return `REWARD AT ${item.trackPoints} POINTS`;
  };
  const remaining = () => items.length - index - 1;
  const skipButton = (count) =>
    count > 1 ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: summary }, `SKIP ALL (${count})`) : null;

  function begin() {
    const item = items[index];
    if (item.source !== 'track' || item.unlockedForm) reveal();
    else encounter();
  }

  /** Step 1: the silhouette. */
  function encounter() {
    stop();
    const item = items[index];
    const mon = resolveMon(ctx, item);
    const throwButton = h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: throwBall }, 'THROW POKé BALL');
    root.className = 'reveal';
    root.replaceChildren(
      h('div', { class: 'label' }, heading(item)),
      h('div', { class: 'stage' },
        h('div', { class: 'stage-mon appear' }, sprite(mon, { scale: 2, silhouette: true, eager: true }))),
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
        h('span', { class: 'stage-ball-spin' },
          icon('pokeball', { scale: 3, label: 'Poké Ball' }),
          // Overlay on the centre button; the stylesheet blinks it red in
          // step with each shake while the ball has the "wobble" class.
          h('span', { class: 'ball-button' }))));
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
    const item = items[index];
    const mon = resolveMon(ctx, item);
    const tier = TIERS[item.tier] ? item.tier : 'common';
    const { copy, newForm } = info[index];
    const isStarter = item.source === 'starter';
    ctx.sfx.play(item.shiny ? 'shiny' : tier === 'common' && !item.unlockedForm ? 'reward' : 'legendary');

    const sparkles = item.shiny
      ? [0, 1, 2, 3, 4, 5].map((i) => h('span', { class: `sparkle s${i}` }, icon('sparkle', { scale: 3 })))
      : null;

    // The small print under the name: which copy this is, or what was unlocked.
    let detail;
    if (item.fusion) {
      const base = ctx.dex.byId.get(mon.fusion.base);
      const partner = ctx.dex.byId.get(mon.fusion.partner);
      detail = `${base.name} + ${partner.name}`;
    } else {
      const number = `#${String(item.dexId).padStart(4, '0')}`;
      if (item.unlockedForm) detail = `${number} · ${mon.label}`;
      else detail = `${number} · COPY ${copy}${copy <= TIERS[tier].cap ? ` OF ${TIERS[tier].cap}` : ''}`;
    }

    root.className = `reveal opened tier-${tier}${item.shiny ? ' is-shiny' : ''}`;
    root.replaceChildren(
      h('div', { class: 'label' }, heading(item)),
      h('div', { class: 'stage' },
        h('span', { class: 'flash' }),
        h('div', { class: 'stage-mon pop' }, sprite(mon, { shiny: item.shiny, scale: 2, eager: true })),
        sparkles),
      h('div', { class: 'reveal-name' }, mon ? mon.name.toUpperCase() : `#${item.dexId}`),
      h('div', { class: 'badges' },
        isStarter ? h('span', { class: 'badge badge-new' }, 'STARTER') : null,
        item.fusion ? h('span', { class: 'badge badge-legendary' }, 'FUSED') : null,
        !isStarter && !item.fusion ? h('span', { class: `badge badge-${tier}` }, TIERS[tier].label.toUpperCase()) : null,
        item.shiny ? h('span', { class: 'badge badge-shiny' }, 'SHINY') : null,
        copy === 1 && !isStarter ? h('span', { class: 'badge badge-new' }, 'NEW') : null,
        newForm ? h('span', { class: 'badge badge-new' }, 'NEW FORM') : null,
        item.bonus ? h('span', { class: 'badge badge-new' }, 'FREE') : null,
        item.pity ? h('span', { class: 'badge' }, 'PITY') : null),
      h('div', { class: 'label muted' }, detail),
      h('div', { class: 'reveal-footer' },
        h('button', {
          class: 'btn btn-primary btn-big',
          type: 'button',
          onclick: () => {
            index++;
            if (index < items.length) begin();
            else done();
          },
        }, remaining() > 0 ? 'NEXT' : 'OK'),
        skipButton(remaining())),
    );
    root.querySelector('.btn-primary').focus();
  }

  function summary() {
    stop();
    index = items.length;
    root.className = 'reveal opened';
    root.replaceChildren(
      h('div', { class: 'label' }, `${items.length} NEW POKéMON`),
      h('div', { class: 'reveal-grid' },
        items.map((item) => {
          const mon = resolveMon(ctx, item);
          const tier = TIERS[item.tier] ? item.tier : 'common';
          return h('div', { class: `cell owned tier-${tier}${item.shiny ? ' shiny' : ''}` },
            sprite(mon, { shiny: item.shiny, eager: true }),
            h('span', { class: 'cell-name' }, mon ? mon.name : `#${item.dexId}`));
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
