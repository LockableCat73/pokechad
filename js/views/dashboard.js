/**
 * Dashboard: score, journey track, the two big buttons (or the running
 * stopwatch), navigation, and the backup reminder.
 */

import { h, sprite, fmtClock, fmtNumber } from '../dom.js';
import { icon } from '../pixelart.js';
import { displayMultiplier, sessionPoints, STAR_MAX, POINTS_PER_REWARD } from '../scoring.js';
import { PITY_LIMIT, STARTER_POINTS, collection } from '../rewards.js';
import * as stopwatch from '../stopwatch.js';
import { openManual } from './rate.js';

/** Days without an export before the reminder shows. */
const BACKUP_REMINDER_DAYS = 14;

/** Horizontal pixels on the journey track per 100 points. */
const TRACK_STEP = 120;
const TRACK_PAD = 60;

/** Nodes updated by tick() without redrawing the whole view. */
let live = null;

export function render(ctx, root) {
  live = null;
  const parts = [
    backupReminder(ctx),
    scorePanel(ctx),
    trackPanel(ctx),
    ctx.state.active ? sessionPanel(ctx) : actionButtons(ctx),
    navButtons(ctx),
  ];
  root.append(...parts.filter(Boolean));
  const strip = root.querySelector('.track-strip');
  const marker = root.querySelector('.track-marker');
  if (strip && marker) {
    strip.scrollLeft = marker.offsetLeft - strip.clientWidth / 2;
  }
  tick(ctx, Date.now());
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

function scorePanel(ctx) {
  const { state, dex } = ctx;
  const { net, highWater } = state.score;
  // Until the starter is chosen, the next reward is the starter at 1 point.
  const awaitingStarter = !state.starter;
  const target = awaitingStarter ? STARTER_POINTS : (state.rewards.length + 1) * POINTS_PER_REWARD;
  const toGo = Math.max(0, target - net);
  const into = awaitingStarter
    ? 0
    : Math.min(POINTS_PER_REWARD, Math.max(0, net - (target - POINTS_PER_REWARD)));
  const buddy = state.buddy ? dex.byId.get(state.buddy.dexId) : null;

  const segments = [];
  for (let i = 0; i < 20; i++) {
    segments.push(h('i', { class: i < Math.floor(into / 5) ? 'on' : '' }));
  }

  return h('section', { class: 'box score', 'aria-label': 'Score' },
    h('div', { class: 'score-main' },
      h('button', {
        class: 'buddy',
        type: 'button',
        title: 'Choose your buddy in the Pokédex',
        'aria-label': buddy ? `Buddy: ${buddy.name}. Open the Pokédex` : 'No buddy yet. Open the Pokédex',
        onclick: () => ctx.go('pokedex'),
      }, buddy
        ? sprite(buddy, { shiny: state.buddy.shiny, eager: true })
        : h('span', { class: 'buddy-empty' }, icon('pokeball', { scale: 3 }))),
      h('div', { class: 'score-numbers' },
        h('div', { class: 'label' }, 'NET SCORE'),
        h('div', { class: `score-value${net < 0 ? ' negative' : ''}` }, fmtNumber(net)),
        h('div', { class: 'label muted' }, `BEST ${fmtNumber(highWater)} · POKéMON ${collection(state).length}`))),
    h('div', { class: 'next' },
      h('div', { class: 'row between' },
        h('span', { class: 'label' }, awaitingStarter ? 'YOUR STARTER' : 'NEXT POKéMON'),
        h('span', { class: 'label' }, toGo === 0 ? 'READY' : `${fmtNumber(toGo)} PT${toGo === 1 ? '' : 'S'} TO GO`)),
      h('div', {
        class: 'meter',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(into),
        'aria-label': 'Progress to the next Pokémon',
      }, segments),
      h('div', { class: 'label muted' }, awaitingStarter
        ? 'FINISH A CHAD SESSION TO CHOOSE YOUR STARTER'
        : `LEGENDARY GUARANTEED IN ${Math.max(1, PITY_LIMIT - state.pity.dry + 1)} REWARDS OR FEWER`)));
}

/**
 * The journey track: the starter station at 1 point, then one station every
 * 100 points. Stations already reached show the Pokémon earned there; the
 * next ones show a Poké Ball. The red marker is the current net score, which
 * can sit behind earned stations after chud time.
 */
function trackPanel(ctx) {
  const { state, dex } = ctx;
  const net = state.score.net;
  const claimed = state.rewards.length;
  const here = Math.min(Math.floor(Math.max(net, 0) / POINTS_PER_REWARD), claimed);
  const base = Math.max(0, here - 5);
  const last = claimed + 2;
  const x = (points) => TRACK_PAD + ((points - base * POINTS_PER_REWARD) / POINTS_PER_REWARD) * TRACK_STEP;
  const markerPoints = Math.min(Math.max(net, base * POINTS_PER_REWARD), last * POINTS_PER_REWARD);

  const stations = [];
  for (let n = base; n <= last; n++) {
    // Station 0 is the starter (at 1 point); stations 1.. are the rolled rewards.
    const reward = n >= 1 ? state.rewards[n - 1] : state.starter;
    const species = reward ? dex.byId.get(reward.dexId) : null;
    const isNext = state.starter ? n === claimed + 1 : n === 0;
    const art = reward
      ? sprite(species, { shiny: Boolean(reward.shiny), eager: true })
      : h('span', { class: `station-ball${isNext ? ' next' : ''}` }, icon('pokeball', { scale: 3 }));
    stations.push(
      h('div', {
        class: `station${reward ? ' claimed' : ''}${reward && reward.shiny ? ' shiny' : ''}`,
        style: { left: `${x(n * POINTS_PER_REWARD)}px` },
        title: reward && species
          ? (n === 0 ? `${species.name}, your starter` : `${species.name} at ${fmtNumber(n * 100)} points`)
          : '',
      },
        h('div', { class: 'station-art' }, art),
        h('div', { class: 'station-node' }),
        h('div', { class: 'station-label' }, n === 0 ? 'STARTER' : fmtNumber(n * POINTS_PER_REWARD))),
    );
  }

  const width = x(last * POINTS_PER_REWARD) + TRACK_PAD;
  const markerX = x(markerPoints);
  return h('section', { class: 'box track', 'aria-label': 'Journey track' },
    h('div', { class: 'track-strip', tabindex: '0', role: 'group', 'aria-label': `Journey track. You are at ${net} points. Next Pokémon at ${state.starter ? (claimed + 1) * 100 : STARTER_POINTS}.` },
      h('div', { class: 'track-inner', style: { width: `${width}px` } },
        h('div', { class: 'track-line' }),
        h('div', { class: 'track-fill', style: { width: `${Math.max(0, markerX)}px` } }),
        stations,
        h('div', { class: 'track-marker', style: { left: `${markerX}px` } },
          h('span', { class: 'track-marker-label' }, net < 0 ? `YOU ${fmtNumber(net)}` : 'YOU')))));
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
