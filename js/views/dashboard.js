/**
 * Dashboard, top to bottom:
 *   1. backup reminder (only when a backup is overdue)
 *   2. the two big buttons, or the running stopwatch
 *   3. one compact progress tile: score, next reward, luck gauge, buddy, journey track
 *   4. the last 7 days of chad and chud time
 *   5. navigation
 */

import { h, sprite, fmtClock, fmtNumber, fmtMinutes, dayKey } from '../dom.js';
import { icon, luckGauge } from '../pixelart.js';
import { resolveMon, currentBuddy } from '../mon.js';
import { balance } from '../shop.js';
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
    weekPanel(ctx),
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
  const multiplier = h('span', { class: 'multiplier-value' }, 'x1.00');
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
 * Body row: your buddy, then the scrollable journey track (see fillTrack).
 */
function progressPanel(ctx) {
  const { state } = ctx;
  const net = state.score.net;
  const claimed = state.rewards.length;
  const awaitingStarter = !state.starter;
  const target = awaitingStarter ? STARTER_POINTS : (claimed + 1) * POINTS_PER_REWARD;
  const toGo = Math.max(0, target - net);
  // The buddy can be a Pokémon in any unlocked form, or a fusion.
  const buddy = currentBuddy(ctx);

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
        'aria-label': buddy ? `Buddy: ${buddy.mon.name}. Open the Pokédex` : 'No buddy yet. Open the Pokédex',
        onclick: () => ctx.go('pokedex'),
      }, buddy
        ? sprite(buddy.mon, { shiny: buddy.shiny, eager: true })
        : h('span', { class: 'buddy-empty' }, icon('pokeball', { scale: 2 }))),
      trackWrap(net, target)));
}

function trackWrap(net, target) {
  const strip = h('div', {
    class: 'track-strip',
    tabindex: '0',
    role: 'group',
    'aria-label': `Journey track, scrollable. You are at ${net} points. Next Pokémon at ${target}.`,
  });
  return h('div', { class: 'track-wrap' }, strip, trackControls(strip));
}

/** Unreached stations drawn beyond the last one earned, for scrolling ahead. */
const TRACK_AHEAD = 10;

/**
 * Draw the journey track into its strip.
 *
 * Station 0 is the starter at 1 point; stations 1.. are the rolled rewards
 * at 100, 200, ... A station you have reached shows the Pokémon that was
 * rolled there. A station you have never reached shows a Poké Ball: what is
 * inside is not decided until you get there.
 *
 * Every station from the start to TRACK_AHEAD beyond the last one earned is
 * drawn, and the strip scrolls sideways through them: swipe, drag with the
 * mouse, use the arrow keys when it has focus, or press the two arrow
 * buttons. Scrolling snaps one station at a time, so the strip always shows
 * a whole number of stations with nothing cut off at the edges.
 *
 * It opens on the "home" view: the window that ends at the next unreached
 * station. The red marker is the current net score; after chud time it can
 * sit behind stations already reached, in which case home slides back to
 * keep it in view.
 */
function fillTrack(ctx, strip) {
  if (!strip) return;
  const { state } = ctx;
  const width = strip.clientWidth;
  if (!width) return;
  const net = state.score.net;
  const claimed = state.rewards.length;

  const count = Math.max(2, Math.floor(width / TRACK_STEP));
  const step = Math.floor(width / count);
  const total = claimed + 1 + TRACK_AHEAD;
  const here = Math.min(Math.floor(Math.max(net, 0) / POINTS_PER_REWARD), claimed);
  let first = Math.max(0, claimed + (count >= 5 ? 2 : 1) - (count - 1));
  if (here < first) first = here;
  const x = (points) => Math.round((points / POINTS_PER_REWARD + 0.5) * step);
  const markerX = Math.max(8, x(net));

  const stations = [];
  for (let n = 0; n < total; n++) {
    const reward = n >= 1 ? state.rewards[n - 1] : state.starter;
    // Shown in the form the copy arrived in (an Alolan Vulpix stays Alolan).
    const species = reward ? resolveMon(ctx, reward) : null;
    const isNext = state.starter ? n === claimed + 1 : n === 0;
    const inHome = n >= first && n < first + count;
    const art = reward
      ? sprite(species, { shiny: Boolean(reward.shiny), eager: inHome })
      : h('span', { class: `station-ball${isNext ? ' next' : ''}` }, icon('pokeball', { scale: 2 }));
    stations.push(
      h('div', {
        class: `station${reward ? ' claimed' : ''}${reward && reward.shiny ? ' shiny' : ''}`,
        style: { left: `${n * step}px`, width: `${step}px` },
        title: reward && species
          ? (n === 0 ? `${species.name}, your starter` : `${species.name}, earned at ${fmtNumber(n * 100)} points`)
          : 'Not reached yet',
      },
        h('div', { class: 'station-art' }, art),
        h('div', { class: 'station-node' }),
        h('div', { class: 'station-label' }, n === 0 ? 'START' : fmtNumber(n * POINTS_PER_REWARD))),
    );
  }

  strip.replaceChildren(
    // The strip is rarely an exact multiple of the step; the few spare pixels
    // are added to the end so the last stop still lines up with a station.
    h('div', { class: 'track-inner', style: { width: `${total * step + (width - count * step)}px` } },
      h('div', { class: 'track-line', style: { left: `${x(0)}px` } }),
      h('div', { class: 'track-fill', style: { left: `${x(0)}px`, width: `${Math.max(0, markerX - x(0))}px` } }),
      stations,
      h('div', { class: 'track-marker', style: { left: `${markerX}px` } })));
  strip.dataset.step = String(step);
  strip.scrollLeft = first * step;
  strip.dispatchEvent(new Event('scroll'));
}

/**
 * Make the strip scrollable by every means: touch and trackpad work natively,
 * so this adds mouse dragging and the two arrow buttons.
 */
function trackControls(strip) {
  const stepBy = (direction) => {
    const step = Number(strip.dataset.step) || TRACK_STEP;
    strip.scrollLeft = Math.round(strip.scrollLeft / step + direction) * step;
  };
  const prev = h('button', { class: 'track-arrow prev', type: 'button', 'aria-label': 'Earlier rewards', onclick: () => stepBy(-1) }, '◀');
  const next = h('button', { class: 'track-arrow next', type: 'button', 'aria-label': 'Later rewards', onclick: () => stepBy(1) }, '▶');
  strip.addEventListener('scroll', () => {
    prev.disabled = strip.scrollLeft <= 0;
    next.disabled = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
  });

  // Drag with the mouse. Touch and pen already scroll the strip themselves.
  strip.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { strip, x: event.clientX, left: strip.scrollLeft, moved: false };
  });
  bindDrag();
  return [prev, next];
}

/** The mouse drag in progress on a track strip, if any. */
let drag = null;
let dragBound = false;

/** Window-level halves of the mouse drag, attached once for the page's lifetime. */
function bindDrag() {
  if (dragBound) return;
  dragBound = true;
  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    drag.strip.classList.add('dragging');
    drag.strip.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag.strip.classList.remove('dragging'); // snapping resumes and settles on a station
    drag = null;
  });
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Tallest a bar in the week tile can be, in pixels (each direction). */
const WEEK_BAR = 28;

/**
 * Time spent over the last 7 days, today included.
 *
 * One column per day: chad time rises above the zero line, chud time hangs
 * below it, both on the same scale. The totals at the top double as the
 * legend. This is plain recorded time (active minutes), with no multiplier
 * or rating applied. A session counts towards the day it started on.
 * Tapping a day spells its numbers out.
 */
function weekPanel(ctx) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today.getTime());
    date.setDate(today.getDate() - i);
    days.push({ key: dayKey(date), date, chad: 0, chud: 0, today: i === 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const session of ctx.state.sessions) {
    const day = byKey.get(dayKey(session.startedAt));
    if (day) day[session.kind] += session.activeMinutes;
  }

  const span = (minutes) => (minutes > 0 ? fmtMinutes(minutes) : '0m');
  const total = (kind) => days.reduce((sum, d) => sum + d[kind], 0);
  const peak = Math.max(1, ...days.map((d) => Math.max(d.chad, d.chud)));
  // Bar heights snap to the 4px grid; any time at all shows at least one step.
  const height = (minutes) => (minutes > 0 ? Math.max(4, Math.round(((minutes / peak) * WEEK_BAR) / 4) * 4) : 0);

  const columns = days.map((day) => {
    const name = day.today ? 'TODAY' : WEEKDAYS[day.date.getDay()];
    const summary = `${name}: CHAD ${span(day.chad)} · CHUD ${span(day.chud)}`;
    return h('button', {
      class: `week-day${day.today ? ' today' : ''}`,
      type: 'button',
      title: summary,
      'aria-label': summary,
      onclick: () => ctx.toast(summary),
    },
      h('span', { class: 'week-up' }, h('i', { class: 'week-chad', style: { height: `${height(day.chad)}px` } })),
      h('span', { class: 'week-zero' }),
      h('span', { class: 'week-down' }, h('i', { class: 'week-chud', style: { height: `${height(day.chud)}px` } })),
      h('span', { class: 'week-label' }, WEEKDAYS[day.date.getDay()][0]));
  });

  return h('section', { class: 'box week', 'aria-label': 'Time spent in the last 7 days' },
    h('div', { class: 'week-head' },
      h('span', { class: 'label muted' }, '7 DAYS'),
      h('span', { class: 'week-total' }, h('i', { class: 'week-chad' }), `CHAD ${span(total('chad'))}`),
      h('span', { class: 'week-total' }, h('i', { class: 'week-chud' }), `CHUD ${span(total('chud'))}`)),
    h('div', { class: 'week-days' }, columns));
}

function navButtons(ctx) {
  const item = (name, label, art, badge) =>
    h('a', { class: 'box nav-item', href: `#/${name}`, onclick: () => ctx.sfx.play('click') },
      icon(art, { scale: 3, swap: art === 'coin' ? { k: '#282030' } : {} }),
      h('span', {}, label),
      badge);
  // The Shop tile carries the coin balance, so it is visible from home.
  const owned = balance(ctx.state);
  return h('nav', { class: 'nav', 'aria-label': 'Sections' },
    item('pokedex', 'POKéDEX', 'pokedex'),
    item('shop', 'SHOP', 'coin', h('span', { class: 'nav-badge', 'aria-label': `${owned} Pokécoins` }, String(owned))),
    item('history', 'HISTORY', 'history'),
    item('stats', 'STATS', 'stats'),
    item('settings', 'BACKUP', 'backup'));
}
