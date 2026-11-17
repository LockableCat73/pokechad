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
import { grantOwed, starterOwed, STARTER_POINTS } from './rewards.js';
import { starterCopy } from './holdings.js';
import { indexForms, NO_FORMS, formsOf, displayName } from './forms.js';
import * as shopRules from './shop.js';
import * as stopwatch from './stopwatch.js';
import { createSfx } from './sfx.js';
import { h, clear, sprite, setText, fmtClock, fmtPoints } from './dom.js';
import { resolveMon } from './mon.js';
import { reminderText, startText, pickReminderCopy } from './encourage.js';
import { askPermission, notify, permission } from './notify.js';
import { syncWakeLock } from './wakelock.js';
import { setFavicon } from './favicon.js';
import * as dashboard from './views/dashboard.js';
import * as pokedex from './views/pokedex.js';
import * as history from './views/history.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';
import * as shop from './views/shop.js';
import { openRating } from './views/rate.js';
import { showReveal } from './views/reveal.js';
import { openStarter } from './views/starter.js';

const VIEWS = { '': dashboard, pokedex, shop, history, stats, settings };

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
  /** Alternate forms and fusions: the index built from data/forms.json. */
  forms: NO_FORMS,
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
  buyCopy,
  buyCopies,
  buyUpgrade,
  fuseFusion,
  unfuseFusion,
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

  // Alternate forms are an extra: if the file cannot be read, the game still
  // runs with plain Pokémon only.
  try {
    const response = await fetch('data/forms.json');
    if (response.ok) ctx.forms = indexForms(await response.json());
  } catch {
    ctx.forms = NO_FORMS;
  }

  const loaded = load();
  ctx.state = loaded.state;

  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', onPopState);
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

  // For trying things from the browser's console. See documentation/stopwatch.md.
  window.pokechad = { testReminder, testStart };
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
      // Alternate forms and fusions share the sprite folders, under their own numbers.
      const extras = [...ctx.forms.fusions];
      for (const list of ctx.forms.bySpecies.values()) extras.push(...list);
      for (const extra of extras) {
        if (extra.sprite !== false) urls.push(`assets/sprites/normal/${extra.pid}.png`);
        if (extra.shiny !== false) urls.push(`assets/sprites/shiny/${extra.pid}.png`);
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
  // A full-page dialog (a Pokédex entry) redraws itself from the state too.
  for (const open of modalStack) if (open.refresh) open.refresh();
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
    const reminder = stopwatch.reminderStatus(active, now);
    if (reminder.due) {
      active.remindersSent = reminder.count;
      save();
      remind(active.kind, reminder.minutes);
    }
  }
  syncWakeLock(Boolean(active));
  updateChrome(now);
  if (currentView.tick) currentView.tick(ctx, now);
}

/** Header chip, mute button, tab title and tab icon. */
function updateChrome(now) {
  const active = ctx.state.active;
  setFavicon(active ? active.kind : null);
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

// ------------------------------------------------------------------ messages
//
// The words come from js/encourage.js (which line) and js/messages.js (the
// lines). Here they are put on screen and, when allowed, sent as a system
// notification.

/** The line shown last time, so the next message never repeats it. */
let lastLine = null;

/**
 * Show a message spoken by a random Pokémon the player holds.
 *
 * It always appears on screen. It is also sent as a system notification
 * when `system` is "always", or when it is "hidden" and the tab is in the
 * background, provided notifications are allowed.
 *
 * @param {object} args
 * @param {(mon: object|null, options: {last: string|null, rng: () => number}) => {title:string, body:string}} args.text
 *   Builds the words for the chosen Pokémon (null when none is held).
 * @param {'always'|'hidden'} args.system
 * @param {string} args.tag   A later notification with the same tag replaces this one.
 * @param {string} [args.sound] Sound effect to play, if any.
 * @param {number} [args.duration] How long the on-screen message stays, in milliseconds.
 * @returns {Promise<boolean>} Whether a system notification was sent.
 */
function say({ text, system, tag, sound, duration = 12000 }) {
  const copy = pickReminderCopy(ctx.state.pokemon, randomFloat);
  const mon = copy ? resolveMon(ctx, copy) : null;
  const shiny = Boolean(copy && copy.shiny && mon && mon.shiny);
  const speaker = mon ? { name: mon.name, slug: mon.species ? mon.species.slug : null, types: mon.types } : null;
  const { title, body } = text(speaker, { last: lastLine, rng: randomFloat });
  lastLine = body;
  toast(`${title}. ${body}`, duration, mon ? { mon, shiny } : null);
  if (sound) ctx.sfx.play(sound);
  if (system !== 'always' && !document.hidden) return Promise.resolve(false);
  const icon = mon ? `assets/sprites/${shiny ? 'shiny' : 'normal'}/${mon.id}.png` : 'assets/icons/icon-192.png';
  return notify({ title, body, icon, tag });
}

/**
 * The 45-minute reminder: on screen with a chime, and as a system
 * notification if the tab is in the background.
 *
 * @param {'chad'|'chud'} kind
 * @param {number} minutes Active time on the stopwatch.
 * @param {{always?: boolean}} [options] `always` sends the system
 *   notification even with the tab in front (used by testReminder).
 */
function remind(kind, minutes, { always = false } = {}) {
  return say({
    text: (mon, options) => reminderText(kind, minutes, mon, options),
    system: always ? 'always' : 'hidden',
    tag: 'pokechad-reminder',
    sound: 'reminder',
  });
}

/**
 * The message when a stopwatch starts: "Let's do this!" for chad time,
 * something discouraging for chud time. Sent as a system notification as
 * well, even though the tab is in front. No sound of its own; the stopwatch
 * has just played its start sound.
 *
 * @param {'chad'|'chud'} kind
 */
function announceStart(kind) {
  return say({ text: (mon, options) => startText(kind, mon, options), system: 'always', tag: 'pokechad-start', duration: 7000 });
}

/** What a console helper answers with. */
function testResult(sent, allowed) {
  if (sent) return 'Sent. Look for the system notification.';
  if (allowed === 'unsupported') return 'This browser has no notifications. The on-screen message was shown.';
  if (allowed === 'denied') return 'Notifications are blocked for this site. Allow them in the site settings (the icon left of the address). The on-screen message was shown.';
  if (allowed === 'default') return 'The permission question was dismissed. Run this again and choose Allow. The on-screen message was shown.';
  return `Could not send (permission is "${permission()}"). The on-screen message was shown.`;
}

/**
 * Console helper: `pokechad.testReminder()` or `pokechad.testReminder('chud')`.
 * Asks for permission if it has not been asked, then sends a 45-minute
 * reminder now, as a system notification as well as on screen.
 *
 * @returns {Promise<string>} What happened, in words.
 */
async function testReminder(kind = 'chad') {
  const allowed = await askPermission();
  return testResult(await remind(kind === 'chud' ? 'chud' : 'chad', 45, { always: true }), allowed);
}

/**
 * Console helper: `pokechad.testStart()` or `pokechad.testStart('chud')`.
 * Sends the message a starting stopwatch would, without starting one.
 *
 * @returns {Promise<string>} What happened, in words.
 */
async function testStart(kind = 'chad') {
  const allowed = await askPermission();
  return testResult(await announceStart(kind === 'chud' ? 'chud' : 'chad'), allowed);
}

// ------------------------------------------------------------------ sessions

function startSession(kind) {
  if (ctx.state.active || ctx.state.pendingRating) return;
  const active = stopwatch.start(kind, Date.now());
  ctx.state.active = active;
  save();
  // The first stopwatch asks once whether messages may be shown as system
  // notifications; whatever the answer, it is never asked again. The start
  // message follows the answer, unless the session has ended by then.
  askPermission().then(() => {
    if (ctx.state.active && ctx.state.active.startedAt === active.startedAt) announceStart(kind);
  });
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
  if (starterOwed(state.score.highWater, starterCopy(state))) {
    save();
    render();
    openStarter(ctx, (dexId) => {
      const first = state.sessions.find((s) => s.netAfter >= STARTER_POINTS);
      const starter = {
        source: 'starter',
        dexId,
        tier: 'common',
        shiny: false,
        at: new Date().toISOString(),
        sessionId: first ? first.id : sessionId,
      };
      state.pokemon.push(starter);
      closeModal(true);
      grantAndReveal(sessionId, starter);
    });
    return true;
  }
  return grantAndReveal(sessionId, null);
}

/**
 * Roll every reward the track owes, save, and play the reveals.
 * @param {string|null} sessionId
 * @param {object|null} starter The starter copy, when it was chosen just now.
 */
function grantAndReveal(sessionId, starter) {
  const { state } = ctx;
  const granted = grantOwed({ state, species: ctx.dex.species, forms: ctx.forms, sessionId });
  // A reward that came with a bonus form shows the Pokémon, then the form.
  const reveals = starter ? [starter] : [];
  for (const copy of granted) {
    reveals.push(copy);
    if (copy.bonusForm) {
      reveals.push({ dexId: copy.dexId, tier: copy.tier, form: copy.bonusForm, shiny: false, unlockedForm: true, bonus: true });
    }
  }
  if (reveals.length === 0) return false;
  if (!state.buddy) {
    state.buddy = { dexId: reveals[0].dexId, shiny: reveals[0].shiny };
  }
  save();
  render();
  showReveal(ctx, reveals);
  return true;
}

// ------------------------------------------------------------------ shop actions
//
// Each action asks for confirmation, applies the purchase through the pure
// rules in shop.js, saves, redraws, and shows what was obtained. They resolve
// to true when the purchase went through. A Pokédex entry that is open stays
// open underneath and is redrawn with the new totals (see render).

/** Form keys unlocked by reaching a copy count (Zygarde), before and after a change. */
function milestonesUnlocked(species) {
  const unlocked = shopRules.unlockedForms(ctx.state, ctx.forms, species.id);
  return formsOf(ctx.forms, species.id).filter((f) => f.kind === 'milestone' && unlocked.has(f.key));
}

/** Buy one copy of a Pokémon already found. */
async function buyCopy(species) {
  const offer = shopRules.copyOffer(ctx.state, ctx.forms, species);
  if (!offer.ok) {
    toast(offer.reason);
    return false;
  }
  const ok = await confirm(`Buy one copy of ${species.name} for ${offer.price} Pokécoin${offer.price === 1 ? '' : 's'}?`, { yes: 'BUY' });
  if (!ok) return false;
  return applyCopies(species, 1);
}

/** Buy several copies at once (used for Zygarde, whose copies cost 1 coin). */
async function buyCopies(species, count) {
  const offer = shopRules.copyOffer(ctx.state, ctx.forms, species);
  if (!offer.ok) {
    toast(offer.reason);
    return false;
  }
  const ok = await confirm(`Buy ${count} copies of ${species.name} for ${offer.price * count} Pokécoins?`, { yes: 'BUY' });
  if (!ok) return false;
  return applyCopies(species, count);
}

function applyCopies(species, count) {
  const before = new Set(milestonesUnlocked(species).map((f) => f.key));
  const heldBefore = shopRules.copiesOf(ctx.state, species.id).length;
  const added = [];
  try {
    for (let i = 0; i < count; i++) {
      added.push(shopRules.buyCopy(ctx.state, ctx.forms, species, { rng: randomFloat }));
    }
  } catch (error) {
    if (added.length === 0) {
      toast(error.message);
      return false;
    }
  }
  const bought = added.length;
  save();
  render();
  ctx.sfx.play('save');

  // Show the copies worth showing: a single purchase always, and from a bulk
  // purchase the shiny one. Then any form the new total has unlocked.
  // Each is told which copy it was, since only some of a bulk purchase are shown.
  // (Shown from a duplicate, so the note does not end up in the save.)
  const copies = added.map((copy, i) => ({ ...copy, copyNumber: heldBefore + i + 1 }));
  const reveals = bought === 1 ? copies : copies.filter((copy) => copy.shiny);
  for (const form of milestonesUnlocked(species)) {
    if (!before.has(form.key)) reveals.push({ dexId: species.id, tier: species.tier, form: form.key, shiny: false, unlockedForm: true });
  }
  if (reveals.length > 0) showReveal(ctx, reveals);
  else toast(`+${bought} ${species.name} COPIES`);
  return true;
}

/** Buy an upgrade form (Mega, Gigantamax ...) for a Pokémon. */
async function buyUpgrade(species, form) {
  const offer = shopRules.upgradeOffer(ctx.state, ctx.forms, species, form);
  if (!offer.ok) {
    toast(offer.owned ? 'ALREADY UNLOCKED' : offer.reason);
    return false;
  }
  const name = displayName(species.name, form);
  const ok = await confirm(`Unlock ${name} for ${offer.price} Pokécoins? It stays unlocked for ${species.name} for good.`, { yes: 'UNLOCK' });
  if (!ok) return false;
  shopRules.buyUpgrade(ctx.state, ctx.forms, species, form);
  save();
  render();
  ctx.sfx.play('save');
  showReveal(ctx, [{ dexId: species.id, tier: species.tier, form: form.key, shiny: false, unlockedForm: true }]);
  return true;
}

/** Make a fusion. The dialog spells out what it costs and what comes back. */
async function fuseFusion(fusion) {
  const offer = shopRules.fusionOffer(ctx.state, ctx.forms, fusion);
  if (!offer.ok) {
    toast(offer.active ? 'ALREADY FUSED' : offer.reason);
    return false;
  }
  const base = ctx.dex.byId.get(fusion.base);
  const partner = ctx.dex.byId.get(fusion.partner);
  const ok = await confirm(
    `Fuse ${base.name} and ${partner.name} into ${fusion.label}? This costs ${offer.price} Pokécoins and sets aside one copy of each. If you unfuse later you get the two copies back, but NOT the ${offer.price} Pokécoins.`,
    { yes: 'FUSE' },
  );
  if (!ok) return false;
  shopRules.fuse(ctx.state, ctx.forms, fusion);
  save();
  render();
  ctx.sfx.play('save');
  showReveal(ctx, [{ fusion: fusion.id, shiny: false, tier: 'legendary', unlockedForm: true }]);
  return true;
}

/** Undo a fusion: the copies come back, the coins do not. */
async function unfuseFusion(fusion) {
  const offer = shopRules.unfuseOffer(ctx.state, fusion);
  if (!offer.ok) {
    toast(offer.reason);
    return false;
  }
  const base = ctx.dex.byId.get(fusion.base);
  const partner = ctx.dex.byId.get(fusion.partner);
  const ok = await confirm(
    `Unfuse ${fusion.label}? You get one copy of ${base.name} and one of ${partner.name} back. The ${shopRules.PRICES.fusion} Pokécoins you paid are NOT refunded, and fusing again will cost ${shopRules.PRICES.fusion} more.`,
    { yes: 'UNFUSE', danger: true },
  );
  if (!ok) return false;
  shopRules.unfuse(ctx.state, fusion);
  save();
  render();
  toast('UNFUSED. BOTH COPIES RETURNED.');
  return true;
}

/** Uniform float in [0, 1) from the platform's cryptographic generator. */
function randomFloat() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}

// ------------------------------------------------------------------ misc actions

/**
 * Choose the buddy: a Pokémon, optionally in one of its forms, or a fusion.
 * @param {{dexId?: number, form?: string, fusion?: number, shiny?: boolean}} ref
 */
function setBuddy(ref) {
  const shiny = Boolean(ref.shiny);
  if (ref.fusion) ctx.state.buddy = { fusion: ref.fusion, shiny };
  else {
    ctx.state.buddy = { dexId: ref.dexId, shiny };
    if (ref.form && ref.form !== 'base') ctx.state.buddy.form = ref.form;
  }
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
    `Replace everything saved in this browser with "${file.name}"? The file has ${imported.sessions.length} sessions and ${imported.pokemon.length} Pokémon. What is here now will be lost unless you exported it.`,
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
 * With `page: true` the dialog is a whole page instead of a box: it covers
 * the window, uses the page background, and has no dimmed backdrop. It is
 * still a dialog (no address of its own), but it takes one step in the
 * browser's history, so the browser's Back button and a phone's back gesture
 * close it like any page. Its content should include its own BACK button
 * that calls closeModal().
 *
 * @param {Node} content
 * @param {object} [options]
 * @param {boolean} [options.locked] No Escape / backdrop dismissal.
 * @param {string}  [options.label]  Accessible name.
 * @param {string}  [options.kind]   Extra class on the dialog box.
 * @param {boolean} [options.page]   Show as a full page (see above).
 * @param {() => void} [options.refresh] Called whenever the view is redrawn,
 *   so a dialog that stays open can redraw itself from the state.
 * @param {() => void} [options.onClose]
 */
function openModal(content, { locked = false, label = 'Dialog', kind = '', page = false, refresh, onClose } = {}) {
  const dialog = h('div', {
    class: page ? `page ${kind}` : `modal box ${kind}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  }, content);
  const layer = h('div', {
    class: `modal-layer${page ? ' is-page' : ''}`,
    onclick: (event) => {
      if (event.target === layer && !locked && !page) closeModal();
    },
  }, dialog);
  modalStack.push({ layer, locked, page, refresh, onClose, returnFocus: document.activeElement });
  modalRoot.append(layer);
  modalRoot.hidden = false;
  document.body.classList.add('has-modal');
  if (page) window.history.pushState({ pokechadPage: true }, '');
  const first = dialog.querySelector('[autofocus]') || dialog.querySelector('button, input, select, textarea');
  if (first) first.focus();
  return dialog;
}

/**
 * Close the top dialog, or every dialog when `all` is true.
 * @param {boolean} [all]
 * @param {boolean} [fromHistory] The browser already stepped back (internal).
 */
function closeModal(all = false, fromHistory = false) {
  do {
    const top = modalStack.pop();
    if (!top) break;
    top.layer.remove();
    if (top.onClose) top.onClose();
    if (top.page && !fromHistory) {
      // Give back the history step the page took when it opened.
      ignorePops++;
      window.history.back();
    }
    if (!all && top.returnFocus && top.returnFocus.isConnected) top.returnFocus.focus();
  } while (all);
  if (modalStack.length === 0) {
    modalRoot.hidden = true;
    document.body.classList.remove('has-modal');
  }
}

/** History steps taken back by closeModal itself, which onPopState must not act on. */
let ignorePops = 0;

/** The browser went back: if a full-page dialog is on top, that closes it. */
function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = modalStack[modalStack.length - 1];
  if (top && top.page) closeModal(false, true);
  // Something else is open above a page (a confirmation, a reveal): the page
  // stays, so take its history step again.
  else if (modalStack.some((m) => m.page)) window.history.pushState({ pokechadPage: true }, '');
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

/**
 * Show a short message at the bottom of the screen.
 * @param {string} message
 * @param {number} [duration] Milliseconds.
 * @param {{mon: object, shiny?: boolean}|null} [picture] A Pokémon to show beside it.
 */
function toast(message, duration = 3500, picture = null) {
  clearTimeout(toastTimer);
  setText(toastRoot, message);
  if (picture) toastRoot.prepend(sprite(picture.mon, { shiny: picture.shiny, eager: true }));
  toastRoot.classList.toggle('with-picture', Boolean(picture));
  toastRoot.classList.add('show');
  toastTimer = setTimeout(() => toastRoot.classList.remove('show'), duration);
}
