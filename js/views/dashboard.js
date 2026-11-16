/**
 * Dashboard, top to bottom:
 *   1. backup reminder (only when a backup is overdue)
 *   2. the two big buttons, or the running stopwatch
 *   3. one compact progress tile: score, next reward, luck gauge, buddy, journey track
 *   4. navigation
 */

import { h, sprite, fmtClock, fmtNumber } from '../dom.js';
import { icon, luckGauge } from '../pixelart.js';
import { displayMultiplier, sessionPoints, STAR_MAX, POINTS_PER_REWARD } from '../scoring.js';
import { PITY_LIMIT, STARTER_POINTS } from '../rewards.js';
import * as stopwatch from '../stopwatch.js';
import { openManual } from './rate.js';

/** Days without an export before the reminder shows. */
const BACKUP_REMINDER_DAYS = 14;

/** Least horizontal room one station on the journey track needs, in pixels. */
const TRACK_STEP = 104;

/** Nodes updated by tick() without redrawing the whole view. */
let live = null;

export function render(ctx, root) {
  live = null;
  const parts = [
    backupReminder(ctx),
    ctx.state.active ? sessionPanel(ctx) : actionButtons(ctx),
    progressPanel(ctx),
    navButtons(ctx),
  ];
  root.append(...parts.filter(Boolean));
  // The track is laid out to the width it actually got, so it is filled in
  // once the tile is on the page, and again whenever the window is resized.
  fillTrack(ctx, root.querySelector('.track-strip'));
  bindResize(ctx);
  tick(ctx, Date.now());
}

let resizeBound = false;
function bindResize(ctx) {
  if (resizeBound) return;
  resizeBound = true;
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const strip = document.querySelector('.track-strip');
      if (strip) fillTrack(ctx, strip);
    }, 150);
  });
}

/** Refresh the stopwatch numbers. Called twice a second by the app shell. */
export function tick(ctx, now) {
  const active = ctx.state.active;
  if (!live || !active) return;
  const elapsed = stopwatch.elapsedMs(active, now);
  const minutes = elapsed / 60000;
  live.clock.textContent = fmtClock(elapsed);
  live.multiplier.textContent = `x${displayMultiplier(minutes).toFixed(2)}`;
  const best = sessionPoints(minutes, STAR_MAX);
  live.potential.textContent =
    active.kind === 'chad' ? `UP TO +${fmtNumber(best)} PTS` : `UP TO -${fmtNumber(best)} PTS`;

  const status = stopwatch.breakStatus(active, now);
  if (live.breakLine) {
    live.breakLine.textContent = `ON BREAK ${fmtClock(stopwatch.breakMs(active, now))} · ENDS AT 35:00`;
  }
  if (live.warning) {
    const warn = status.phase === 'warning';
    live.warning.hidden = !warn;
    live.panel.classList.toggle('is-warning', warn);
    if (warn) live.countdown.textContent = fmtClock(status.remainingMs + 999);
  }
}

// ---------------------------------------------------------------- pieces

function backupReminder(ctx) {
  const { state } = ctx;
  if (state.sessions.length === 0) return null;
  const since = Date.parse(state.lastExportAt || state.createdAt);
  const days = Math.floor((Date.now() - since) / 86_400_000);
  if (days < BACKUP_REMINDER_DAYS) return null;
  return h('div', { class: 'box banner' },
    h('p', {}, state.lastExportAt
      ? `LAST BACKUP WAS ${days} DAYS AGO.`
      : `NO BACKUP YET (${days} DAYS OF DATA).`),
    h('button', { class: 'btn btn-small', type: 'button', onclick: ctx.exportBackup }, 'EXPORT NOW'));
}

function actionButtons(ctx) {
  const card = (kind, title, sub, image) =>
    h('button', {
      class: `box action action-${kind}`,
      type: 'button',
      onclick: () => openChoice(ctx, kind),
    },
      h('img', { class: 'sprite', src: image, width: 96, height: 96, alt: '', draggable: 'false' }),
      h('span', { class: 'action-title' }, title),
      h('span', { class: 'action-sub' }, sub));
  return h('section', { class: 'actions', 'aria-label': 'Record time' },
    card('chud', 'ADD CHUD TIME', 'SLACKING, SCROLLING', 'assets/icons/snorlax.png'),
    card('chad', 'ADD CHAD TIME', 'WORK, STUDY, GYM', 'assets/icons/zacian-crowned.png'));
}

/** After tapping a big button: stopwatch or after-the-fact entry. */
function openChoice(ctx, kind) {
  ctx.sfx.play('click');
  ctx.openModal(
    h('div', { class: 'stack' },
      h('h2', { class: `title-${kind}` }, `${kind.toUpperCase()} TIME`),
      h('button', { class: `btn btn-${kind} btn-big`, type: 'button', autofocus: true, onclick: () => ctx.startSession(kind) },
        'START STOPWATCH'),
      h('p', { class: 'muted small' }, 'RECOMMENDED. THE MULTIPLIER GROWS THE LONGER YOU STAY IN ONE SESSION.'),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
          ctx.closeModal();
          openManual(ctx, kind);
        },
      }, 'ADD PAST TIME'),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => ctx.closeModal() }, 'CANCEL')),
    { label: `${kind} time`, kind: 'modal-small' },
  );
}

function sessionPanel(ctx) {
  const active = ctx.state.active;
  const paused = Boolean(active.pausedAt);
  const image = active.kind === 'chad' ? 'assets/icons/zacian-crowned.png' : 'assets/icons/snorlax.png';

  const clock = h('div', { class: 'clock', role: 'timer', 'aria-label': 'Active time' }, '00:00');
  const multiplier = h('span', { class: 'multiplier-value' }, 'x0.00');
  const potential = h('span', { class: 'label muted' }, '');
  const breakLine = paused ? h('div', { class: 'label break-line' }, '') : null;
  const countdown = h('span', { class: 'countdown' }, '5:00');
  const warning = paused
    ? h('div', { class: 'warning', role: 'alert', hidden: true },
        h('span', {}, 'CONTINUE OR LOSE MULTIPLIER'),
        countdown)
    : null;

  const panel = h('section', {
    class: `box session session-${active.kind}${paused ? ' is-paused' : ''}`,
    'aria-label': `${active.kind} session`,
  },
    h('div', { class: 'session-head' },
      h('div', {},
        h('div', { class: `label title-${active.kind}` }, `${active.kind.toUpperCase()} SESSION${paused ? ' · PAUSED' : ''}`),
        clock),
      h('img', { class: 'sprite', src: image, width: 96, height: 96, alt: '', draggable: 'false' })),
    h('div', { class: 'multiplier' },
      h('span', { class: 'label' }, 'MULTIPLIER'),
      multiplier,
      potential),
    breakLine,
    warning,
    h('div', { class: 'row' },
      paused
        ? h('button', { class: `btn btn-${active.kind} btn-big grow`, type: 'button', onclick: ctx.resumeSession }, 'CONTINUE')
        : h('button', { class: 'btn btn-big grow', type: 'button', onclick: ctx.pauseSession }, 'PAUSE'),
      h('button', { class: 'btn btn-big btn-danger grow', type: 'button', onclick: ctx.stopSession }, 'STOP')));

  live = { panel, clock, multiplier, potential, breakLine, warning, countdown };
  return panel;
}

/**
 * The compact progress tile.
 *
 * Head row: net score, points to the next reward, and the luck gauge (a
 * small circle that fills as the legendary guarantee gets closer).
 *
 * Body row: your buddy, then the journey track (see fillTrack).
 */
function progressPanel(ctx) {
  const { state, dex } = ctx;
  const net = state.score.net;
  const claimed = state.rewards.length;
  const awaitingStarter = !state.starter;
  const target = awaitingStarter ? STARTER_POINTS : (claimed + 1) * POINTS_PER_REWARD;
  const toGo = Math.max(0, target - net);
  const buddy = state.buddy ? dex.byId.get(state.buddy.dexId) : null;

  // Luck: rewards left until a legendary is guaranteed.
  const left = Math.max(1, PITY_LIMIT - state.pity.dry + 1);
  const luckText = `LUCK: A LEGENDARY IS GUARANTEED WITHIN ${left} REWARD${left === 1 ? '' : 'S'}`;
  const luck = h('button', {
    class: 'luck',
    type: 'button',
    title: luckText,
    'aria-label': luckText,
    onclick: () => ctx.toast(luckText),
  },
    luckGauge(Math.min(1, state.pity.dry / PITY_LIMIT), 3),
    h('span', { class: 'luck-n', 'aria-hidden': 'true' }, String(left)));

  return h('section', { class: 'box progress', 'aria-label': 'Progress' },
    h('div', { class: 'progress-head' },
      h('div', { class: 'progress-score', title: `Best ever: ${fmtNumber(state.score.highWater)}` },
        h('div', { class: 'label muted' }, 'NET SCORE'),
        h('div', { class: `progress-value${net < 0 ? ' negative' : ''}` }, fmtNumber(net))),
      h('div', { class: 'progress-next' },
        h('div', { class: 'label muted' }, awaitingStarter ? 'YOUR STARTER' : 'NEXT POKéMON'),
        h('div', { class: 'progress-togo' }, toGo === 0 ? 'READY' : `${fmtNumber(toGo)} PT${toGo === 1 ? '' : 'S'} TO GO`)),
      luck),
    h('div', { class: 'progress-body' },
      h('button', {
        class: 'buddy',
        type: 'button',
        title: 'Choose your buddy in the Pokédex',
        'aria-label': buddy ? `Buddy: ${buddy.name}. Open the Pokédex` : 'No buddy yet. Open the Pokédex',
        onclick: () => ctx.go('pokedex'),
      }, buddy
        ? sprite(buddy, { shiny: state.buddy.shiny, eager: true })
        : h('span', { class: 'buddy-empty' }, icon('pokeball', { scale: 2 }))),
      h('div', {
        class: 'track-strip',
        role: 'group',
        'aria-label': `Journey track. You are at ${net} points. Next Pokémon at ${target}.`,
      })));
}

/**
 * Draw the journey track into its strip.
 *
 * Station 0 is the starter at 1 point; stations 1.. are the rolled rewards
 * at 100, 200, ... A station you have reached shows the Pokémon that was
 * rolled there. A station you have never reached shows a Poké Ball: what is
 * inside is not decided until you get there.
 *
 * Only as many stations as fit are shown, evenly spaced, with no scrolling
 * and nothing cut off at the edges. The window normally ends at the next
 * unreached station. The red marker is the current net score; after chud
 * time it can sit behind stations already reached, in which case the window
 * slides back to keep it in view.
 */
function fillTrack(ctx, strip) {
  if (!strip) return;
  const { state, dex } = ctx;
  const width = strip.clientWidth;
  if (!width) return;
  const net = state.score.net;
  const claimed = state.rewards.length;

  const count = Math.max(2, Math.floor(width / TRACK_STEP));
  const step = width / count;
  const here = Math.min(Math.floor(Math.max(net, 0) / POINTS_PER_REWARD), claimed);
  let first = Math.max(0, claimed + (count >= 5 ? 2 : 1) - (count - 1));
  if (here < first) first = here;
  const x = (points) => (points / POINTS_PER_REWARD - first + 0.5) * step;
  const markerX = Math.min(width - 8, Math.max(8, x(net)));

  const stations = [];
  for (let n = first; n < first + count; n++) {
    const reward = n >= 1 ? state.rewards[n - 1] : state.starter;
    const species = reward ? dex.byId.get(reward.dexId) : null;
    const isNext = state.starter ? n === claimed + 1 : n === 0;
    const art = reward
      ? sprite(species, { shiny: Boolean(reward.shiny), eager: true })
      : h('span', { class: `station-ball${isNext ? ' next' : ''}` }, icon('pokeball', { scale: 2 }));
    stations.push(
      h('div', {
        class: `station${reward ? ' claimed' : ''}${reward && reward.shiny ? ' shiny' : ''}`,
        style: { left: `${Math.round(x(n * POINTS_PER_REWARD))}px` },
        title: reward && species
          ? (n === 0 ? `${species.name}, your starter` : `${species.name}, earned at ${fmtNumber(n * 100)} points`)
          : 'Not reached yet',
      },
        h('div', { class: 'station-art' }, art),
        h('div', { class: 'station-node' }),
        h('div', { class: 'station-label' }, n === 0 ? 'START' : fmtNumber(n * POINTS_PER_REWARD))),
    );
  }

  // The gold line starts at the first station on a fresh track, and at the
  // left edge once earlier stations have scrolled out of the window.
  const fillFrom = first === 0 ? Math.round(x(0)) : 0;
  strip.replaceChildren(
    h('div', { class: 'track-inner' },
      h('div', { class: 'track-line', style: { left: `${fillFrom}px` } }),
      h('div', { class: 'track-fill', style: { left: `${fillFrom}px`, width: `${Math.max(0, Math.round(markerX) - fillFrom)}px` } }),
      stations,
      h('div', { class: 'track-marker', style: { left: `${Math.round(markerX)}px` } })));
}

function navButtons(ctx) {
  const item = (name, label, art) =>
    h('a', { class: 'box nav-item', href: `#/${name}`, onclick: () => ctx.sfx.play('click') },
      icon(art, { scale: 3 }),
      h('span', {}, label));
  return h('nav', { class: 'nav', 'aria-label': 'Sections' },
    item('pokedex', 'POKéDEX', 'pokedex'),
    item('history', 'HISTORY', 'history'),
    item('stats', 'STATS', 'stats'),
    item('settings', 'BACKUP', 'backup'));
}
