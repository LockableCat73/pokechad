/**
 * Application shell: boots the page, owns the state object, switches views,
 * runs the once-a-second tick, and exposes the actions views call.
 * See documentation/architecture.md.
 */

import {
  STORAGE_KEY,
  NOTE_MAX,
  load,
  save as saveState,
  exportJSON,
  importJSON,
  backupFilename,
  defaultState,
  newId,
} from './state.js';
import { recalculate, clampStars } from './scoring.js';
import { grantOwed, pityDry, starterOwed, collection, STARTER_POINTS } from './rewards.js';
import * as stopwatch from './stopwatch.js';
import { createSfx } from './sfx.js';
import { h, clear, fmtClock, fmtPoints } from './dom.js';
import * as dashboard from './views/dashboard.js';
import * as pokedex from './views/pokedex.js';
import * as history from './views/history.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';
import { openRating } from './views/rate.js';
import { showReveal } from './views/reveal.js';
import { openStarter } from './views/starter.js';

const VIEWS = { '': dashboard, pokedex, history, stats, settings };

const viewRoot = document.getElementById('view');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast');
const liveChip = document.getElementById('live-chip');
const muteButton = document.getElementById('mute');

let currentView = dashboard;
let lastWarnMinute = null;
let toastTimer = 0;
const modalStack = [];

/**
 * The context handed to every view. Views read `ctx.state` and `ctx.dex`,
 * and change things only through the action methods below.
 */
const ctx = {
  /** The saved state (see documentation/storage.json.md). */
  state: defaultState(),
  /** Pokédex data: { species: [...], byId: Map, updatedAt }. */
  dex: { species: [], byId: new Map(), updatedAt: null },
  sfx: createSfx(() => ctx.state.settings.muted),

  save,
  render,
  go,
  openModal,
  closeModal,
  confirm,
  toast,

  startSession,
  pauseSession,
  resumeSession,
  stopSession,
  commitSession,
  discardPending,

  setBuddy,
  toggleMute,
  exportBackup,
  importBackup,
  resetAll,
};

// ------------------------------------------------------------------ boot

boot();

async function boot() {
  try {
    const response = await fetch('data/pokedex.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    ctx.dex = {
      species: data.species,
      byId: new Map(data.species.map((s) => [s.id, s])),
      updatedAt: data.updatedAt,
    };
  } catch (error) {
    clear(viewRoot).append(
      h('div', { class: 'box pad' },
        h('h1', {}, 'COULD NOT LOAD THE POKéDEX'),
        h('p', {}, `data/pokedex.json failed to load (${error.message}). Check your connection and reload.`)),
    );
    return;
  }

  const loaded = load();
  ctx.state = loaded.state;

  window.addEventListener('hashchange', render);
  window.addEventListener('storage', onStorage);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
  muteButton.addEventListener('click', toggleMute);

  render();
  if (loaded.problem) toast(loaded.problem, 12000);

  // A break may have run past its limit while the tab was closed; tick()
  // then ends the session and opens the rating dialog itself.
  tick();
  if (modalStack.length === 0) {
    if (ctx.state.pendingRating) openRating(ctx);
    else settle(null);
  }

  setInterval(tick, 500);

  registerServiceWorker();
}

/**
 * Offline support. Once the worker is running, hand it the list of every
 * sprite so it can download them in the background; skipped when the browser
 * reports that the user is saving data.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready
    .then((registration) => {
      if (navigator.connection && navigator.connection.saveData) return;
      const urls = [];
      for (const species of ctx.dex.species) {
        if (species.sprite !== false) urls.push(`assets/sprites/normal/${species.id}.png`);
        if (species.shiny !== false) urls.push(`assets/sprites/shiny/${species.id}.png`);
      }
      setTimeout(() => {
        if (registration.active) registration.active.postMessage({ type: 'precache-art', urls });
      }, 4000);
    })
    .catch(() => {});
}

// ------------------------------------------------------------------ routing

function routeName() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return VIEWS[name] ? name : '';
}

/** Navigate to a view by name ('' is the dashboard). */
function go(name) {
  const target = `#/${name}`;
  if (location.hash === target || (name === '' && !location.hash)) render();
  else location.hash = target;
}

/** Redraw the current view from the state. */
function render() {
  const name = routeName();
  currentView = VIEWS[name];
  document.body.dataset.view = name || 'dashboard';
  clear(viewRoot);
  currentView.render(ctx, viewRoot);
  updateChrome(Date.now());
}

// ------------------------------------------------------------------ ticking

/** Runs twice a second: enforces the break limit and refreshes live numbers. */
function tick() {
  const now = Date.now();
  const active = ctx.state.active;
  if (active) {
    const status = stopwatch.breakStatus(active, now);
    if (status.phase === 'expired') {
      autoEnd(now);
      return;
    }
    if (status.phase === 'warning') {
      const minutesLeft = Math.ceil(status.remainingMs / 60000);
      if (minutesLeft !== lastWarnMinute) {
        ctx.sfx.play('warning');
        lastWarnMinute = minutesLeft;
      }
    } else {
      lastWarnMinute = null;
    }
  }
  updateChrome(now);
  if (currentView.tick) currentView.tick(ctx, now);
}

/** Header chip, mute button and tab title. */
function updateChrome(now) {
  const active = ctx.state.active;
  muteButton.textContent = ctx.state.settings.muted ? 'SOUND OFF' : 'SOUND ON';
  muteButton.setAttribute('aria-pressed', String(!ctx.state.settings.muted));
  if (!active) {
    liveChip.hidden = true;
    document.title = 'PokéChad';
    return;
  }
  const clock = fmtClock(stopwatch.elapsedMs(active, now));
  const label = active.pausedAt ? 'BREAK' : active.kind.toUpperCase();
  liveChip.hidden = routeName() === '';
  liveChip.className = `chip chip-${active.kind}${active.pausedAt ? ' chip-paused' : ''}`;
  liveChip.textContent = `${label} ${clock}`;
  document.title = `${clock} ${label} · PokéChad`;
}

// ------------------------------------------------------------------ sessions

function startSession(kind) {
  if (ctx.state.active || ctx.state.pendingRating) return;
  ctx.state.active = stopwatch.start(kind, Date.now());
  save();
  ctx.sfx.play('start');
  closeModal(true);
  go('');
}

function pauseSession() {
  if (!ctx.state.active) return;
  ctx.state.active = stopwatch.pause(ctx.state.active, Date.now());
  save();
  ctx.sfx.play('pause');
  render();
}

function resumeSession() {
  if (!ctx.state.active) return;
  ctx.state.active = stopwatch.resume(ctx.state.active, Date.now());
  lastWarnMinute = null;
  save();
  ctx.sfx.play('resume');
  render();
}

/** Stop the stopwatch and ask for a rating. */
function stopSession() {
  if (!ctx.state.active) return;
  ctx.state.pendingRating = stopwatch.finish(ctx.state.active, Date.now());
  ctx.state.active = null;
  save();
  ctx.sfx.play('stop');
  render();
  openRating(ctx);
}

/** The 35-minute break limit was reached. */
function autoEnd(now) {
  ctx.state.pendingRating = stopwatch.finish(ctx.state.active, now, { autoEnded: true });
  ctx.state.active = null;
  lastWarnMinute = null;
  save();
  ctx.sfx.play('expired');
  closeModal(true);
  render();
  openRating(ctx);
}

/**
 * Record a finished session, apply its points and hand out any rewards.
 *
 * @param {object} record  kind, method, startedAt, endedAt, activeMinutes, pauses, autoEnded.
 * @param {number} stars   0 to 4.
 * @param {string} note    Short description.
 */
function commitSession(record, stars, note) {
  const session = {
    id: newId('s'),
    kind: record.kind,
    method: record.method,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    activeMinutes: record.activeMinutes,
    pauses: record.pauses || [],
    autoEnded: Boolean(record.autoEnded),
    stars: clampStars(stars),
    note: String(note || '').trim().slice(0, NOTE_MAX),
    points: 0,
    netAfter: 0,
  };
  ctx.state.sessions.push(session);
  ctx.state.score = recalculate(ctx.state.sessions);
  if (record.method === 'stopwatch') ctx.state.pendingRating = null;
  closeModal(true);
  ctx.sfx.play('save');
  const revealed = settle(session.id);
  if (!revealed) {
    save();
    render();
    toast(`${fmtPoints(session.points)} POINTS`);
  }
}

/** Throw away the stopwatch session that is waiting for a rating. */
function discardPending() {
  ctx.state.pendingRating = null;
  save();
  closeModal(true);
  render();
  toast('SESSION DISCARDED');
}

/**
 * Hand out everything the high-water mark now covers: first the starter
 * choice (once, at 1 point), then one rolled reward per 100 points. Plays the
 * reveals.
 *
 * @param {string|null} sessionId The session that caused this, if any.
 * @returns {boolean} true when something was (or is about to be) awarded.
 */
function settle(sessionId) {
  const { state } = ctx;
  if (starterOwed(state.score.highWater, state.starter)) {
    save();
    render();
    openStarter(ctx, (dexId) => {
      const first = state.sessions.find((s) => s.netAfter >= STARTER_POINTS);
      state.starter = {
        dexId,
        at: new Date().toISOString(),
        sessionId: first ? first.id : sessionId,
      };
      closeModal(true);
      grantAndReveal(sessionId, true);
    });
    return true;
  }
  return grantAndReveal(sessionId, false);
}

function grantAndReveal(sessionId, withStarter) {
  const { state } = ctx;
  const granted = grantOwed({
    highWater: state.score.highWater,
    rewards: state.rewards,
    species: ctx.dex.species,
    starter: state.starter,
    sessionId,
  });
  state.pity = { dry: pityDry(state.rewards) };
  const reveals = withStarter ? [collection(state)[0], ...granted] : granted;
  if (reveals.length === 0) return false;
  if (!state.buddy) {
    state.buddy = { dexId: reveals[0].dexId, shiny: reveals[0].shiny };
  }
  save();
  render();
  showReveal(ctx, reveals);
  return true;
}

// ------------------------------------------------------------------ misc actions

function setBuddy(dexId, shiny) {
  ctx.state.buddy = { dexId, shiny: Boolean(shiny) };
  save();
  ctx.sfx.play('save');
}

function toggleMute() {
  ctx.state.settings.muted = !ctx.state.settings.muted;
  save();
  ctx.sfx.play('click');
  updateChrome(Date.now());
  if (routeName() === 'settings') render();
}

/** Download the whole state as a JSON file. */
function exportBackup() {
  const text = exportJSON(ctx.state);
  save();
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: backupFilename() });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.sfx.play('save');
  render();
  toast('BACKUP SAVED');
}

/** Replace the state with the contents of a backup file, after confirmation. */
async function importBackup(file) {
  let imported;
  try {
    imported = importJSON(await file.text());
  } catch (error) {
    ctx.sfx.play('error');
    toast(error.message, 9000);
    return;
  }
  const ok = await confirm(
    `Replace everything saved in this browser with "${file.name}"? The file has ${imported.sessions.length} sessions and ${collection(imported).length} Pokémon. What is here now will be lost unless you exported it.`,
    { yes: 'REPLACE', danger: true },
  );
  if (!ok) return;
  ctx.state = imported;
  save();
  render();
  toast('BACKUP LOADED');
  if (ctx.state.pendingRating) openRating(ctx);
  else settle(null);
}

async function resetAll() {
  const ok = await confirm(
    'Delete every session and every Pokémon saved in this browser? This cannot be undone. Export a backup first if you might want it back.',
    { yes: 'DELETE ALL', danger: true },
  );
  if (!ok) return;
  ctx.state = defaultState();
  save();
  render();
  toast('ALL DATA DELETED');
}

function save() {
  if (!saveState(ctx.state)) {
    toast('COULD NOT SAVE: BROWSER STORAGE IS FULL OR BLOCKED', 9000);
  }
}

/** Another tab changed the save: adopt it so the two never overwrite each other. */
function onStorage(event) {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  ctx.state = load().state;
  closeModal(true);
  render();
  if (ctx.state.pendingRating) openRating(ctx);
}

// ------------------------------------------------------------------ modals

/**
 * Show a dialog on top of the page. Dialogs stack.
 *
 * @param {Node} content
 * @param {object} [options]
 * @param {boolean} [options.locked] No Escape / backdrop dismissal.
 * @param {string}  [options.label]  Accessible name.
 * @param {string}  [options.kind]   Extra class on the dialog box.
 * @param {() => void} [options.onClose]
 */
function openModal(content, { locked = false, label = 'Dialog', kind = '', onClose } = {}) {
  const dialog = h('div', { class: `modal box ${kind}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, content);
  const layer = h('div', {
    class: 'modal-layer',
    onclick: (event) => {
      if (event.target === layer && !locked) closeModal();
    },
  }, dialog);
  modalStack.push({ layer, locked, onClose, returnFocus: document.activeElement });
  modalRoot.append(layer);
  modalRoot.hidden = false;
  document.body.classList.add('has-modal');
  const first = dialog.querySelector('[autofocus]') || dialog.querySelector('button, input, select, textarea');
  if (first) first.focus();
  return dialog;
}

/** Close the top dialog, or every dialog when `all` is true. */
function closeModal(all = false) {
  do {
    const top = modalStack.pop();
    if (!top) break;
    top.layer.remove();
    if (top.onClose) top.onClose();
    if (!all && top.returnFocus && top.returnFocus.isConnected) top.returnFocus.focus();
  } while (all);
  if (modalStack.length === 0) {
    modalRoot.hidden = true;
    document.body.classList.remove('has-modal');
  }
}

function onKeydown(event) {
  if (event.key !== 'Escape') return;
  const top = modalStack[modalStack.length - 1];
  if (top && !top.locked) closeModal();
}

/**
 * Ask a yes/no question.
 * @returns {Promise<boolean>}
 */
function confirm(message, { yes = 'YES', no = 'CANCEL', danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    openModal(
      h('div', { class: 'stack' },
        h('p', {}, message),
        h('div', { class: 'row end' },
          h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => closeModal() }, no),
          h('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            type: 'button',
            onclick: () => {
              answer = true;
              closeModal();
            },
          }, yes))),
      { label: 'Confirm', kind: 'modal-small', onClose: () => resolve(answer) },
    );
  });
}

/** Show a short message at the bottom of the screen. */
function toast(message, duration = 3500) {
  clearTimeout(toastTimer);
  toastRoot.textContent = message;
  toastRoot.classList.add('show');
  toastTimer = setTimeout(() => toastRoot.classList.remove('show'), duration);
}
