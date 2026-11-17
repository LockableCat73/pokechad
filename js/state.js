/**
 * The saved state: loading, saving, validating, exporting and importing.
 * The object kept in localStorage and the exported backup file have exactly
 * the same shape, described field by field in documentation/storage.json.md.
 */

import { recalculate, clampStars, POINTS_PER_REWARD } from './scoring.js';
import { pityDry, TIERS } from './rewards.js';
import { SOURCES, UNLOCK_SOURCES, trackCopies, wallet } from './holdings.js';
import { roundMinutes } from './stopwatch.js';

/**
 * localStorage key. The name is historical: it has held every version of the
 * format so far, and stays the same so that an existing save is found.
 */
export const STORAGE_KEY = 'pokechad.v1';

/**
 * Where the untouched text of a version 1 save is kept the first time it is
 * converted, in case the conversion ever needs to be looked at again.
 */
export const BEFORE_V2_KEY = `${STORAGE_KEY}.before-schema-2`;

/**
 * Version of the JSON format written by this code.
 *   1  starter + rewards + shop.ledger
 *   2  pokemon + unlocks + fusions + grants (see upgradeFromV1)
 */
export const SCHEMA = 2;

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
    pity: { dry: 0 },
    wallet: { earned: 0, spent: 0, balance: 0 },
    sessions: [],
    pokemon: [],
    unlocks: [],
    fusions: [],
    grants: [],
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
 * `netAfter`, `score`, `pity`, `wallet`, each track copy's `n` and
 * `trackPoints`) are thrown away and recomputed, which is what makes a
 * hand-edited backup safe to import.
 *
 * A save in an older format is converted first (see upgradeFromV1).
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
  if (schema === 1) raw = upgradeFromV1(raw);

  const state = defaultState();
  state.createdAt = isoOr(raw.createdAt, state.createdAt);
  state.lastExportAt = isoOr(raw.lastExportAt, null);

  const seen = new Set();
  state.sessions = list(raw.sessions, 'sessions').map((s, i) =>
    normalizeSession(s, i, seen),
  );

  let starters = 0;
  let stations = 0;
  state.pokemon = list(raw.pokemon, 'pokemon').map((c, i) => {
    const copy = normalizeCopy(c, i);
    // There is one starter. Any further "starter" copy is kept as a gift.
    if (copy.source === 'starter' && ++starters > 1) copy.source = 'gift';
    if (copy.source === 'track') {
      copy.n = ++stations;
      copy.trackPoints = copy.n * POINTS_PER_REWARD;
    }
    return copy;
  });
  state.unlocks = list(raw.unlocks, 'unlocks').map((e, i) => normalizeUnlock(e, i));
  state.fusions = list(raw.fusions, 'fusions').map((e, i) => normalizeFusion(e, i));
  state.grants = list(raw.grants, 'grants').map((e, i) => normalizeGrant(e, i));

  state.buddy = normalizeBuddy(raw.buddy);
  state.active = normalizeActive(raw.active);
  state.pendingRating = normalizePending(raw.pendingRating);
  state.settings = { muted: Boolean(raw.settings && raw.settings.muted) };
  return refreshDerived(state);
}

/**
 * Recompute the fields that are worked out from the rest of the save:
 * `score` from the sessions, `pity` from the track copies, `wallet` from
 * everything that earns or costs coins. Called on every load and before
 * every write, so the stored copies of these numbers are never stale.
 *
 * @param {object} state Mutated.
 * @returns {object} The same state.
 */
export function refreshDerived(state) {
  state.score = recalculate(state.sessions);
  state.pity = { dry: pityDry(trackCopies(state)) };
  state.wallet = wallet(state);
  return state;
}

/**
 * Convert a version 1 save to version 2.
 *
 * Version 1 kept the starter, the track rewards and the shop in three
 * places, and could only describe a Pokémon as "earned on the track" or
 * "bought". Version 2 has one list of copies, each saying where it came
 * from:
 *
 *   starter               ->  pokemon, source "starter"
 *   rewards (in order)    ->  pokemon, source "track"
 *   ledger "copy"         ->  pokemon, source "shop", keeping its cost
 *   ledger "upgrade"      ->  unlocks, source "shop", keeping its cost
 *   ledger "fuse"         ->  fusions, keeping its cost
 *   ledger "unfuse"       ->  `undoneAt` on the fusion it undid
 *   ledger "grant"        ->  grants
 *
 * Nothing is dropped and no number changes: the same copies, the same
 * stations on the track, the same coin balance.
 *
 * @param {object} raw A parsed version 1 save.
 * @returns {object} The same data in the version 2 shape (not yet validated).
 */
export function upgradeFromV1(raw) {
  const pokemon = [];
  const unlocks = [];
  const fusions = [];
  const grants = [];

  const starter = raw.starter;
  if (starter && typeof starter === 'object' && Number.isInteger(Number(starter.dexId)) && Number(starter.dexId) >= 1) {
    pokemon.push({ source: 'starter', dexId: starter.dexId, tier: 'common', shiny: false, at: starter.at, sessionId: starter.sessionId });
  }
  list(raw.rewards, 'rewards').forEach((reward, i) => {
    if (!reward || typeof reward !== 'object') throw new Error(`Reward ${i + 1} is not an object.`);
    pokemon.push({ ...reward, source: 'track' });
  });

  list(raw.shop && raw.shop.ledger, 'shop.ledger').forEach((entry, i) => {
    const where = `Shop entry ${i + 1}`;
    if (!entry || typeof entry !== 'object') throw new Error(`${where} is not an object.`);
    switch (entry.type) {
      case 'copy':
        pokemon.push({ ...entry, source: 'shop' });
        break;
      case 'upgrade':
        unlocks.push({ dexId: entry.dexId, form: entry.form, source: 'shop', cost: entry.cost, at: entry.at });
        break;
      case 'fuse':
        fusions.push({ fusion: entry.fusion, cost: entry.cost, at: entry.at, undoneAt: null });
        break;
      case 'unfuse': {
        // Undoes the most recent fusion of that id which is still standing.
        const made = fusions.findLast((f) => Number(f.fusion) === Number(entry.fusion) && !f.undoneAt);
        if (made) made.undoneAt = isoOr(entry.at, new Date().toISOString());
        break;
      }
      case 'grant':
        grants.push({ coins: entry.coins, at: entry.at });
        break;
      default:
        throw new Error(`${where}: "type" must be one of copy, upgrade, fuse, unfuse, grant.`);
    }
  });

  const { starter: _starter, rewards: _rewards, shop: _shop, ...rest } = raw;
  return { ...rest, schema: 2, pokemon, unlocks, fusions, grants };
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

function requireDexId(value, where) {
  const dexId = Number(value);
  if (!Number.isInteger(dexId) || dexId < 1) {
    throw new Error(`${where}: "dexId" must be a Pokédex number.`);
  }
  return dexId;
}

function requireCost(value, where) {
  const cost = Number(value === undefined || value === null ? 0 : value);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error(`${where}: "cost" must be a number, 0 or more.`);
  }
  return cost;
}

/**
 * One copy of a Pokémon. Every copy has `source`, `dexId`, `tier`, `shiny`
 * and `at`, and `form` when it arrived in an alternate form. On top of that:
 *   track    `pity`, `sessionId`, `bonusForm` (plus `n` and `trackPoints`,
 *            which normalize() fills in from the copy's place on the track)
 *   starter  `sessionId`
 *   shop     `cost`
 */
function normalizeCopy(raw, index) {
  const where = `Pokémon ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  if (!SOURCES.includes(raw.source)) {
    throw new Error(`${where}: "source" must be one of ${SOURCES.join(', ')}.`);
  }
  const copy = {
    source: raw.source,
    // A track copy's place on the track; normalize() fills these in.
    ...(raw.source === 'track' ? { n: 0, trackPoints: 0 } : {}),
    dexId: requireDexId(raw.dexId, where),
    tier: TIERS[raw.tier] ? raw.tier : 'common',
    shiny: Boolean(raw.shiny),
    at: isoOr(raw.at, new Date().toISOString()),
  };
  // The form this copy arrived in. Absent means the ordinary (Base) form.
  if (typeof raw.form === 'string' && raw.form && raw.form !== 'base') copy.form = raw.form;
  if (raw.source === 'track') {
    copy.pity = Boolean(raw.pity);
    if (typeof raw.bonusForm === 'string' && raw.bonusForm) copy.bonusForm = raw.bonusForm;
  }
  if (raw.source === 'track' || raw.source === 'starter') {
    copy.sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : null;
  }
  if (raw.source === 'shop') copy.cost = requireCost(raw.cost, where);
  return copy;
}

/** A paid form the player can use: { dexId, form, source, cost, at }. */
function normalizeUnlock(raw, index) {
  const where = `Unlock ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  if (typeof raw.form !== 'string' || !raw.form) {
    throw new Error(`${where}: "form" must name the form.`);
  }
  const source = raw.source === undefined ? 'shop' : raw.source;
  if (!UNLOCK_SOURCES.includes(source)) {
    throw new Error(`${where}: "source" must be one of ${UNLOCK_SOURCES.join(', ')}.`);
  }
  return {
    dexId: requireDexId(raw.dexId, where),
    form: raw.form,
    source,
    // Only a bought form costs anything.
    cost: source === 'shop' ? requireCost(raw.cost, where) : 0,
    at: isoOr(raw.at, new Date().toISOString()),
  };
}

/** A fusion that was made: { fusion, cost, at, undoneAt }. */
function normalizeFusion(raw, index) {
  const where = `Fusion ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  const fusion = Number(raw.fusion);
  if (!Number.isInteger(fusion) || fusion < 1) {
    throw new Error(`${where}: "fusion" must be a fusion number.`);
  }
  return {
    fusion,
    cost: requireCost(raw.cost, where),
    at: isoOr(raw.at, new Date().toISOString()),
    undoneAt: isoOr(raw.undoneAt, null),
  };
}

/** Coins handed out directly: { coins, at }. */
function normalizeGrant(raw, index) {
  const where = `Grant ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where} is not an object.`);
  const coins = Number(raw.coins);
  if (!Number.isInteger(coins) || coins < 0) {
    throw new Error(`${where}: "coins" must be a whole number, 0 or more.`);
  }
  return { coins, at: isoOr(raw.at, new Date().toISOString()) };
}

/**
 * The buddy is either a Pokémon (optionally in one of its forms) or a fusion:
 *   { dexId, shiny, form? }   or   { fusion, shiny }
 */
function normalizeBuddy(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shiny = Boolean(raw.shiny);
  const fusion = Number(raw.fusion);
  if (raw.fusion !== undefined && raw.fusion !== null && Number.isInteger(fusion) && fusion > 0) {
    return { fusion, shiny };
  }
  const dexId = Number(raw.dexId);
  if (!Number.isInteger(dexId) || dexId < 1) return null;
  const buddy = { dexId, shiny };
  if (typeof raw.form === 'string' && raw.form && raw.form !== 'base') buddy.form = raw.form;
  return buddy;
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
    remindersSent: Number.isInteger(raw.remindersSent) && raw.remindersSent > 0 ? raw.remindersSent : 0,
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
 * being overwritten, and `problem` says what went wrong. A save in the older
 * version 1 format is converted, and its original text kept under
 * BEFORE_V2_KEY the first time that happens.
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
    const raw = JSON.parse(text);
    const state = normalize(raw);
    // Converting an older save: keep its original text, once, just in case.
    if (raw && Number(raw.schema) === 1) {
      try {
        if (!storage.getItem(BEFORE_V2_KEY)) storage.setItem(BEFORE_V2_KEY, text);
      } catch {
        /* no room for the spare copy; the conversion itself is still fine */
      }
    }
    return { state, problem: null };
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
 * Write the save to storage. The derived fields are brought up to date first.
 * @returns {boolean} false when the browser refused (private mode, quota).
 */
export function save(state, storage = globalThis.localStorage) {
  refreshDerived(state);
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
  refreshDerived(state);
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
