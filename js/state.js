/**
 * The saved state: loading, saving, validating, exporting and importing.
 * The object kept in localStorage and the exported backup file have exactly
 * the same shape, described field by field in documentation/storage.json.md.
 */

import { recalculate, clampStars, POINTS_PER_REWARD } from './scoring.js';
import { pityDry, TIERS } from './rewards.js';
import { roundMinutes } from './stopwatch.js';

/** localStorage key. The suffix changes only if the format breaks compatibility. */
export const STORAGE_KEY = 'pokechad.v1';

/** Version of the JSON format written by this code. */
export const SCHEMA = 1;

/** Longest description stored with a session. */
export const NOTE_MAX = 140;

/** A brand-new, empty save. */
export function defaultState(now = Date.now()) {
  return {
    app: 'pokechad',
    schema: SCHEMA,
    createdAt: new Date(now).toISOString(),
    lastExportAt: null,
    score: { net: 0, highWater: 0 },
    sessions: [],
    starter: null,
    rewards: [],
    pity: { dry: 0 },
    buddy: null,
    active: null,
    pendingRating: null,
    settings: { muted: false },
  };
}

/**
 * Turn any parsed JSON into a valid state, or throw an Error whose message
 * can be shown to the user.
 *
 * Source-of-truth fields are validated and kept. Derived fields (`points`,
 * `netAfter`, `score`, `pity`, each reward's `n` and `trackPoints`) are
 * thrown away and recomputed, which is what makes a hand-edited backup safe
 * to import.
 *
 * @param {unknown} raw
 * @returns {object} A fresh state object.
 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('This is not a PokéChad save: expected a JSON object.');
  }
  if (raw.app !== 'pokechad') {
    throw new Error('This is not a PokéChad save: the "app" field is missing.');
  }
  const schema = Number(raw.schema);
  if (!Number.isInteger(schema) || schema < 1) {
    throw new Error('The save has no valid "schema" number.');
  }
  if (schema > SCHEMA) {
    throw new Error(
      `The save uses format ${schema}, but this version of the site only understands up to ${SCHEMA}. Update the site first.`,
    );
  }

  const state = defaultState();
  state.createdAt = isoOr(raw.createdAt, state.createdAt);
  state.lastExportAt = isoOr(raw.lastExportAt, null);

  const seen = new Set();
  state.sessions = list(raw.sessions, 'sessions').map((s, i) =>
    normalizeSession(s, i, seen),
  );
  state.rewards = list(raw.rewards, 'rewards').map((r, i) => normalizeReward(r, i));

  state.starter = normalizeStarter(raw.starter);

  state.score = recalculate(state.sessions);
  state.pity = { dry: pityDry(state.rewards) };

  if (raw.buddy && Number.isInteger(Number(raw.buddy.dexId))) {
    state.buddy = { dexId: Number(raw.buddy.dexId), shiny: Boolean(raw.buddy.shiny) };
  }
  state.active = normalizeActive(raw.active);
  state.pendingRating = normalizePending(raw.pendingRating);
  state.settings = { muted: Boolean(raw.settings && raw.settings.muted) };
  return state;
}

function list(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`"${name}" must be a list.`);
  return value;
}

function isoOr(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function requireIso(value, where) {
  const result = isoOr(value, null);
  if (!result) throw new Error(`${where} is not a valid date/time.`);
  return result;
}

function requireKind(value, where) {
  if (value !== 'chad' && value !== 'chud') {
    throw new Error(`${where} must be "chad" or "chud".`);
  }
  return value;
}

function normalizePauses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((p) => ({ from: isoOr(p && p.from, null), to: isoOr(p && p.to, null) }))
    .filter((p) => p.from && p.to);
}

function normalizeSession(raw, index, seen) {
  const where = `Session ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  const minutes = Number(raw.activeMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`${where}: "activeMinutes" must be a number of minutes, 0 or more.`);
  }
  let id = typeof raw.id === 'string' && raw.id ? raw.id : newId('s');
  while (seen.has(id)) id = newId('s');
  seen.add(id);
  const startedAt = requireIso(raw.startedAt, `${where}: "startedAt"`);
  return {
    id,
    kind: requireKind(raw.kind, `${where}: "kind"`),
    method: raw.method === 'manual' ? 'manual' : 'stopwatch',
    startedAt,
    endedAt: isoOr(raw.endedAt, startedAt),
    activeMinutes: roundMinutes(minutes),
    pauses: normalizePauses(raw.pauses),
    autoEnded: Boolean(raw.autoEnded),
    stars: clampStars(raw.stars),
    note: typeof raw.note === 'string' ? raw.note.slice(0, NOTE_MAX) : '',
    points: 0,
    netAfter: 0,
  };
}

function normalizeReward(raw, index) {
  const where = `Reward ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  const dexId = Number(raw.dexId);
  if (!Number.isInteger(dexId) || dexId < 1) {
    throw new Error(`${where}: "dexId" must be a Pokédex number.`);
  }
  const n = index + 1;
  return {
    n,
    trackPoints: n * POINTS_PER_REWARD,
    dexId,
    tier: TIERS[raw.tier] ? raw.tier : 'common',
    shiny: Boolean(raw.shiny),
    pity: Boolean(raw.pity),
    at: isoOr(raw.at, new Date().toISOString()),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
  };
}

function normalizeStarter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dexId = Number(raw.dexId);
  if (!Number.isInteger(dexId) || dexId < 1) return null;
  return {
    dexId,
    at: isoOr(raw.at, new Date().toISOString()),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
  };
}

function normalizeActive(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'chad' && raw.kind !== 'chud') return null;
  const startedAt = isoOr(raw.startedAt, null);
  if (!startedAt) return null;
  return {
    kind: raw.kind,
    startedAt,
    pauses: normalizePauses(raw.pauses),
    pausedAt: isoOr(raw.pausedAt, null),
  };
}

function normalizePending(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'chad' && raw.kind !== 'chud') return null;
  const startedAt = isoOr(raw.startedAt, null);
  const minutes = Number(raw.activeMinutes);
  if (!startedAt || !Number.isFinite(minutes) || minutes < 0) return null;
  return {
    kind: raw.kind,
    method: 'stopwatch',
    startedAt,
    endedAt: isoOr(raw.endedAt, startedAt),
    activeMinutes: roundMinutes(minutes),
    pauses: normalizePauses(raw.pauses),
    autoEnded: Boolean(raw.autoEnded),
  };
}

/** A short unique id, e.g. "s-lq3k9x2a-7f3k". */
export function newId(prefix) {
  const random = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * Read the save from storage. Returns a fresh state when there is none.
 * A save that cannot be read is kept under a "<key>.corrupt" key instead of
 * being overwritten, and `problem` says what went wrong.
 *
 * @param {Storage} [storage]
 * @returns {{state: object, problem: string|null}}
 */
export function load(storage = globalThis.localStorage) {
  let text = null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaultState(), problem: 'Browser storage is not available. Nothing will be saved.' };
  }
  if (!text) return { state: defaultState(), problem: null };
  try {
    return { state: normalize(JSON.parse(text)), problem: null };
  } catch (error) {
    try {
      storage.setItem(`${STORAGE_KEY}.corrupt`, text);
    } catch {
      /* nothing more we can do */
    }
    return {
      state: defaultState(),
      problem: `The saved data could not be read (${error.message}) and was set aside. Import a backup to restore it.`,
    };
  }
}

/**
 * Write the save to storage.
 * @returns {boolean} false when the browser refused (private mode, quota).
 */
export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * The backup file contents: the whole state, pretty-printed, with the time of
 * export added. Also stamps `state.lastExportAt` so the backup reminder resets.
 *
 * @param {object} state Mutated: lastExportAt is updated.
 * @param {number} [now]
 * @returns {string} JSON text.
 */
export function exportJSON(state, now = Date.now()) {
  const at = new Date(now).toISOString();
  state.lastExportAt = at;
  return JSON.stringify({ ...state, exportedAt: at }, null, 2);
}

/**
 * Parse a backup file. Throws an Error with a readable message when the file
 * is not usable; otherwise returns a validated, recalculated state.
 *
 * @param {string} text
 */
export function importJSON(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`The file is not valid JSON (${error.message}).`);
  }
  const state = normalize(raw);
  // A stopwatch that was running when the backup was made is not restored:
  // it would otherwise count all the time between export and import.
  state.active = null;
  return state;
}

/** Suggested backup filename for a given day, e.g. pokechad-backup-2026-11-16.json */
export function backupFilename(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `pokechad-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}
