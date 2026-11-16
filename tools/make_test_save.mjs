/**
 * Write tests/all-pokemon-save.json: a save for trying things out.
 *
 *   - one copy of every Pokémon except Charmander (so the starter choice
 *     can still complete the Pokédex);
 *   - exactly 1,000,000 Pokécoins, through a "grant" entry in the shop ledger;
 *   - no sessions, no starter, no buddy.
 *
 * Load the file from Backup -> Load JSON. Run this again after the Pokédex
 * data changes:
 *
 *     node tools/make_test_save.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { defaultState, normalize } from '../js/state.js';
import { balance } from '../js/shop.js';

const COINS = 1_000_000;
const SKIP = 'charmander';
const AT = '2026-01-01T00:00:00.000Z'; // fixed, so regenerating gives the same file

const root = new URL('../', import.meta.url);
const dex = JSON.parse(readFileSync(new URL('data/pokedex.json', root), 'utf8')).species;

const state = defaultState(Date.parse(AT));
state.rewards = dex
  .filter((species) => species.slug !== SKIP && species.sprite !== false)
  .map((species) => ({ dexId: species.id, tier: species.tier, shiny: false, pity: false, at: AT, sessionId: null }));
// Each reward is already worth one coin; the grant makes up the rest.
state.shop.ledger = [{ type: 'grant', coins: COINS - state.rewards.length, at: AT }];

const save = normalize(state);
if (balance(save) !== COINS) throw new Error(`balance is ${balance(save)}, expected ${COINS}`);

// One reward per line keeps the file readable and the diff small.
const { rewards, ...rest } = save;
const head = JSON.stringify({ ...rest, rewards: [] }, null, 2);
const lines = rewards.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
const text = head.replace('"rewards": []', `"rewards": [\n${lines}\n  ]`) + '\n';
JSON.parse(text);
writeFileSync(new URL('tests/all-pokemon-save.json', root), text);
console.log(`Wrote tests/all-pokemon-save.json: ${rewards.length} Pokémon, ${COINS.toLocaleString('en-US')} Pokécoins.`);
