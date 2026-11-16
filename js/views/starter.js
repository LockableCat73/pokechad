/**
 * The starter choice. Shown once, when the score first reaches 1 point:
 * the player picks Bulbasaur, Charmander, Squirtle or Pikachu. This is an
 * extra reward in front of the track; the rolled rewards at 100, 200 ... are
 * unaffected.
 */

import { h, sprite, setText } from '../dom.js';
import { STARTERS } from '../rewards.js';

/**
 * @param {object} ctx                      App context.
 * @param {(dexId: number) => void} onPick  Called once with the chosen species.
 */
export function openStarter(ctx, onPick) {
  let chosen = null;
  const confirm = h('button', { class: 'btn btn-primary btn-big starter-confirm', type: 'button', disabled: true }, 'CHOOSE ONE');

  const options = STARTERS.map((dexId) => {
    const species = ctx.dex.byId.get(dexId);
    const button = h('button', {
      class: 'starter-option',
      type: 'button',
      role: 'radio',
      // The species' Pokédex colour from the data (green, red, blue, yellow ...);
      // the stylesheet turns it into the highlight used when this one is picked.
      dataset: { color: species.color || 'yellow' },
      'aria-checked': 'false',
      onclick: () => {
        chosen = dexId;
        ctx.sfx.play('click');
        for (const option of options) {
          const on = option === button;
          option.classList.toggle('selected', on);
          option.setAttribute('aria-checked', String(on));
        }
        confirm.disabled = false;
        confirm.dataset.color = species.color || 'yellow';
        setText(confirm, `CHOOSE ${species.name.toUpperCase()}`);
      },
    },
      sprite(species, { eager: true }),
      h('span', { class: 'label' }, species.name.toUpperCase()));
    return button;
  });

  confirm.addEventListener('click', () => {
    if (chosen !== null) onPick(chosen);
  });

  ctx.openModal(
    h('div', { class: 'stack' },
      h('h2', { class: 'center' }, 'CHOOSE YOUR STARTER'),
      h('p', { class: 'center' }, 'YOUR FIRST POINT IS ON THE BOARD. PICK THE POKéMON THAT JOINS YOU FIRST.'),
      h('div', { class: 'starter-grid', role: 'radiogroup', 'aria-label': 'Starter Pokémon' }, options),
      confirm),
    { locked: true, label: 'Choose your starter' },
  );
  ctx.sfx.play('open');
}
