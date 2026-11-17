/**
 * Write the two saves used for trying things out:
 *
 *   tests/all-pokemon-save.json      1 copy of every Pokémon
 *   tests/all-pokemon-x10-save.json  10 copies of every Pokémon
 *
 * Both leave Charmander out (so the starter choice can still complete the
 * Pokédex), hold exactly 1,000,000 Pokécoins, and have no sessions, starter
 * or buddy.
 *
 * Every copy is a gift (`"source": "gift"`): it is held, but it was not
 * earned on the reward track, so the track stays at START with nothing
 * claimed and the first real reward is still reward number 1. The coins are
 * one entry in `grants`.
 *
 * Copies otherwise follow the game's own rules:
 *   - form: the first copy is Base, then one new alternate form per copy in
 *     Pokédex order; once every form is held the rest are Base (the game
 *     would pick at random there, but a fixed choice keeps the file stable);
 *   - shiny: the 7th copy of a common, the 5th of a legendary, the 2nd of a
 *     mythical.
 * Ten copies is above the usual limit of 7 / 5 / 2. Imported files are
 * trusted, so that loads fine.
 *
 * Load a file from Backup -> Load JSON. Run this again after the Pokédex
 * data changes:
 *
 *     node tools/make_test_save.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { defaultState, normalize } from '../js/state.js';
import { balance, trackCopies } from '../js/shop.js';
import { TIERS } from '../js/rewards.js';
import { BASE, indexForms, nextForm } from '../js/forms.js';

const COINS = 1_000_000;
const SKIP = 'charmander';
const AT = '2026-01-01T00:00:00.000Z'; // fixed, so regenerating gives the same file

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const dex = read('data/pokedex.json').species;
const forms = indexForms(read('data/forms.json'));

function write(file, copies) {
  const state = defaultState(Date.parse(AT));
  for (const species of dex) {
    if (species.slug === SKIP || species.sprite === false) continue;
    const held = [];
    for (let n = 1; n <= copies; n++) {
      const form = nextForm(forms, species.id, held, () => 0); // 0 picks Base once all are held
      held.push(form);
      const copy = { source: 'gift', dexId: species.id, tier: species.tier, shiny: n === TIERS[species.tier].cap, at: AT };
      if (form !== BASE) copy.form = form;
      state.pokemon.push(copy);
    }
  }
  // Gifts earn no coins, so the grant is the whole balance.
  state.grants = [{ coins: COINS, at: AT }];

  const save = normalize(state);
  if (balance(save) !== COINS) throw new Error(`balance is ${balance(save)}, expected ${COINS}`);
  if (trackCopies(save).length !== 0) throw new Error('a test save must not claim any station on the track');

  // One copy per line keeps the file readable and the diff small.
  const { pokemon, ...rest } = save;
  const head = JSON.stringify({ ...rest, pokemon: [] }, null, 2);
  const lines = pokemon.map((copy) => `    ${JSON.stringify(copy)}`).join(',\n');
  const text = head.replace('"pokemon": []', `"pokemon": [\n${lines}\n  ]`) + '\n';
  JSON.parse(text);
  writeFileSync(new URL(`tests/${file}`, root), text);
  console.log(`Wrote tests/${file}: ${pokemon.length} copies, ${COINS.toLocaleString('en-US')} Pokécoins.`);
}

write('all-pokemon-save.json', 1);
write('all-pokemon-x10-save.json', 10);
